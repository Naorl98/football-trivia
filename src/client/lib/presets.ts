import type { QuizConfiguration } from "../../shared/types";

export interface QuickPreset {
  key: string;
  titleHe: string;
  subtitleHe: string;
  emoji: string;
  config: QuizConfiguration;
}

const base = {
  countries: [] as string[],
  questionCount: 10 as const,
  difficulty: "MIXED" as const,
  answerMode: "MULTIPLE_CHOICE" as const,
};

export const QUICK_PRESETS: QuickPreset[] = [
  {
    key: "world",
    titleHe: "כל העולם",
    subtitleHe: "תערובת שאלות מכל קצוות עולם הכדורגל",
    emoji: "🌍",
    config: { ...base, region: "WORLD", competitions: ["ALL"], categories: [], gameMode: "CLASSIC" },
  },
  {
    key: "top6",
    titleHe: "6 הליגות המובילות",
    subtitleHe: "פרמיירליג, לה ליגה, סרייה א׳ ועוד",
    emoji: "🏆",
    config: { ...base, region: "EUROPE", competitions: ["TOP_6_EUROPE"], categories: [], gameMode: "CLASSIC" },
  },
  {
    key: "ucl",
    titleHe: "ליגת האלופות",
    subtitleHe: "הרגעים הגדולים של הכדורגל האירופי",
    emoji: "⭐",
    config: {
      ...base,
      region: "EUROPE",
      competitions: ["UCL"],
      categories: ["CHAMPIONS_LEAGUE"],
      gameMode: "CLASSIC",
    },
  },
  {
    key: "worldcup",
    titleHe: "מונדיאל",
    subtitleHe: "היסטוריית גביע העולם מ-1930 ועד היום",
    emoji: "🌐",
    config: {
      ...base,
      region: "WORLD",
      competitions: ["WORLD_CUP"],
      categories: ["WORLD_CUP"],
      gameMode: "CLASSIC",
    },
  },
  {
    key: "whoami",
    titleHe: "מי אני?",
    subtitleHe: "נחשו את הכוכב לפי רמזי הקריירה שלו",
    emoji: "🕵️",
    config: { ...base, region: "WORLD", competitions: ["ALL"], categories: ["WHO_AM_I"], gameMode: "WHO_AM_I" },
  },
  {
    key: "career",
    titleHe: "מסלול קריירה",
    subtitleHe: "עקבו אחרי המועדונים ונחשו את השחקן",
    emoji: "🧭",
    config: {
      ...base,
      region: "WORLD",
      competitions: ["ALL"],
      categories: ["CAREER_PATH"],
      gameMode: "CAREER_PATH",
    },
  },
];
