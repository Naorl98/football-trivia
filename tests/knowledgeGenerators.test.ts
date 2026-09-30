import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDifficulty,
  derivePlayerAliases,
  deriveTeamAliases,
  generateCareerPaths,
  generateCompetitionParticipation,
  generateCompetitionWinners,
  generateCupFinalQuestions,
  generateKnockoutProgressionQuestions,
  generateTransferQuestions,
  generateTrophyQuestions,
  generateVenueQuestions,
  pickDistinct,
  validateAndDedupe,
  type KnowledgeQuestion,
  type FixtureRow,
  type TeamRow,
  type TransferRow,
  type WinnerRow,
} from "../src/server/questions/knowledgeGenerators.ts";

const teamRow = (id: number, name: string, venue: string | null = null): TeamRow => ({
  id,
  name,
  name_he: null,
  country_name: "England",
  founded: 1900,
  venue_name: venue,
  local_code: "PREMIER_LEAGUE",
  competition_priority: 1,
});

const winnerRow = (season: number, team: string): WinnerRow => ({
  competition_id: 39,
  competition_name: "Premier League",
  competition_local_code: "PREMIER_LEAGUE",
  competition_priority: 1,
  season,
  team_name: team,
  runner_up_name: null,
});

const transferRow = (over: Partial<TransferRow> = {}): TransferRow => ({
  player_id: 1,
  player_name: "Lionel Messi",
  from_team_id: 10,
  from_team_name: "Barcelona",
  to_team_id: 20,
  to_team_name: "Paris Saint Germain",
  transfer_date: "2021-08-10",
  transfer_type: "Free",
  ...over,
});

describe("alias derivation stays safe", () => {
  test("includes the full name and an ASCII-folded variant", () => {
    const aliases = derivePlayerAliases("Vinícius Júnior");
    assert.ok(aliases.includes("Vinícius Júnior"));
    assert.ok(aliases.includes("Vinicius Junior"));
  });

  test("includes a distinctive surname", () => {
    assert.ok(derivePlayerAliases("Lionel Messi").includes("Messi"));
  });

  test("never invents nicknames", () => {
    const aliases = derivePlayerAliases("Vinícius Júnior");
    assert.ok(!aliases.includes("Vini"), "nicknames must be curated, not derived");
  });

  test("skips very short surnames that identify nobody", () => {
    assert.ok(!derivePlayerAliases("Kevin De").includes("De"));
  });

  test("team aliases strip club-type prefixes", () => {
    const aliases = deriveTeamAliases(teamRow(1, "FC Barcelona"));
    assert.ok(aliases.includes("FC Barcelona"));
    assert.ok(aliases.includes("Barcelona"));
  });
});

describe("deterministic helpers", () => {
  test("pickDistinct is stable for the same seed", () => {
    const pool = ["a", "b", "c", "d", "e", "f"];
    assert.deepEqual(pickDistinct(pool, 3, "seed"), pickDistinct(pool, 3, "seed"));
  });

  test("different seeds generally differ", () => {
    const pool = ["a", "b", "c", "d", "e", "f", "g", "h"];
    assert.notDeepEqual(pickDistinct(pool, 3, "seed-a"), pickDistinct(pool, 3, "seed-z"));
  });

  test("difficulty classification is deterministic", () => {
    const input = { resource: "winner" as const, season: 2015, competitionPriority: 1 };
    assert.equal(classifyDifficulty(input), classifyDifficulty(input));
  });

  test("older facts classify as harder", () => {
    const recent = classifyDifficulty({ resource: "winner", season: 2024, competitionPriority: 1 });
    const old = classifyDifficulty({ resource: "winner", season: 2005, competitionPriority: 1 });
    const ladder = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];
    assert.ok(ladder.indexOf(old) > ladder.indexOf(recent));
  });

  test("lower-priority competitions classify as harder", () => {
    const ladder = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];
    const top = classifyDifficulty({ resource: "winner", season: 2024, competitionPriority: 1 });
    const minor = classifyDifficulty({ resource: "winner", season: 2024, competitionPriority: 3 });
    assert.ok(ladder.indexOf(minor) > ladder.indexOf(top));
  });
});

