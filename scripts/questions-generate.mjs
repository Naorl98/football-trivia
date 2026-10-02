#!/usr/bin/env node
// Turns imported football facts into playable questions.
//   npm run questions:generate [-- --remote]
//
// Pipeline: D1 facts -> generators -> quality gates -> dedupe -> difficulty ->
// D1 questions. Generated rows live above id 500000 so they never collide with
// curated questions (1..N) or the static generated bank (100000+), and each is
// keyed by its semantic key so re-running is idempotent.

import { D1Client, sqlValue } from "../src/server/sync/d1Client.ts";
import { normalizeAnswer } from "../src/shared/answerMatching.ts";
import { chunkByCost, maxWritesPerRun, planWrites } from "../src/server/sync/writeBudget.ts";
import { curatedRecognition } from "../seed/recognition.ts";
import { answerTypeFor } from "../src/server/football/archetypes.ts";
import { isQuickStartFriendly } from "../src/server/football/difficulty.ts";
import { validateSemantics } from "../src/server/football/validate.ts";
import { generateKnowledgeQuestions, loadKnowledgeFacts } from "../src/server/football/pipeline.ts";
import { finalizeHints, validateAndDedupe } from "../src/server/questions/knowledgeGenerators.ts";

const KB_ID_BASE = 500000;
const target = process.argv.includes("--remote") ? "remote" : "local";
// Reads the facts, runs every generator and applies the quality gates, then
// reports what it would write without writing it.
const dryRun = process.argv.includes("--dry-run");
// Re-derives hints for questions already stored, which normal generation skips.
const rewriteHints = process.argv.includes("--rewrite-hints");
const db = new D1Client({
  target,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "367bed473a2c48604d27f2e668162c49",
});

console.log(`\nGenerating questions from the knowledge base → ${target} D1\n`);

/*
  ---- Read the facts and generate.

  Both steps live in src/server/football/pipeline.ts, which the audit
  (npm run questions:audit) also calls. That shared call is what lets the audit
  say "this stored question would not be generated today" and mean it: it is
  literally the same computation over the same rows, not a second
  implementation of the same intent.
*/
const facts = await loadKnowledgeFacts(db, curatedRecognition());
const { context, teams, players, transfers, winners, trophies, playerTeams, coachSpells, seasonStats } = facts;

console.log(
  `  facts: ${teams.length} teams, ${players.length} players, ${transfers.length} transfers, ` +
    `${winners.length} competition winners, ${trophies.length} trophies,\n` +
    `         ${playerTeams.length} player-club links, ${coachSpells.length} coach spells, ` +
    `${seasonStats.length} season stat rows`
);

const generation = generateKnowledgeQuestions(facts);
const { byGenerator, candidates } = generation;

console.log(`  team kinds:`, generation.teamKindCounts);
if (Object.keys(generation.droppedCareerLinks).length > 0) {
  console.log(`  player-club links dropped as non-club:`, generation.droppedCareerLinks);
}

console.log(`  candidates generated: ${candidates.length}`);
for (const [name, list] of Object.entries(byGenerator)) {
  if (list.length > 0) console.log(`    ${name.padEnd(20)} ${list.length}`);
}

/**
 * --rewrite-hints: re-derive hints for questions that already exist.
 *
 * Generation is idempotent by semantic key, so an improvement to hint building
 * reaches no already-stored question: every candidate is rejected as a duplicate
 * before its hints are ever looked at. This path matches regenerated candidates to
 * stored questions by that same key and replaces the hints where they differ,
 * touching nothing else about the question — the id, the options and the answer
 * are left exactly as they are, so nobody's saved challenge changes meaning.
 */
