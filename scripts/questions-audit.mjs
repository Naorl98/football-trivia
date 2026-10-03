#!/usr/bin/env node
// Audits — and optionally repairs — the live question bank.
//
//   npm run questions:audit                        # local, report only
//   npm run questions:audit -- --remote            # production, report only
//   npm run questions:audit -- --remote --repair   # apply the repairs
//   npm run questions:audit -- --remote --repair --max-writes 90000
//
// WHY THIS EXISTS
//
// Fixing the generators fixes the NEXT question. It does nothing for the 15,186
// already live, and those are what players meet. Production held, measured:
//
//   2,291 club-transfer questions with a national team among the options
//      52 "איזה מועדון אני?" questions with a national team as an option,
//         32 of them with the national team as the correct answer
//     213 questions offering a reserve or youth side as a club
//     131 position questions answering a precise role from broad data
//   8,106 questions labelled HARD — 53% of the bank
//
// HOW IT JUDGES A QUESTION
//
// Not with a second set of rules. It re-runs the real generators over the real
// facts (src/server/football/pipeline.ts, the same call `questions:generate`
// makes) and compares each stored question with what its own semantic key
// produces today. Three outcomes:
//
//   REGENERATED and identical   leave alone
//   REGENERATED and different   repair in place, field by field
//   NOT REGENERATED             the fact no longer supports a question of this
//                               shape, so deactivate
//
// That last case is the one that matters most and the one a checklist-style
// audit would miss: "Qatar" stopped being a valid answer to "which club am I?"
// not because a rule flagged it, but because the generator that produced it will
// not produce it again.
//
// IDS AND KEYS ARE NEVER REWRITTEN. A repair is an UPDATE to the columns that
// changed. Shared challenge links and stored daily challenges keep resolving to
// the same questions, and `content_hash` is recomputed so the curated applier
// (scripts/seed-apply.mjs) sees the repaired question as current rather than
// rewriting all 30 of its rows again.

import { D1Client, sqlValue } from "../src/server/sync/d1Client.ts";
import { maxWritesPerRun, planWrites } from "../src/server/sync/writeBudget.ts";
import { normalizeAnswer } from "../src/shared/answerMatching.ts";
import { generateKnowledgeQuestions, knowledgeKeyPrefixes, loadKnowledgeFacts } from "../src/server/football/pipeline.ts";
import { curatedRecognition } from "../seed/recognition.ts";
import { generateAll } from "../seed/generators/index.ts";
import { answerTypeFor, ARCHETYPES } from "../src/server/football/archetypes.ts";
import { archetypeForStoredKey, CLUB_ONLY_ARCHETYPES, keyPrefix } from "../src/server/football/storedKeys.ts";
import { isQuickStartFriendly } from "../src/server/football/difficulty.ts";
import { validateSemantics } from "../src/server/football/validate.ts";
import { validateAndDedupe } from "../src/server/questions/knowledgeGenerators.ts";
import { BROAD_HE, DETAILED_HE } from "../src/server/football/positions.ts";
import { classifyMovement, LOAN_WORDING_HE, MOVED_PERMANENTLY_HE } from "../src/server/football/career.ts";
import { contentHashFor } from "../seed/contentHash.ts";

const args = process.argv.slice(2);
const target = args.includes("--remote") ? "remote" : "local";
const repair = args.includes("--repair");
// Replaces every option set the rules would pick differently, not only the ones
// that are actually wrong. See planRepair — it costs about 240,000 rows written
// and buys plausibility rather than correctness.
const fullOptions = args.includes("--full-options");
const sampleSize = (() => {
  const at = args.indexOf("--sample");
  return at !== -1 ? Number(args[at + 1]) : 6;
})();
const maxWrites = (() => {
  const at = args.indexOf("--max-writes");
  return at !== -1 ? Number(args[at + 1]) : maxWritesPerRun();
})();

const db = new D1Client({
  target,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "367bed473a2c48604d27f2e668162c49",
});

const BANDS = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];
const bandRank = (band) => BANDS.indexOf(band);

console.log(`\nFootball IQ question audit → ${target} D1${repair ? "  (REPAIR)" : "  (report only)"}\n`);

// ---------------------------------------------------------------------------
// 1. What the rules produce today
// ---------------------------------------------------------------------------
const recognition = curatedRecognition();
const facts = await loadKnowledgeFacts(db, recognition);
const { context } = facts;
const generation = generateKnowledgeQuestions(facts);
const curatedQuestions = generateAll();

/*
  THE DESIRED BANK — and it has to be the ACCEPTED one.

  `generation.candidates` are raw: they have not passed the quality gates and
  their hints have not been finalised. Repairing a stored question towards a raw
  candidate would be two separate mistakes. It would delete every hint, because
  finalizeHints runs inside validateAndDedupe and a raw candidate carries
  `hintCandidates` rather than `hints`. And it would repair a question towards a
  shape the gate would reject — the audit would be fixing the bank into a state
  the generator refuses to produce.

  So the candidates go through the real gate first, with an empty "already
  stored" set so that nothing is rejected merely for existing.
*/
const validated = validateAndDedupe(generation.candidates, new Set());
const rejectionReasons = {};
for (const r of validated.rejected) {
  rejectionReasons[r.reason] = (rejectionReasons[r.reason] ?? 0) + 1;
}

/** semanticKey -> the question the rules would produce today. */
const desired = new Map();
for (const q of validated.accepted) if (!desired.has(q.semanticKey)) desired.set(q.semanticKey, q);
for (const q of curatedQuestions) if (!desired.has(q.semanticKey)) desired.set(q.semanticKey, q);

/** Key prefixes this audit is competent to judge. */
const knownPrefixes = knowledgeKeyPrefixes(generation);
for (const q of curatedQuestions) knownPrefixes.add(keyPrefix(q.semanticKey));

console.log(`  rules produce ${desired.size.toLocaleString()} distinct question(s) from current data`);
console.log(
  `    ${validated.accepted.length.toLocaleString()} knowledge-base + ${curatedQuestions.length.toLocaleString()} curated,` +
    ` ${validated.rejected.length.toLocaleString()} candidate(s) rejected by the gates`
);
if (Object.keys(rejectionReasons).length > 0) console.log(`    rejections:`, rejectionReasons);
console.log(`  team kinds:`, generation.teamKindCounts);

