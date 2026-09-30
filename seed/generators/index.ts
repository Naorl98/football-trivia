// Question generators.
//
// Each generator turns verified structured facts (clubs.ts / players.ts /
// competitions.ts) into playable questions. The rules that keep generated
// content trustworthy:
//
//  * A generator only emits a question when the underlying fact makes the
//    answer unambiguous. Anything that could have a second correct answer is
//    either skipped or restricted to multiple choice.
//  * Free text is enabled only for question types with exactly one correct
//    answer (a specific club, player, nation, stadium). "Which player played
//    for both X and Y" stays multiple-choice, because the real world contains
//    players outside this dataset who also qualify.
//  * Distractors are never clubs/players that would also satisfy the question.
//  * Every question carries a semantic key so near-duplicates collapse.

import { CLUBS, CLUB_BY_ID, type ClubRecord } from "../data/clubs.ts";
import { PLAYERS, NATIONALITIES, type PlayerRecord } from "../data/players.ts";
import {
  EURO_FINALS,
  LEAGUE_CHAMPIONS,
  NATIONS,
  UCL_FINALS,
  UEL_FINALS,
  WORLD_CUP_FINALS,
  type ClubFinal,
} from "../data/competitions.ts";
import type { SeedCategory, SeedDifficulty, SeedMode, SeedScope } from "../questions.ts";

export interface GeneratedQuestion {
  semanticKey: string;
  mode: SeedMode;
  category: SeedCategory;
  difficulty: SeedDifficulty;
  questionHe: string;
  explanationHe: string;
  options: string[];
  correctIndex: number;
  clues?: string[];
  scopes: SeedScope[];
  sourceLabel: string;
  freeText: boolean;
  canonicalAnswer?: string;
  aliases?: string[];
  hints?: string[];
}

// ---------------------------------------------------------------------------
// Deterministic randomness — the same inputs must always produce the same
// question set, otherwise question ids churn and shared challenges break.
// ---------------------------------------------------------------------------
function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickN<T>(pool: T[], n: number, seedKey: string): T[] {
  const rand = mulberry32(hashString(seedKey));
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

const isReal = (clubId: string) => CLUB_BY_ID.has(clubId);
const clubOf = (id: string): ClubRecord => CLUB_BY_ID.get(id)!;

function clubAliases(c: ClubRecord): string[] {
  return [c.en, ...c.aliases];
}

function firstLetterHint(name: string): string {
  return `השם מתחיל באות ${name.trim()[0]}`;
}

// ---------------------------------------------------------------------------
// Player career generators
// ---------------------------------------------------------------------------

// Clubs a player demonstrably never played for: different country from every
// club in their career, so an unlisted loan spell cannot make the answer wrong.
function safeNonClubs(player: PlayerRecord): ClubRecord[] {
  const careerCountries = new Set(
    player.clubs.filter(isReal).map((id) => clubOf(id).country)
  );
  return CLUBS.filter((c) => !careerCountries.has(c.country) && !player.clubs.includes(c.id));
}

function playerHints(player: PlayerRecord): string[] {
  const nat = NATIONALITIES[player.nat];
  const posHe = { GK: "שוער", DF: "מגן", MF: "קשר", FW: "חלוץ" }[player.pos];
  const hints = [];
  if (nat) hints.push(`הוא ${nat.he === "ישראל" ? "ישראלי" : `נולד ב${nat.he}`}`);
  hints.push(`הוא שיחק בעמדת ${posHe}`);
  hints.push(firstLetterHint(player.he));
  return hints;
}

function clubHints(c: ClubRecord): string[] {
  const hints = [`המועדון פועל במדינה: ${countryHe(c.country)}`];
  if (c.stadiumHe) hints.push(`האצטדיון הביתי: ${c.stadiumHe}`);
  hints.push(firstLetterHint(c.he));
  return hints;
}

const COUNTRY_HE: Record<string, string> = {
  ENG: "אנגליה", ESP: "ספרד", ITA: "איטליה", GER: "גרמניה", FRA: "צרפת",
  POR: "פורטוגל", NED: "הולנד", ISR: "ישראל", BRA: "ברזיל", ARG: "ארגנטינה",
  URU: "אורוגוואי", SCO: "סקוטלנד", TUR: "טורקיה", KSA: "ערב הסעודית",
  USA: "ארצות הברית", UKR: "אוקראינה", RUS: "רוסיה", SRB: "סרביה",
  ROU: "רומניה", GRE: "יוון", SWE: "שוודיה", BEL: "בלגיה", AUT: "אוסטריה",
  CRO: "קרואטיה", NOR: "נורווגיה", POL: "פולין", JPN: "יפן", SUI: "שווייץ",
  CAN: "קנדה", CHN: "סין",
};
const countryHe = (code: string) => COUNTRY_HE[code] ?? code;

function difficultyForPlayer(player: PlayerRecord, bump = 0): SeedDifficulty {
  const ladder: SeedDifficulty[] = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];
  const base = player.tier === 1 ? 1 : player.tier === 2 ? 2 : 3;
  return ladder[Math.min(ladder.length - 1, base + bump)];
}