if (rewriteHints) {
  const finalized = new Map();
  for (const q of candidates) {
    if (!finalized.has(q.semanticKey)) finalized.set(q.semanticKey, finalizeHints(q).hints ?? []);
  }

  const stored = await db.query(
    `SELECT q.id, q.semantic_key,
            (SELECT GROUP_CONCAT(h.text, '') FROM question_hints h
              WHERE h.question_id = q.id ORDER BY h.order_index) AS hint_text
       FROM questions q
      WHERE q.semantic_key IS NOT NULL AND q.id >= ${KB_ID_BASE}`
  );

  const statements = [];
  let changed = 0;
  let unchanged = 0;
  let emptied = 0;

  for (const row of stored) {
    const next = finalized.get(String(row.semantic_key));
    if (!next) continue;
    const current = row.hint_text ? String(row.hint_text).split("") : [];
    if (current.length === next.length && current.every((t, i) => t === next[i])) {
      unchanged++;
      continue;
    }
    changed++;
    if (next.length === 0) emptied++;
    const id = Number(row.id);
    statements.push(`DELETE FROM question_hints WHERE question_id = ${id};`);
    next.forEach((text, index) => {
      statements.push(
        `INSERT INTO question_hints (question_id, text, order_index) VALUES (${id}, ${sqlValue(text)}, ${index});`
      );
    });
  }

  console.log(`\n  hint rewrite over ${stored.length} stored knowledge-base questions`);
  console.log(`    unchanged            : ${unchanged}`);
  console.log(`    to rewrite           : ${changed}`);
  console.log(`    left with no hint    : ${emptied}  (every candidate repeated the question or the answer)`);

  if (statements.length === 0) {
    console.log(`\n  Nothing to rewrite.\n`);
    process.exit(0);
  }

  const budget = (() => {
    const flag = process.argv.indexOf("--max-writes");
    return flag !== -1 ? Number(process.argv[flag + 1]) : maxWritesPerRun();
  })();
  const priced = planWrites(statements);
  console.log(`    estimated rows       : ${priced.estimatedRowsWritten.toLocaleString()} (budget ${budget.toLocaleString()})`);

  if (dryRun) {
    // One sample per difficulty, so the ordering and the strength gating can be
    // read rather than taken on trust.
    const sampleByDifficulty = new Map();
    for (const q of candidates) {
      const built = finalized.get(q.semanticKey) ?? [];
      if (built.length === 0 || sampleByDifficulty.has(q.difficulty)) continue;
      sampleByDifficulty.set(q.difficulty, { q, built });
    }
    for (const level of ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"]) {
      const sample = sampleByDifficulty.get(level);
      if (!sample) continue;
      console.log(`\n  [${level}] ${sample.q.questionHe}`);
      console.log(`      answer : ${sample.q.options[sample.q.correctIndex]}`);
      sample.built.forEach((h, i) => console.log(`      hint ${i + 1} : ${h}`));
    }

    // Where hints disappear, and why it is the right outcome.
    const emptyByCategory = {};
    for (const q of candidates) {
      if ((finalized.get(q.semanticKey) ?? []).length > 0) continue;
      emptyByCategory[q.category] = (emptyByCategory[q.category] ?? 0) + 1;
    }
    console.log(`\n  candidates left with no hint, by category:`, emptyByCategory);

    console.log(`\n  DRY RUN — nothing written.\n`);
    process.exit(0);
  }

  // Chunk by cost and stop at the budget; re-running continues, because a
  // question whose hints already match is skipped on the next pass.
  let spent = 0;
  let written = 0;
  for (const chunk of chunkByCost(statements, 4000)) {
    const cost = planWrites(chunk).estimatedRowsWritten;
    if (spent + cost > budget && written > 0) {
      console.log(`    stopped at the write budget — re-run to continue`);
      break;
    }
    await db.execute(chunk);
    spent += cost;
    written += chunk.length;
    console.log(`    wrote ${written}/${statements.length} statements`);
  }
  console.log(`\n  Hint rewrite done (~${spent.toLocaleString()} rows).\n`);
  process.exit(0);
}

// ---- Quality gates + dedupe against what already exists.
const existingRows = await db.query(
  `SELECT semantic_key FROM questions WHERE semantic_key IS NOT NULL`
);
const existingKeys = new Set(existingRows.map((r) => String(r.semantic_key)));

const { accepted, rejected } = validateAndDedupe(candidates, existingKeys);
const reasons = {};
for (const r of rejected) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
console.log(`  accepted: ${accepted.length}, rejected: ${rejected.length}`, reasons);

// Warnings do not block a question, but they are worth seeing: a glued Hebrew
// preposition or a movement wording the provider does not actually support is a
// wording problem, not a correctness one, and the count says how many there are.
const warnings = {};
for (const q of accepted) {
  for (const issue of validateSemantics(q)) {
    if (issue.severity === "WARN") warnings[issue.code] = (warnings[issue.code] ?? 0) + 1;
  }
}
if (Object.keys(warnings).length > 0) console.log(`  warnings:`, warnings);

if (accepted.length === 0) {
  console.log(`\nNothing new to write. Import more data first: npm run data:harvest\n`);
  process.exit(0);
}

if (dryRun) {
  const byCategory = {};
  const byMode = {};
  let freeText = 0;
  for (const q of accepted) {
    byCategory[q.category] = (byCategory[q.category] ?? 0) + 1;
    byMode[q.mode] = (byMode[q.mode] ?? 0) + 1;
    if (q.freeText) freeText++;
  }
  console.log(`\n  DRY RUN — nothing written.`);
  console.log(`  would insert ${accepted.length} question(s); ${freeText} free-text capable`);
  console.log(`  by category:`, byCategory);
  console.log(`  by mode    :`, byMode);
  console.log(`\n  sample:`);
  for (const q of accepted.slice(0, 5)) console.log(`    [${q.category}] ${q.questionHe} → ${q.options[q.correctIndex]}`);
  console.log();
  process.exit(0);
}