// ---------------------------------------------------------------------------
// 2. What is stored
// ---------------------------------------------------------------------------
const [storedQuestions, storedOptions, storedClues, storedHints, storedAliases, storedScopes] =
  await Promise.all([
    db.query(`
      SELECT id, semantic_key, mode, category, difficulty, question_he, explanation_he,
             source_label, canonical_answer, supports_free_text, active, content_hash,
             archetype, answer_entity_type, quick_start_safe
        FROM questions
    `),
    db.query(`SELECT question_id, answer_text, is_correct, sort_order FROM question_options`),
    db.query(`SELECT question_id, clue_he, sort_order FROM question_clues`),
    db.query(`SELECT question_id, text, order_index FROM question_hints`),
    db.query(`SELECT question_id, alias FROM answer_aliases`),
    db.query(`SELECT question_id, scope_type, scope_value FROM question_scopes`),
  ]);

const group = (rows, key, map) => {
  const out = new Map();
  for (const row of rows) {
    const id = Number(row[key]);
    out.set(id, [...(out.get(id) ?? []), map(row)]);
  }
  return out;
};

const optionsById = group(storedOptions, "question_id", (r) => ({
  text: String(r.answer_text),
  correct: Number(r.is_correct) === 1,
  order: Number(r.sort_order),
}));
for (const list of optionsById.values()) list.sort((a, b) => a.order - b.order);

const cluesById = group(storedClues, "question_id", (r) => ({
  text: String(r.clue_he),
  order: Number(r.sort_order),
}));
for (const list of cluesById.values()) list.sort((a, b) => a.order - b.order);

const hintsById = group(storedHints, "question_id", (r) => ({
  text: String(r.text),
  order: Number(r.order_index),
}));
for (const list of hintsById.values()) list.sort((a, b) => a.order - b.order);

const aliasesById = group(storedAliases, "question_id", (r) => String(r.alias));
const scopesById = group(storedScopes, "question_id", (r) => ({
  type: String(r.scope_type),
  value: String(r.scope_value),
}));

/*
  Sorted by id, because the duplicate rule depends on the order.

  `SELECT ... FROM questions` has no ORDER BY, so whichever of two identical
  questions arrives first was deciding which one is the original and which gets
  deactivated — and that could differ between runs. Ascending id makes it the
  older question that survives, which is the hand-written one: the curated bank
  was seeded first, and a later generated question that reproduces it is the
  copy.
*/
const active = storedQuestions
  .filter((q) => Number(q.active) === 1)
  .sort((a, b) => Number(a.id) - Number(b.id));
console.log(
  `  stored: ${storedQuestions.length.toLocaleString()} question(s), ${active.length.toLocaleString()} active\n`
);

// ---------------------------------------------------------------------------
// 3. Typing stored option text
// ---------------------------------------------------------------------------

/**
 * Resolves one option's entity type from its text.
 *
 * Needed because stored options are plain strings: the type was never recorded,
 * which is precisely how a national team ended up in a club question. Resolution
 * is by lookup against the knowledge base and the curated registries, in the
 * order that a collision should be decided — a name that is both a team and
 * something else is a team, because that is how it got into the bank.
 */
const venueNames = new Set();
for (const profile of context.teamById.values()) {
  if (profile.venueName) venueNames.add(profile.venueName);
}
const competitionNames = new Set(facts.participationRows.map((r) => String(r.competition_name)));
for (const row of facts.winners) competitionNames.add(String(row.competition_name));
for (const row of facts.trophies) competitionNames.add(String(row.competition_name));

const curatedClubHe = new Map();
const curatedPlayerHe = new Set();
for (const name of recognition.clubNames) curatedClubHe.set(name, true);
for (const name of recognition.playerTiers.keys()) curatedPlayerHe.add(name);

const BROAD_LABELS = new Set(Object.values(BROAD_HE));
const DETAILED_LABELS = new Set(Object.values(DETAILED_HE));
const COUNTRY_LABELS = new Set();
for (const row of facts.teams) if (row.country_name) COUNTRY_LABELS.add(String(row.country_name));
// Hebrew country names used by the curated bank's nationality questions.
for (const he of [
  "אנגליה", "ספרד", "איטליה", "גרמניה", "צרפת", "פורטוגל", "הולנד", "ישראל", "ברזיל",
  "ארגנטינה", "אורוגוואי", "בלגיה", "קרואטיה", "מצרים", "סנגל", "קמרון", "ניגריה",
  "מרוקו", "גאורגיה", "אוקראינה", "צ'כיה", "רומניה", "בולגריה", "ליבריה", "שוודיה",
  "נורווגיה", "פולין", "דרום קוריאה", "ויילס", "ברית המועצות", "חוף השנהב",
]) {
  COUNTRY_LABELS.add(he);
}

const SCORELINE = /^\d+-\d+(\s*\(\d+-\d+\s.+\))?$/;

/*
  Everyone who has ever managed a club, so a coach is not mistaken for a player.

  Most managers used to play, and this bank knows many of them twice — Thomas
  Frank is in `coaches` and in `players`. classifyOption had no COACH branch at
  all, so "מי אימן את Luton בשנת 2019?" answered with its actual manager was
  reported as answering a COACH question with a PLAYER. The name is genuinely
  both; the question decides which one is meant, so the caller says what it
  expects and an ambiguous name resolves to that.
*/
const coachNames = new Set();
for (const row of facts.coachSpells ?? []) {
  if (row.coach_name) coachNames.add(String(row.coach_name).trim());
}

