import type { IconName } from "../components/Icon";
import type { QuizConfiguration } from "../../shared/types";

export interface QuickPreset {
  key: string;
  titleHe: string;
  subtitleHe: string;
  /** Drawn mark from the shared icon set — never an emoji. */
  icon: IconName;
  /** Short running-head label, shown as a stamp in the fixtures list. */
  tagHe: string;
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
    icon: "globe",
    tagHe: "מעורב",
    config: { ...base, region: "WORLD", competitions: ["ALL"], categories: [], gameMode: "CLASSIC" },
  },
  {
    key: "top6",
    titleHe: "6 הליגות המובילות",
    subtitleHe: "פרמיירליג, לה ליגה, סרייה א׳ ועוד",
    icon: "shield",
    tagHe: "אירופה",
    config: { ...base, region: "EUROPE", competitions: ["TOP_6_EUROPE"], categories: [], gameMode: "CLASSIC" },
  },
  {
    key: "ucl",
    titleHe: "ליגת האלופות",
    subtitleHe: "הרגעים הגדולים של הכדורגל האירופי",
    icon: "trophy",
    tagHe: "גביע",
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
    icon: "stadium",
    tagHe: "נבחרות",
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
    icon: "target",
    tagHe: "רמזים",
    config: { ...base, region: "WORLD", competitions: ["ALL"], categories: ["WHO_AM_I"], gameMode: "WHO_AM_I" },
  },
  {
    key: "career",
    titleHe: "מסלול קריירה",
    subtitleHe: "עקבו אחרי המועדונים ונחשו את השחקן",
    icon: "route",
    tagHe: "קריירות",
    config: {
      ...base,
      region: "WORLD",
      competitions: ["ALL"],
      categories: ["CAREER_PATH"],
      gameMode: "CAREER_PATH",
    },
  },
];
