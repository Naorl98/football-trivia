import type {
  Category,
  CompetitionRef,
  CountryRef,
  Difficulty,
  GameMode,
  Region,
  RankLabel,
} from "./types";

export const REGIONS: { code: Region; labelHe: string }[] = [
  { code: "WORLD", labelHe: "כל העולם" },
  { code: "EUROPE", labelHe: "אירופה" },
  { code: "SOUTH_AMERICA", labelHe: "דרום אמריקה" },
  { code: "NORTH_AMERICA", labelHe: "צפון אמריקה" },
  { code: "AFRICA", labelHe: "אפריקה" },
  { code: "ASIA", labelHe: "אסיה" },
  { code: "OCEANIA", labelHe: "אוקיאניה" },
];

export const COUNTRIES: CountryRef[] = [
  { code: "ENG", nameHe: "אנגליה", nameEn: "England", continent: "EUROPE" },
  { code: "ESP", nameHe: "ספרד", nameEn: "Spain", continent: "EUROPE" },
  { code: "ITA", nameHe: "איטליה", nameEn: "Italy", continent: "EUROPE" },
  { code: "GER", nameHe: "גרמניה", nameEn: "Germany", continent: "EUROPE" },
  { code: "FRA", nameHe: "צרפת", nameEn: "France", continent: "EUROPE" },
  { code: "POR", nameHe: "פורטוגל", nameEn: "Portugal", continent: "EUROPE" },
  { code: "NED", nameHe: "הולנד", nameEn: "Netherlands", continent: "EUROPE" },
  { code: "ISR", nameHe: "ישראל", nameEn: "Israel", continent: "ASIA" },
  { code: "BRA", nameHe: "ברזיל", nameEn: "Brazil", continent: "SOUTH_AMERICA" },
  { code: "ARG", nameHe: "ארגנטינה", nameEn: "Argentina", continent: "SOUTH_AMERICA" },
];

// Individual competitions. "GROUP" type entries (e.g. TOP_5_EUROPE) are virtual
// and expand to a set of real competitions at query time — see COMPETITION_GROUPS.
export const COMPETITIONS: CompetitionRef[] = [
  { code: "ALL", nameHe: "כל הליגות", nameEn: "All leagues", type: "GROUP" },
  { code: "TOP_5_EUROPE", nameHe: "5 הליגות הגדולות", nameEn: "Top 5 Europe", type: "GROUP" },
  { code: "TOP_6_EUROPE", nameHe: "6 הליגות הגדולות", nameEn: "Top 6 Europe", type: "GROUP" },
  { code: "PREMIER_LEAGUE", nameHe: "פרמיירליג", nameEn: "Premier League", type: "LEAGUE" },
  { code: "LA_LIGA", nameHe: "לה ליגה", nameEn: "La Liga", type: "LEAGUE" },
  { code: "SERIE_A", nameHe: "סרייה א׳", nameEn: "Serie A", type: "LEAGUE" },
  { code: "BUNDESLIGA", nameHe: "בונדסליגה", nameEn: "Bundesliga", type: "LEAGUE" },
  { code: "LIGUE_1", nameHe: "ליגה 1 הצרפתית", nameEn: "Ligue 1", type: "LEAGUE" },
  { code: "LIGA_PORTUGAL", nameHe: "ליגה פורטוגזית", nameEn: "Liga Portugal", type: "LEAGUE" },
  { code: "EREDIVISIE", nameHe: "אירדיוויזי", nameEn: "Eredivisie", type: "LEAGUE" },
  { code: "ISRAELI_PREMIER_LEAGUE", nameHe: "ליגת העל בישראל", nameEn: "Israeli Premier League", type: "LEAGUE" },
  { code: "UCL", nameHe: "ליגת האלופות", nameEn: "UEFA Champions League", type: "CONTINENTAL" },
  { code: "UEL", nameHe: "ליגה האירופית", nameEn: "UEFA Europa League", type: "CONTINENTAL" },
  { code: "UECL", nameHe: "ליגת הכנס האירופית", nameEn: "UEFA Conference League", type: "CONTINENTAL" },
  { code: "WORLD_CUP", nameHe: "מונדיאל", nameEn: "FIFA World Cup", type: "INTERNATIONAL" },
  { code: "COPA_AMERICA", nameHe: "קופה אמריקה", nameEn: "Copa América", type: "INTERNATIONAL" },
  { code: "EURO", nameHe: "יורו", nameEn: "UEFA European Championship", type: "INTERNATIONAL" },
];