function classifyOption(text, prefer = null) {
  const value = (text ?? "").trim();
  if (!value) return { type: null, detail: "empty" };

  // Checked before players, but only decisive when the name is not also a
  // player's — otherwise `prefer` breaks the tie and PLAYER wins by default,
  // since a player who later managed is still a player in a player question.
  if (coachNames.has(value)) {
    const alsoPlayer = context.playerByName.has(value) || curatedPlayerHe.has(value);
    if (!alsoPlayer) return { type: "COACH", kind: "COACH" };
    if (prefer === "COACH") return { type: "COACH", kind: "COACH", ambiguous: true };
  }

  const team = context.teamByName.get(value);
  if (team) {
    if (team.kind === "CLUB") return { type: "CLUB", kind: "CLUB" };
    if (team.kind === "NATIONAL_TEAM") return { type: "NATIONAL_TEAM", kind: "NATIONAL_TEAM" };
    // A reserve or youth side is a club-shaped thing that may not stand in a
    // club question. Reported with its kind so the repair knows why.
    return { type: "CLUB", kind: team.kind };
  }

  if (context.playerByName.has(value)) return { type: "PLAYER", kind: "PLAYER" };
  if (DETAILED_LABELS.has(value) && !BROAD_LABELS.has(value)) return { type: "POSITION", kind: "POSITION" };
  if (BROAD_LABELS.has(value)) return { type: "POSITION_GROUP", kind: "POSITION_GROUP" };
  if (venueNames.has(value)) return { type: "STADIUM", kind: "STADIUM" };
  if (competitionNames.has(value)) return { type: "COMPETITION", kind: "COMPETITION" };
  if (COUNTRY_LABELS.has(value)) return { type: "COUNTRY", kind: "COUNTRY" };
  if (SCORELINE.test(value)) return { type: "SCORELINE", kind: "SCORELINE" };
  if (/^\d{1,4}$/.test(value)) return { type: "COUNT", kind: "COUNT" };
  if (curatedClubHe.has(value)) return { type: "CLUB", kind: "CLUB" };
  if (curatedPlayerHe.has(value)) return { type: "PLAYER", kind: "PLAYER" };
  return { type: null, kind: "UNRESOLVED" };
}

// ---------------------------------------------------------------------------
// 4. Audit every active question
// ---------------------------------------------------------------------------
const findings = {
  nationalTeamInClubQuestion: [],
  nationalTeamAsClubAnswer: [],
  reserveOrYouthInClubQuestion: [],
  mixedEntityTypes: [],
  answerTypeMismatch: [],
  precisePositionFromBroad: [],
  vagueCareerWording: [],
  loanWordedAsTransfer: [],
  gluedPreposition: [],
  nationalTeamInCareerPath: [],
  unresolvedOptions: [],
  semanticDuplicates: [],
  noLongerGeneratable: [],
  foreignKey: [],
};

const difficultyMoves = new Map(); // "HARD->EXPERT" -> count
const before = {};
const after = {};
const repairPlans = [];
let unchanged = 0;

/** Hebrew preposition glued to a Latin-script word: "מAuxerre". */
const GLUED = /[מלבוכש](?=[A-Za-z])/;
const VAGUE_CAREER = /באיזו קבוצה התחיל|איפה התחיל/;

/*
  Transfers keyed the way a semantic key identifies one, for loan auditing.

  EVERY row that shares a key, not the last one to be written. A semantic key is
  player + club + YEAR, and a player can join the same club twice in one year:
  Álvaro Fernández went to Benfica on loan in January 2024 and permanently for
  €6M that July, and both rows produce `KB_TRANSFER_TO:193:98:2024`. A map that
  overwrites keeps whichever row the unordered query happened to return last, so
  half of those questions get audited against the loan and reported as a loan
  called a transfer — when "עבר" is exactly right, because the permanent move
  also happened. That mismeasurement reported 134 findings where the generators
  and the bank were both correct.

  So the finding requires that NO row for the key is a permanent move. If the
  player really did move permanently to that club that year, the wording stands.
*/
const transfersByKey = new Map();
const addTransfer = (key, row) => {
  const list = transfersByKey.get(key);
  if (list) list.push(row);
  else transfersByKey.set(key, [row]);
};
for (const row of facts.transfers) {
  const year = row.transfer_date ? String(row.transfer_date).slice(0, 4) : "-";
  addTransfer(`KB_TRANSFER_TO:${row.player_id}:${row.to_team_id}:${year}`, row);
  addTransfer(`KB_TRANSFER_FROM:${row.player_id}:${row.from_team_id}:${year}`, row);
}

const semanticFingerprints = new Map();
/** duplicate question id -> the id it duplicates. Deactivated after the loop. */
const duplicateIds = new Map();

