// Difficulty model for generated questions.
//
// WHY THIS EXISTS
//
// The first pass assigned difficulty from a single signal — usually the
// subject's fame tier, sometimes a flat literal — and it produced a bank that
// was upside down: HARD held more questions than NORMAL, 62% of the bank sat at
// HARD or above, and nothing at all was EASY from the player generators, because
// the fame ladder started at NORMAL. Worse, the top band was monotonous: every
// one of the 159 club founding-year questions was IMPOSSIBLE, so choosing
// "בלתי אפשרי" effectively meant playing a founding-year quiz.
//
// Difficulty is not one signal. A question is hard because of some combination
// of: how famous the subject is, how much recall the question *shape* demands,
// how far back the fact sits, and — the one everybody forgets — how close the
// wrong options are to the right one. "Which club did Mbappé join after Monaco"
// with three other-continent clubs as distractors is easy; the same question
// with three clubs from his own career is genuinely hard, because now you must
// recall the order, not the club.
//
// So difficulty is scored from four weighted signals and then banded. All
// weights live here, in one table, where they can be reasoned about and tested.
//
// DELIBERATELY NOT A SIGNAL: answer mode. Typing a name from nothing is harder
// than picking one of four, but the band is stored per question while the answer
// mode is chosen per quiz — so "HARD" has to mean the same thing either way.

export type Band = "EASY" | "NORMAL" | "HARD" | "EXPERT" | "IMPOSSIBLE";

/**
 * How far the subject is from being a household name.
 *   0 — anyone who watches football knows them (Messi, Real Madrid)
 *   1 — a regular viewer knows them (Rodri, Atalanta)
 *   2 — keen fans know them (a 1990s squad player, a second-tier club)
 */
export type Fame = 0 | 1 | 2;

/** How close the wrong options sit to the right one. */
export type Distractors = "far" | "mixed" | "near";

/**
 * Intrinsic hardness of each question shape, independent of who it is about.
 *
 * Calibrated by asking: for a subject everybody knows, in the present day, with
 * unrelated distractors — how often does a competent fan get this right?
 * ~always → 0, about half the time → ~2, rarely → ~2.5+.
 */
export const ARCHETYPE_WEIGHT = {
  /** "Which country is Club X from?" — the club's name usually gives it away. */
  club_country: 0.0,
  /** "Which country does Player X represent?" */
  nationality: 0.2,
  /** "Who won competition C in year Y?" */
  final_winner: 0.8,
  /** "Where was the World Cup held in year Y?" */
  wc_host: 0.6,
  /** "Who won league L in season S?" */
  league_champion: 1.0,
  /** "Which of these clubs did X never play for?" — odd-one-out, so forgiving. */
  not_played_for: 1.0,
  /** "What is Club X's nickname?" */
  nickname: 1.0,
  /** "Which stadium does Club X play in?" */
  stadium: 1.1,
  /** "Whose career path is this?" — several clues, one answer. */
  career_path: 1.2,
  /**
   * "Who am I?" — a handful of biographical clues narrowing to one player.
   * Slightly harder than a career path: the clues are about the person rather
   * than the club sequence, so there is no visual shape to recognise.
   */
  who_am_i: 0.9,
  /**
   * "Which club is this?" — country, stadium, founding year, famous players.
   * Harder again, because a club is identified by facts most fans never learn
   * deliberately.
   */
  guess_club: 1.1,
  /** "Where did Player X start his senior career?" — a detail even fans miss. */
  first_club: 1.5,
  /** "Who did the winner beat in the final?" — the loser is far less memorable. */
  final_runner_up: 1.5,
  /** "Which player played for both A and B?" */
  club_connection: 1.6,
  /** "Which club did X join after / before Y?" — demands the sequence. */
  adjacent_move: 1.8,
  /** "How many times has Club X won C?" — an exact number. */
  title_count: 2.1,
  /** "In which year was Club X founded?" — an exact 19th-century year. */
  founded_year: 2.6,
} as const;

export type Archetype = keyof typeof ARCHETYPE_WEIGHT;

export interface Signals {
  archetype: Archetype;
  fame?: Fame;
  /** The year the fact belongs to, for dated facts only. */
  year?: number;
  distractors?: Distractors;
}

/** Fame costs 1.25 per step — enough to move a question a full band. */
const FAME_WEIGHT = 1.25;

const DISTRACTOR_WEIGHT: Record<Distractors, number> = {
  far: -0.55,
  mixed: 0,
  near: 0.85,
};

/**
 * How much harder a fact is for sitting further in the past.
 *
 * The steps track how football is actually remembered rather than even decades:
 * the current era is live memory, 2010+ is "recent", the Champions League
 * rebrand (1992) and the pre-colour-television era are real cliffs in what a
 * Hebrew-speaking audience has watched.
 */
export function eraWeight(year: number): number {
  if (year >= 2018) return 0;
  if (year >= 2010) return 0.35;
  if (year >= 2000) return 0.8;
  if (year >= 1992) return 1.3;
  if (year >= 1975) return 2.0;
  return 2.7;
}

/** The continuous difficulty score. Exported so tests can probe the curve. */
export function difficultyScore(signals: Signals): number {
  const archetype = ARCHETYPE_WEIGHT[signals.archetype];
  const fame = (signals.fame ?? 0) * FAME_WEIGHT;
  const era = signals.year === undefined ? 0 : eraWeight(signals.year);
  const distractors = DISTRACTOR_WEIGHT[signals.distractors ?? "mixed"];
  return archetype + fame + era + distractors;
}

/**
 * Band thresholds.
 *
 * Chosen so the bank comes out as a pyramid — more questions at the bottom than
 * the top — which is what makes a difficulty selector mean anything. The shape
 * is asserted in tests/difficulty.test.ts rather than left to trust.
 */
const BANDS: { max: number; band: Band }[] = [
  { max: 1.0, band: "EASY" },
  { max: 2.3, band: "NORMAL" },
  { max: 3.1, band: "HARD" },
  { max: 4.2, band: "EXPERT" },
  { max: Infinity, band: "IMPOSSIBLE" },
];

export function difficultyFor(signals: Signals): Band {
  const score = difficultyScore(signals);
  for (const { max, band } of BANDS) {
    if (score < max) return band;
  }
  return "IMPOSSIBLE";
}

export const BAND_ORDER: Band[] = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];