// Reusable competition groups, defined declaratively instead of being
// hardcoded inside UI components. The question engine expands these codes
// into their member competition codes before matching scopes.
export const COMPETITION_GROUPS: Record<string, string[]> = {
  ALL: COMPETITIONS.filter((c) => c.type !== "GROUP").map((c) => c.code),
  TOP_5_EUROPE: ["PREMIER_LEAGUE", "LA_LIGA", "SERIE_A", "BUNDESLIGA", "LIGUE_1"],
  TOP_6_EUROPE: ["PREMIER_LEAGUE", "LA_LIGA", "SERIE_A", "BUNDESLIGA", "LIGUE_1", "LIGA_PORTUGAL"],
};

export function expandCompetitionCodes(codes: string[]): string[] {
  const expanded = new Set<string>();
  for (const code of codes) {
    if (COMPETITION_GROUPS[code]) {
      COMPETITION_GROUPS[code].forEach((c) => expanded.add(c));
    } else {
      expanded.add(code);
    }
  }
  return [...expanded];
}

export const CATEGORIES: { code: Category; labelHe: string }[] = [
  { code: "PLAYERS", labelHe: "שחקנים" },
  { code: "CLUBS", labelHe: "קבוצות" },
  { code: "NATIONAL_TEAMS", labelHe: "נבחרות" },
  { code: "CAREERS", labelHe: "קריירות" },
  { code: "TRANSFERS", labelHe: "העברות" },
  { code: "TITLES", labelHe: "תארים" },
  { code: "STATS", labelHe: "סטטיסטיקות" },
  { code: "COACHES", labelHe: "מאמנים" },
  { code: "STADIUMS", labelHe: "אצטדיונים" },
  { code: "CHAMPIONS_LEAGUE", labelHe: "ליגת האלופות" },
  { code: "WORLD_CUP", labelHe: "מונדיאל" },
  { code: "WHO_AM_I", labelHe: "מי אני?" },
  { code: "GUESS_THE_CLUB", labelHe: "נחש את הקבוצה" },
  { code: "CAREER_PATH", labelHe: "מסלול קריירה" },
];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  EASY: "קל",
  NORMAL: "רגיל",
  HARD: "קשה",
  EXPERT: "מומחה",
  IMPOSSIBLE: "בלתי אפשרי",
};

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  CLASSIC: "חידון קלאסי",
  WHO_AM_I: "מי אני?",
  CAREER_PATH: "מסלול קריירה",
  CLUB_CONNECTION: "חיבור קבוצות",
  HIGHER_LOWER: "יותר או פחות",
  GUESS_THE_CLUB: "נחש את הקבוצה",
};

// Higher/Lower requires reliable head-to-head statistics we have not verified
// yet — keep it visible in the architecture but disabled in the product until
// a trustworthy stats source is wired in.
export const ENABLED_GAME_MODES: GameMode[] = [
  "CLASSIC",
  "WHO_AM_I",
  "CAREER_PATH",
  "CLUB_CONNECTION",
  "GUESS_THE_CLUB",
];

export const QUESTION_COUNTS = [5, 10, 20, 30, 50] as const;

// Deterministic, playful rank labels derived from accuracy percentage.
export function rankFromAccuracy(accuracy: number): RankLabel {
  if (accuracy >= 95) return "אגדה";
  if (accuracy >= 80) return "מומחה";
  if (accuracy >= 60) return "פרשן";
  if (accuracy >= 35) return "אוהד";
  return "צופה מזדמן";
}

export const DEFAULT_QUIZ_DURATION_QUESTIONS = 10;
