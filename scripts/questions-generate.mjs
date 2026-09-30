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
import {
  generateCareerPaths,
  generateClubConnections,
  generateCompetitionParticipation,
  generateCompetitionWinners,
  generateCupFinalQuestions,
  generateDidNotPlayFor,
  generateKnockoutProgressionQuestions,
  generateGuessTheClub,
  generateManagerQuestions,
  generatePreviousClubQuestions,
  generateTopScorerQuestions,
  generateTransferQuestions,
  generateTrophyQuestions,
  generateVenueQuestions,
  generateWhoAmI,
  indexCareers,
  notableClubNames,
  seasonLabel,
  validateAndDedupe,
} from "../src/server/questions/knowledgeGenerators.ts";

const KB_ID_BASE = 500000;
const target = process.argv.includes("--remote") ? "remote" : "local";
// Reads the facts, runs every generator and applies the quality gates, then
// reports what it would write without writing it.
const dryRun = process.argv.includes("--dry-run");
const db = new D1Client({
  target,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "367bed473a2c48604d27f2e668162c49",
});

console.log(`\nGenerating questions from the knowledge base → ${target} D1\n`);

/**
 * Tidies provider-supplied names before they reach question text.
 *
 * API-Football returns the odd "Tomasz  Kuszczak" with a doubled space, which
 * reads as a typo in a question and, worse, normalises to a different free-text
 * answer than the same name written once. Whitespace only — nothing here renames
 * or re-spells anybody.
 */
const cleanName = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value);
const NAME_COLUMNS = ["player_name", "team_name", "from_team_name", "to_team_name", "coach_name", "name", "runner_up_name", "competition_name", "venue_name"];
function tidyNames(rows) {
  for (const row of rows) {
    for (const column of NAME_COLUMNS) {
      if (row[column] != null) row[column] = cleanName(row[column]);
    }
  }
  return rows;
}

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
         w.name AS team_name, r.name AS runner_up_name,
         cs.start_date, cs.end_date
    FROM competition_winners cw
    JOIN competitions c ON c.id = cw.competition_id
    JOIN teams w ON w.id = cw.team_id
    LEFT JOIN teams r ON r.id = cw.runner_up_team_id
    LEFT JOIN competition_seasons cs
           ON cs.competition_id = cw.competition_id AND cs.season = cw.season
`);
for (const row of winners) {
  row.season_label = seasonLabel(Number(row.season), row.start_date, row.end_date);
}

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

// Every known player-at-club relationship, however it was learned — a squad
// listing, a transfer, or a scoring record. Club Connection and Who Am I are
// both built from this, so they see a career assembled from all three sources
// rather than transfers alone.
const playerTeams = await db.query(`
  SELECT pt.player_id, p.name AS player_name, p.position, p.nationality,
         pt.team_id, t.name AS team_name, t.country_name, pt.season, pt.start_date
    FROM player_teams pt
    JOIN players p ON p.id = pt.player_id
    JOIN teams t ON t.id = pt.team_id
`);

// Cup fixtures. Only the rounds the generators reason about are read: a group or
// league phase is hundreds of rows that settle nothing on their own.
const cupFixtures = await db.query(`
  SELECT f.id, f.competition_id, c.name AS competition_name, c.local_code AS competition_local_code,
         c.priority AS competition_priority, f.season, f.round,
         f.home_team_id, f.away_team_id, h.name AS home_team_name, a.name AS away_team_name,
         f.home_goals, f.away_goals, f.home_penalties, f.away_penalties, f.status,
         cs.start_date, cs.end_date
    FROM fixtures f
    JOIN competitions c ON c.id = f.competition_id
    LEFT JOIN teams h ON h.id = f.home_team_id
    LEFT JOIN teams a ON a.id = f.away_team_id
    LEFT JOIN competition_seasons cs ON cs.competition_id = f.competition_id AND cs.season = f.season
   WHERE LOWER(TRIM(f.round)) IN ('final','semi-finals','quarter-finals','round of 16')
`);

/**
 * Who took part in each competition-season, and for which of them the fixture
 * list is complete enough to argue from absence.
 *
 * Participation questions turn on three clubs *not* having played, so they are
 * only offered for a competition-season whose fixtures were imported whole.
 */
const participationRows = await db.query(`
  SELECT ts.competition_id, ts.season, t.name AS team_name,
         c.name AS competition_name, c.local_code AS competition_local_code, c.priority AS competition_priority,
         cs.start_date, cs.end_date,
         (SELECT COUNT(*) FROM fixtures f
           WHERE f.competition_id = ts.competition_id AND f.season = ts.season) AS fixture_count
    FROM team_seasons ts
    JOIN teams t ON t.id = ts.team_id
    JOIN competitions c ON c.id = ts.competition_id
    LEFT JOIN competition_seasons cs ON cs.competition_id = ts.competition_id AND cs.season = ts.season
   WHERE c.type = 'CUP'
`);

const coachSpells = await db.query(`
  SELECT ct.coach_id, co.name AS coach_name, co.nationality,
         ct.team_id, t.name AS team_name, ct.start_date, ct.end_date
    FROM coach_teams ct
    JOIN coaches co ON co.id = ct.coach_id
    JOIN teams t ON t.id = ct.team_id