function playerScopes(player: PlayerRecord): SeedScope[] {
  const scopes: SeedScope[] = [];
  const countries = new Set(player.clubs.filter(isReal).map((id) => clubOf(id).country));
  const leagues = new Set(
    player.clubs.filter(isReal).map((id) => clubOf(id).league).filter(Boolean) as string[]
  );
  const europeanCountries = ["ENG", "ESP", "ITA", "GER", "FRA", "POR", "NED"];
  if ([...countries].some((c) => europeanCountries.includes(c))) {
    scopes.push({ type: "REGION", value: "EUROPE" });
  }
  for (const c of countries) {
    if (["ENG", "ESP", "ITA", "GER", "FRA", "POR", "NED", "ISR", "BRA", "ARG"].includes(c)) {
      scopes.push({ type: "COUNTRY", value: c });
    }
  }
  for (const l of leagues) scopes.push({ type: "COMPETITION", value: l });
  if (scopes.length === 0) scopes.push({ type: "REGION", value: "WORLD" });
  return scopes;
}

function generateFirstClub(): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  for (const player of PLAYERS) {
    if (!player.firstListed) continue;
    const firstId = player.clubs[0];
    if (!firstId || !isReal(firstId)) continue;
    const correct = clubOf(firstId);

    const laterOwnClubs = player.clubs.slice(1).filter(isReal).map(clubOf);
    const others = safeNonClubs(player);
    const key = `first_club:${player.id}`;
    const distractors = [
      ...pickN(laterOwnClubs, 2, key + ":own"),
      ...pickN(others, 3, key + ":other"),
    ]
      .filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i && c.id !== correct.id)
      .slice(0, 3);
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: key,
      mode: "CLASSIC",
      category: "CAREERS",
      difficulty: difficultyForPlayer(player, 0),
      questionHe: `באיזו קבוצה התחיל ${player.he} את הקריירה הבוגרת שלו?`,
      explanationHe: `${player.he} פרץ מ${correct.he} לפני שהמשיך הלאה בקריירה.`,
      options: [correct.he, ...distractors.map((d) => d.he)],
      correctIndex: 0,
      scopes: playerScopes(player),
      sourceLabel: "מסלולי קריירה מאומתים",
      freeText: true,
      canonicalAnswer: correct.he,
      aliases: clubAliases(correct),
      hints: clubHints(correct),
    });
  }
  return out;
}

