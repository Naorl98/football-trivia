// The football semantic layer.
//
// Every test here names the production failure it prevents. That is deliberate:
// these are not unit tests of pure functions, they are the written form of a
// bank audit that found 2,291 club-transfer questions offering a national team,
// 131 position questions answering a precise role from broad data, and 213
// questions treating a reserve side as a club.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyTeam,
  isAskableClub,
  isAskableNationalTeam,
  looksLikeCountry,
  parentClubName,
  clubCandidate,
  nationalTeamCandidate,
  playerCandidate,
} from "../src/server/football/entities.ts";
import {
  BROAD_HE,
  DETAILED_HE,
  broadOf,
  parseBroadPosition,
  parseDetailedPosition,
  positionQuestionShape,
  resolvePosition,
  supportsPreciseQuestion,
} from "../src/server/football/positions.ts";
import {
  classifyCareerEntry,
  classifyMovement,
  clubCareerOnly,
  hePrefix,
  isProductionEligible,
  resolveCareerStart,
} from "../src/server/football/career.ts";
import {
  clubProminence,
  competitionTier,
  factProminence,
  isObscureSubject,
  isVeryObscureSubject,
  playerFame,
} from "../src/server/football/prominence.ts";
import {
  closenessOf,
  DistractorTypeError,
  generateDistractors,
  isEligibleCandidate,
  prominenceGiveaway,
} from "../src/server/football/distractors.ts";
import { answerTypeFor, ARCHETYPES, winnerTypeOfCompetition } from "../src/server/football/archetypes.ts";
import { hasRejection, validateSemantics } from "../src/server/football/validate.ts";
import { buildFootballContext } from "../src/server/football/context.ts";
import { archetypeForStoredKey, CLUB_ONLY_ARCHETYPES } from "../src/server/football/storedKeys.ts";
import { PLAYERS, PLAYER_ROLES } from "../seed/data/players.ts";

// ---------------------------------------------------------------------------
describe("team classification", () => {
  it("trusts the provider's flag for senior national teams", () => {
    assert.equal(classifyTeam({ name: "Japan", isNational: 1 }), "NATIONAL_TEAM");
    assert.equal(classifyTeam({ name: "Brazil", isNational: true }), "NATIONAL_TEAM");
  });

  /*
    THE PROVIDER IS WRONG ABOUT YOUTH INTERNATIONALS.

    API-Football returns `national: false` for "Croatia U21", so believing the
    flag puts a youth international squad into the club pool. Production held
    three of them: Croatia U21, England U19, Norway U19.
  */
  it("does not believe the flag for a youth international side", () => {
    assert.equal(classifyTeam({ name: "Croatia U21", isNational: 0 }), "YOUTH_NATIONAL_TEAM");
    assert.equal(classifyTeam({ name: "England U19", isNational: 0 }), "YOUTH_NATIONAL_TEAM");
    assert.equal(classifyTeam({ name: "Norway U19", isNational: 0 }), "YOUTH_NATIONAL_TEAM");
  });

  it("tells an academy side from a youth international one", () => {
    assert.equal(classifyTeam({ name: "Chelsea U21", isNational: 0 }), "YOUTH_TEAM");
    assert.equal(classifyTeam({ name: "Borussia Dortmund U19", isNational: 0 }), "YOUTH_TEAM");
  });

  it("recognises reserve sides by suffix", () => {
    for (const name of [
      "Barcelona B",
      "Real Madrid II",
      "Bayern München II",
      "Auxerre II",
      "FC Porto B",
      "Sporting CP B",
    ]) {
      assert.equal(classifyTeam({ name, isNational: 0 }), "RESERVE_TEAM", name);
    }
  });

  /*
    THE SUFFIX RULE HAS TO NOT EAT REAL CLUBS.

    "Willem II" is an Eredivisie side. The pattern is anchored to the end of the
    name, which already protects every club that merely CONTAINS a marker, and
    Willem II is named explicitly.
  */
  it("leaves senior clubs whose names collide with the suffixes alone", () => {
    assert.equal(classifyTeam({ name: "Willem II", isNational: 0 }), "CLUB");
    assert.equal(classifyTeam({ name: "Atletico Madrid", isNational: 0 }), "CLUB");
    assert.equal(classifyTeam({ name: "Athletic Club", isNational: 0 }), "CLUB");
    assert.equal(classifyTeam({ name: "Internacional", isNational: 0 }), "CLUB");
    assert.equal(classifyTeam({ name: "Qingdao Youth Island", isNational: 0 }), "CLUB");
  });

  it("only clubs are askable as clubs", () => {
    assert.equal(isAskableClub("CLUB"), true);
    for (const kind of ["NATIONAL_TEAM", "YOUTH_NATIONAL_TEAM", "RESERVE_TEAM", "YOUTH_TEAM"] as const) {
      assert.equal(isAskableClub(kind), false, kind);
    }
  });

  it("only senior national teams are askable as national teams", () => {
    assert.equal(isAskableNationalTeam("NATIONAL_TEAM"), true);
    assert.equal(isAskableNationalTeam("YOUTH_NATIONAL_TEAM"), false);
    assert.equal(isAskableNationalTeam("CLUB"), false);
  });

  it("traces a reserve side back to its first team", () => {
    const senior = new Set(["Barcelona", "Bayern München", "Atletico Madrid"]);
    assert.equal(parentClubName("Barcelona B", senior), "Barcelona");
    assert.equal(parentClubName("Bayern München II", senior), "Bayern München");
    // Accent and case folded, so the provider's two spellings meet.
    assert.equal(parentClubName("Atlético Madrid II", senior), "Atletico Madrid");
    assert.equal(parentClubName("Auxerre II", senior), null, "no senior Auxerre is known here");
  });

  it("knows a country name from a club name", () => {
    assert.equal(looksLikeCountry("Croatia"), true);
    assert.equal(looksLikeCountry("South Korea"), true);
    assert.equal(looksLikeCountry("Chelsea"), false);
  });
});

