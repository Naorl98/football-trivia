import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  derivePlayerAliases,
  deriveTeamAliases,
  generateCareerPaths,
  generateCompetitionParticipation,
  generateCompetitionWinners,
  generateCupFinalQuestions,
  generateGuessTheClub,
  generateKnockoutProgressionQuestions,
  generatePreviousClubQuestions,
  generateTransferQuestions,
  generateTrophyQuestions,
  generateVenueQuestions,
  pickDistinct,
  validateAndDedupe,
  type GeneratorOptions,
  type KnowledgeQuestion,
  type FixtureRow,
  type PlayerRow,
  type TeamRow,
  type TransferRow,
  type WinnerRow,
} from "../src/server/questions/knowledgeGenerators.ts";
import { buildFootballContext } from "../src/server/football/context.ts";
import { MOVED_PERMANENTLY_HE } from "../src/server/football/career.ts";

// ---------------------------------------------------------------------------
// Fixtures
//
// Every generator now takes a FootballContext — the knowledge base with each
// team classified and each club scored. That is not ceremony: it is the only
// thing that lets a generator know "Japan" is a country and "Auxerre II" is a
// reserve side, and the absence of it is what produced 2,291 club-transfer
// questions with a national team among the options.
// ---------------------------------------------------------------------------

const teamRow = (id: number, name: string, venue: string | null = null, over: Partial<TeamRow> = {}): TeamRow => ({
  id,
  name,
  name_he: null,
  country_name: "England",
  founded: 1900,
  venue_name: venue,
  local_code: "PREMIER_LEAGUE",
  competition_priority: 1,
  is_national: 0,
  ...over,
});

/** A senior national team, as API-Football stores one. */
const nationalRow = (id: number, name: string, over: Partial<TeamRow> = {}): TeamRow =>
  teamRow(id, name, null, { is_national: 1, country_name: name, local_code: null, ...over });

/** Builds the context the generators need from a list of team rows. */
const contextOf = (teams: TeamRow[], players: PlayerRow[] = []): GeneratorOptions => ({
  context: buildFootballContext({
    teams: teams as never,
    players: players.map((p) => ({ ...p })) as never,
  }),
});