function generateAdjacentClubMoves(): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  for (const player of PLAYERS) {
    if (player.seq !== "full") continue;
    for (let i = 0; i < player.clubs.length - 1; i++) {
      const fromId = player.clubs[i];
      const toId = player.clubs[i + 1];
      if (!isReal(fromId) || !isReal(toId)) continue;
      const from = clubOf(fromId);
      const to = clubOf(toId);
      if (from.id === to.id) continue;

      const otherCareerClubs = player.clubs
        .filter(isReal)
        .map(clubOf)
        .filter((c) => c.id !== from.id && c.id !== to.id);
      const pool = safeNonClubs(player);

      // "Which club did X move to after Y?"
      const nextKey = `next_club:${player.id}:${from.id}`;
      const nextDistractors = [
        ...pickN(otherCareerClubs, 2, nextKey + ":own"),
        ...pickN(pool, 3, nextKey + ":other"),
      ]
        .filter((c, idx, arr) => arr.findIndex((x) => x.id === c.id) === idx && c.id !== to.id)
        .slice(0, 3);
      if (nextDistractors.length === 3) {
        out.push({
          semanticKey: nextKey,
          mode: "CLASSIC",
          category: "TRANSFERS",
          difficulty: difficultyForPlayer(player, 1),
          questionHe: `לאיזו קבוצה עבר ${player.he} אחרי ${from.he}?`,
          explanationHe: `אחרי התקופה ב${from.he}, ${player.he} עבר ל${to.he}.`,
          options: [to.he, ...nextDistractors.map((d) => d.he)],
          correctIndex: 0,
          scopes: playerScopes(player),
          sourceLabel: "מסלולי קריירה מאומתים",
          freeText: true,
          canonicalAnswer: to.he,
          aliases: clubAliases(to),
          hints: clubHints(to),
        });
      }

      // "Which club did X play for before Y?"
      const prevKey = `prev_club:${player.id}:${to.id}`;
      const prevDistractors = [
        ...pickN(otherCareerClubs, 2, prevKey + ":own"),
        ...pickN(pool, 3, prevKey + ":other"),
      ]
        .filter((c, idx, arr) => arr.findIndex((x) => x.id === c.id) === idx && c.id !== from.id)
        .slice(0, 3);
      if (prevDistractors.length === 3) {
        out.push({
          semanticKey: prevKey,
          mode: "CLASSIC",
          category: "CAREERS",
          difficulty: difficultyForPlayer(player, 1),
          questionHe: `באיזו קבוצה שיחק ${player.he} לפני ${to.he}?`,
          explanationHe: `${player.he} הגיע ל${to.he} מ${from.he}.`,
          options: [from.he, ...prevDistractors.map((d) => d.he)],
          correctIndex: 0,
          scopes: playerScopes(player),
          sourceLabel: "מסלולי קריירה מאומתים",
          freeText: true,
          canonicalAnswer: from.he,
          aliases: clubAliases(from),
          hints: clubHints(from),
        });
      }
    }
  }
  return out;
}

function generateCareerPaths(): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  for (const player of PLAYERS) {
    if (player.seq !== "full") continue;
    if (player.clubs.some((c) => !isReal(c))) continue;
    if (player.clubs.length < 3) continue;

    const path = player.clubs.map((id) => clubOf(id).he);
    const distractorPool = PLAYERS.filter(
      (p) => p.id !== player.id && p.pos === player.pos && p.clubs.length >= 3
    );
    const distractors = pickN(distractorPool, 3, `career_path:${player.id}`);
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: `career_path:${player.id}`,
      mode: "CAREER_PATH",
      category: "CAREER_PATH",
      difficulty: difficultyForPlayer(player, 0),
      questionHe: "של מי מסלול הקריירה הזה?",
      explanationHe: `זהו מסלול הקריירה של ${player.he}.`,
      clues: path,
      options: [player.he, ...distractors.map((d) => d.he)],
      correctIndex: 0,
      scopes: playerScopes(player),
      sourceLabel: "מסלולי קריירה מאומתים",
      freeText: true,
      canonicalAnswer: player.he,
      aliases: [player.en, ...player.aliases],
      hints: playerHints(player),
    });
  }
  return out;
}

