// The wizard's state machine.
//
// WHY THIS IS NOT IN THE COMPONENT
//
// The builder's job is to turn a handful of choices into a QuizConfiguration,
// and the thing that went wrong with the original builder was not its CSS — it
// was that every control was visible at once, so nothing told the player what
// they were deciding. Fixing that makes the SEQUENCE of questions the design,
// and a sequence with conditional steps is a state machine whether or not you
// write it as one.
//
// Written as one here, outside React, for three reasons: the smart-skip rules
// are testable without a DOM; "going back must preserve selections" falls out of
// keeping one state object rather than unmounting steps; and the mapping from
// choices to the quiz query is in one function that a test can assert over.
//
// WHAT CHANGED IN THE SECOND PASS. The first wizard fixed the wall of filters
// and overshot: four steps, two of which offered two cards each. It was simple
// and it was empty, and an empty step is not a low-cognitive-load step — it is a
// step that makes you wonder whether the product has anything in it. So the
// choices came back, with three rules that were not there the first time:
//
//   * every list is as long as the DATA justifies, not as long as looks tidy —
//     thirty countries, twelve question types, every competition that has
//     questions behind it;
//   * "מעורב" exists wherever mixing is meaningful, and it is a real draw rather
//     than an absent filter (see engine/mixedSelection.ts);
//   * an option that cannot fill the quiz is DISABLED with its real count, not
//     hidden, because "Scotland has eight questions" and "Scotland is missing"
//     are different facts.

import { COMPETITIONS, COUNTRIES, LEAGUE_BY_COUNTRY } from "../../shared/constants.ts";
import { MIXED_TYPE_KEY, QUESTION_TYPE_BY_KEY } from "../../shared/questionTypes.ts";
import type {
  AnswerMode,
  Category,
  Difficulty,
  GameMode,
  QuizConfiguration,
  Region,
} from "../../shared/types.ts";

export type StepId =
  | "type"
  | "mode"
  | "settings"
  | "scope"
  | "continent"
  | "country"
  | "league"
  | "competition"
  | "preset"
  | "summary";

/** Where the questions come from. The branches of the scope step. */
export type ScopeKind = "WORLD" | "REGION" | "COMPETITION" | "PRESET";

// Scope presets live in shared/builderPresets.ts — the worker needs them to
// report a real count for every preset card. Re-exported so the page and the
// tests keep importing them from the wizard.
export { PRESETS, PRESET_BY_KEY, type Preset } from "../../shared/builderPresets.ts";
import { PRESET_BY_KEY } from "../../shared/builderPresets.ts";

/**
 * Competitions offered as a scope in their own right.
 *
 * Drawn from COMPETITIONS rather than retyped, minus the virtual group codes —
 * a group is a preset, not a competition — so this list cannot drift from the
 * one the query validator accepts. The wizard shows every entry with its real
 * count and disables the ones that cannot fill the quiz, which is how the
 * Conference League and Copa América are handled: both are real competitions
 * the bank has no questions for yet, and saying so is better than pretending
 * they do not exist.
 */
export const SCOPE_COMPETITIONS = COMPETITIONS.filter((c) => c.type !== "GROUP");

/**
 * The competitions offered once a country has been chosen.
 *
 * WHY THIS IS MORE THAN THE DOMESTIC LEAGUE. The bank defines exactly one league
 * per country, so a league step built from LEAGUE_BY_COUNTRY alone offers two
 * things — "all of it" and that one league — and measured at 40% of its own
 * screen. The honest way to fill it is not bigger cards, it is the other
 * competitions the country's clubs actually appear in.
 *
 * And they do appear: scope matching is now AND across dimensions, so "Spain"
 * plus "Champions League" means Spanish clubs in the Champions League, which is
 * a real and interesting filter rather than a union of the two. Continental
 * competitions are the ones that make sense here — a domestic league belongs to
 * one country, a World Cup to none.
 *
 * Nothing is assumed to have questions behind it. Each card carries its real
 * count, measured within the chosen country, and is disabled when it cannot
 * fill the quiz — which is how a country with no European pedigree shows an
 * empty Champions League card instead of a lie.
 */
export const CONTINENTAL_COMPETITIONS = COMPETITIONS.filter((c) => c.type === "CONTINENTAL");

export function competitionsForCountry(countryCode: string): string[] {
  const domestic = LEAGUE_BY_COUNTRY[countryCode];
  return [...(domestic ? [domestic] : []), ...CONTINENTAL_COMPETITIONS.map((c) => c.code)];
}

/**
 * Every continent, including the two with nothing in them.
 *
 * THIS USED TO BE FILTERED, and filtering it was wrong twice over.
 *
 * Africa and Oceania have no countries in the bank, so they were dropped — and
 * the step was left with four cards on a 932px phone, 200px of empty screen
 * below them, and no way to make it fuller except by inflating the cards. The
 * spec's own rule resolves it: disable, do not disappear. A card reading
 * "אפריקה — לא מספיק שאלות כרגע" is a true statement about the product, it
 * tells a player the continent is known rather than forgotten, and it fills the
 * grid with content instead of padding.
 *
 * The availability query reports every continent listed here, including a zero
 * for the ones with no countries, so "offered" never means "selectable". The
 * day African questions are harvested the card lights up on its own.
 */