`);

const seasonStats = await db.query(`
  SELECT s.player_id, p.name AS player_name, t.name AS team_name,
         c.name AS competition_name, c.local_code AS competition_local_code,
         c.priority AS competition_priority, s.season, s.goals, s.assists, s.appearances,
         cs.start_date, cs.end_date
    FROM player_season_stats s
    JOIN players p ON p.id = s.player_id
    JOIN competitions c ON c.id = s.competition_id
    LEFT JOIN teams t ON t.id = s.team_id
    LEFT JOIN competition_seasons cs
           ON cs.competition_id = s.competition_id AND cs.season = s.season
`);
for (const row of seasonStats) {
  row.season_label = seasonLabel(Number(row.season), row.start_date, row.end_date);
}

for (const rows of [teams, winners, transfers, players, trophies, playerTeams, coachSpells, seasonStats, cupFixtures, participationRows]) {
  tidyNames(rows);
}
for (const row of cupFixtures) {
  row.season_label = seasonLabel(Number(row.season), row.start_date, row.end_date);
}

// Grouped by competition-season. Only seasons with a stored fixture list get
// participation questions, because those are the only ones where a club's absence
// from the team sheet actually means it did not play.
const cupParticipants = new Map();
const cupSeasonMeta = new Map();
for (const row of participationRows) {
  if (Number(row.fixture_count) === 0) continue;
  const key = `${row.competition_id}:${row.season}`;
  cupParticipants.set(key, [...(cupParticipants.get(key) ?? []), String(row.team_name)]);
  if (!cupSeasonMeta.has(key)) {
    cupSeasonMeta.set(key, {
      competitionId: Number(row.competition_id),
      competitionName: String(row.competition_name),
      localCode: row.competition_local_code ?? null,
      priority: row.competition_priority ?? null,
      season: Number(row.season),
      seasonLabel: seasonLabel(Number(row.season), row.start_date, row.end_date),
    });
  }
}

console.log(
  `  facts: ${teams.length} teams, ${players.length} players, ${transfers.length} transfers, ` +
    `${winners.length} competition winners, ${trophies.length} trophies,\n` +
    `         ${playerTeams.length} player-club links, ${coachSpells.length} coach spells, ` +
    `${seasonStats.length} season stat rows`
);

// ---- Generate candidates.
const transfersByPlayer = new Map();
for (const row of transfers) {
  transfersByPlayer.set(row.player_id, [...(transfersByPlayer.get(row.player_id) ?? []), row]);
}

const careers = indexCareers(playerTeams);
const notable = notableClubNames(teams);

// Clubs that actually contested each competition, used as believable distractors
// for "who won X in season Y".
const competitionClubs = await db.query(`
  SELECT ts.competition_id, t.name AS team_name
    FROM team_seasons ts
    JOIN teams t ON t.id = ts.team_id
`);
const clubsByCompetition = new Map();
for (const row of competitionClubs) {
  const id = Number(row.competition_id);
  clubsByCompetition.set(id, [...(clubsByCompetition.get(id) ?? []), String(row.team_name)]);
}

// Club countries, used to keep a "never played for" club on a different national
// footing from every club the player is recorded at.
const clubCountryById = new Map(teams.map((t) => [Number(t.id), t.country_name ?? null]));

console.log(`  ${notable.size} of ${teams.length} clubs are competition-backed and askable`);

/**
 * Which cups each club has played in, by club name.
 *
 * Gives career questions a competition scope, so a Champions League quiz reaches
 * the transfers and team-mates of the clubs that contested it rather than only
 * the two finals we hold. A scope, not a category: the question is still a
 * transfer question and is still counted as one.
 */
const cupScopes = new Map();
for (const row of participationRows) {
  if (!row.competition_local_code) continue;
  const name = String(row.team_name);
  const codes = cupScopes.get(name) ?? new Set();
  codes.add(String(row.competition_local_code));
  cupScopes.set(name, codes);
}
for (const [name, codes] of cupScopes) cupScopes.set(name, [...codes]);

const byGenerator = {
  competitionWinners: generateCompetitionWinners(winners, clubsByCompetition),
  transferTo: generateTransferQuestions(transfers, teams, notable, cupScopes),
  transferFrom: generatePreviousClubQuestions(transfers, teams, notable, cupScopes),
  careerPath: generateCareerPaths(transfersByPlayer, players, cupScopes),
  clubConnection: generateClubConnections(careers, { notable, cupScopes }),
  didNotPlayFor: generateDidNotPlayFor(careers, { notable, clubCountryById }),
  whoAmI: generateWhoAmI(careers),
  guessTheClub: generateGuessTheClub(teams),
  managers: generateManagerQuestions(coachSpells),
  topScorers: generateTopScorerQuestions(seasonStats),
  cupFinals: generateCupFinalQuestions(cupFixtures, cupParticipants),
  knockouts: generateKnockoutProgressionQuestions(cupFixtures, cupParticipants),
  cupParticipation: generateCompetitionParticipation(cupParticipants, cupSeasonMeta, [...notable]),
  venues: generateVenueQuestions(teams),
  trophies: generateTrophyQuestions(trophies),
};

const candidates = Object.values(byGenerator).flat();

console.log(`  candidates generated: ${candidates.length}`);
for (const [name, list] of Object.entries(byGenerator)) {
  if (list.length > 0) console.log(`    ${name.padEnd(20)} ${list.length}`);
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

/** SQL for one question, kept together so a question is never half-written. */
function statementsForQuestion(q, id) {
  const statements = [];
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