function generateClubConnections(): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];

  // Index which players in the dataset played for each club, so a pair that
  // two known players share is never turned into a question.
  const playersByClub = new Map<string, string[]>();
  for (const p of PLAYERS) {
    for (const cid of new Set(p.clubs.filter(isReal))) {
      playersByClub.set(cid, [...(playersByClub.get(cid) ?? []), p.id]);
    }
  }

  for (const player of PLAYERS) {
    const clubs = [...new Set(player.clubs.filter(isReal))];
    if (clubs.length < 2) continue;

    // Prefer the most recognisable pair: two big-league clubs.
    const pairs: [string, string][] = [];
    for (let i = 0; i < clubs.length; i++) {
      for (let j = i + 1; j < clubs.length; j++) pairs.push([clubs[i], clubs[j]]);
    }

    const usable = pairs.filter(([a, b]) => {
      const sharedBy = (playersByClub.get(a) ?? []).filter((id) =>
        (playersByClub.get(b) ?? []).includes(id)
      );
      return sharedBy.length === 1 && sharedBy[0] === player.id;
    });
    if (usable.length === 0) continue;

    // Prefer the pairing a fan would actually recognise: both clubs in a big
    // league beats an obscure early-career pairing.
    const bigLeagues = ["PREMIER_LEAGUE", "LA_LIGA", "SERIE_A", "BUNDESLIGA", "LIGUE_1"];
    const bigness = (id: string) => (bigLeagues.includes(clubOf(id).league ?? "") ? 1 : 0);
    const ranked = [...usable].sort(
      (p, q) => bigness(q[0]) + bigness(q[1]) - (bigness(p[0]) + bigness(p[1]))
    );
    const topTier = ranked.filter(
      ([a, b]) => bigness(a) + bigness(b) === bigness(ranked[0][0]) + bigness(ranked[0][1])
    );
    const [aId, bId] = pickN(topTier, 1, `connection:${player.id}`)[0];
    const a = clubOf(aId);
    const b = clubOf(bId);

    // Distractors: players who did NOT play for both clubs.
    const distractorPool = PLAYERS.filter((p) => {
      if (p.id === player.id) return false;
      const set = new Set(p.clubs);
      return !(set.has(aId) && set.has(bId));
    });
    const distractors = pickN(distractorPool, 3, `connection_d:${player.id}`);
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: `connection:${player.id}:${[aId, bId].sort().join("+")}`,
      mode: "CLUB_CONNECTION",
      category: "TRANSFERS",
      difficulty: difficultyForPlayer(player, 0),
      questionHe: `איזה שחקן שיחק גם ב${a.he} וגם ב${b.he}?`,
      explanationHe: `${player.he} שיחק גם ב${a.he} וגם ב${b.he} במהלך הקריירה שלו.`,
      options: [player.he, ...distractors.map((d) => d.he)],
      correctIndex: 0,
      scopes: playerScopes(player),
      sourceLabel: "מסלולי קריירה מאומתים",
      // Multiple choice only: other players outside this dataset also qualify.
      freeText: false,
      hints: playerHints(player),
    });
  }
  return out;
}

function generateDidNotPlayFor(): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  for (const player of PLAYERS) {
    const own = [...new Set(player.clubs.filter(isReal))].map(clubOf);
    if (own.length < 3) continue;
    const key = `not_played:${player.id}`;
    const ownPicks = pickN(own, 3, key + ":own");
    const never = pickN(safeNonClubs(player), 1, key + ":never")[0];
    if (!never || ownPicks.length < 3) continue;

    out.push({
      semanticKey: key,
      mode: "CLASSIC",
      category: "CAREERS",
      difficulty: difficultyForPlayer(player, 1),
      questionHe: `באיזו מהקבוצות הבאות ${player.he} מעולם לא שיחק?`,
      explanationHe: `${player.he} שיחק ב${ownPicks.map((c) => c.he).join(", ")} — אך לא ב${never.he}.`,
      options: [never.he, ...ownPicks.map((c) => c.he)],
      correctIndex: 0,
      scopes: playerScopes(player),
      sourceLabel: "מסלולי קריירה מאומתים",
      freeText: false,
      hints: [`הקבוצה נמצאת ב${countryHe(never.country)}`],
    });
  }
  return out;
}

