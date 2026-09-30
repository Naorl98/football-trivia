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
import {
  generateCareerPaths,
  generateCompetitionWinners,
  generateTransferQuestions,
  generateTrophyQuestions,
  generateVenueQuestions,
  validateAndDedupe,
} from "../src/server/questions/knowledgeGenerators.ts";

const KB_ID_BASE = 500000;
const target = process.argv.includes("--remote") ? "remote" : "local";
const db = new D1Client({
  target,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "367bed473a2c48604d27f2e668162c49",
});

console.log(`\nGenerating questions from the knowledge base → ${target} D1\n`);

// ---- Read the facts.
const teams = await db.query(`
  SELECT t.id, t.name, t.name_he, t.country_name, t.founded,
         v.name AS venue_name, c.local_code, MIN(c.priority) AS competition_priority
    FROM teams t
    LEFT JOIN venues v ON v.id = t.venue_id
    LEFT JOIN team_seasons ts ON ts.team_id = t.id
    LEFT JOIN competitions c ON c.id = ts.competition_id
   GROUP BY t.id
`);

const winners = await db.query(`
  SELECT cw.competition_id, c.name AS competition_name, c.local_code AS competition_local_code,
         c.priority AS competition_priority, cw.season,
         w.name AS team_name, r.name AS runner_up_name
    FROM competition_winners cw
    JOIN competitions c ON c.id = cw.competition_id
    JOIN teams w ON w.id = cw.team_id
    LEFT JOIN teams r ON r.id = cw.runner_up_team_id
`);

const transfers = await db.query(`
  SELECT pt.player_id, p.name AS player_name,
         pt.from_team_id, ft.name AS from_team_name,
         pt.to_team_id, tt.name AS to_team_name,
         pt.transfer_date, pt.transfer_type
    FROM player_transfers pt
    JOIN players p ON p.id = pt.player_id
    LEFT JOIN teams ft ON ft.id = pt.from_team_id
    LEFT JOIN teams tt ON tt.id = pt.to_team_id
`);

const players = await db.query(`SELECT id, name, name_he, nationality, position FROM players`);

const trophies = await db.query(`
  SELECT tr.player_id, p.name AS player_name, tr.competition_name, tr.season, tr.place
    FROM player_trophies tr
    JOIN players p ON p.id = tr.player_id
`);

console.log(
  `  facts: ${teams.length} teams, ${players.length} players, ${transfers.length} transfers, ` +
    `${winners.length} competition winners, ${trophies.length} trophies`
);

// ---- Generate candidates.
const transfersByPlayer = new Map();
for (const row of transfers) {
  transfersByPlayer.set(row.player_id, [...(transfersByPlayer.get(row.player_id) ?? []), row]);
}

const candidates = [
  ...generateCompetitionWinners(winners),
  ...generateTransferQuestions(transfers, teams),
  ...generateCareerPaths(transfersByPlayer, players),
  ...generateVenueQuestions(teams),
  ...generateTrophyQuestions(trophies),
];

console.log(`  candidates generated: ${candidates.length}`);

// ---- Quality gates + dedupe against what already exists.
const existingRows = await db.query(
  `SELECT semantic_key FROM questions WHERE semantic_key IS NOT NULL`
);
const existingKeys = new Set(existingRows.map((r) => String(r.semantic_key)));

const { accepted, rejected } = validateAndDedupe(candidates, existingKeys);
const reasons = {};
for (const r of rejected) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
console.log(`  accepted: ${accepted.length}, rejected: ${rejected.length}`, reasons);

if (accepted.length === 0) {
  console.log(`\nNothing new to write. Import more data first: npm run data:harvest\n`);
  process.exit(0);
}

// ---- Assign stable ids and write.
const maxRow = await db.query(
  `SELECT COALESCE(MAX(id), ${KB_ID_BASE - 1}) AS max_id FROM questions WHERE id >= ${KB_ID_BASE}`
);
let nextId = Number(maxRow[0]?.max_id ?? KB_ID_BASE - 1) + 1;

const statements = [];
for (const q of accepted) {
  const id = nextId++;
  statements.push(
    `INSERT INTO questions (id, public_id, mode, category, difficulty, question_he, explanation_he,
       verified, active, source_label, canonical_answer, supports_free_text, semantic_key, generated)
     VALUES (${id}, ${sqlValue(`kb_${id}`)}, ${sqlValue(q.mode)}, ${sqlValue(q.category)},
             ${sqlValue(q.difficulty)}, ${sqlValue(q.questionHe)}, ${sqlValue(q.explanationHe)},
             1, 1, ${sqlValue(q.sourceLabel)},
             ${q.freeText ? sqlValue(q.canonicalAnswer) : "NULL"}, ${q.freeText ? 1 : 0},
             ${sqlValue(q.semanticKey)}, 1);`
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
}

// Write in chunks so a single CLI invocation never gets unwieldy.
const CHUNK = 2000;
for (let i = 0; i < statements.length; i += CHUNK) {
  await db.execute(statements.slice(i, i + CHUNK));
  console.log(`  wrote ${Math.min(i + CHUNK, statements.length)}/${statements.length} statements`);
}

const byDifficulty = {};
for (const q of accepted) byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] ?? 0) + 1;

console.log(`\n  ${accepted.length} new question(s) written.`);
console.log(`  by difficulty:`, byDifficulty);
console.log(`\nNext: npm run questions:stats${target === "remote" ? " -- --remote" : ""}\n`);
