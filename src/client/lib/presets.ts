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
