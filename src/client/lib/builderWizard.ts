// The wizard's state machine.
//
// WHY THIS IS NOT IN THE COMPONENT
//
// The builder's job is to turn a handful of choices into a QuizConfiguration,
// and the thing that went wrong with the old one was not its CSS — it was that
// every control was visible at once, so nothing told the player what they were
// deciding. Fixing that means the SEQUENCE of questions becomes the design, and
// a sequence with conditional steps is a state machine whether or not you write
// it as one.
//
// Written as one here, outside React, for three reasons: the smart-skip rules
// are testable without a DOM; "going back must preserve selections" falls out of
// keeping one state object rather than unmounting steps; and the mapping from
// choices to the quiz query is in one function that a test can assert over,
// which is the last item on this phase's definition of done.

import { LEAGUE_BY_COUNTRY, COUNTRIES } from "../../shared/constants.ts";
import type {
  AnswerMode,
  Category,
  Difficulty,
  GameMode,
  QuizConfiguration,
  Region,
} from "../../shared/types.ts";

export type StepId = "mode" | "settings" | "scope" | "region" | "summary";

/** Where the questions come from. The three branches of step 3. */
export type ScopeKind = "WORLD" | "REGION" | "PRESET";

/**
 * A one-tap choice that fills in several fields at once.
 *
 * `kind` is the distinction the spec insists on and the old builder blurred:
 *
 *   COMPETITION — a SCOPE. "Champions League" narrows which football the
 *                 questions come from. Every game mode still works.
 *   ARCHETYPE   — a QUESTION SHAPE. "Who Am I?" changes what the question looks
 *                 like, not where it is set.
 *
 * They were both chips in the same row before, which is how somebody ended up
 * choosing "Who Am I?" expecting a filter.
 */
export interface QuickPick {
  key: string;
  labelHe: string;
  kind: "COMPETITION" | "ARCHETYPE";
  region?: Region;
  competitions?: string[];
  categories?: Category[];
  gameMode?: GameMode;
}

export const QUICK_PICKS: QuickPick[] = [
  // ---- competitions: where the football comes from ----
  { key: "top5", labelHe: "5 הליגות הגדולות", kind: "COMPETITION", region: "EUROPE", competitions: ["TOP_5_EUROPE"] },
  { key: "top6", labelHe: "6 הליגות הגדולות", kind: "COMPETITION", region: "EUROPE", competitions: ["TOP_6_EUROPE"] },
  { key: "ucl", labelHe: "ליגת האלופות", kind: "COMPETITION", region: "EUROPE", competitions: ["UCL"] },
  { key: "uel", labelHe: "הליגה האירופית", kind: "COMPETITION", region: "EUROPE", competitions: ["UEL"] },
  { key: "wc", labelHe: "מונדיאל", kind: "COMPETITION", region: "WORLD", competitions: ["WORLD_CUP"] },
  { key: "euro", labelHe: "יורו", kind: "COMPETITION", region: "EUROPE", competitions: ["EURO"] },
  { key: "copa", labelHe: "קופה אמריקה", kind: "COMPETITION", region: "SOUTH_AMERICA", competitions: ["COPA_AMERICA"] },
  { key: "nations", labelHe: "נבחרות", kind: "COMPETITION", region: "WORLD", competitions: ["ALL"], categories: ["NATIONAL_TEAMS"] },

  // ---- archetypes: what shape the question takes ----
  { key: "whoami", labelHe: "מי אני?", kind: "ARCHETYPE", gameMode: "WHO_AM_I", categories: ["WHO_AM_I"] },
  { key: "career", labelHe: "מסלול קריירה", kind: "ARCHETYPE", gameMode: "CAREER_PATH", categories: ["CAREER_PATH"] },
  { key: "guess", labelHe: "נחש את הקבוצה", kind: "ARCHETYPE", gameMode: "GUESS_THE_CLUB", categories: ["GUESS_THE_CLUB"] },
];

export const QUICK_PICK_BY_KEY = new Map(QUICK_PICKS.map((p) => [p.key, p]));

/** Continents that actually have supported countries. Nothing empty is offered. */
export const SUPPORTED_CONTINENTS: { code: Region; labelHe: string }[] = (
  [
    { code: "EUROPE", labelHe: "אירופה" },
    { code: "SOUTH_AMERICA", labelHe: "דרום אמריקה" },
    { code: "NORTH_AMERICA", labelHe: "צפון אמריקה" },
    { code: "ASIA", labelHe: "אסיה" },
    { code: "AFRICA", labelHe: "אפריקה" },
    { code: "OCEANIA", labelHe: "אוקיאניה" },
  ] as { code: Region; labelHe: string }[]
).filter((continent) => COUNTRIES.some((country) => country.continent === continent.code));

export const countriesIn = (continent: Region) =>
  COUNTRIES.filter((country) => country.continent === continent);

export const leagueOf = (countryCode: string): string | null =>
  LEAGUE_BY_COUNTRY[countryCode] ?? null;