export const SUPPORTED_CONTINENTS: { code: Region; labelHe: string }[] = [
  { code: "EUROPE", labelHe: "אירופה" },
  { code: "SOUTH_AMERICA", labelHe: "דרום אמריקה" },
  { code: "NORTH_AMERICA", labelHe: "צפון אמריקה" },
  { code: "ASIA", labelHe: "אסיה" },
  { code: "AFRICA", labelHe: "אפריקה" },
  { code: "OCEANIA", labelHe: "אוקיאניה" },
];

export const countriesIn = (continent: Region) =>
  COUNTRIES.filter((country) => country.continent === continent);

export const leagueOf = (countryCode: string): string | null =>
  LEAGUE_BY_COUNTRY[countryCode] ?? null;

export interface WizardState {
  /** A key from shared/questionTypes, or MIXED. */
  questionType: string;
  answerMode: AnswerMode;
  difficulty: Difficulty | "MIXED";
  questionCount: number;
  scope: ScopeKind;
  /** Only meaningful when scope is PRESET. */
  preset: string | null;
  /** Only meaningful when scope is COMPETITION. */
  competition: string | null;
  /** Only meaningful when scope is REGION. */
  continent: Region | null;
  country: string | null;
  /** null means "every league in the country". */
  league: string | null;
}

export const INITIAL_STATE: WizardState = {
  // Mixed leads on both of the axes that can be mixed: it is the recommended
  // choice, and the one that shows off the breadth of the bank.
  questionType: MIXED_TYPE_KEY,
  // Free text is the mode the product is actually about, so it leads.
  answerMode: "FREE_TEXT",
  difficulty: "MIXED",
  questionCount: 10,
  scope: "WORLD",
  preset: null,
  competition: null,
  continent: null,
  country: null,
  league: null,
};

/**
 * Which steps this state actually needs.
 *
 * THE SMART SKIPS, all of them, in one place:
 *
 *   כל העולם          → no geography to ask about at all
 *   a preset          → the preset already said where; no drill-down
 *   תחרות             → one competition step, no country or league
 *   אזור מסוים        → continent, then country, then league
 *   a country with no
 *   league in the bank → the league step does not appear
 *   כל היבשת          → neither does it, because no country was chosen
 *
 * Returning the list rather than a "next step" function is what makes the
 * progress indicator honest: "3 / 6" is computed from the steps this player will
 * actually see, not from a fixed total that sometimes lies.
 */
export function stepsFor(state: WizardState): StepId[] {
  const steps: StepId[] = ["type", "mode", "settings", "scope"];
  if (state.scope === "REGION") {
    steps.push("continent");
    if (state.continent) steps.push("country");
    if (state.country && leagueOf(state.country)) steps.push("league");
  }
  if (state.scope === "COMPETITION") steps.push("competition");
  if (state.scope === "PRESET") steps.push("preset");
  steps.push("summary");
  return steps;
}

/** Whether the current step has enough to move on. */
export function canAdvance(state: WizardState, step: StepId): boolean {
  switch (step) {
    case "type":
    case "mode":
    case "settings":
    case "scope":
    case "league":
    case "summary":
      return true;
    case "continent":
      // A continent alone is a usable filter: "anywhere in Europe" is a real
      // choice and should not be blocked on picking a country.
      return state.continent !== null;
    case "country":
      // "כל היבשת" is represented by a null country, so this step is always
      // satisfied once it is reachable.
      return true;
    case "competition":
      return state.competition !== null;
    case "preset":
      return state.preset !== null;
  }
}

/** Which availability dimension a step needs counts for, if any. */
export function dimensionFor(step: StepId): string[] {
  switch (step) {
    case "type":
      return ["types"];
    case "continent":
      return ["continents"];
    case "country":
      return ["countries"];
    case "league":
      // Two dimensions, because this step compares a whole country against one
      // of its leagues: "מעורב" is the country's count and the other card is the
      // league's. Asking only for competitions would leave the mixed card — the
      // recommended one — as the only option on the step with no number on it.
      return ["countries", "competitions"];
    case "competition":
      return ["competitions"];
    case "preset":
      return ["presets"];
    default:
      return [];
  }
}