function generateNationalities(): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  for (const player of PLAYERS) {
    if (player.tier === 3) continue;
    const nat = NATIONALITIES[player.nat];
    if (!nat) continue;
    const others = Object.entries(NATIONALITIES).filter(([code]) => code !== player.nat);
    const distractors = pickN(others, 3, `nationality:${player.id}`);
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: `nationality:${player.id}`,
      mode: "CLASSIC",
      category: "PLAYERS",
      difficulty: difficultyForPlayer(player, -1) === "EASY" ? "EASY" : "NORMAL",
      questionHe: `מאיזו מדינה ${player.he}?`,
      explanationHe: `${player.he} הוא נציג נבחרת ${nat.he}.`,
      options: [nat.he, ...distractors.map(([, v]) => v.he)],
      correctIndex: 0,
      scopes: playerScopes(player),
      sourceLabel: "נתוני שחקנים מאומתים",
      freeText: true,
      canonicalAnswer: nat.he,
      aliases: nat.aliases,
      hints: [firstLetterHint(nat.he)],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Competition generators
// ---------------------------------------------------------------------------

function difficultyForYear(year: number): SeedDifficulty {
  if (year >= 2018) return "EASY";
  if (year >= 2004) return "NORMAL";
  if (year >= 1992) return "HARD";
  if (year >= 1975) return "EXPERT";
  return "IMPOSSIBLE";
}

function generateClubFinals(
  finals: ClubFinal[],
  compCode: string,
  compHe: string,
  keyPrefix: string,
  category: SeedCategory
): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  const allWinners = [...new Set(finals.map((f) => f.winner))].filter(isReal);

  for (const final of finals) {
    if (!isReal(final.winner)) continue;
    const winner = clubOf(final.winner);
    const baseScopes: SeedScope[] = [
      { type: "REGION", value: "EUROPE" },
      { type: "COMPETITION", value: compCode },
    ];

    // Who won it in year N?
    const winnerDistractors = pickN(
      allWinners.filter((id) => id !== final.winner).map(clubOf),
      3,
      `${keyPrefix}_winner:${final.year}`
    );
    if (winnerDistractors.length === 3) {
      out.push({
        semanticKey: `${keyPrefix}_winner:${final.year}`,
        mode: "CLASSIC",
        category,
        difficulty: difficultyForYear(final.year),
        questionHe: `איזו קבוצה זכתה ב${compHe} בשנת ${final.year}?`,
        explanationHe: final.runnerUp && isReal(final.runnerUp)
          ? `${winner.he} זכתה ב${compHe} ${final.year} בגמר מול ${clubOf(final.runnerUp).he}${final.score ? ` (${final.score})` : ""}.`
          : `${winner.he} זכתה ב${compHe} בשנת ${final.year}.`,
        options: [winner.he, ...winnerDistractors.map((c) => c.he)],
        correctIndex: 0,
        scopes: baseScopes,
        sourceLabel: `טבלת גמרי ${compHe}`,
        freeText: true,
        canonicalAnswer: winner.he,
        aliases: clubAliases(winner),
        hints: clubHints(winner),
      });
    }

    // Who did the winner beat?
    if (final.runnerUp && isReal(final.runnerUp)) {
      const runnerUp = clubOf(final.runnerUp);
      const ruDistractors = pickN(
        allWinners.filter((id) => id !== final.runnerUp && id !== final.winner).map(clubOf),
        3,
        `${keyPrefix}_runnerup:${final.year}`
      );
      if (ruDistractors.length === 3) {
        out.push({
          semanticKey: `${keyPrefix}_runnerup:${final.year}`,
          mode: "CLASSIC",
          category,
          difficulty: difficultyForYear(final.year) === "EASY" ? "NORMAL" : difficultyForYear(final.year),
          questionHe: `את מי ניצחה ${winner.he} בגמר ${compHe} ${final.year}?`,
          explanationHe: `${winner.he} ניצחה את ${runnerUp.he} בגמר ${final.year}${final.score ? ` (${final.score})` : ""}.`,
          options: [runnerUp.he, ...ruDistractors.map((c) => c.he)],
          correctIndex: 0,
          scopes: baseScopes,
          sourceLabel: `טבלת גמרי ${compHe}`,
          freeText: true,
          canonicalAnswer: runnerUp.he,
          aliases: clubAliases(runnerUp),
          hints: clubHints(runnerUp),
        });
      }
    }
  }

  // Title counts, computed by counting rows rather than copying a summary.
  const counts = new Map<string, number>();
  for (const f of finals) counts.set(f.winner, (counts.get(f.winner) ?? 0) + 1);
  for (const [clubId, count] of counts) {
    if (!isReal(clubId) || count < 3) continue;
    const c = clubOf(clubId);
    const wrong = [count + 1, count - 1, count + 2].filter((n) => n > 0);
    out.push({
      semanticKey: `${keyPrefix}_count:${clubId}`,
      mode: "CLASSIC",
      category,
      difficulty: count >= 7 ? "NORMAL" : "HARD",
      questionHe: `כמה פעמים זכתה ${c.he} ב${compHe}?`,
      explanationHe: `${c.he} זכתה ב${compHe} ${count} פעמים.`,
      options: [String(count), ...wrong.slice(0, 3).map(String)],
      correctIndex: 0,
      scopes: [
        { type: "REGION", value: "EUROPE" },
        { type: "COMPETITION", value: compCode },
      ],
      sourceLabel: `טבלת גמרי ${compHe}`,
      freeText: false,
      hints: [`מדובר במספר חד-ספרתי או דו-ספרתי נמוך`],
    });
  }

  return out;
}