// ---------------------------------------------------------------------------
describe("position normalisation", () => {
  /*
    THE SALAH BUG.

    Production asked "באיזו עמדה משחק מוחמד סלאח?" and answered "חלוץ" — striker
    — because the registry's `pos` is FW and a four-entry lookup turned FW into
    that word. FW is the front line; "חלוץ" is one role in it, and not his.
  */
  it("broad data never produces a precise role", () => {
    const fromBroad = resolvePosition({ providerBroad: "Attacker" });
    assert.equal(fromBroad.detailed, null, "a unit is not a role");
    assert.equal(fromBroad.broad, "FORWARD");
    assert.equal(fromBroad.confidence, "LOW");
    assert.equal(positionQuestionShape(fromBroad), "BROAD");
    assert.equal(supportsPreciseQuestion(fromBroad), false);
  });

  it("the seed registry's codes behave the same way", () => {
    const fromSeed = resolvePosition({ seedBroad: "FW" });
    assert.equal(fromSeed.detailed, null);
    assert.equal(fromSeed.broad, "FORWARD");
    assert.equal(positionQuestionShape(fromSeed), "BROAD");
  });

  it("a curated role produces a precise question at high confidence", () => {
    const salah = resolvePosition({ curatedRole: "RW", seedBroad: "FW" });
    assert.equal(salah.detailed, "RW");
    assert.equal(salah.broad, "FORWARD");
    assert.equal(salah.confidence, "HIGH");
    assert.equal(positionQuestionShape(salah), "PRECISE");
    assert.equal(DETAILED_HE.RW, "קיצוני ימני");
  });

  it("broad evidence never overwrites a precise role", () => {
    const both = resolvePosition({ curatedRole: "RW", providerBroad: "Attacker" });
    assert.equal(both.detailed, "RW", "the provider's category must not win");
  });

  /*
    GOALKEEPER IS THE HONEST EXCEPTION, and it is a football fact rather than a
    convenience: for a keeper the unit and the role are the same thing.
  */
  it("a goalkeeper gets a precise role from broad data", () => {
    const keeper = resolvePosition({ providerBroad: "Goalkeeper" });
    assert.equal(keeper.detailed, "GK");
    assert.equal(keeper.confidence, "HIGH");
    assert.equal(keeper.source, "goalkeeper-identity");
  });

  it("parses units and roles without confusing them", () => {
    assert.equal(parseBroadPosition("Defender"), "DEFENDER");
    assert.equal(parseDetailedPosition("Defender"), null, "a unit name is not a role");
    assert.equal(parseDetailedPosition("Right Winger"), "RW");
    assert.equal(parseBroadPosition("Right Winger"), "FORWARD");
  });

  it("every detailed role belongs to exactly one unit", () => {
    for (const [role, label] of Object.entries(DETAILED_HE)) {
      const unit = broadOf(role as keyof typeof DETAILED_HE);
      assert.ok(BROAD_HE[unit], `${role} (${label}) has no unit`);
    }
  });

  it('"חלוץ" names only the striker', () => {
    const striker = Object.entries(DETAILED_HE).filter(([, label]) => label === "חלוץ");
    assert.deepEqual(striker.map(([role]) => role), ["ST"]);
  });

  /*
    THE CURATED ROLE TABLE IS INCOMPLETE ON PURPOSE.

    A player absent from it is a player whose role is genuinely ambiguous —
    Messi, Mbappé, Cristiano Ronaldo, Thomas Müller — and the generator then asks
    the broad question, which the data does support. This asserts the table never
    contradicts the registry's own unit, which is the one way it could be wrong
    without anybody noticing.
  */
  it("no curated role contradicts the player's unit", () => {
    const byId = new Map(PLAYERS.map((p) => [p.id, p]));
    for (const [id, role] of Object.entries(PLAYER_ROLES)) {
      const player = byId.get(id);
      assert.ok(player, `${id} is not in the registry`);
      const unit = broadOf(role);
      const expected = { GK: "GOALKEEPER", DF: "DEFENDER", MF: "MIDFIELDER", FW: "FORWARD" }[player!.pos];
      assert.equal(unit, expected, `${id}: role ${role} is a ${unit}, registry says ${player!.pos}`);
    }
  });

  it("leaves the genuinely ambiguous players without a role", () => {
    for (const id of ["messi", "ronaldo_cr", "mbappe", "muller_t", "totti", "rooney", "griezmann"]) {
      assert.equal(PLAYER_ROLES[id], undefined, `${id}'s role is contested and must not be asserted`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("career semantics", () => {
  /*
    THE BUSQUETS BUG.

    "באיזו קבוצה התחיל X?" is at least six different questions, and the provider
    answers only the least interesting one: the earliest row it happens to hold.
    Taking MIN(season) and calling it a career start is a different claim, and
    for anyone whose early years were not harvested it is a false one.
  */
  it("never asserts a career start from provider ordering", () => {
    const start = resolveCareerStart({
      entries: [
        { teamId: 1, teamName: "Barcelona", season: 2008 },
        { teamId: 2, teamName: "Inter Miami", season: 2023 },
      ],
    });
    assert.equal(start!.concept, "FIRST_RECORDED_PROVIDER_CLUB");
    assert.equal(start!.confidence, "LOW");
    assert.equal(isProductionEligible(start!.confidence), false);
  });

  it("reports a reserve side as a reserve side, not a career start", () => {
    const start = resolveCareerStart({
      entries: [
        { teamId: 90, teamName: "Barcelona B", season: 2007 },
        { teamId: 1, teamName: "Barcelona", season: 2008 },
      ],
      seniorClubNames: new Set(["Barcelona"]),
    });
    assert.equal(start!.concept, "RESERVE_TEAM");
    assert.equal(isProductionEligible(start!.confidence), false);
    assert.match(start!.reason, /reserve side of Barcelona/);
  });

  it("a verified first senior club is the one way to ask the question", () => {
    const start = resolveCareerStart({
      entries: [{ teamId: 90, teamName: "Barcelona B", season: 2007 }],
      verifiedFirstSeniorClub: { teamId: 1, teamName: "Barcelona", year: 2008 },
    });
    assert.equal(start!.concept, "FIRST_SENIOR_CLUB");
    assert.equal(start!.confidence, "HIGH");
    assert.match(start!.questionHe("בוסקטס"), /הופעת הבכורה בקבוצה הבוגרת/);
  });

  it("a club career holds clubs only", () => {
    const entries = [
      { teamId: 1, teamName: "Barcelona", season: 2008 },
      { teamId: 91, teamName: "Spain", isNational: 1, season: 2009 },
      { teamId: 90, teamName: "Barcelona B", season: 2007 },
      { teamId: 92, teamName: "Spain U21", season: 2008 },
    ].map(classifyCareerEntry);
    assert.deepEqual(clubCareerOnly(entries).map((e) => e.teamName), ["Barcelona"]);
  });

  it("classifies the kinds of movement the provider actually reports", () => {
    assert.equal(classifyMovement("Loan"), "LOAN");
    assert.equal(classifyMovement("€ 45M"), "PERMANENT");
    assert.equal(classifyMovement("Free"), "FREE");
    assert.equal(classifyMovement("Back from Loan"), "LOAN_RETURN");
    assert.equal(classifyMovement("N/A"), "UNKNOWN");
    assert.equal(classifyMovement(null), "UNKNOWN");
  });

  /*
    "מAuxerre" IS WHAT CONCATENATION GIVES YOU when one operand is RTL and the
    other is not. It appeared verbatim in production question text.
  */
  it("puts a maqaf between a Hebrew preposition and a Latin name", () => {
    assert.equal(hePrefix("מ", "Auxerre"), "מ-Auxerre");
    assert.equal(hePrefix("ל", "PSV איינדהובן"), "ל-PSV איינדהובן");
    assert.equal(hePrefix("ב", "ברצלונה"), "בברצלונה");
  });

  it("swallows a definite article only when told it is one", () => {
    assert.equal(hePrefix("ב", "הליגה האירופית", { definiteArticle: true }), "בליגה האירופית");
    // A club called "הפועל תל אביב" carries that ה as part of its name.
    assert.equal(hePrefix("ל", "הפועל תל אביב"), "להפועל תל אביב");
  });
});

// ---------------------------------------------------------------------------
describe("prominence", () => {
  it("treats the core football universe as core", () => {
    for (const code of ["PREMIER_LEAGUE", "LA_LIGA", "SERIE_A", "BUNDESLIGA", "LIGUE_1", "LIGA_PORTUGAL", "UCL", "WORLD_CUP"]) {
      assert.equal(competitionTier({ localCode: code }), "CORE", code);
    }
  });

  /*
    ISRAEL IS CORE BY AUDIENCE, NOT BY COEFFICIENT.

    Football IQ is Hebrew-first. The Israeli Premier League is not globally
    elite and is exactly the football this audience watches, so penalising it
    would make the product's home league its hardest content.
  */
  it("treats the Israeli league as core and a comparable foreign league as not", () => {
    assert.equal(competitionTier({ localCode: "ISRAELI_PREMIER_LEAGUE" }), "CORE");
    assert.equal(competitionTier({ countryName: "Japan", priority: 1 }), "NON_CORE");
    assert.equal(competitionTier({ countryName: "Denmark", priority: 1 }), "NON_CORE");
  });

  it("scores a curated club above an unknown one", () => {
    const barcelona = clubProminence({ curated: true, titles: 24 });
    const stub = clubProminence({ competitionPriority: null, countryName: null });
    assert.ok(barcelona < stub, `${barcelona} should be lower (better) than ${stub}`);
    assert.ok(barcelona <= 0.4);
    assert.ok(stub >= 2.4);
  });

  it("scores a global icon as famous and an untracked player as obscure", () => {
    assert.equal(playerFame({ curatedTier: 1 }), 0);
    const fringe = playerFame({ recordedClubs: 2, recordedTransfers: 1 });
    assert.ok(isVeryObscureSubject(fringe), `fringe fame ${fringe} should be very obscure`);
  });

  it("a core-league regular is not obscure", () => {
    const regular = playerFame({
      coreClubs: 2,
      hasSeniorNationalTeam: true,
      recordedClubs: 4,
      recordedTransfers: 4,
      bestClubProminence: 0.9,
    });
    assert.equal(isObscureSubject(regular), false, `fame ${regular} should clear the obscure threshold`);
  });

  it("a famous move between famous clubs is a headline fact", () => {
    assert.equal(
      factProminence({ subjectFame: 0, bestClubProminence: 0.4, worstClubProminence: 0.4, year: 2024 }),
      "HEADLINE"
    );
  });

  it("an obscure old move by the same kind of player is not", () => {
    assert.equal(
      factProminence({ subjectFame: 0, bestClubProminence: 0.4, worstClubProminence: 2.4, year: 2010 }),
      "KNOWN"
    );
  });
});

// ---------------------------------------------------------------------------
describe("the distractor engine", () => {
  const clubs = [
    clubCandidate("Lille", { id: 1, prominence: 1.2, country: "France", competitionCode: "LIGUE_1" }),
    clubCandidate("Sevilla", { id: 2, prominence: 0.9, country: "Spain", competitionCode: "LA_LIGA" }),
    clubCandidate("Porto", { id: 3, prominence: 0.8, country: "Portugal", competitionCode: "LIGA_PORTUGAL" }),
    clubCandidate("Lyon", { id: 4, prominence: 1.0, country: "France", competitionCode: "LIGUE_1" }),
  ];
  const nations = [
    nationalTeamCandidate("Japan", { id: 10, prominence: 0.4, country: "Japan" }),
    nationalTeamCandidate("Brazil", { id: 11, prominence: 0.4, country: "Brazil" }),
  ];
  const answer = clubCandidate("Monaco", { id: 5, prominence: 1.0, country: "France", competitionCode: "LIGUE_1" });

  /*
    THE BUG THIS MODULE EXISTS FOR.

    Before it, "לאיזו קבוצה עבר X מ-Monaco?" could be answered with Lille,
    Japan, Sevilla or Porto. 2,291 active questions were in that state.
  */
  it("refuses to offer a national team in a club question", () => {
    const drawn = generateDistractors({
      expectedEntityType: "CLUB",
      answer,
      pool: [...clubs, ...nations],
      seedKey: "t1",
    })!;
    assert.equal(drawn.distractors.length, 3);
    for (const d of drawn.distractors) {
      assert.equal(d.type, "CLUB", `${d.text} is ${d.type}`);
    }
    assert.equal(drawn.dropped.typeMismatch, 2, "both national teams must be rejected, not merely unused");
  });

  it("refuses to offer a reserve side as a club", () => {
    const reserve = { ...clubCandidate("Auxerre II", { id: 6, prominence: 2.6 }), teamKind: "RESERVE_TEAM" as const };
    assert.equal(isEligibleCandidate(reserve, "CLUB"), false);
  });

  it("treats an unclassified team as ineligible rather than harmless", () => {
    const unknown = { text: "Mystery FC", type: "CLUB" as const };
    assert.equal(isEligibleCandidate(unknown, "CLUB"), false);
  });

  it("throws when the answer itself is the wrong type", () => {
    assert.throws(
      () =>
        generateDistractors({
          expectedEntityType: "CLUB",
          answer: nationalTeamCandidate("Japan", { prominence: 0.4 }),
          pool: clubs,
          seedKey: "t2",
        }),
      DistractorTypeError
    );
  });

  it("returns null rather than a short list", () => {
    const drawn = generateDistractors({
      expectedEntityType: "CLUB",
      answer,
      pool: clubs.slice(0, 2),
      seedKey: "t3",
    });
    assert.equal(drawn, null, "two eligible candidates cannot fill three slots");
  });

  it("never offers the answer or an excluded value", () => {
    const drawn = generateDistractors({
      expectedEntityType: "CLUB",
      answer,
      pool: [...clubs, answer],
      seedKey: "t4",
      exclude: ["Lyon"],
    })!;
    const texts = drawn.distractors.map((d) => d.text);
    assert.ok(!texts.includes("Monaco"));
    assert.ok(!texts.includes("Lyon"));
  });

  it("is deterministic for the same seed", () => {
    const once = generateDistractors({ expectedEntityType: "CLUB", answer, pool: clubs, seedKey: "same" })!;
    const twice = generateDistractors({ expectedEntityType: "CLUB", answer, pool: clubs, seedKey: "same" })!;
    assert.deepEqual(once.distractors.map((d) => d.text), twice.distractors.map((d) => d.text));
  });

  /*
    NO EASY-THROUGH-BAD-OPTIONS.

    A HARD question whose three wrong answers are clubs nobody has heard of is
    not hard — the player answers by recognition. The type rules make the extreme
    version impossible; this catches the subtle one.
  */
  it("flags an answer that is the only recognisable option", () => {
    const famous = clubCandidate("Real Madrid", { prominence: 0 });
    const obscure = [
      clubCandidate("Lorient", { prominence: 2.1 }),
      clubCandidate("Niort", { prominence: 2.6 }),
      clubCandidate("Avranches", { prominence: 2.8 }),
    ];
    assert.equal(prominenceGiveaway(obscure, famous), true);
    assert.equal(prominenceGiveaway(obscure, clubCandidate("Lille", { prominence: 2.2 })), false);
  });

  it("measures how close the chosen options turned out", () => {
    const near = closenessOf(
      [clubCandidate("Lyon", { prominence: 1.0, country: "France", competitionCode: "LIGUE_1" })],
      answer
    );
    const far = closenessOf([clubCandidate("Shimizu", { prominence: 2.8, country: "Japan" })], answer);
    assert.equal(near, "near");
    assert.equal(far, "far");
  });
});

// ---------------------------------------------------------------------------
describe("the archetype registry", () => {
  it("every club archetype answers with a club", () => {
    for (const archetype of CLUB_ONLY_ARCHETYPES) {
      const spec = ARCHETYPES[archetype];
      assert.ok(spec, archetype);
      assert.equal(spec.answerType, "CLUB", archetype);
    }
  });

  it("the spec's answer types are what the registry says", () => {
    const expected: Record<string, string> = {
      TRANSFER_TO: "CLUB",
      TRANSFER_FROM: "CLUB",
      PREVIOUS_CLUB: "CLUB",
      NEXT_CLUB: "CLUB",
      GUESS_THE_CLUB: "CLUB",
      CLUB_CONNECTION_PLAYER: "PLAYER",
      WHO_AM_I: "PLAYER",
      PLAYER_NATIONALITY: "COUNTRY",
      PLAYER_NATIONAL_TEAM: "NATIONAL_TEAM",
      COACH_CLUB: "CLUB",
      STADIUM_CLUB: "CLUB",
      PLAYER_TROPHY: "COMPETITION",
    };
    for (const [archetype, type] of Object.entries(expected)) {
      assert.equal(ARCHETYPES[archetype as keyof typeof ARCHETYPES].answerType, type, archetype);
    }
  });

  it("a competition winner must say whether it is a club or a nation", () => {
    assert.throws(() => answerTypeFor("COMPETITION_WINNER"), /must resolve which/);
    assert.equal(answerTypeFor("COMPETITION_WINNER", "CLUB"), "CLUB");
    assert.equal(answerTypeFor("COMPETITION_WINNER", "NATIONAL_TEAM"), "NATIONAL_TEAM");
  });

  it("reads club-or-nation off the competition rather than guessing", () => {
    assert.equal(winnerTypeOfCompetition({ localCode: "UCL", type: "CONTINENTAL" }), "CLUB");
    assert.equal(winnerTypeOfCompetition({ localCode: "WORLD_CUP" }), "NATIONAL_TEAM");
    assert.equal(winnerTypeOfCompetition({ localCode: "EURO" }), "NATIONAL_TEAM");
    assert.equal(winnerTypeOfCompetition({ type: "INTERNATIONAL" }), "NATIONAL_TEAM");
    assert.equal(winnerTypeOfCompetition({ localCode: "PREMIER_LEAGUE", type: "LEAGUE" }), "CLUB");
  });

  it("recovers the archetype of a stored question from its semantic key", () => {
    assert.equal(archetypeForStoredKey("KB_TRANSFER_TO:123:45:2024"), "TRANSFER_TO");
    assert.equal(archetypeForStoredKey("KB_GUESS_CLUB:17"), "GUESS_THE_CLUB");
    assert.equal(archetypeForStoredKey("position:salah"), "POSITION_BROAD");
    assert.equal(archetypeForStoredKey("position_role:salah"), "POSITION_PRECISE");
    // "connection" asks which PLAYER links two clubs; the KB's club connection
    // asks which CLUB links two players. Opposite answer types, same word.
    assert.equal(archetypeForStoredKey("connection:messi:0"), "CLUB_CONNECTION_PLAYER");
    assert.equal(archetypeForStoredKey("KB_CLUB_CONNECTION:1:2:3"), "CLUB_CONNECTION_CLUB");
    assert.equal(archetypeForStoredKey(null), null);
  });
});

// ---------------------------------------------------------------------------
describe("the semantic validation gate", () => {
  const base = {
    semanticKey: "KB_TRANSFER_TO:1:2:2024",
    questionHe: "לאיזו קבוצה עבר X מ-Monaco בשנת 2024?",
    explanationHe: "X עבר מ-Monaco ל-Lille בשנת 2024.",
    options: ["Lille", "Sevilla", "Porto", "Lyon"],
    correctIndex: 0,
    difficulty: "NORMAL" as const,
    archetype: "TRANSFER_TO" as const,
    answerCandidate: clubCandidate("Lille", { prominence: 1.2 }),
    distractorCandidates: [
      clubCandidate("Sevilla", { prominence: 0.9 }),
      clubCandidate("Porto", { prominence: 0.8 }),
      clubCandidate("Lyon", { prominence: 1.0 }),
    ],
    factConfidence: "HIGH" as const,
    movement: "PERMANENT" as const,
  };

  it("passes a well-formed club transfer", () => {
    assert.deepEqual(validateSemantics(base), []);
  });

  it("rejects a question with no archetype — nothing about it can be checked", () => {
    const issues = validateSemantics({ ...base, archetype: undefined });
    assert.ok(issues.some((i) => i.code === "missing-archetype"));
    assert.equal(hasRejection(issues), true);
  });

  it("rejects a national team among a club question's options", () => {
    const issues = validateSemantics({
      ...base,
      distractorCandidates: [
        nationalTeamCandidate("Japan", { prominence: 0.4 }),
        clubCandidate("Porto", { prominence: 0.8 }),
        clubCandidate("Lyon", { prominence: 1.0 }),
      ],
    });
    assert.ok(issues.some((i) => i.code === "distractor-type-mismatch"));
    assert.equal(hasRejection(issues), true);
  });

  it("rejects a national team AS a club question's answer", () => {
    const issues = validateSemantics({
      ...base,
      archetype: "GUESS_THE_CLUB",
      questionHe: "איזה מועדון אני?",
      answerCandidate: nationalTeamCandidate("Qatar", { prominence: 0.4 }),
    });
    assert.ok(issues.some((i) => i.code === "answer-type-mismatch"));
  });

  it("rejects a loan described as a permanent move", () => {
    const issues = validateSemantics({ ...base, movement: "LOAN" });
    assert.ok(issues.some((i) => i.code === "loan-worded-as-permanent"));
  });

  it("rejects a precise position question built on broad data", () => {
    const issues = validateSemantics({
      ...base,
      archetype: "POSITION_PRECISE",
      questionHe: "מה התפקיד המדויק של מוחמד סלאח?",
      answerCandidate: { text: "חלוץ", type: "POSITION" },
      distractorCandidates: [
        { text: "בלם", type: "POSITION" },
        { text: "שוער", type: "POSITION" },
        { text: "קשר מרכזי", type: "POSITION" },
      ],
      positionShape: "PRECISE",
      positionConfidence: "LOW",
    });
    assert.ok(issues.some((i) => i.code === "precise-position-from-broad-data"));
  });

  it("rejects the vague career-start wording", () => {
    const issues = validateSemantics({
      ...base,
      archetype: "FIRST_SENIOR_CLUB",
      questionHe: "באיזו קבוצה התחיל סרחיו בוסקטס את הקריירה הבוגרת שלו?",
      careerConcept: "FIRST_RECORDED_PROVIDER_CLUB",
    });
    assert.ok(issues.some((i) => i.code === "career-start-from-provider-ordering"));
    assert.ok(issues.some((i) => i.code === "vague-career-wording"));
  });

  it("rejects a question whose difficulty is kinder than its subject's obscurity", () => {
    const issues = validateSemantics({
      ...base,
      difficulty: "NORMAL",
      difficultySignals: { archetype: "TRANSFER_TO", subjectFame: 2.9 },
    });
    assert.ok(issues.some((i) => i.code === "obscure-subject-too-easy"));
  });

  it("rejects a non-core fact labelled below HARD", () => {
    const issues = validateSemantics({
      ...base,
      difficulty: "NORMAL",
      difficultySignals: { archetype: "TRANSFER_TO", subjectFame: 1.0, tier: "NON_CORE" },
    });
    assert.ok(issues.some((i) => i.code === "non-core-too-easy"));
  });

  it("lets a globally famous non-core fact stay accessible", () => {
    const issues = validateSemantics({
      ...base,
      difficulty: "NORMAL",
      difficultySignals: {
        archetype: "TRANSFER_TO",
        subjectFame: 0,
        tier: "NON_CORE",
        factProminence: "HEADLINE",
      },
    });
    assert.equal(hasRejection(issues), false, "Ronaldo at Al-Nassr is not an Expert question");
  });

  it("warns about a Hebrew preposition glued to a Latin name", () => {
    const issues = validateSemantics({
      ...base,
      questionHe: "לאיזו קבוצה עבר X מMonaco בשנת 2024?",
    });
    const glued = issues.find((i) => i.code === "glued-hebrew-preposition");
    assert.ok(glued);
    assert.equal(glued!.severity, "WARN", "bad typography is not a correctness failure");
  });

  it("rejects a clue that names the answer", () => {
    const issues = validateSemantics({
      ...base,
      archetype: "CAREER_PATH",
      answerCandidate: playerCandidate("Neymar", { prominence: 0 }),
      distractorCandidates: [
        playerCandidate("Messi", { prominence: 0 }),
        playerCandidate("Mbappe", { prominence: 0 }),
        playerCandidate("Vinicius", { prominence: 0 }),
      ],
      options: ["Neymar", "Messi", "Mbappe", "Vinicius"],
      clues: ["Santos", "Barcelona", "Neymar's old club"],
    });
    assert.ok(issues.some((i) => i.code === "clue-contains-answer"));
  });
});

// ---------------------------------------------------------------------------
describe("the normalised context", () => {
  const context = buildFootballContext({
    teams: [
      { id: 1, name: "Barcelona", country_name: "Spain", local_code: "LA_LIGA", competition_priority: 1, is_national: 0, founded: 1899, venue_name: "Camp Nou" },
      { id: 2, name: "Barcelona B", is_national: 0 },
      { id: 3, name: "Spain", country_name: "Spain", is_national: 1 },
      { id: 4, name: "Spain U21", is_national: 0 },
      { id: 5, name: "Willem II", country_name: "Netherlands", local_code: "EREDIVISIE", competition_priority: 1, is_national: 0 },
    ],
    players: [{ id: 1, name: "S. Busquets", position: "Midfielder", core_clubs: 1, recorded_clubs: 2 }],
    curated: { clubNames: ["Barcelona"], clubTitles: new Map([["Barcelona", 24]]) },
  });

  it("classifies every team exactly once", () => {
    assert.equal(context.teamById.get(1)!.kind, "CLUB");
    assert.equal(context.teamById.get(2)!.kind, "RESERVE_TEAM");
    assert.equal(context.teamById.get(3)!.kind, "NATIONAL_TEAM");
    assert.equal(context.teamById.get(4)!.kind, "YOUTH_NATIONAL_TEAM");
    assert.equal(context.teamById.get(5)!.kind, "CLUB", "Willem II is an Eredivisie club");
  });

  it("the club pool holds only askable clubs", () => {
    assert.deepEqual(context.clubPool.map((c) => c.text).sort(), ["Barcelona", "Willem II"]);
    assert.deepEqual(context.nationalTeamPool.map((c) => c.text), ["Spain"]);
  });

  it("traces a reserve side to its parent", () => {
    assert.equal(context.teamById.get(2)!.parentName, "Barcelona");
  });

  it("a curated club outscores an unknown one", () => {
    assert.ok(context.teamById.get(1)!.prominence < context.teamById.get(5)!.prominence);
  });

  it("resolves a provider position to a unit and no role", () => {
    const player = context.playerByName.get("S. Busquets")!;
    assert.equal(player.position.broad, "MIDFIELDER");
    assert.equal(player.position.detailed, null, "the provider gives no role, so none is claimed");
  });
});