/**
 * Turns the wizard's state into the quiz query.
 *
 * This function is the contract between the UI and the engine, and it is the one
 * the Playwright flows assert against — "verify the query, not just the UI" is
 * only possible because the mapping lives in one place with no React around it.
 *
 * THE REGION FIELD IS DELIBERATELY LEFT AT WORLD when a continent is chosen, and
 * the continent is expressed as its countries instead. There are only three
 * REGION scope values in the bank — WORLD, EUROPE and SOUTH_AMERICA — so
 * `region: "ASIA"` matched nothing and Israel, a core domain for this audience,
 * was unreachable through the geography branch. The COUNTRY dimension is
 * populated for all thirty countries, so a continent is the set of its
 * countries. Measured: the seven big European countries give 1,111 questions
 * against REGION=EUROPE's 1,106, so the continent that did have a tag loses
 * nothing by being expressed this way.
 *
 * Note what is NOT set: `preset`. A player who walked through the wizard and
 * chose "מומחה" has asked for Expert questions and gets them. Only the home
 * page's one-tap presets carry QUICK_START, and only those get the accessible
 * difficulty mix.
 */
export function toConfiguration(state: WizardState): QuizConfiguration {
  const spec = state.questionType === MIXED_TYPE_KEY ? null : QUESTION_TYPE_BY_KEY.get(state.questionType);

  const base = {
    region: "WORLD" as Region,
    countries: [] as string[],
    competitions: ["ALL"] as string[],
    // A question type's categories and a preset's categories are both real
    // filters, and only one of them can be in force: the type is chosen first
    // and a preset that carries categories replaces them, because a player who
    // picked "נבחרות" after "העברות" means national-team questions.
    categories: (spec?.categories ?? []) as Category[],
    gameMode: (spec?.mode ?? "CLASSIC") as GameMode,
  };

  if (state.scope === "PRESET" && state.preset) {
    const preset = PRESET_BY_KEY.get(state.preset);
    if (preset) {
      if (preset.region) base.region = preset.region;
      if (preset.countries) base.countries = preset.countries;
      if (preset.competitions) base.competitions = preset.competitions;
      if (preset.categories) base.categories = preset.categories;
    }
  } else if (state.scope === "COMPETITION" && state.competition) {
    base.competitions = [state.competition];
  } else if (state.scope === "REGION" && state.continent) {
    base.countries = state.country ? [state.country] : countriesIn(state.continent).map((c) => c.code);
    // A league chosen inside a country narrows further; "every league" leaves
    // the country filter to do the work on its own.
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
    questionType: state.questionType,
  };
}

/** The compact final summary, as label/value pairs in reading order. */
export function summaryOf(
  state: WizardState,
  labels: {
    answerMode: Record<AnswerMode, string>;
    difficulty: Record<string, string>;
    competition: (code: string) => string;
    country: (code: string) => string;
  }
): { step: StepId; label: string; value: string }[] {
  const scopeValue = (() => {
    if (state.scope === "WORLD") return "כל העולם";
    if (state.scope === "PRESET") {
      return PRESET_BY_KEY.get(state.preset ?? "")?.labelHe ?? "בחירה מהירה";
    }
    if (state.scope === "COMPETITION") {
      return state.competition ? labels.competition(state.competition) : "תחרות";
    }
    const parts: string[] = [];
    if (state.continent) {
      parts.push(SUPPORTED_CONTINENTS.find((c) => c.code === state.continent)?.labelHe ?? "");
    }
    parts.push(state.country ? labels.country(state.country) : "כל היבשת");
    if (state.league) parts.push(labels.competition(state.league));
    return parts.filter(Boolean).join(" → ");
  })();

  const scopeStep: StepId =
    state.scope === "REGION"
      ? state.league
        ? "league"
        : state.country
          ? "country"
          : "continent"
      : state.scope === "COMPETITION"
        ? "competition"
        : state.scope === "PRESET"
          ? "preset"
          : "scope";

  return [
    {
      step: "type",
      label: "סוג שאלות",
      value:
        state.questionType === MIXED_TYPE_KEY
          ? "מעורב"
          : (QUESTION_TYPE_BY_KEY.get(state.questionType)?.labelHe ?? state.questionType),
    },
    { step: "mode", label: "איך משחקים", value: labels.answerMode[state.answerMode] },
    {
      step: "settings",
      label: "קושי",
      value: state.difficulty === "MIXED" ? "מעורב" : labels.difficulty[state.difficulty],
    },
    { step: "settings", label: "כמות", value: `${state.questionCount} שאלות` },
    { step: scopeStep, label: "מקור", value: scopeValue },
  ];
}

/**
 * The one-line orientation chip shown at the top of later steps.
 *
 * Deliberately short and deliberately not the full summary: it exists so a
 * player four steps in can see what they already chose without the step turning
 * into a receipt. Three values, the ones that change how the quiz plays.
 */
export function orientationOf(
  state: WizardState,
  labels: { answerMode: Record<AnswerMode, string>; difficulty: Record<string, string> }
): string {
  const type =
    state.questionType === MIXED_TYPE_KEY
      ? "מעורב"
      : (QUESTION_TYPE_BY_KEY.get(state.questionType)?.labelHe ?? state.questionType);
  const difficulty = state.difficulty === "MIXED" ? "מעורב" : labels.difficulty[state.difficulty];
  return `${type} · ${labels.answerMode[state.answerMode]} · ${difficulty} · ${state.questionCount}`;
}