// ---- Assign stable ids and write, within the run's D1 write allowance.
const maxRow = await db.query(
  `SELECT COALESCE(MAX(id), ${KB_ID_BASE - 1}) AS max_id FROM questions WHERE id >= ${KB_ID_BASE}`
);
let nextId = Number(maxRow[0]?.max_id ?? KB_ID_BASE - 1) + 1;

/**
 * Interleaves the accepted questions by category.
 *
 * A run is normally cut short by the write budget rather than by running out of
 * questions, so whatever sits at the front of the list is what production
 * actually gets. Generated in generator order that front is all transfers —
 * they outnumber everything else roughly two to one — and the modes with only a
 * few dozen candidates would never be reached at all. Round-robin spends the
 * budget across every category at once: the scarce ones are written out
 * completely because they run dry early, and the abundant ones contribute evenly
 * instead of crowding the rest out.
 */
/**
 * Draws per round, by category.
 *
 * The under-served modes are weighted up so that a run cut short by the write
 * budget closes the gaps rather than widening them. Transfers and career paths
 * already dominate the bank by a wide margin, so they take one slot a round and
 * the specialist modes take four; a category that runs dry simply stops being
 * drawn, which is why the scarce ones end up written in full.
 */
const CATEGORY_WEIGHT = {
  WHO_AM_I: 5,
  GUESS_THE_CLUB: 5,
  CHAMPIONS_LEAGUE: 4,
  WORLD_CUP: 4,
  NATIONAL_TEAMS: 3,
  COACHES: 3,
  TITLES: 2,
  STATS: 2,
  STADIUMS: 2,
  CLUBS: 2,
  PLAYERS: 2,
  CAREERS: 1,
  CAREER_PATH: 1,
  TRANSFERS: 1,
};
const DEFAULT_CATEGORY_WEIGHT = 2;

function interleaveByCategory(questions) {
  const queues = new Map();
  for (const q of questions) {
    queues.set(q.category, [...(queues.get(q.category) ?? []), q]);
  }
  // Heaviest first, so the order inside a partially-written round also favours
  // the modes that need the most.
  const order = [...queues.keys()].sort(
    (a, b) =>
      (CATEGORY_WEIGHT[b] ?? DEFAULT_CATEGORY_WEIGHT) - (CATEGORY_WEIGHT[a] ?? DEFAULT_CATEGORY_WEIGHT) ||
      a.localeCompare(b)
  );

  const cursor = new Map(order.map((category) => [category, 0]));
  const out = [];
  while (out.length < questions.length) {
    let progressed = false;
    for (const category of order) {
      const queue = queues.get(category);
      const weight = CATEGORY_WEIGHT[category] ?? DEFAULT_CATEGORY_WEIGHT;
      let taken = 0;
      let at = cursor.get(category);
      while (taken < weight && at < queue.length) {
        out.push(queue[at]);
        at++;
        taken++;
        progressed = true;
      }
      cursor.set(category, at);
    }
    if (!progressed) break;
  }
  return out;
}

/**
 * The semantic facts stored alongside a question.
 *
 * Written so the audit can judge a question later without re-deriving how it was
 * built, and so Quick Start can filter on familiarity in SQL rather than
 * trusting the client. See migration 0008.
 */
function semanticColumns(q) {
  const signals = q.difficultySignals ?? {};
  const answerType = q.archetype
    ? answerTypeFor(q.archetype, q.resolvedTeamType)
    : null;
  const quickStartSafe = isQuickStartFriendly({
    band: q.difficulty,
    subjectFame: signals.subjectFame ?? null,
    entityProminence: signals.entityProminence ?? null,
    tier: signals.tier ?? null,
  });
  return {
    archetype: q.archetype ?? null,
    answerEntityType: answerType,
    factConfidence: q.factConfidence ?? null,
    subjectFame: typeof signals.subjectFame === "number" ? signals.subjectFame : null,
    entityProminence: typeof signals.entityProminence === "number" ? signals.entityProminence : null,
    domainTier: signals.tier ?? null,
    quickStartSafe: quickStartSafe ? 1 : 0,
  };
}