export interface WizardState {
  answerMode: AnswerMode;
  difficulty: Difficulty | "MIXED";
  questionCount: number;
  scope: ScopeKind;
  /** Only meaningful when scope is PRESET. */
  quickPick: string | null;
  /** Only meaningful when scope is REGION. */
  continent: Region | null;
  country: string | null;
  /** null means "every league in the country". */
  league: string | null;
}

export const INITIAL_STATE: WizardState = {
  // Free text is the mode the product is actually about, so it leads.
  answerMode: "FREE_TEXT",
  difficulty: "MIXED",
  questionCount: 10,
  scope: "WORLD",
  quickPick: null,
  continent: null,
  country: null,
  league: null,
};

/**
 * Which steps this state actually needs.
 *
 * THE SMART SKIPS, all of them, in one place:
 *
 *   כל העולם        → no geography to ask about
 *   a quick pick    → the pick already said where (or what shape)
 *   אזור מסוים      → the region step appears
 *
 * Returning the list rather than a "next step" function is what makes the
 * progress indicator honest: "2 / 4" is computed from the steps this player will
 * actually see, not from a fixed total that sometimes lies.
 */
export function stepsFor(state: WizardState): StepId[] {
  const steps: StepId[] = ["mode", "settings", "scope"];
  if (state.scope === "REGION") steps.push("region");
  steps.push("summary");
  return steps;
}

/** Whether the current step has enough to move on. */
export function canAdvance(state: WizardState, step: StepId): boolean {
  switch (step) {
    case "mode":
    case "settings":
      return true;
    case "scope":
      // A preset branch needs a preset chosen; the other two are complete as soon
      // as they are selected.
      return state.scope !== "PRESET" || state.quickPick !== null;
    case "region":
      // A continent alone is a usable filter: "anywhere in Europe" is a real
      // choice and should not be blocked on picking a country.
      return state.continent !== null;
    case "summary":
      return true;
  }
}

/**
 * Turns the wizard's state into the quiz query.
 *
 * This function is the contract between the UI and the engine, and it is the one
 * the Playwright flows assert against — "verify the query, not just the UI" is
 * only possible because the mapping lives in one place with no React around it.
 *
 * Note what is NOT set: `preset`. A player who walked through the wizard and
 * chose "מומחה" has asked for Expert questions and gets them. Only the home
 * page's one-tap presets carry QUICK_START, and only those get the accessible
 * difficulty mix.
 */
export function toConfiguration(state: WizardState): QuizConfiguration {
  const base = {
    countries: [] as string[],
    competitions: ["ALL"] as string[],
    categories: [] as Category[],
    gameMode: "CLASSIC" as GameMode,
    region: "WORLD" as Region,
  };

  if (state.scope === "PRESET" && state.quickPick) {
    const pick = QUICK_PICK_BY_KEY.get(state.quickPick);
    if (pick) {
      base.region = pick.region ?? "WORLD";
      base.competitions = pick.competitions ?? ["ALL"];
      base.categories = pick.categories ?? [];
      base.gameMode = pick.gameMode ?? "CLASSIC";
    }
  } else if (state.scope === "REGION" && state.continent) {
    base.region = state.continent;
    if (state.country) base.countries = [state.country];
    // A league chosen inside a country narrows further; "every league" leaves the
    // country filter to do the work on its own.
    if (state.league) base.competitions = [state.league];
  }

  return {
    region: base.region,
    countries: base.countries,
    competitions: base.competitions,
    categories: base.categories,
    difficulty: state.difficulty,
    questionCount: state.questionCount as QuizConfiguration["questionCount"],
    gameMode: base.gameMode,
    answerMode: state.answerMode,
  };
}

/** The compact final summary, as label/value pairs in reading order. */
export function summaryOf(state: WizardState, labels: {
  answerMode: Record<AnswerMode, string>;
  difficulty: Record<string, string>;
  competition: (code: string) => string;
  country: (code: string) => string;
}): { step: StepId; label: string; value: string }[] {
  const scopeValue = (() => {
    if (state.scope === "WORLD") return "כל העולם";
    if (state.scope === "PRESET") {
      return QUICK_PICK_BY_KEY.get(state.quickPick ?? "")?.labelHe ?? "בחירה מהירה";
    }
    const parts: string[] = [];
    if (state.continent) {
      parts.push(SUPPORTED_CONTINENTS.find((c) => c.code === state.continent)?.labelHe ?? "");
    }
    if (state.country) parts.push(labels.country(state.country));
    if (state.league) parts.push(labels.competition(state.league));
    return parts.filter(Boolean).join(" · ");
  })();

  return [
    { step: "mode", label: "מצב", value: labels.answerMode[state.answerMode] },
    {
      step: "settings",
      label: "קושי",
      value: state.difficulty === "MIXED" ? "מעורב" : labels.difficulty[state.difficulty],
    },
    { step: "settings", label: "שאלות", value: `${state.questionCount} שאלות` },
    { step: state.scope === "REGION" ? "region" : "scope", label: "טווח", value: scopeValue },
  ];
}
