import type { IconName } from "../components/Icon";
import type { QuizConfiguration } from "../../shared/types";

export interface QuickPreset {
  key: string;
  titleHe: string;
  icon: IconName;
  config: QuizConfiguration;
}

const base = {
  countries: [] as string[],
  questionCount: 10 as const,
  difficulty: "MIXED" as const,
  answerMode: "MULTIPLE_CHOICE" as const,
  /**
   * Every home-page preset is a Quick Start launch.
   *
   * That tag is what gets these quizzes the accessible difficulty mix —
   * EASY/NORMAL/HARD only, with the HARD questions familiarity-guarded — and it
   * is enforced server-side, in src/worker/engine/difficultyPolicy.ts. Setting
   * it here is a declaration of intent, not the mechanism: the server would
   * apply the same rules if the client sent nothing else at all, and it ignores
   * `difficulty` entirely when a preset is present.
   *
   * The builder deliberately does NOT send this. Somebody who walks through the
   * wizard and chooses "מומחה" has asked for Expert questions and gets them.
   */
  preset: "QUICK_START" as const,
};

/**
 * Four one-tap starts, and no more.
 *
 * The home page's job is to get someone into a quiz in one tap; a longer list
 * turns that into a decision. Anything else lives in the builder.
 */
export const QUICK_PRESETS: QuickPreset[] = [
  {
    key: "world",
    titleHe: "כל העולם",
    icon: "globe",
    config: { ...base, region: "WORLD", competitions: ["ALL"], categories: [], gameMode: "CLASSIC" },
  },
  {
    key: "top6",
    titleHe: "טופ 6",
    icon: "shield",
    config: { ...base, region: "EUROPE", competitions: ["TOP_6_EUROPE"], categories: [], gameMode: "CLASSIC" },
  },
  {
    key: "ucl",
    titleHe: "ליגת האלופות",
    icon: "trophy",
    config: {
      ...base,
      region: "EUROPE",
      competitions: ["UCL"],
      categories: ["CHAMPIONS_LEAGUE"],
      gameMode: "CLASSIC",
    },
  },
  {
    key: "whoami",
    titleHe: "מי אני?",
    icon: "target",
    config: { ...base, region: "WORLD", competitions: ["ALL"], categories: ["WHO_AM_I"], gameMode: "WHO_AM_I" },
  },
];