const winnerRow = (season: number, team: string, over: Partial<WinnerRow> = {}): WinnerRow => ({
  competition_id: 39,
  competition_name: "Premier League",
  competition_local_code: "PREMIER_LEAGUE",
  competition_priority: 1,
  competition_type: "LEAGUE",
  season,
  team_name: team,
  runner_up_name: null,
  ...over,
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
  const teams = [
    teamRow(1, "Liverpool"),
    teamRow(2, "Manchester City"),
    teamRow(3, "Arsenal"),
    teamRow(4, "Chelsea"),
    teamRow(5, "Everton"),
  ];
  const ctx = contextOf(teams).context;
  const run = (rows: WinnerRow[] = winners) => generateCompetitionWinners(rows, new Map(), ctx);

  test("generates one question per season", () => {
    assert.equal(run().length, winners.length);
  });

  test("the correct option is the actual champion", () => {
    const q = run().find((x) => x.semanticKey.endsWith(":2020"))!;
    assert.equal(q.options[q.correctIndex], "Liverpool");
  });

  test("distractors are clubs of the same competition", () => {
    const pool = new Set(teams.map((t) => t.name));
    for (const option of run()[0].options) {
      assert.ok(pool.has(option), `${option} is not a plausible distractor`);
    }
  });

  test("no distractor equals the answer", () => {
    for (const q of run()) {
      const others = q.options.filter((_, i) => i !== q.correctIndex);
      assert.ok(!others.includes(q.options[q.correctIndex]));
    }
  });

  test("skips competitions without enough club distractors", () => {
    const thin = [winnerRow(2023, "A"), winnerRow(2024, "B")];
    assert.equal(generateCompetitionWinners(thin, new Map(), contextOf([teamRow(1, "A"), teamRow(2, "B")]).context).length, 0);
  });

  test("semantic keys are unique and stable", () => {
    const first = run().map((q) => q.semanticKey);
    const second = run().map((q) => q.semanticKey);
    assert.deepEqual(first, second);
    assert.equal(new Set(first).size, first.length);
  });

  /*
    THE WORLD CUP IS WON BY A NATION, THE PREMIER LEAGUE BY A CLUB.

    Both arrive through this generator from the same table, and before this phase
    both drew from the same undifferentiated name pool — which is how two active
    questions offered a World Cup champion beside three clubs.
  */
  test("an international competition's champion is a national team, with national-team options", () => {
    const nations = [
      nationalRow(100, "Argentina"),
      nationalRow(101, "France"),
      nationalRow(102, "Brazil"),
      nationalRow(103, "Germany"),
      nationalRow(104, "Spain"),
    ];
    const ctxWithNations = contextOf([...teams, ...nations]).context;
    const out = generateCompetitionWinners(
      [
        winnerRow(2022, "Argentina", {
          competition_id: 1,
          competition_name: "World Cup",
          competition_local_code: "WORLD_CUP",
          competition_type: "INTERNATIONAL",
        }),
        winnerRow(2018, "France", {
          competition_id: 1,
          competition_name: "World Cup",
          competition_local_code: "WORLD_CUP",
          competition_type: "INTERNATIONAL",
        }),
      ],
      // The entrants of that competition-season, which is where the believable
      // wrong answers live. Without it the pool is the two champions alone.
      new Map([[1, nations.map((n) => n.name)]]),
      ctxWithNations
    );
    assert.ok(out.length > 0, "a World Cup winner must still produce a question");
    const nationNames = new Set(nations.map((n) => n.name));
    for (const q of out) {
      assert.equal(q.resolvedTeamType, "NATIONAL_TEAM");
      for (const option of q.options) {
        assert.ok(nationNames.has(option), `${option} is not a national team`);
      }
    }
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
  const options = contextOf(teams);

  test("asks where the player moved to", () => {
    const [q] = generateTransferQuestions([transferRow()], options);
    assert.equal(q.options[q.correctIndex], "Paris Saint Germain");
    assert.match(q.questionHe, /Barcelona/);
  });

  /*
    LOANS ARE ASKED, AND CALLED LOANS.

    They used to be discarded entirely, on the grounds that "a loan is not a
    clean 'moved to' fact" — which is true of the WORDING and not of the fact. A
    loan is a perfectly good question when the question says so, and throwing
    them away cost half the transfer bank.
  */
  test("a loan is asked with loan wording, not as a permanent move", () => {
    const [q] = generateTransferQuestions([transferRow({ transfer_type: "Loan" })], options);
    assert.ok(q, "a loan must still produce a question");
    assert.match(q.questionHe, /הושאל/, "a loan must be called a loan");
    // MOVED_PERMANENTLY_HE, not /\bעבר\b/: `\b` is defined against [A-Za-z0-9_]
    // so it matches no boundary in Hebrew, and this assertion would pass on any
    // text at all. See career.ts.
    assert.doesNotMatch(q.questionHe, MOVED_PERMANENTLY_HE, "a loan must not be described as a permanent move");
    assert.equal(q.movement, "LOAN");
  });

  test("an unspecified movement gets neutral wording rather than a claim", () => {
    const [q] = generateTransferQuestions([transferRow({ transfer_type: null })], options);
    assert.match(q.questionHe, /הגיע/, "with no transfer type on record, 'הגיע' is the honest verb");
    assert.doesNotMatch(q.questionHe, MOVED_PERMANENTLY_HE);
  });

  test("transfers missing either end are skipped", () => {
    assert.equal(generateTransferQuestions([transferRow({ from_team_name: null })], options).length, 0);
    assert.equal(generateTransferQuestions([transferRow({ to_team_name: null })], options).length, 0);
  });

  test("the origin club is never offered as a distractor", () => {
    const [q] = generateTransferQuestions([transferRow()], options);
    const others = q.options.filter((_, i) => i !== q.correctIndex);
    assert.ok(!others.includes("Barcelona"));
  });

  test("free text is enabled with the destination as canonical answer", () => {
    const [q] = generateTransferQuestions([transferRow()], options);
    assert.equal(q.freeText, true);
    assert.equal(q.canonicalAnswer, "Paris Saint Germain");
  });

  test("a Hebrew preposition before a Latin club name takes a maqaf", () => {
    const [q] = generateTransferQuestions([transferRow()], options);
    assert.match(q.questionHe, /מ-Barcelona/, 'production read "מBarcelona", two scripts jammed together');
  });

  /*
    THE HARD INVARIANT, at the generator level.

    No club transfer may be answered by, or offered against, a national team —
    whatever is in the pool.
  */
  test("national teams never reach a club transfer's options", () => {
    const withNations = contextOf([
      ...teams,
      nationalRow(200, "Japan"),
      nationalRow(201, "Brazil"),
      nationalRow(202, "Argentina"),
    ]);
    const forward = generateTransferQuestions([transferRow()], withNations);
    const back = generatePreviousClubQuestions([transferRow()], withNations);
    for (const q of [...forward, ...back]) {
      for (const option of q.options) {
        assert.ok(
          !["Japan", "Brazil", "Argentina"].includes(option),
          `${option} is a national team and cannot appear in "${q.questionHe}"`
        );
      }
    }
  });

  test("a transfer whose end is a reserve side produces nothing", () => {
    const withReserve = contextOf([...teams, teamRow(60, "Auxerre II")]);
    const out = generateTransferQuestions(
      [transferRow({ to_team_name: "Auxerre II", to_team_id: 60 })],
      withReserve
    );
    assert.equal(out.length, 0, "a reserve side is not a club a player can be asked about");
  });
});

describe("career path generator", () => {
  const players: PlayerRow[] = [
    { id: 1, name: "Lionel Messi", name_he: null, nationality: "Argentina", position: "Attacker" },
    { id: 2, name: "Cristiano Ronaldo", name_he: null, nationality: "Portugal", position: "Attacker" },
    { id: 3, name: "Neymar", name_he: null, nationality: "Brazil", position: "Attacker" },
    { id: 4, name: "Kylian Mbappe", name_he: null, nationality: "France", position: "Attacker" },
  ];
  const teams = [
    teamRow(1, "Santos"),
    teamRow(2, "Barcelona"),
    teamRow(3, "Paris Saint Germain"),
    teamRow(4, "Al Hilal"),
    teamRow(5, "Real Madrid"),
  ];

  const chain: TransferRow[] = [
    transferRow({ transfer_date: "2013-07-01", from_team_name: "Santos", to_team_name: "Barcelona", player_id: 3, player_name: "Neymar" }),
    transferRow({ transfer_date: "2017-08-03", from_team_name: "Barcelona", to_team_name: "Paris Saint Germain", player_id: 3, player_name: "Neymar" }),
    transferRow({ transfer_date: "2023-08-15", from_team_name: "Paris Saint Germain", to_team_name: "Al Hilal", player_id: 3, player_name: "Neymar" }),
  ];

  const options = contextOf(teams, players);

  test("builds a chronological path", () => {
    const [q] = generateCareerPaths(new Map([[3, chain]]), players, options);
    assert.deepEqual(q.clues, ["Santos", "Barcelona", "Paris Saint Germain", "Al Hilal"]);
  });

  test("the answer is the player", () => {
    const [q] = generateCareerPaths(new Map([[3, chain]]), players, options);
    assert.equal(q.options[q.correctIndex], "Neymar");
  });

  test("rejects chains with an undated move, where ordering is uncertain", () => {
    const undated = [...chain.slice(0, 2), transferRow({ player_id: 3, transfer_date: null })];
    assert.equal(generateCareerPaths(new Map([[3, undated]]), players, options).length, 0);
  });

  test("requires at least three clubs to be interesting", () => {
    assert.equal(generateCareerPaths(new Map([[3, chain.slice(0, 1)]]), players, options).length, 0);
  });

  /*
    A CLUB CAREER PATH CONTAINS CLUBS.

    That reads like a tautology and was not true: the path was built from raw
    transfer rows, so a national-team row or a B-team spell went straight onto
    the list of clues, and 50 active questions showed a reserve side as the first
    stop in a career — the Busquets class of failure.
  */
  test("national teams and reserve sides are kept out of the path", () => {
    const polluted: TransferRow[] = [
      transferRow({ transfer_date: "2012-07-01", from_team_name: "Barcelona B", from_team_id: 90, to_team_name: "Santos", player_id: 3, player_name: "Neymar" }),
      ...chain,
      transferRow({ transfer_date: "2024-01-01", from_team_name: "Al Hilal", to_team_name: "Brazil", to_team_id: 91, player_id: 3, player_name: "Neymar" }),
    ];
    const withNoise = contextOf(
      [...teams, teamRow(90, "Barcelona B"), nationalRow(91, "Brazil")],
      players
    );
    const [q] = generateCareerPaths(new Map([[3, polluted]]), players, withNoise);
    assert.ok(q, "the path should survive with its club spells");
    assert.ok(!q.clues!.includes("Brazil"), "a national team is not a club in a career");
    assert.ok(!q.clues!.includes("Barcelona B"), "a reserve side is not a career start");
    assert.deepEqual(q.clues, ["Santos", "Barcelona", "Paris Saint Germain", "Al Hilal"]);
  });
});

describe("guess the club generator", () => {
  const clubs = [
    teamRow(1, "Arsenal", "Emirates Stadium", { founded: 1886 }),
    teamRow(2, "Manchester United", "Old Trafford", { founded: 1878 }),
    teamRow(3, "Liverpool", "Anfield", { founded: 1892 }),
    teamRow(4, "Chelsea", "Stamford Bridge", { founded: 1905 }),
    teamRow(5, "Everton", "Goodison Park", { founded: 1878 }),
  ];

  /*
    "איזה מועדון אני?" CANNOT BE ANSWERED BY A COUNTRY.

    52 active questions offered a national team as an option and 32 answered with
    one, because Qatar and Canada carry a country, a founding year and a stadium
    on record exactly like a club does. Every one of those three facts was true.
  */
  test("a national team is never the subject or an option", () => {
    const withNations = [
      ...clubs,
      nationalRow(100, "Qatar", { venue_name: "Lusail Stadium", founded: 1960 }),
      nationalRow(101, "Canada", { venue_name: "BMO Field", founded: 1912 }),
    ];
    const out = generateGuessTheClub(withNations, contextOf(withNations));
    assert.ok(out.length > 0);
    for (const q of out) {
      for (const option of q.options) {
        assert.ok(!["Qatar", "Canada"].includes(option), `${option} is a country, not a club`);
      }
    }
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
  const options = contextOf(teams);

  test("only teams with a known venue produce questions", () => {
    assert.equal(generateVenueQuestions(teams, options).length, 4);
  });

  test("options are all real venues", () => {
    const venues = new Set(teams.filter((t) => t.venue_name).map((t) => t.venue_name));
    for (const q of generateVenueQuestions(teams, options)) {
      for (const option of q.options) assert.ok(venues.has(option));
    }
  });

  test("a national team's ground is not a club's home stadium", () => {
    const withNation = [...teams, nationalRow(9, "Qatar", { venue_name: "Lusail Stadium" })];
    const out = generateVenueQuestions(withNation, contextOf(withNation));
    assert.ok(!out.some((q) => q.questionHe.includes("Qatar")));
    assert.ok(!out.some((q) => q.options.includes("Lusail Stadium")));
  });
});

describe("trophy generator", () => {
  const trophies = [
    { player_id: 1, player_name: "A", competition_name: "UEFA Champions League", season: "2019/2020", place: "Winner" },
    { player_id: 2, player_name: "B", competition_name: "Premier League", season: "2019/2020", place: "Winner" },
    { player_id: 3, player_name: "C", competition_name: "Serie A", season: "2019/2020", place: "Winner" },
    { player_id: 4, player_name: "D", competition_name: "La Liga", season: "2019/2020", place: "Winner" },
  ];
  const options = contextOf([teamRow(1, "Arsenal")]);

  test("only 'Winner' placements are used", () => {
    const withRunnerUp = [...trophies, { player_id: 5, player_name: "E", competition_name: "Copa del Rey", season: "2020/2021", place: "Runner-up" }];
    const questions = generateTrophyQuestions(withRunnerUp, options);
    assert.ok(!questions.some((q) => q.questionHe.includes("E")));
  });

  test("a player who won two competitions in one season is skipped as ambiguous", () => {
    const ambiguous = [
      ...trophies,
      { player_id: 1, player_name: "A", competition_name: "Premier League", season: "2019/2020", place: "Winner" },
    ];
    const questions = generateTrophyQuestions(ambiguous, options);
    assert.ok(!questions.some((q) => q.semanticKey.startsWith("KB_TROPHY_PLAYER:1:")));
  });

  test("trophy questions stay multiple-choice", () => {
    for (const q of generateTrophyQuestions(trophies, options)) assert.equal(q.freeText, false);
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

  // The structural gates are tested without the semantic layer: these questions
  // are hand-built literals with no archetype, and the semantic gate would
  // correctly reject every one of them for that reason alone — which would tell
  // us nothing about the structural checks.
  const structural = (questions: KnowledgeQuestion[], existing = new Set<string>()) =>
    validateAndDedupe(questions, existing, { semantic: false });

  test("accepts a well-formed question", () => {
    assert.equal(structural([base]).accepted.length, 1);
  });

  test("rejects duplicate semantic keys against the existing bank", () => {
    const { accepted, rejected } = structural([base], new Set(["KB_TEST:1"]));
    assert.equal(accepted.length, 0);
    assert.equal(rejected[0].reason, "duplicate-semantic-key");
  });

  test("rejects duplicates inside one batch", () => {
    assert.equal(structural([base, { ...base }]).accepted.length, 1);
  });

  test("rejects the wrong number of options", () => {
    assert.equal(structural([{ ...base, options: ["A", "B", "C"] }]).rejected[0].reason, "wrong-option-count");
  });

  test("rejects options that are duplicates after normalization", () => {
    assert.equal(
      structural([{ ...base, options: ["Bayern", "bayern", "C", "D"] }]).rejected[0].reason,
      "duplicate-options"
    );
  });

  test("rejects an empty option", () => {
    assert.equal(structural([{ ...base, options: ["A", "", "C", "D"] }]).rejected[0].reason, "empty-option");
  });

  test("rejects free text without a canonical answer", () => {
    assert.equal(structural([{ ...base, freeText: true }]).rejected[0].reason, "free-text-without-canonical");
  });

  test("rejects a canonical answer that collides with a distractor", () => {
    assert.equal(
      structural([{ ...base, freeText: true, canonicalAnswer: "B", aliases: ["B"] }]).rejected[0].reason,
      "canonical-collides-with-distractor"
    );
  });

  test("rejects an alias that would accept a wrong option", () => {
    assert.equal(
      structural([{ ...base, freeText: true, canonicalAnswer: "A", aliases: ["C"] }]).rejected[0].reason,
      "alias-collides-with-distractor"
    );
  });

  test("rejects missing question text", () => {
    assert.equal(structural([{ ...base, questionHe: "  " }]).rejected[0].reason, "missing-text");
  });

  /*
    THE SEMANTIC GATE IS ON BY DEFAULT.

    A question carrying no archetype cannot be checked for anything that matters
    — which answer type it should have, whether its options are all that type,
    whether a loan is called a loan — so it is rejected rather than waved
    through. "Nobody annotated this" is not a reason to trust it.
  */
  test("the semantic gate rejects an un-annotated question", () => {
    const { accepted, rejected } = validateAndDedupe([base], new Set());
    assert.equal(accepted.length, 0);
    assert.equal(rejected[0].reason, "missing-archetype");
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
    competition_type: "CONTINENTAL",
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
  const clubTeams = [
    teamRow(10, "Paris Saint Germain"),
    teamRow(20, "Inter"),
    teamRow(30, "Arsenal"),
    teamRow(31, "Barcelona"),
    teamRow(32, "Bayern München"),
    teamRow(33, "Real Madrid"),
  ];
  const options = contextOf(clubTeams);

  test("a final produces finalist and scoreline questions", () => {
    const out = generateCupFinalQuestions([fixture({})], participants, options);
    assert.ok(out.length >= 3, `expected finalist questions both ways plus a score, got ${out.length}`);
    const opponent = out.find((q) => q.questionHe.includes("נגד מי"))!;
    assert.ok(opponent, "expected a 'who did they face' question");
    assert.equal(opponent.category, "CHAMPIONS_LEAGUE", "a UCL final belongs in the UCL filter, not TITLES");
  });

  test("a group-stage fixture is not a final", () => {
    assert.deepEqual(generateCupFinalQuestions([fixture({ round: "Group Stage - 1" })], participants, options), []);
  });

  test("the third-place play-off is not a final", () => {
    // It contains the word "Final" and settles no trophy.
    assert.deepEqual(generateCupFinalQuestions([fixture({ round: "3rd Place Final" })], participants, options), []);
  });

  test("an unplayed final produces nothing", () => {
    assert.deepEqual(
      generateCupFinalQuestions(
        [fixture({ status: "NS", home_goals: null, away_goals: null })],
        participants,
        options
      ),
      []
    );
  });

  test("a shootout is reported in the scoreline rather than hidden", () => {
    // Argentina 3-3 France, won 4-2 on penalties. A goals-only reading of this
    // final says nobody won it.
    const nations = [
      nationalRow(10, "Argentina"),
      nationalRow(20, "France"),
      nationalRow(40, "Brazil"),
      nationalRow(41, "England"),
      nationalRow(42, "Netherlands"),
      nationalRow(43, "Croatia"),
    ];
    const out = generateCupFinalQuestions(
      [
        fixture({
          competition_id: 1,
          competition_name: "World Cup",
          competition_local_code: "WORLD_CUP",
          competition_type: "INTERNATIONAL",
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
      new Map([["1:2022", ["Brazil", "England", "Netherlands", "Croatia"]]]),
      contextOf(nations)
    );
    const score = out.find((q) => q.questionHe.includes("התוצאה"));
    assert.ok(score, "expected a scoreline question");
    assert.match(score!.options[score!.correctIndex], /3-3.*4-2/, "the shootout must appear in the answer");
    assert.equal(score!.category, "WORLD_CUP");

    // And the finalist question must offer nations, not clubs.
    const opponent = out.find((q) => q.questionHe.includes("נגד מי"))!;
    assert.equal(opponent.resolvedTeamType, "NATIONAL_TEAM");
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
      participants,
      options
    );
    const psg = out.filter((q) => q.questionHe.includes("Paris Saint Germain"));
    assert.equal(psg.length, 1, "two legs are one tie and must yield one question");
    assert.equal(psg[0].options[psg[0].correctIndex], "Arsenal");
  });

  test("a club that never reached the next round is not credited with winning a tie", () => {
    const out = generateKnockoutProgressionQuestions(
      [fixture({ id: 2, round: "Semi-finals", home_team_id: 10, away_team_id: 30, away_team_name: "Arsenal" })],
      participants,
      options
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
        type: "CUP",
        season: 2024,
        seasonLabel: "2024/25",
      },
    ],
  ]);
  const clubNames = ["Arsenal", "Barcelona", "Inter", "Real Madrid", "Leeds", "Sunderland", "Cadiz", "Hellas Verona"];
  const options = contextOf(clubNames.map((name, i) => teamRow(i + 1, name)));

  test("asks only about competition-seasons whose participants are known", () => {
    const played = new Map([["2:2024", ["Arsenal", "Barcelona", "Inter", "Real Madrid"]]]);
    const out = generateCompetitionParticipation(played, meta as never, clubNames, options);
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
    const out = generateCompetitionParticipation(
      played,
      meta as never,
      ["Arsenal", "Barcelona", "Inter", "Real Madrid"],
      options
    );
    assert.deepEqual(out, []);
  });

  /*
    A WORLD CUP IS CONTESTED BY NATIONS.

    71 active questions asked "איזו מהקבוצות האלה השתתפה במונדיאל" and offered a
    nation beside three clubs, which answers itself.
  */
  test("an international competition offers nations only, and says so in the wording", () => {
    const nations = ["Argentina", "France", "Brazil", "England", "Japan", "Qatar", "Canada", "Ghana"];
    const wcMeta = new Map([
      [
        "1:2022",
        {
          competitionId: 1,
          competitionName: "World Cup",
          localCode: "WORLD_CUP",
          priority: 1,
          type: "INTERNATIONAL",
          season: 2022,
          seasonLabel: "2022",
        },
      ],
    ]);
    const played = new Map([["1:2022", ["Argentina", "France", "Brazil", "England"]]]);
    const out = generateCompetitionParticipation(
      played,
      wcMeta as never,
      nations,
      contextOf(nations.map((name, i) => nationalRow(100 + i, name)))
    );
    assert.ok(out.length > 0);
    for (const q of out) {
      assert.equal(q.resolvedTeamType, "NATIONAL_TEAM");
      assert.match(q.questionHe, /מהנבחרות/, "nations are נבחרות, not קבוצות");
      for (const option of q.options) assert.ok(nations.includes(option));
    }
  });
});