describe("competition winner generator", () => {
  const winners = [
    winnerRow(2020, "Liverpool"),
    winnerRow(2021, "Manchester City"),
    winnerRow(2022, "Manchester City"),
    winnerRow(2023, "Manchester City"),
    winnerRow(2024, "Arsenal"),
    winnerRow(2019, "Chelsea"),
  ];

  test("generates one question per season", () => {
    const questions = generateCompetitionWinners(winners);
    assert.equal(questions.length, winners.length);
  });

  test("the correct option is the actual champion", () => {
    const q = generateCompetitionWinners(winners).find((x) => x.semanticKey.endsWith(":2020"))!;
    assert.equal(q.options[q.correctIndex], "Liverpool");
  });

  test("distractors are other champions of the same competition", () => {
    const q = generateCompetitionWinners(winners)[0];
    const pool = new Set(winners.map((w) => w.team_name));
    for (const option of q.options) assert.ok(pool.has(option), `${option} is not a plausible distractor`);
  });

  test("no distractor equals the answer", () => {
    for (const q of generateCompetitionWinners(winners)) {
      const others = q.options.filter((_, i) => i !== q.correctIndex);
      assert.ok(!others.includes(q.options[q.correctIndex]));
    }
  });

  test("skips competitions without enough distinct champions", () => {
    const thin = [winnerRow(2023, "A"), winnerRow(2024, "B")];
    assert.equal(generateCompetitionWinners(thin).length, 0);
  });

  test("semantic keys are unique and stable", () => {
    const first = generateCompetitionWinners(winners).map((q) => q.semanticKey);
    const second = generateCompetitionWinners(winners).map((q) => q.semanticKey);
    assert.deepEqual(first, second);
    assert.equal(new Set(first).size, first.length);
  });
});

describe("transfer generator", () => {
  const teams = [
    teamRow(20, "Paris Saint Germain"),
    teamRow(10, "Barcelona"),
    teamRow(30, "Real Madrid"),
    teamRow(40, "Bayern Munich"),
    teamRow(50, "Inter"),
  ];

  test("asks where the player moved to", () => {
    const [q] = generateTransferQuestions([transferRow()], teams);
    assert.equal(q.options[q.correctIndex], "Paris Saint Germain");
    assert.match(q.questionHe, /Barcelona/);
  });

  test("loans are skipped — they are not a clean 'moved to' fact", () => {
    const questions = generateTransferQuestions([transferRow({ transfer_type: "Loan" })], teams);
    assert.equal(questions.length, 0);
  });

  test("transfers missing either end are skipped", () => {
    assert.equal(generateTransferQuestions([transferRow({ from_team_name: null })], teams).length, 0);
    assert.equal(generateTransferQuestions([transferRow({ to_team_name: null })], teams).length, 0);
  });

  test("the origin club is never offered as a distractor", () => {
    const [q] = generateTransferQuestions([transferRow()], teams);
    const others = q.options.filter((_, i) => i !== q.correctIndex);
    assert.ok(!others.includes("Barcelona"));
  });

  test("free text is enabled with the destination as canonical answer", () => {
    const [q] = generateTransferQuestions([transferRow()], teams);
    assert.equal(q.freeText, true);
    assert.equal(q.canonicalAnswer, "Paris Saint Germain");
  });
});