for (const row of active) {
  const id = Number(row.id);
  const key = row.semantic_key ? String(row.semantic_key) : null;
  const archetype = row.archetype ? String(row.archetype) : archetypeForStoredKey(key);
  const options = optionsById.get(id) ?? [];
  const clues = cluesById.get(id) ?? [];
  const questionHe = String(row.question_he ?? "");
  const explanationHe = String(row.explanation_he ?? "");
  const band = String(row.difficulty);
  before[band] = (before[band] ?? 0) + 1;

  const answer = options.find((o) => o.correct) ?? options[0];
  const distractors = options.filter((o) => o !== answer);
  // The archetype's declared answer type breaks ties for names this bank knows
  // in two roles — see coachNames. It only ever resolves an ambiguity; it
  // cannot turn a club into a coach.
  const wantsType = archetype && ARCHETYPES[archetype] ? ARCHETYPES[archetype].answerType : null;
  const typed = options.map((o) => ({ ...o, ...classifyOption(o.text, wantsType) }));
  const typedAnswer = typed.find((o) => o.correct) ?? typed[0];

  // ---- the hard invariant: no national team in a club question ----
  const clubOnly = archetype && CLUB_ONLY_ARCHETYPES.includes(archetype);
  if (clubOnly) {
    const nationals = typed.filter((o) => o.kind === "NATIONAL_TEAM");
    if (nationals.length > 0) {
      findings.nationalTeamInClubQuestion.push({ id, key, questionHe, names: nationals.map((o) => o.text) });
      if (nationals.some((o) => o.correct)) {
        findings.nationalTeamAsClubAnswer.push({ id, key, questionHe, answer: answer?.text });
      }
    }
    const second = typed.filter((o) => o.kind === "RESERVE_TEAM" || o.kind === "YOUTH_TEAM" || o.kind === "YOUTH_NATIONAL_TEAM");
    if (second.length > 0) {
      findings.reserveOrYouthInClubQuestion.push({ id, key, questionHe, names: second.map((o) => o.text) });
    }
  }

  // ---- entity-type consistency, whatever the archetype ----
  const resolvedTypes = new Set(typed.map((o) => o.type).filter(Boolean));
  if (resolvedTypes.size > 1) {
    findings.mixedEntityTypes.push({ id, key, questionHe, types: [...resolvedTypes] });
  }
  const unresolved = typed.filter((o) => !o.type);
  if (unresolved.length > 0) {
    findings.unresolvedOptions.push({ id, key, count: unresolved.length, sample: unresolved[0].text });
  }

  if (archetype && ARCHETYPES[archetype] && typedAnswer?.type) {
    const spec = ARCHETYPES[archetype];
    if (spec.answerType !== "RESOLVED_TEAM" && spec.answerType !== typedAnswer.type) {
      findings.answerTypeMismatch.push({
        id, key, questionHe, expected: spec.answerType, got: typedAnswer.type,
      });
    }
  }

  // ---- position precision ----
  if (archetype === "POSITION_PRECISE" || /באיזו עמדה משחק|מה התפקיד/.test(questionHe)) {
    const answerIsBroad = BROAD_LABELS.has(answer?.text ?? "");
    const asksPrecise = /באיזו עמדה משחק|מה התפקיד/.test(questionHe);
    // The exact production bug: a precise question whose options are the four
    // units. "באיזו עמדה משחק מוחמד סלאח?" answered "חלוץ" is this.
    if (asksPrecise && (answerIsBroad || typed.every((o) => BROAD_LABELS.has(o.text)))) {
      findings.precisePositionFromBroad.push({ id, key, questionHe, answer: answer?.text });
    }
  }

  // ---- career semantics ----
  if (VAGUE_CAREER.test(questionHe)) {
    findings.vagueCareerWording.push({ id, key, questionHe });
  }
  if (archetype === "CAREER_PATH") {
    const bad = clues.map((c) => classifyOption(c.text)).filter((t) => t.kind && t.kind !== "CLUB");
    if (bad.length > 0) {
      findings.nationalTeamInCareerPath.push({
        id, key, kinds: bad.map((b) => b.kind),
      });
    }
  }

  // ---- loan semantics ----
  if (key && (key.startsWith("KB_TRANSFER_TO:") || key.startsWith("KB_TRANSFER_FROM:"))) {
    const candidates = transfersByKey.get(key) ?? [];
    const movements = candidates.map((t) => classifyMovement(t.transfer_type));
    // A loan only if that is the ONLY thing the key can mean. A key that also
    // matches a permanent move is not evidence of anything — see transfersByKey.
    const isLoan =
      movements.length > 0 &&
      movements.some((m) => m === "LOAN") &&
      !movements.some((m) => m === "PERMANENT" || m === "FREE");
    // MOVED_PERMANENTLY_HE, not /\bעבר\b/: JavaScript's `\b` is defined against
    // [A-Za-z0-9_], so it never matches a boundary in Hebrew text and a check
    // written that way reports zero findings on a bank full of them.
    if (isLoan && MOVED_PERMANENTLY_HE.test(questionHe) && !LOAN_WORDING_HE.test(questionHe)) {
      findings.loanWordedAsTransfer.push({ id, key, questionHe });
    }
  }

  // ---- wording ----
  if (GLUED.test(questionHe) || GLUED.test(explanationHe)) {
    findings.gluedPreposition.push({ id, key, questionHe });
  }

  // ---- semantic duplicates: the same answer to the same question text ----
  const fingerprint = `${normalizeAnswer(questionHe)}|${normalizeAnswer(answer?.text ?? "")}|${clues
    .map((c) => normalizeAnswer(c.text))
    .join("~")}`;
  if (semanticFingerprints.has(fingerprint)) {
    /*
      The same question text with the same answer, under a different semantic
      key — so the dedupe gate, which keys on semanticKey, never saw it.

      Eleven of these: a hand-written question like "מה הכינוי של מועדון ארסנל?"
      and a generated one that arrives at the same text from the same data. Both
      are correct, which is why nothing else flags them, and that is precisely
      the problem — a quiz dedupes by id, so a player can be asked the identical
      question twice in one game.

      The copy is deactivated rather than repaired. There is nothing to fix
      about it; it should not be in the bank. The original stays active, and
      `active` is sorted by id so "original" means the older row every run.
    */
    duplicateIds.set(id, semanticFingerprints.get(fingerprint));
    findings.semanticDuplicates.push({ id, key, questionHe, duplicateOf: semanticFingerprints.get(fingerprint) });
  } else {
    semanticFingerprints.set(fingerprint, id);
  }

  // ---- compare with what the rules produce today ----
  const want = key ? desired.get(key) : null;
  if (want) {
    const plan = planRepair({ id, row, want, options, clues, hints: hintsById.get(id) ?? [], aliases: aliasesById.get(id) ?? [], scopes: scopesById.get(id) ?? [] });
    if (plan.changes.length === 0) {
      unchanged++;
      after[band] = (after[band] ?? 0) + 1;
    } else {
      repairPlans.push(plan);
      const nextBand = want.difficulty;
      after[nextBand] = (after[nextBand] ?? 0) + 1;
      if (nextBand !== band) {
        const move = `${band} -> ${nextBand}`;
        difficultyMoves.set(move, (difficultyMoves.get(move) ?? 0) + 1);
      }
    }
  } else if (key && knownPrefixes.has(keyPrefix(key))) {
    // The generator that produced this question will not produce it again. The
    // fact behind it is gone, or it no longer passes the quality gates.
    findings.noLongerGeneratable.push({ id, key, questionHe, difficulty: band });
    repairPlans.push({
      id,
      key,
      changes: ["deactivate"],
      statements: [deactivate(id)],
      deactivate: true,
      priority: 0,
    });
  } else if (key) {
    findings.foreignKey.push({ id, key });
    after[band] = (after[band] ?? 0) + 1;
  } else {
    /*
      A hand-written curated question, with no semantic key.

      139 of these. They are not regenerated and must not be rewritten — a human
      wrote the wording. They are still audited for the entity-type invariants
      above, and a hard violation there would be reported as such; none is
      repaired automatically, because "a person wrote this" is the strongest
      quality signal in the bank and a script should not overrule it.
    */
    after[band] = (after[band] ?? 0) + 1;
  }
}