/** SQL for one question, kept together so a question is never half-written. */
function statementsForQuestion(q, id) {
  const statements = [];
  const semantics = semanticColumns(q);
  statements.push(
    `INSERT INTO questions (id, public_id, mode, category, difficulty, question_he, explanation_he,
       verified, active, source_label, canonical_answer, supports_free_text, semantic_key, generated,
       archetype, answer_entity_type, fact_confidence, subject_fame, entity_prominence, domain_tier,
       quick_start_safe)
     VALUES (${id}, ${sqlValue(`kb_${id}`)}, ${sqlValue(q.mode)}, ${sqlValue(q.category)},
             ${sqlValue(q.difficulty)}, ${sqlValue(q.questionHe)}, ${sqlValue(q.explanationHe)},
             1, 1, ${sqlValue(q.sourceLabel)},
             ${q.freeText ? sqlValue(q.canonicalAnswer) : "NULL"}, ${q.freeText ? 1 : 0},
             ${sqlValue(q.semanticKey)}, 1,
             ${sqlValue(semantics.archetype)}, ${sqlValue(semantics.answerEntityType)},
             ${sqlValue(semantics.factConfidence)}, ${sqlValue(semantics.subjectFame)},
             ${sqlValue(semantics.entityProminence)}, ${sqlValue(semantics.domainTier)},
             ${semantics.quickStartSafe});`
  );

  q.options.forEach((option, index) => {
    statements.push(
      `INSERT INTO question_options (question_id, answer_text, is_correct, sort_order)
       VALUES (${id}, ${sqlValue(option)}, ${index === q.correctIndex ? 1 : 0}, ${index});`
    );
  });

  (q.clues ?? []).forEach((clue, index) => {
    statements.push(
      `INSERT INTO question_clues (question_id, clue_he, sort_order) VALUES (${id}, ${sqlValue(clue)}, ${index});`
    );
  });

  q.scopes.forEach((scope) => {
    statements.push(
      `INSERT INTO question_scopes (question_id, scope_type, scope_value)
       VALUES (${id}, ${sqlValue(scope.type)}, ${sqlValue(scope.value)});`
    );
  });

  if (q.freeText) {
    const seen = new Set();
    for (const alias of [q.canonicalAnswer, ...(q.aliases ?? [])]) {
      if (!alias) continue;
      const normalized = normalizeAnswer(alias);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      statements.push(
        `INSERT INTO answer_aliases (question_id, alias, normalized, lang)
         VALUES (${id}, ${sqlValue(alias)}, ${sqlValue(normalized)},
                 ${sqlValue(/[֐-׿]/.test(alias) ? "he" : "en")});`
      );
    }
  }

  (q.hints ?? []).forEach((hint, index) => {
    statements.push(
      `INSERT INTO question_hints (question_id, text, order_index) VALUES (${id}, ${sqlValue(hint)}, ${index});`
    );
  });
  return statements;
}

/**
 * Selects as many whole questions as the run's write allowance covers.
 *
 * D1 bills rows written and counts every index entry as a row, which puts one
 * question at roughly thirty rows once its options, clues, scopes, aliases and
 * hints are priced. The full set therefore costs several times the free tier's
 * 100,000-a-day, so the ceiling decides how much lands and the remainder waits
 * for the next run. That is safe to leave half-done: every question carries a
 * semantic key and is skipped if it is already stored, so re-running continues
 * rather than duplicating.
 */
const maxWrites = (() => {
  const flag = process.argv.indexOf("--max-writes");
  if (flag !== -1) return Number(process.argv[flag + 1]);
  return maxWritesPerRun();
})();

const ordered = interleaveByCategory(accepted);
const selected = [];
const statements = [];
let estimatedRows = 0;

for (const q of ordered) {
  const id = nextId;
  const group = statementsForQuestion(q, id);
  const cost = planWrites(group).estimatedRowsWritten;
  if (estimatedRows + cost > maxWrites && selected.length > 0) break;
  nextId++;
  selected.push(q);
  statements.push(...group);
  estimatedRows += cost;
}

const deferredCount = accepted.length - selected.length;
console.log(
  `\n  write budget ${maxWrites.toLocaleString()} rows → writing ${selected.length.toLocaleString()} question(s) ` +
    `(~${estimatedRows.toLocaleString()} rows, ${statements.length.toLocaleString()} statements)`
);
if (deferredCount > 0) {
  console.log(
    `  ${deferredCount.toLocaleString()} question(s) left for the next run — re-run this command to continue`
  );
}

// Chunk by cost rather than by statement count, so one batch never balloons.
const chunks = chunkByCost(statements, 4000);
let written = 0;
for (const chunk of chunks) {
  await db.execute(chunk);
  written += chunk.length;
  console.log(`  wrote ${written}/${statements.length} statements`);
}

const byDifficulty = {};
const byCategoryWritten = {};
for (const q of selected) {
  byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] ?? 0) + 1;
  byCategoryWritten[q.category] = (byCategoryWritten[q.category] ?? 0) + 1;
}

console.log(`\n  ${selected.length} new question(s) written.`);
console.log(`  by difficulty:`, byDifficulty);
console.log(`  by category  :`, byCategoryWritten);
console.log(`\nNext: npm run questions:stats${target === "remote" ? " -- --remote" : ""}\n`);