describe("career path generator", () => {
  const players = [
    { id: 1, name: "Lionel Messi", name_he: null, nationality: "Argentina", position: "Attacker" },
    { id: 2, name: "Cristiano Ronaldo", name_he: null, nationality: "Portugal", position: "Attacker" },
    { id: 3, name: "Neymar", name_he: null, nationality: "Brazil", position: "Attacker" },
    { id: 4, name: "Kylian Mbappe", name_he: null, nationality: "France", position: "Attacker" },
  ];

  const chain: TransferRow[] = [
    transferRow({ transfer_date: "2013-07-01", from_team_name: "Santos", to_team_name: "Barcelona", player_id: 3, player_name: "Neymar" }),
    transferRow({ transfer_date: "2017-08-03", from_team_name: "Barcelona", to_team_name: "Paris Saint Germain", player_id: 3, player_name: "Neymar" }),
    transferRow({ transfer_date: "2023-08-15", from_team_name: "Paris Saint Germain", to_team_name: "Al Hilal", player_id: 3, player_name: "Neymar" }),
  ];

  test("builds a chronological path", () => {
    const map = new Map([[3, chain]]);
    const [q] = generateCareerPaths(map, players);
    assert.deepEqual(q.clues, ["Santos", "Barcelona", "Paris Saint Germain", "Al Hilal"]);
  });

  test("the answer is the player", () => {
    const [q] = generateCareerPaths(new Map([[3, chain]]), players);
    assert.equal(q.options[q.correctIndex], "Neymar");
  });

  test("rejects chains with an undated move, where ordering is uncertain", () => {
    const undated = [...chain.slice(0, 2), transferRow({ player_id: 3, transfer_date: null })];
    assert.equal(generateCareerPaths(new Map([[3, undated]]), players).length, 0);
  });

  test("requires at least three clubs to be interesting", () => {
    assert.equal(generateCareerPaths(new Map([[3, chain.slice(0, 1)]]), players).length, 0);
  });
});

describe("venue generator", () => {
  const teams = [
    teamRow(1, "Arsenal", "Emirates Stadium"),
    teamRow(2, "Manchester United", "Old Trafford"),
    teamRow(3, "Liverpool", "Anfield"),
    teamRow(4, "Chelsea", "Stamford Bridge"),
    teamRow(5, "Everton", null),
  ];

  test("only teams with a known venue produce questions", () => {
    assert.equal(generateVenueQuestions(teams).length, 4);
  });

  test("options are all real venues", () => {
    const venues = new Set(teams.filter((t) => t.venue_name).map((t) => t.venue_name));
    for (const q of generateVenueQuestions(teams)) {
      for (const option of q.options) assert.ok(venues.has(option));
    }
  });
});

describe("trophy generator", () => {
  const trophies = [
    { player_id: 1, player_name: "A", competition_name: "UEFA Champions League", season: "2019/2020", place: "Winner" },
    { player_id: 2, player_name: "B", competition_name: "Premier League", season: "2019/2020", place: "Winner" },
    { player_id: 3, player_name: "C", competition_name: "Serie A", season: "2019/2020", place: "Winner" },
    { player_id: 4, player_name: "D", competition_name: "La Liga", season: "2019/2020", place: "Winner" },
  ];

  test("only 'Winner' placements are used", () => {
    const withRunnerUp = [...trophies, { player_id: 5, player_name: "E", competition_name: "Copa del Rey", season: "2020/2021", place: "Runner-up" }];
    const questions = generateTrophyQuestions(withRunnerUp);
    assert.ok(!questions.some((q) => q.questionHe.includes("E")));
  });

  test("a player who won two competitions in one season is skipped as ambiguous", () => {
    const ambiguous = [
      ...trophies,
      { player_id: 1, player_name: "A", competition_name: "Premier League", season: "2019/2020", place: "Winner" },
    ];
    const questions = generateTrophyQuestions(ambiguous);
    assert.ok(!questions.some((q) => q.semanticKey.startsWith("KB_TROPHY_PLAYER:1:")));
  });

  test("trophy questions stay multiple-choice", () => {
    for (const q of generateTrophyQuestions(trophies)) assert.equal(q.freeText, false);
  });
});

