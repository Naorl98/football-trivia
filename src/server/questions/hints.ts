// Hint construction for generated questions.
//
// A hint is only worth the accuracy it costs. The bank's most common hints before
// this module existed were "שני השחקנים חלקו מועדון אחד" (976 of them), on a
// question that asks which club two players shared, and "השנה: 2022" (about five
// thousand across all years) on a question whose own text already names the year.
// Both are free to generate, look plausible in a list, and tell the player
// precisely nothing — while still charging them the hint penalty.
//
// So hints are built here from candidates that each declare how much they give
// away, and are then filtered, ordered weakest-first, and gated on the question's
// difficulty. A candidate that repeats the question or contains the answer is
// dropped rather than reworded.

import { normalizeAnswer } from "../../shared/answerMatching.ts";
import type { Difficulty } from "./knowledgeGenerators.ts";

/**
 * How much a hint narrows the field.
 *
 *  1 — nudges. A region, a position, how many clubs a career spans: true of many
 *      possible answers, useful only with what the player already knows.
 *  2 — narrows. A country, a competition, an era.
 *  3 — nearly names it. A stadium, a runner-up, a single distinctive club.
 */
export type HintStrength = 1 | 2 | 3;

export interface HintCandidate {
  text: string;
  strength: HintStrength;
}

export const hint = (strength: HintStrength, text: string | null | undefined): HintCandidate[] =>
  text && text.trim() ? [{ text: text.trim(), strength }] : [];

/**
 * How strong the *first* hint may be, by difficulty.
 *
 * An easy question can afford a generous opener; a hard one cannot, or the hint
 * button becomes an answer button and the difficulty was a lie. Later hints are
 * free to be stronger — the player has chosen to spend them.
 */
const MAX_FIRST_STRENGTH: Record<Difficulty, HintStrength> = {
  EASY: 3,
  NORMAL: 2,
  HARD: 1,
  EXPERT: 1,
  IMPOSSIBLE: 1,
};

const MAX_HINTS = 3;

/** Continents, for the weakest useful geographic nudge. */
const REGION_BY_COUNTRY: Record<string, string> = {
  England: "אירופה", Spain: "אירופה", Italy: "אירופה", Germany: "אירופה", France: "אירופה",
  Portugal: "אירופה", Netherlands: "אירופה", Scotland: "אירופה", Belgium: "אירופה",
  Turkey: "אירופה", Greece: "אירופה", Croatia: "אירופה", Austria: "אירופה", Switzerland: "אירופה",
  Denmark: "אירופה", Sweden: "אירופה", Norway: "אירופה", Poland: "אירופה", Russia: "אירופה",
  Ukraine: "אירופה", "Czech-Republic": "אירופה", Serbia: "אירופה", Romania: "אירופה",
  Brazil: "דרום אמריקה", Argentina: "דרום אמריקה", Uruguay: "דרום אמריקה", Chile: "דרום אמריקה",
  Colombia: "דרום אמריקה", Paraguay: "דרום אמריקה", Peru: "דרום אמריקה", Ecuador: "דרום אמריקה",
  USA: "צפון אמריקה", Canada: "צפון אמריקה", Mexico: "צפון אמריקה",
  Japan: "אסיה", "South-Korea": "אסיה", China: "אסיה", "Saudi-Arabia": "אסיה", Qatar: "אסיה",
  "United-Arab-Emirates": "אסיה", Israel: "אסיה", Iran: "אסיה",
  Egypt: "אפריקה", Morocco: "אפריקה", Nigeria: "אפריקה", Senegal: "אפריקה", Algeria: "אפריקה",
  Tunisia: "אפריקה", Ghana: "אפריקה", "South-Africa": "אפריקה",
  Australia: "אוקיאניה",
};

export const regionOf = (country: string | null | undefined): string | null =>
  country ? REGION_BY_COUNTRY[country] ?? null : null;

/**
 * Hebrew country names.
 *
 * The provider returns "England", and a hint reading "המועדון פועל בEngland" is
 * two scripts jammed together with no space — it reads as a bug. Where the Hebrew
 * name is not known the country is skipped rather than transliterated, because
 * guessing at a spelling is how you end up with two spellings.
 */