function generateNationFinals(
  finals: { year: number; hostHe: string; winner: string; runnerUp: string; score: string }[],
  compCode: string,
  compHe: string,
  keyPrefix: string,
  category: SeedCategory
): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  const allNations = [...new Set(finals.flatMap((f) => [f.winner, f.runnerUp]))];

  for (const final of finals) {
    const winner = NATIONS[final.winner];
    const runnerUp = NATIONS[final.runnerUp];
    if (!winner || !runnerUp) continue;
    const scopes: SeedScope[] = [
      { type: "REGION", value: compCode === "WORLD_CUP" ? "WORLD" : "EUROPE" },
      { type: "COMPETITION", value: compCode },
    ];

    const winnerDistractors = pickN(
      allNations.filter((n) => n !== final.winner && NATIONS[n]),
      3,
      `${keyPrefix}_winner:${final.year}`
    );
    if (winnerDistractors.length === 3) {
      out.push({
        semanticKey: `${keyPrefix}_winner:${final.year}`,
        mode: "CLASSIC",
        category,
        difficulty: difficultyForYear(final.year),
        questionHe: `איזו נבחרת זכתה ב${compHe} ${final.year}?`,
        explanationHe: `${winner.he} ניצחה את ${runnerUp.he} בגמר ${final.year} (${final.score}).`,
        options: [winner.he, ...winnerDistractors.map((n) => NATIONS[n].he)],
        correctIndex: 0,
        scopes,
        sourceLabel: `טבלת גמרי ${compHe}`,
        freeText: true,
        canonicalAnswer: winner.he,
        aliases: winner.aliases,
        hints: [`הגמר נערך ב${final.hostHe}`, firstLetterHint(winner.he)],
      });
    }

    const ruDistractors = pickN(
      allNations.filter((n) => n !== final.runnerUp && n !== final.winner && NATIONS[n]),
      3,
      `${keyPrefix}_runnerup:${final.year}`
    );
    if (ruDistractors.length === 3) {
      out.push({
        semanticKey: `${keyPrefix}_runnerup:${final.year}`,
        mode: "CLASSIC",
        category,
        difficulty: difficultyForYear(final.year) === "EASY" ? "NORMAL" : "HARD",
        questionHe: `את מי ניצחה ${winner.he} בגמר ${compHe} ${final.year}?`,
        explanationHe: `${winner.he} ניצחה את ${runnerUp.he} בגמר ${final.year} (${final.score}).`,
        options: [runnerUp.he, ...ruDistractors.map((n) => NATIONS[n].he)],
        correctIndex: 0,
        scopes,
        sourceLabel: `טבלת גמרי ${compHe}`,
        freeText: true,
        canonicalAnswer: runnerUp.he,
        aliases: runnerUp.aliases,
        hints: [firstLetterHint(runnerUp.he)],
      });
    }
  }
  return out;
}

function generateWorldCupHosts(): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  const hosts = WORLD_CUP_FINALS.map((f) => f.hostHe);
  for (const final of WORLD_CUP_FINALS) {
    const distractors = pickN(
      hosts.filter((h) => h !== final.hostHe),
      3,
      `wc_host:${final.year}`
    );
    if (distractors.length < 3) continue;
    out.push({
      semanticKey: `wc_host:${final.year}`,
      mode: "CLASSIC",
      category: "WORLD_CUP",
      difficulty: difficultyForYear(final.year) === "EASY" ? "NORMAL" : difficultyForYear(final.year),
      questionHe: `היכן נערך מונדיאל ${final.year}?`,
      explanationHe: `מונדיאל ${final.year} נערך ב${final.hostHe}, ו${NATIONS[final.winner]?.he ?? ""} זכתה בתואר.`,
      options: [final.hostHe, ...distractors],
      correctIndex: 0,
      scopes: [
        { type: "REGION", value: "WORLD" },
        { type: "COMPETITION", value: "WORLD_CUP" },
      ],
      sourceLabel: "טבלת גמרי המונדיאל",
      freeText: true,
      canonicalAnswer: final.hostHe,
      aliases: [],
      hints: [firstLetterHint(final.hostHe)],
    });
  }
  return out;
}