describe("quality gates", () => {
  const base: KnowledgeQuestion = {
    semanticKey: "KB_TEST:1",
    mode: "CLASSIC",
    category: "TITLES",
    difficulty: "NORMAL",
    questionHe: "שאלה?",
    explanationHe: "הסבר.",
    options: ["A", "B", "C", "D"],
    correctIndex: 0,
    scopes: [{ type: "REGION", value: "WORLD" }],
    sourceLabel: "test",
    freeText: false,
  };

  test("accepts a well-formed question", () => {
    const { accepted } = validateAndDedupe([base], new Set());
    assert.equal(accepted.length, 1);
  });

  test("rejects duplicate semantic keys against the existing bank", () => {
    const { accepted, rejected } = validateAndDedupe([base], new Set(["KB_TEST:1"]));
    assert.equal(accepted.length, 0);
    assert.equal(rejected[0].reason, "duplicate-semantic-key");
  });

  test("rejects duplicates inside one batch", () => {
    const { accepted } = validateAndDedupe([base, { ...base }], new Set());
    assert.equal(accepted.length, 1);
  });

  test("rejects the wrong number of options", () => {
    const { rejected } = validateAndDedupe([{ ...base, options: ["A", "B", "C"] }], new Set());
    assert.equal(rejected[0].reason, "wrong-option-count");
  });

  test("rejects options that are duplicates after normalization", () => {
    const { rejected } = validateAndDedupe([{ ...base, options: ["Bayern", "bayern", "C", "D"] }], new Set());
    assert.equal(rejected[0].reason, "duplicate-options");
  });

  test("rejects an empty option", () => {
    const { rejected } = validateAndDedupe([{ ...base, options: ["A", "", "C", "D"] }], new Set());
    assert.equal(rejected[0].reason, "empty-option");
  });

  test("rejects free text without a canonical answer", () => {
    const { rejected } = validateAndDedupe([{ ...base, freeText: true }], new Set());
    assert.equal(rejected[0].reason, "free-text-without-canonical");
  });

  test("rejects a canonical answer that collides with a distractor", () => {
    const { rejected } = validateAndDedupe(
      [{ ...base, freeText: true, canonicalAnswer: "B", aliases: ["B"] }],
      new Set()
    );
    assert.equal(rejected[0].reason, "canonical-collides-with-distractor");
  });

  test("rejects an alias that would accept a wrong option", () => {
    const { rejected } = validateAndDedupe(
      [{ ...base, freeText: true, canonicalAnswer: "A", aliases: ["C"] }],
      new Set()
    );
    assert.equal(rejected[0].reason, "alias-collides-with-distractor");
  });

  test("rejects missing question text", () => {
    const { rejected } = validateAndDedupe([{ ...base, questionHe: "  " }], new Set());
    assert.equal(rejected[0].reason, "missing-text");
  });
});