const COUNTRY_HE: Record<string, string> = {
  England: "אנגליה", Spain: "ספרד", Italy: "איטליה", Germany: "גרמניה", France: "צרפת",
  Portugal: "פורטוגל", Netherlands: "הולנד", Scotland: "סקוטלנד", Belgium: "בלגיה",
  Turkey: "טורקיה", Greece: "יוון", Croatia: "קרואטיה", Austria: "אוסטריה",
  Switzerland: "שווייץ", Denmark: "דנמרק", Sweden: "שוודיה", Norway: "נורווגיה",
  Poland: "פולין", Russia: "רוסיה", Ukraine: "אוקראינה", Serbia: "סרביה",
  Romania: "רומניה", "Czech-Republic": "צ'כיה", Wales: "ויילס", Ireland: "אירלנד",
  Brazil: "ברזיל", Argentina: "ארגנטינה", Uruguay: "אורוגוואי", Chile: "צ'ילה",
  Colombia: "קולומביה", Paraguay: "פרגוואי", Peru: "פרו", Ecuador: "אקוודור",
  USA: "ארצות הברית", Canada: "קנדה", Mexico: "מקסיקו",
  Japan: "יפן", "South-Korea": "קוריאה הדרומית", China: "סין",
  "Saudi-Arabia": "ערב הסעודית", Qatar: "קטאר", "United-Arab-Emirates": "איחוד האמירויות",
  Israel: "ישראל", Iran: "איראן",
  Egypt: "מצרים", Morocco: "מרוקו", Nigeria: "ניגריה", Senegal: "סנגל",
  Algeria: "אלג'יריה", Tunisia: "תוניסיה", Ghana: "גאנה", "South-Africa": "דרום אפריקה",
  Australia: "אוסטרליה",
};

export const countryHe = (country: string | null | undefined): string | null =>
  country ? COUNTRY_HE[country] ?? null : null;

/** Hebrew names for the competitions a hint may mention. */
const COMPETITION_HE: Record<string, string> = {
  UCL: "ליגת האלופות",
  UEL: "הליגה האירופית",
  WORLD_CUP: "גביע העולם",
  EURO: "אליפות אירופה",
  COPA_AMERICA: "קופה אמריקה",
  PREMIER_LEAGUE: "הליגה האנגלית",
  LA_LIGA: "הליגה הספרדית",
  SERIE_A: "הליגה האיטלקית",
  BUNDESLIGA: "הליגה הגרמנית",
  LIGUE_1: "הליגה הצרפתית",
  LIGA_PORTUGAL: "הליגה הפורטוגלית",
  EREDIVISIE: "הליגה ההולנדית",
  ISRAELI_PREMIER_LEAGUE: "הליגה הישראלית",
};

export const competitionHe = (localCode: string | null | undefined): string | null =>
  localCode ? COMPETITION_HE[localCode] ?? null : null;

/**
 * Phrases that carry no information whatever the data behind them.
 *
 * Each of these was a real, high-volume hint in the bank. They are matched on
 * normalized text so a spacing change cannot slip one back in.
 */
const BANNED_NORMALIZED = new Set(
  [
    "שני השחקנים חלקו מועדון אחד",
    "שניהם שיחקו באותו מועדון",
  ].map(normalizeAnswer)
);

/** What is known about a club, for building hints about it. */
export interface ClubHintFacts {
  countryName?: string | null;
  localCode?: string | null;
  venueName?: string | null;
  founded?: number | null;
  /** Local codes of cups the club has played in. */
  cupCodes?: readonly string[];
}

/**
 * Hints for a question whose answer is a club, weakest first.
 *
 * `others` are the facts about the distractors on screen, and they decide whether
 * a hint is worth offering at all. A hint only helps if it tells the two apart: on
 * a question whose four options are all English clubs, "the club is in England" is
 * true of every one of them and narrows nothing, and "the club is in Europe" —
 * true of very nearly every club in the bank — is worse. Both are the "too vague
 * to be useful" case, and both are dropped here rather than shipped.
 *
 * The continent survives only where it actually separates the options, which in
 * practice means a non-European club among European ones. The ground and the
 * founding year are unique to a club, so they always discriminate and always come
 * last.
 */
export function clubHintCandidates(
  facts: ClubHintFacts,
  others: readonly ClubHintFacts[] = []
): HintCandidate[] {
  /**
   * True when some other option is *known* to differ on this fact.
   *
   * An unknown value on a distractor proves nothing — most clubs in the bank are
   * names only, and treating "no country on record" as "a different country"
   * would keep every geographic hint alive on the grounds that the data is
   * missing. That is how "the club is in Europe" survived onto a question whose
   * four options were all English.
   */
  const separates = <T>(pick: (f: ClubHintFacts) => T): boolean => {
    if (others.length === 0) return true;
    const mine = pick(facts);
    return others.some((other) => {
      const theirs = pick(other);
      return theirs !== null && theirs !== undefined && theirs !== mine;
    });
  };

  const region = regionOf(facts.countryName);
  const country = countryHe(facts.countryName);
  const league = competitionHe(facts.localCode);
  // A club's own competition can also appear in its cup list, and then the two
  // hints name the same trophy in slightly different words — "הוא משחק בליגת
  // האלופות" followed by "הוא שיחק בליגת האלופות". Deduplicating on the sentence
  // does not catch that; deduplicating on the competition does.
  const cup = (facts.cupCodes ?? [])
    .filter((code) => code !== facts.localCode)
    .map(competitionHe)
    .find((name) => Boolean(name) && name !== league);

  return [
    ...hint(1, region && separates((f) => regionOf(f.countryName)) ? `המועדון מ${region}` : null),
    ...hint(1, country && separates((f) => f.countryName) ? `המועדון פועל ב${country}` : null),
    ...hint(2, league && separates((f) => f.localCode) ? `הוא משחק ב${league}` : null),
    ...hint(2, cup ? `הוא שיחק ב${cup}` : null),
    ...hint(3, facts.founded ? `הוא נוסד בשנת ${facts.founded}` : null),
    ...hint(3, facts.venueName ? `המגרש הביתי שלו: ${facts.venueName}` : null),
  ];
}