function generateLeagueChampions(): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  for (const league of LEAGUE_CHAMPIONS) {
    const winners = [...new Set(league.seasons.map((s) => s.champion))].filter(isReal);
    for (const season of league.seasons) {
      if (!isReal(season.champion)) continue;
      const champion = clubOf(season.champion);
      const distractors = pickN(
        winners.filter((id) => id !== season.champion).map(clubOf),
        3,
        `league_champ:${league.league}:${season.season}`
      );
      if (distractors.length < 3) continue;
      const year = Number(season.season.slice(0, 4));

      out.push({
        semanticKey: `league_champ:${league.league}:${season.season}`,
        mode: "CLASSIC",
        category: "TITLES",
        difficulty: difficultyForYear(year + 1),
        questionHe: `מי זכתה באליפות ${league.leagueHe} בעונת ${season.season}?`,
        explanationHe: `${champion.he} זכתה באליפות ${league.leagueHe} בעונת ${season.season}.`,
        options: [champion.he, ...distractors.map((c) => c.he)],
        correctIndex: 0,
        scopes: [
          { type: "REGION", value: "EUROPE" },
          { type: "COMPETITION", value: league.league },
          { type: "COUNTRY", value: champion.country },
        ],
        sourceLabel: `טבלת אלופות ${league.leagueHe}`,
        freeText: true,
        canonicalAnswer: champion.he,
        aliases: clubAliases(champion),
        hints: clubHints(champion),
      });
    }

    // League title counts within the covered seasons.
    const counts = new Map<string, number>();
    for (const s of league.seasons) counts.set(s.champion, (counts.get(s.champion) ?? 0) + 1);
    const firstSeason = league.seasons[0].season;
    const lastSeason = league.seasons[league.seasons.length - 1].season;
    for (const [clubId, count] of counts) {
      if (!isReal(clubId) || count < 4) continue;
      const c = clubOf(clubId);
      out.push({
        semanticKey: `league_count:${league.league}:${clubId}`,
        mode: "CLASSIC",
        category: "TITLES",
        difficulty: "EXPERT",
        questionHe: `כמה אליפויות ${league.leagueHe} זכתה ${c.he} בין העונות ${firstSeason} ל-${lastSeason}?`,
        explanationHe: `בין ${firstSeason} ל-${lastSeason}, ${c.he} זכתה ${count} פעמים באליפות ${league.leagueHe}.`,
        options: [String(count), String(count + 1), String(count - 1), String(count + 2)],
        correctIndex: 0,
        scopes: [
          { type: "REGION", value: "EUROPE" },
          { type: "COMPETITION", value: league.league },
        ],
        sourceLabel: `טבלת אלופות ${league.leagueHe}`,
        freeText: false,
        hints: [`הטווח הוא בין ${firstSeason} ל-${lastSeason}`],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Club fact generators
// ---------------------------------------------------------------------------
function generateClubFacts(): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  const withStadium = CLUBS.filter((c) => c.stadiumHe);

  for (const c of withStadium) {
    const distractors = pickN(
      withStadium.filter((x) => x.id !== c.id),
      3,
      `stadium:${c.id}`
    );
    if (distractors.length < 3) continue;
    out.push({
      semanticKey: `stadium:${c.id}`,
      mode: "CLASSIC",
      category: "STADIUMS",
      difficulty: "NORMAL",
      questionHe: `באיזה אצטדיון משחקת ${c.he} את משחקי הבית שלה?`,
      explanationHe: `${c.he} משחקת ב${c.stadiumHe}.`,
      options: [c.stadiumHe!, ...distractors.map((d) => d.stadiumHe!)],
      correctIndex: 0,
      scopes: [
        { type: "COUNTRY", value: c.country },
        ...(c.league ? [{ type: "COMPETITION" as const, value: c.league }] : []),
      ],
      sourceLabel: "נתוני מועדונים",
      freeText: true,
      canonicalAnswer: c.stadiumHe!,
      aliases: c.stadium ? [c.stadium] : [],
      hints: [`המועדון פועל ב${countryHe(c.country)}`, firstLetterHint(c.stadiumHe!)],
    });
  }

  // Which country is this club from?
  const bigCountries = ["ENG", "ESP", "ITA", "GER", "FRA", "POR", "NED", "BRA", "ARG", "ISR"];
  for (const c of CLUBS) {
    if (!bigCountries.includes(c.country)) continue;
    const distractors = pickN(
      bigCountries.filter((x) => x !== c.country),
      3,
      `club_country:${c.id}`
    );
    if (distractors.length < 3) continue;
    out.push({
      semanticKey: `club_country:${c.id}`,
      mode: "CLASSIC",
      category: "CLUBS",
      difficulty: "EASY",
      questionHe: `מאיזו מדינה מגיע מועדון ${c.he}?`,
      explanationHe: `${c.he} הוא מועדון מ${countryHe(c.country)}.`,
      options: [countryHe(c.country), ...distractors.map(countryHe)],
      correctIndex: 0,
      scopes: [{ type: "COUNTRY", value: c.country }],
      sourceLabel: "נתוני מועדונים",
      freeText: true,
      canonicalAnswer: countryHe(c.country),
      aliases: [],
      hints: [firstLetterHint(countryHe(c.country))],
    });
  }

  // Club nicknames.
  const withNickname = CLUBS.filter((c) => c.nicknameHe);
  for (const c of withNickname) {
    const distractors = pickN(
      withNickname.filter((x) => x.id !== c.id),
      3,
      `nickname:${c.id}`
    );
    if (distractors.length < 3) continue;
    out.push({
      semanticKey: `nickname:${c.id}`,
      mode: "CLASSIC",
      category: "CLUBS",
      difficulty: "NORMAL",
      questionHe: `מה הכינוי של מועדון ${c.he}?`,
      explanationHe: `${c.he} מכונה "${c.nicknameHe}".`,
      options: [c.nicknameHe!, ...distractors.map((d) => d.nicknameHe!)],
      correctIndex: 0,
      scopes: [{ type: "COUNTRY", value: c.country }],
      sourceLabel: "נתוני מועדונים",
      freeText: false,
      hints: [`המועדון פועל ב${countryHe(c.country)}`],
    });
  }

  // Founding years — the hardest tier: numeric multiple choice over every
  // club whose founding year we hold.
  for (const c of CLUBS.filter((x) => x.founded)) {
    out.push({
      semanticKey: `founded:${c.id}`,
      mode: "CLASSIC",
      category: "CLUBS",
      difficulty: "IMPOSSIBLE",
      questionHe: `באיזו שנה נוסד מועדון ${c.he}?`,
      explanationHe: `${c.he} נוסד בשנת ${c.founded}.`,
      options: [String(c.founded), String(c.founded! + 7), String(c.founded! - 5), String(c.founded! + 13)],
      correctIndex: 0,
      scopes: [{ type: "COUNTRY", value: c.country }],
      sourceLabel: "נתוני מועדונים",
      freeText: false,
      hints: [`המועדון נוסד במאה ה-${Math.ceil(c.founded! / 100)}`],
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
export function generateAll(): GeneratedQuestion[] {
  const all = [
    ...generateFirstClub(),
    ...generateAdjacentClubMoves(),
    ...generateCareerPaths(),
    ...generateClubConnections(),
    ...generateDidNotPlayFor(),
    ...generateNationalities(),
    ...generateClubFinals(UCL_FINALS, "UCL", "ליגת האלופות", "ucl", "CHAMPIONS_LEAGUE"),
    ...generateClubFinals(UEL_FINALS, "UEL", "הליגה האירופית", "uel", "TITLES"),
    ...generateNationFinals(WORLD_CUP_FINALS, "WORLD_CUP", "מונדיאל", "wc", "WORLD_CUP"),
    ...generateNationFinals(EURO_FINALS, "EURO", "אליפות אירופה", "euro", "NATIONAL_TEAMS"),
    ...generateWorldCupHosts(),
    ...generateLeagueChampions(),
    ...generateClubFacts(),
  ];

  // Semantic de-duplication.
  const seen = new Set<string>();
  const deduped: GeneratedQuestion[] = [];
  for (const q of all) {
    if (seen.has(q.semanticKey)) continue;
    seen.add(q.semanticKey);
    // Sanity: exactly 4 distinct options, exactly one correct.
    const unique = new Set(q.options);
    if (q.options.length !== 4 || unique.size !== 4) continue;
    deduped.push(q);
  }
  return deduped.sort((a, b) => a.semanticKey.localeCompare(b.semanticKey));
}