// ---------------------------------------------------------------------------
// Cup competitions
// ---------------------------------------------------------------------------
describe("cup finals and knockout progression", () => {
  const fixture = (over: Partial<FixtureRow>): FixtureRow => ({
    id: 1,
    competition_id: 2,
    competition_name: "UEFA Champions League",
    competition_local_code: "UCL",
    competition_priority: 1,
    season: 2024,
    season_label: "2024/25",
    round: "Final",
    home_team_id: 10,
    away_team_id: 20,
    home_team_name: "Paris Saint Germain",
    away_team_name: "Inter",
    home_goals: 5,
    away_goals: 0,
    home_penalties: null,
    away_penalties: null,
    status: "FT",
    ...over,
  });

  const participants = new Map([["2:2024", ["Arsenal", "Barcelona", "Bayern München", "Real Madrid"]]]);

  test("a final produces finalist and scoreline questions", () => {
    const out = generateCupFinalQuestions([fixture({})], participants);
    assert.ok(out.length >= 3, `expected finalist questions both ways plus a score, got ${out.length}`);
    const opponent = out.find((q) => q.questionHe.includes("נגד מי"))!;
    assert.ok(opponent, "expected a 'who did they face' question");
    assert.equal(opponent.category, "CHAMPIONS_LEAGUE", "a UCL final belongs in the UCL filter, not TITLES");
  });

  test("a group-stage fixture is not a final", () => {
    assert.deepEqual(generateCupFinalQuestions([fixture({ round: "Group Stage - 1" })], participants), []);
  });

  test("the third-place play-off is not a final", () => {
    // It contains the word "Final" and settles no trophy.
    assert.deepEqual(generateCupFinalQuestions([fixture({ round: "3rd Place Final" })], participants), []);
  });

  test("an unplayed final produces nothing", () => {
    assert.deepEqual(
      generateCupFinalQuestions([fixture({ status: "NS", home_goals: null, away_goals: null })], participants),
      []
    );
  });

  test("a shootout is reported in the scoreline rather than hidden", () => {
    // Argentina 3-3 France, won 4-2 on penalties. A goals-only reading of this
    // final says nobody won it.
    const out = generateCupFinalQuestions(
      [
        fixture({
          competition_id: 1,
          competition_name: "World Cup",
          competition_local_code: "WORLD_CUP",
          season: 2022,
          season_label: "2022",
          home_team_name: "Argentina",
          away_team_name: "France",
          home_goals: 3,
          away_goals: 3,
          home_penalties: 4,
          away_penalties: 2,
          status: "PEN",
        }),
      ],
      new Map([["1:2022", ["Brazil", "England", "Netherlands", "Croatia"]]])
    );
    const score = out.find((q) => q.questionHe.includes("התוצאה"));
    assert.ok(score, "expected a scoreline question");
    assert.match(score!.options[score!.correctIndex], /3-3.*4-2/, "the shootout must appear in the answer");
    assert.equal(score!.category, "WORLD_CUP");
  });

  test("a two-legged tie names one opponent, read from who reached the next round", () => {
    // PSG appear in the final, so they won their semi; the loser is simply the
    // other club in PSG's semi-final fixtures. Neither leg's score is consulted.
    const out = generateKnockoutProgressionQuestions(
      [
        fixture({ id: 1, round: "Final", home_team_id: 10, away_team_id: 20 }),
        fixture({ id: 2, round: "Semi-finals", home_team_id: 10, away_team_id: 30, home_team_name: "Paris Saint Germain", away_team_name: "Arsenal", home_goals: 1, away_goals: 0 }),
        fixture({ id: 3, round: "Semi-finals", home_team_id: 30, away_team_id: 10, home_team_name: "Arsenal", away_team_name: "Paris Saint Germain", home_goals: 1, away_goals: 2 }),
      ],
      participants
    );
    const psg = out.filter((q) => q.questionHe.includes("Paris Saint Germain"));
    assert.equal(psg.length, 1, "two legs are one tie and must yield one question");
    assert.equal(psg[0].options[psg[0].correctIndex], "Arsenal");
  });

  test("a club that never reached the next round is not credited with winning a tie", () => {
    const out = generateKnockoutProgressionQuestions(
      [
        fixture({ id: 2, round: "Semi-finals", home_team_id: 10, away_team_id: 30, away_team_name: "Arsenal" }),
      ],
      participants
    );
    assert.deepEqual(out, [], "with no later round on record, nothing is known about who advanced");
  });
});

describe("competition participation", () => {
  const meta = new Map([
    [
      "2:2024",
      {
        competitionId: 2,
        competitionName: "UEFA Champions League",
        localCode: "UCL",
        priority: 1,
        season: 2024,
        seasonLabel: "2024/25",
      },
    ],
  ]);

  test("asks only about competition-seasons whose participants are known", () => {
    const played = new Map([["2:2024", ["Arsenal", "Barcelona", "Inter", "Real Madrid"]]]);
    const out = generateCompetitionParticipation(played, meta, [
      "Arsenal",
      "Barcelona",
      "Inter",
      "Real Madrid",
      "Leeds",
      "Sunderland",
      "Cadiz",
      "Hellas Verona",
    ]);
    assert.ok(out.length > 0);
    for (const q of out) {
      const answer = q.options[q.correctIndex];
      assert.ok(played.get("2:2024")!.includes(answer), `${answer} did not play in that competition`);
      for (const [i, option] of q.options.entries()) {
        if (i === q.correctIndex) continue;
        assert.ok(
          !played.get("2:2024")!.includes(option),
          `${option} did play, so it is a second correct answer`
        );
      }
    }
  });

  test("produces nothing when there are too few clubs that did not take part", () => {
    const played = new Map([["2:2024", ["Arsenal", "Barcelona", "Inter", "Real Madrid"]]]);
    const out = generateCompetitionParticipation(played, meta, ["Arsenal", "Barcelona", "Inter", "Real Madrid"]);
    assert.deepEqual(out, []);
  });
});