/**
 * What the move itself says, for a transfer question.
 *
 * Useful where the destination club is a bare name — a club known only because
 * somebody transferred there has no country, ground or founding year to hint at,
 * and this is the one fact left that the question does not already state. "N/A"
 * and a bare "Transfer" say nothing and are skipped.
 */
export function transferTypeHint(transferType: string | null | undefined): HintCandidate[] {
  const value = (transferType ?? "").trim();
  if (!value || /^(n\/a|-|transfer)$/i.test(value)) return [];
  if (/free/i.test(value)) return hint(1, "המעבר היה בחינם");
  if (/[€$£]/.test(value)) return hint(2, `העברה תמורת ${value}`);
  return [];
}

/**
 * The answer's first letter — a last resort, and the strongest hint here.
 *
 * It follows the curated bank's own convention ("השם מתחיל באות ר") and earns its
 * place in free text, where knowing the first character is most of the work. At
 * strength 3 it is gated out of the opening slot on anything above NORMAL, so a
 * hard question does not get handed its answer's initial as hint one.
 */
export function firstLetterHint(answer: string | null | undefined): HintCandidate[] {
  const trimmed = (answer ?? "").trim();
  if (!trimmed) return [];
  const [first] = trimmed;
  if (!first || !/\p{L}/u.test(first)) return [];
  return hint(3, `השם מתחיל באות ${first}`);
}

export interface BuildHintsInput {
  candidates: HintCandidate[];
  /** The question as the player sees it — a hint may not merely restate it. */
  questionHe: string;
  /** The answer, plus any alias, so no hint can contain it. */
  answer?: string | null;
  aliases?: readonly string[];
  /** Clues already on screen; a hint repeating one is not a hint. */
  clues?: readonly string[];
  difficulty: Difficulty;
}

/**
 * Tokens worth checking for overlap between a hint and the question.
 *
 * Only numbers of three digits or more (a year, a founding date) and words of at
 * least three characters, so an incidental "של" shared between the two does not
 * discard a good hint.
 */
function informativeTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of normalizeAnswer(text).split(" ")) {
    if (!raw) continue;
    if (/^\d+$/.test(raw)) {
      if (raw.length >= 3) tokens.add(raw);
    } else if (raw.length >= 3) {
      tokens.add(raw);
    }
  }
  return tokens;
}

/**
 * True when every informative token in the hint already appears in the question
 * or in a clue — which is what "השנה: 2022" was, on a question reading
 * "...בשנת 2022?". The hint cost the player accuracy to be told what was on
 * screen. A hint that adds even one new token is kept.
 */
function addsNothing(hintText: string, against: Set<string>): boolean {
  const tokens = informativeTokens(hintText);
  if (tokens.size === 0) return true;
  for (const token of tokens) if (!against.has(token)) return false;
  return true;
}

function leaksAnswer(hintText: string, answers: readonly string[]): boolean {
  const normalizedHint = ` ${normalizeAnswer(hintText)} `;
  return answers.some((answer) => {
    const normalized = normalizeAnswer(answer);
    // Short answers match too eagerly as substrings; require a word boundary.
    return normalized.length >= 3 && normalizedHint.includes(` ${normalized} `);
  });
}

/**
 * Filters, orders and truncates hint candidates.
 *
 * Returns at most three, weakest first, none of which repeats the question, the
 * clues or the answer. An empty result is a legitimate outcome: no hint is better
 * than one that charges the player for information they already had.
 */
export function buildHints(input: BuildHintsInput): string[] {
  const answers = [input.answer ?? "", ...(input.aliases ?? [])].filter(Boolean);
  const onScreen = informativeTokens([input.questionHe, ...(input.clues ?? [])].join(" "));

  const seen = new Set<string>();
  const kept: HintCandidate[] = [];

  for (const candidate of input.candidates) {
    const text = candidate.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = normalizeAnswer(text);
    if (!key || seen.has(key) || BANNED_NORMALIZED.has(key)) continue;
    if (leaksAnswer(text, answers)) continue;
    if (addsNothing(text, onScreen)) continue;
    seen.add(key);
    kept.push({ text, strength: candidate.strength });
  }

  kept.sort((a, b) => a.strength - b.strength);

  // The opener must respect the difficulty. Dropping from the strong end rather
  // than the weak one keeps the gentlest hint available.
  const ceiling = MAX_FIRST_STRENGTH[input.difficulty];
  while (kept.length > 0 && kept[0].strength > ceiling) kept.pop();

  return kept.slice(0, MAX_HINTS).map((c) => c.text);
}