/*
  Duplicates are deactivated, and that REPLACES any repair planned for them.

  A duplicate may also have a repair plan from the comparison above — it is a
  valid question, after all. Both plans would be applied, which means paying to
  rewrite a question's wording and then switching it off. Deactivation is the
  only statement worth sending, so it supersedes the plan rather than joining
  it, and it goes in at priority 0 with the other deactivations.
*/
for (const [id, originalId] of duplicateIds) {
  const existing = repairPlans.findIndex((p) => p.id === id);
  const plan = {
    id,
    key: `duplicate-of-${originalId}`,
    changes: ["deactivate"],
    statements: [deactivate(id)],
    deactivate: true,
    priority: 0,
  };
  if (existing >= 0) repairPlans[existing] = plan;
  else repairPlans.push(plan);
}

// ---------------------------------------------------------------------------
// 5. Repair planning
// ---------------------------------------------------------------------------

// Function declarations rather than consts: planRepair is called from the audit
// loop above, which runs before this section is evaluated, and a const would
// still be in its temporal dead zone.
function deactivate(id) {
  return `UPDATE questions SET active = 0 WHERE id = ${id};`;
}

function sameList(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Works out the minimal set of writes that turns a stored question into the
 * desired one.
 *
 * Minimal matters: the parent row costs 8 rows written (it carries six indexes),
 * each option 2, each hint 2. A difficulty-only change is therefore 8 rows, and
 * a full delete-and-reinsert of the same question is about 30. Across 15,000
 * questions that difference is the whole free-tier daily allowance.
 */
function planRepair({ id, row, want, options, clues, hints, aliases, scopes }) {
  const changes = [];
  const statements = [];
  const parent = {};

  const freeText = Boolean(want.freeText);
  const wantOptions = want.options.map((text, index) => ({
    text,
    correct: index === want.correctIndex,
  }));

  if (String(row.question_he) !== want.questionHe) {
    parent.question_he = want.questionHe;
    changes.push("question_he");
  }
  if (String(row.explanation_he ?? "") !== want.explanationHe) {
    parent.explanation_he = want.explanationHe;
    changes.push("explanation_he");
  }
  if (String(row.difficulty) !== want.difficulty) {
    parent.difficulty = want.difficulty;
    changes.push("difficulty");
  }
  if (String(row.category) !== want.category) {
    parent.category = want.category;
    changes.push("category");
  }
  if (String(row.mode) !== want.mode) {
    parent.mode = want.mode;
    changes.push("mode");
  }
  const wantCanonical = freeText ? want.canonicalAnswer ?? want.options[want.correctIndex] : null;
  if ((row.canonical_answer ?? null) !== wantCanonical) {
    parent.canonical_answer = wantCanonical;
    changes.push("canonical_answer");
  }
  if (Number(row.supports_free_text) !== (freeText ? 1 : 0)) {
    parent.supports_free_text = freeText ? 1 : 0;
    changes.push("supports_free_text");
  }

  // The semantic columns migration 0008 added. Written on every repair, so the
  // audit's own judgement is persisted and the next run has less to recompute.
  const signals = want.difficultySignals ?? {};
  const archetype = want.archetype ?? null;
  const answerType = archetype ? answerTypeFor(archetype, want.resolvedTeamType) : null;
  const quickStart = isQuickStartFriendly({
    band: want.difficulty,
    subjectFame: signals.subjectFame ?? null,
    entityProminence: signals.entityProminence ?? null,
    tier: signals.tier ?? null,
  })
    ? 1
    : 0;

  if ((row.archetype ?? null) !== archetype) {
    parent.archetype = archetype;
    changes.push("archetype");
  }
  if ((row.answer_entity_type ?? null) !== answerType) {
    parent.answer_entity_type = answerType;
    changes.push("answer_entity_type");
  }
  if (Number(row.quick_start_safe ?? 0) !== quickStart) {
    parent.quick_start_safe = quickStart;
    changes.push("quick_start_safe");
  }
  if (archetype) {
    parent.fact_confidence = want.factConfidence ?? "HIGH";
    parent.subject_fame = typeof signals.subjectFame === "number" ? signals.subjectFame : null;
    parent.entity_prominence =
      typeof signals.entityProminence === "number" ? signals.entityProminence : null;
    parent.domain_tier = signals.tier ?? null;
  }

  /*
    ---- children ----

    OPTION SETS ARE ONLY REPLACED WHEN THEY ARE WRONG, not whenever they differ.

    The distractor engine ranks by plausibility now, so it picks a different —
    usually better — set for essentially every stored question: 11,916 of them.
    Replacing all of those costs about 240,000 rows written, two and a half days
    of the free-tier allowance, and buys no correctness. The questions in
    question already have four options of the right type with one correct answer.

    What MUST be replaced is an option set containing something ineligible: a
    national team in a club question, a reserve side, an answer of the wrong
    type. That is 2,400-odd questions and it is the invariant this phase exists
    to establish.

    `--full-options` does the whole thing for anyone who wants the plausibility
    improvement and has the budget for it.
  */
  const storedOptionTexts = options.map((o) => o.text);
  const wantOptionTexts = wantOptions.map((o) => o.text);
  const storedTypes = options.map((o) => classifyOption(o.text));
  const expectedType = archetype ? answerTypeFor(archetype, want.resolvedTeamType) : null;

  /*
    A POSITION QUESTION HAS A CLOSED VOCABULARY, so "different" really is
    "wrong" — the one place the plausibility argument above does not apply.

    There are exactly four units and fifteen roles, and the generator picks the
    four options from that fixed list rather than sampling plausible ones. So an
    option outside the set the rules now choose is not a different-but-equally
    good distractor, it is a label the vocabulary no longer contains.

    This is how seven goalkeeper questions survived the repair. They asked
    "באיזו חוליה משחק אליסון?" — the unit — and offered שוער / מגן / קשר / חלוץ,
    the pre-semantic-layer vocabulary, in which "חלוץ" names a UNIT. It names
    the striker's ROLE and nothing else, which is the Forward-is-not-a-Striker
    bug sitting in the option list instead of the answer. Nothing caught it:
    curated questions carry no archetype, so the type invariant never ran on
    them, and for a goalkeeper alone the answer label is unchanged between the
    two vocabularies, so the answer check passed too. Every other position
    question was repaired because its answer moved from מגן to הגנה.
  */
  const POSITION_LABELS = new Set([...BROAD_LABELS, ...DETAILED_LABELS]);
  const isPositionQuestion =
    wantOptionTexts.length > 0 && wantOptionTexts.every((t) => POSITION_LABELS.has(t));
  const staleVocabulary =
    isPositionQuestion && storedOptionTexts.some((t) => !wantOptionTexts.includes(t));

  const storedIsInvalid =
    staleVocabulary ||
    options.length !== 4 ||
    options.filter((o) => o.correct).length !== 1 ||
    (expectedType !== null &&
      storedTypes.some((t, i) => {
        // An option this audit cannot type is left alone: "unknown" is not
        // evidence of "wrong", and guessing would rewrite correct questions.
        if (!t.type) return false;
        if (t.type !== expectedType) return true;
        if (expectedType === "CLUB" && t.kind !== "CLUB") return true;
        if (expectedType === "NATIONAL_TEAM" && t.kind !== "NATIONAL_TEAM") return true;
        return i < 0;
      })) ||
    // The stored answer must be the one the rules now give.
    (options.find((o) => o.correct)?.text ?? null) !== wantOptions[0].text;

  const optionsDiffer =
    !sameList(storedOptionTexts, wantOptionTexts) ||
    !sameList(options.map((o) => o.correct), wantOptions.map((o) => o.correct));
  const replaceOptions = fullOptions ? optionsDiffer : storedIsInvalid;
  if (replaceOptions) {
    changes.push("options");
    statements.push(`DELETE FROM question_options WHERE question_id = ${id};`);
    wantOptions.forEach((option, index) => {
      statements.push(
        `INSERT INTO question_options (question_id, answer_text, is_correct, sort_order)` +
          ` VALUES (${id}, ${sqlValue(option.text)}, ${option.correct ? 1 : 0}, ${index});`
      );
    });
  }

  const wantClues = want.clues ?? [];
  if (!sameList(clues.map((c) => c.text), wantClues)) {
    changes.push("clues");
    statements.push(`DELETE FROM question_clues WHERE question_id = ${id};`);
    wantClues.forEach((clue, index) => {
      statements.push(
        `INSERT INTO question_clues (question_id, clue_he, sort_order) VALUES (${id}, ${sqlValue(clue)}, ${index});`
      );
    });
  }

  const wantHints = want.hints ?? [];
  if (!sameList(hints.map((h) => h.text), wantHints)) {
    changes.push("hints");
    statements.push(`DELETE FROM question_hints WHERE question_id = ${id};`);
    wantHints.forEach((hint, index) => {
      statements.push(
        `INSERT INTO question_hints (question_id, text, order_index) VALUES (${id}, ${sqlValue(hint)}, ${index});`
      );
    });
  }

  const wantAliases = freeText
    ? [...new Set([wantCanonical, ...(want.aliases ?? [])].filter(Boolean).map((a) => a))]
    : [];
  const storedAliasSet = new Set(aliases.map(normalizeAnswer));
  const wantAliasSet = new Set(wantAliases.map(normalizeAnswer));
  const aliasesDiffer =
    storedAliasSet.size !== wantAliasSet.size || [...wantAliasSet].some((a) => !storedAliasSet.has(a));
  if (aliasesDiffer) {
    changes.push("aliases");
    statements.push(`DELETE FROM answer_aliases WHERE question_id = ${id};`);
    const seen = new Set();
    for (const alias of wantAliases) {
      const normalized = normalizeAnswer(alias);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      statements.push(
        `INSERT INTO answer_aliases (question_id, alias, normalized, lang)` +
          ` VALUES (${id}, ${sqlValue(alias)}, ${sqlValue(normalized)},` +
          ` ${sqlValue(/[֐-׿]/.test(alias) ? "he" : "en")});`
      );
    }
  }

  const wantScopes = want.scopes ?? [];
  const scopeKey = (s) => `${s.type}:${s.value}`;
  const storedScopeSet = new Set(scopes.map(scopeKey));
  const wantScopeSet = new Set(wantScopes.map(scopeKey));
  if (
    storedScopeSet.size !== wantScopeSet.size ||
    [...wantScopeSet].some((s) => !storedScopeSet.has(s))
  ) {
    changes.push("scopes");
    statements.push(`DELETE FROM question_scopes WHERE question_id = ${id};`);
    for (const scope of wantScopes) {
      statements.push(
        `INSERT INTO question_scopes (question_id, scope_type, scope_value)` +
          ` VALUES (${id}, ${sqlValue(scope.type)}, ${sqlValue(scope.value)});`
      );
    }
  }

  /*
    THE CONTENT HASH.

    Recomputed whenever anything changed, so scripts/seed-apply.mjs sees the
    repaired question as current. Without it the curated applier would compare
    its freshly built hash against the stale stored one, decide the question had
    changed, and delete and re-insert all ~30 of its rows — undoing the saving
    this whole function exists for.
  */
  if (changes.length > 0) {
    // Hashed over the state the row will ACTUALLY be in, which in minimal mode
    // keeps the stored options. Hashing the desired options instead would leave
    // every repaired question permanently mismatched, so seed-apply would
    // rewrite all ~30 of its rows on the next run — undoing the saving.
    const resultingOptions = replaceOptions ? want.options : storedOptionTexts;
    const resultingCorrectIndex = replaceOptions
      ? want.correctIndex
      : Math.max(0, options.findIndex((o) => o.correct));
    parent.content_hash = contentHashFor({
      id,
      q: {
        mode: want.mode,
        category: want.category,
        difficulty: want.difficulty,
        questionHe: want.questionHe,
        explanationHe: want.explanationHe,
        sourceLabel: want.sourceLabel,
        options: resultingOptions,
        correctIndex: resultingCorrectIndex,
        clues: wantClues,
        scopes: wantScopes,
      },
      freeTextSpec: freeText
        ? { canonical: wantCanonical, aliases: want.aliases ?? [] }
        : null,
      hints: wantHints,
      semanticKey: want.semanticKey,
    });
  }

  const assignments = Object.entries(parent).map(([column, value]) => `${column} = ${sqlValue(value)}`);
  // One UPDATE for every parent column that changed, not one per column.
  if (assignments.length > 0) {
    statements.unshift(`UPDATE questions SET ${assignments.join(", ")} WHERE id = ${id};`);
  }

  /*
    PRIORITY, because this will not all fit in one day.

    322,000 rows written at the free tier's 100,000 a day is three days of
    repair, so the order it happens in decides what production looks like
    tonight. Correctness first:

      0  deactivations — the questions that should not be answerable at all
      1  option sets with something ineligible in them — the hard invariant
      2  a wrong answer, wrong difficulty or wrong archetype
      3  wording: glued prepositions, loan phrasing, clue text
      4  hints and scopes — real improvements, no correctness at stake

    Re-running continues where it stopped, because a question that already
    matches compares equal and produces no statements.
  */
  const priority = (() => {
    if (replaceOptions) return 1;
    if (changes.includes("difficulty") || changes.includes("canonical_answer") || changes.includes("archetype")) {
      return 2;
    }
    if (changes.includes("question_he") || changes.includes("explanation_he") || changes.includes("clues")) {
      return 3;
    }
    return 4;
  })();

  return {
    id,
    key: want.semanticKey,
    changes,
    statements,
    deactivate: false,
    priority,
    storedOptions: storedOptionTexts,
    wantOptions: wantOptionTexts,
  };
}

// ---------------------------------------------------------------------------
// 6. Report
// ---------------------------------------------------------------------------
const count = (list) => list.length;
const pct = (n, total) => (total === 0 ? "0.0%" : `${((n / total) * 100).toFixed(1)}%`);

console.log(`ENTITY TYPES`);
console.log(`  national team inside a club question      : ${count(findings.nationalTeamInClubQuestion)}`);
console.log(`    ...of which as the correct answer       : ${count(findings.nationalTeamAsClubAnswer)}`);
console.log(`  reserve/youth side inside a club question : ${count(findings.reserveOrYouthInClubQuestion)}`);
console.log(`  mixed entity types in one option set      : ${count(findings.mixedEntityTypes)}`);
console.log(`  answer type not what the archetype asks   : ${count(findings.answerTypeMismatch)}`);
console.log(`  options this audit could not type         : ${count(findings.unresolvedOptions)}`);

console.log(`\nPOSITIONS`);
console.log(`  precise role asked from broad-unit data   : ${count(findings.precisePositionFromBroad)}`);

console.log(`\nCAREERS AND TRANSFERS`);
console.log(`  vague "התחיל" career-start wording         : ${count(findings.vagueCareerWording)}`);
console.log(`  non-club entity inside a career path      : ${count(findings.nationalTeamInCareerPath)}`);
console.log(`  loan described as a permanent transfer    : ${count(findings.loanWordedAsTransfer)}`);

console.log(`\nWORDING AND DUPLICATES`);
console.log(`  Hebrew preposition glued to a Latin name  : ${count(findings.gluedPreposition)}`);
console.log(`  semantically duplicate questions          : ${count(findings.semanticDuplicates)}`);

console.log(`\nAGAINST THE CURRENT RULES`);
console.log(`  identical to what the rules produce       : ${unchanged}`);
console.log(`  repairable in place                       : ${repairPlans.filter((p) => !p.deactivate).length}`);
console.log(`  no longer generatable (deactivate)       : ${count(findings.noLongerGeneratable)}`);
console.log(`  keys this audit does not judge           : ${count(findings.foreignKey)}`);

const changeCounts = {};
for (const plan of repairPlans) {
  for (const change of plan.changes) changeCounts[change] = (changeCounts[change] ?? 0) + 1;
}
console.log(`  fields to repair                         :`, changeCounts);

console.log(`\nDIFFICULTY`);
console.log(`  before:`);
for (const band of BANDS) {
  console.log(`    ${band.padEnd(11)} ${String(before[band] ?? 0).padStart(6)}  ${pct(before[band] ?? 0, active.length)}`);
}
console.log(`  after (projected):`);
const afterTotal = Object.values(after).reduce((a, b) => a + b, 0);
for (const band of BANDS) {
  console.log(`    ${band.padEnd(11)} ${String(after[band] ?? 0).padStart(6)}  ${pct(after[band] ?? 0, afterTotal)}`);
}
console.log(`  movement:`);
for (const [move, n] of [...difficultyMoves].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${move.padEnd(24)} ${n}`);
}

// Samples, so the report can be checked rather than believed.
function sample(label, list, render) {
  if (list.length === 0) return;
  console.log(`\n  ${label} (${list.length}, showing ${Math.min(sampleSize, list.length)}):`);
  for (const item of list.slice(0, sampleSize)) console.log(`    ${render(item)}`);
}

sample("national team in a club question", findings.nationalTeamInClubQuestion, (f) =>
  `#${f.id} ${f.questionHe}  [${f.names.join(", ")}]`
);
sample("national team AS the club answer", findings.nationalTeamAsClubAnswer, (f) =>
  `#${f.id} ${f.questionHe} → ${f.answer}`
);
sample("precise position from broad data", findings.precisePositionFromBroad, (f) =>
  `#${f.id} ${f.questionHe} → ${f.answer}`
);
sample("loan worded as a transfer", findings.loanWordedAsTransfer, (f) => `#${f.id} ${f.questionHe}`);
sample("no longer generatable", findings.noLongerGeneratable, (f) =>
  `#${f.id} [${f.difficulty}] ${f.questionHe}`
);
sample("glued Hebrew preposition", findings.gluedPreposition, (f) => `#${f.id} ${f.questionHe}`);
sample("mixed entity types in one option set", findings.mixedEntityTypes, (f) =>
  `#${f.id} ${f.questionHe}  [${f.types.join(", ")}]`
);
sample("answer type not what the archetype asks", findings.answerTypeMismatch, (f) =>
  `#${f.id} ${f.questionHe}  (want ${f.expected}, got ${f.got})`
);
sample("semantically duplicate questions", findings.semanticDuplicates, (f) =>
  `#${f.id} ${f.questionHe}  (duplicate of #${f.duplicateOf})`
);

/*
  Option-set replacements, shown with both sets.

  An option repair that is still pending after a repair ran has not converged:
  the set the rules want is itself failing the eligibility test, so every run
  rewrites it and every run finds it wrong again. That is a bug in the rules, not
  a repair still to do, and it is invisible in a count.
*/
sample(
  "option sets to replace",
  repairPlans.filter((p) => !p.deactivate && p.changes.includes("options")),
  (f) => `#${f.id} ${f.key}\n      stored: ${(f.storedOptions ?? []).join(" | ")}\n      want:   ${(f.wantOptions ?? []).join(" | ")}`
);

// ---------------------------------------------------------------------------
// 7. Apply
// ---------------------------------------------------------------------------
/*
  WRITE COST, priced per column rather than per table.

  writeBudget.ts prices a row in `questions` at 8 — one row plus its six
  indexes — which is the right conservative number when you do not know what
  changed. Here we do know, and the difference is large enough to decide whether
  this repair takes one day or three.

  D1 bills an index entry only when the index's columns change. Of the twelve
  columns this repair touches, exactly three appear in an index: `difficulty`
  (three indexes), `active` (three), and `category` (two). The other nine —
  question_he, explanation_he, archetype, answer_entity_type, fact_confidence,
  subject_fame, entity_prominence, domain_tier, quick_start_safe, content_hash —
  are indexed nowhere, so changing them costs the row and nothing else.

  A text-and-metadata repair is therefore 1 row written, not 8. Over 13,815
  questions that is the difference between 110,000 rows and about 46,000.
*/
const INDEXED_QUESTION_COLUMNS = { difficulty: 3, active: 3, category: 2 };

function priceParentUpdate(sql) {
  let cost = 1;
  for (const [column, indexes] of Object.entries(INDEXED_QUESTION_COLUMNS)) {
    if (new RegExp(`\\b${column}\\s*=`).test(sql)) cost += indexes;
  }
  return cost;
}

const rowCounts = {
  question_options: 4,
  question_clues: 3,
  question_hints: 3,
  answer_aliases: 3,
  question_scopes: 3,
};

function priceStatements(list) {
  let total = 0;
  for (const sql of list) {
    if (/^UPDATE questions SET/.test(sql)) total += priceParentUpdate(sql);
    else total += planWrites([sql], rowCounts).estimatedRowsWritten;
  }
  return total;
}

// Correctness first — see the priority note in planRepair.
const ordered = [...repairPlans].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.id - b.id);
const statements = ordered.flatMap((p) => p.statements);
const estimated = priceStatements(statements);

const byPriority = {};
for (const plan of ordered) {
  const key = String(plan.priority ?? 9);
  byPriority[key] = (byPriority[key] ?? 0) + priceStatements(plan.statements);
}

console.log(`\nWRITES`);
console.log(`  statements              : ${statements.length.toLocaleString()}`);
console.log(`  estimated rows written  : ${estimated.toLocaleString()}`);
console.log(`  budget this run         : ${maxWrites.toLocaleString()}`);
console.log(`  option-set policy       : ${fullOptions ? "replace every set that differs" : "replace only invalid sets"}`);
console.log(`  cost by priority        :`, byPriority);

if (!repair) {
  console.log(`\nReport only. Re-run with --repair to apply.\n`);
  process.exit(0);
}

if (statements.length === 0) {
  console.log(`\nNothing to repair — the bank already matches the rules.\n`);
  process.exit(0);
}

/*
  CHUNKED, AND SAFE TO STOP HALFWAY.

  Each chunk is a whole number of questions' worth of statements, and a question
  that has already been repaired compares equal on the next run and is skipped.
  So hitting the budget is not a failure state: re-running continues from where
  it stopped, and stopping between chunks never leaves a question half-written
  because planRepair emits a question's statements contiguously.
*/
let spent = 0;
let written = 0;
// Chunked per question, so a chunk boundary never falls inside one question's
// statements. `ordered` is already in priority order.
let chunk = [];
let chunkCost = 0;
const chunks = [];
for (const plan of ordered) {
  const cost = priceStatements(plan.statements);
  if (chunk.length > 0 && chunkCost + cost > 3000) {
    chunks.push({ statements: chunk, cost: chunkCost });
    chunk = [];
    chunkCost = 0;
  }
  chunk.push(...plan.statements);
  chunkCost += cost;
}
if (chunk.length > 0) chunks.push({ statements: chunk, cost: chunkCost });

for (const batch of chunks) {
  if (spent + batch.cost > maxWrites && written > 0) {
    console.log(`\n  stopped at the write budget — re-run to continue`);
    break;
  }
  await db.execute(batch.statements);
  spent += batch.cost;
  written += batch.statements.length;
  console.log(
    `  wrote ${written.toLocaleString()}/${statements.length.toLocaleString()} statements (~${spent.toLocaleString()} rows)`
  );
}

console.log(`\nRepair applied: ${written.toLocaleString()} statement(s), ~${spent.toLocaleString()} rows written.`);
if (written < statements.length) {
  console.log(`${(statements.length - written).toLocaleString()} statement(s) remain — re-run to continue.`);
}
console.log("");
