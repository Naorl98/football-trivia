import type {
  Category,
  CompetitionRef,
  CountryRef,
  Difficulty,
  GameMode,
  Region,
  RankLabel,
} from "./types.ts";

export const REGIONS: { code: Region; labelHe: string }[] = [
  { code: "WORLD", labelHe: "כל העולם" },
  { code: "EUROPE", labelHe: "אירופה" },
  { code: "SOUTH_AMERICA", labelHe: "דרום אמריקה" },
  { code: "NORTH_AMERICA", labelHe: "צפון אמריקה" },
  { code: "AFRICA", labelHe: "אפריקה" },
  { code: "ASIA", labelHe: "אסיה" },
  { code: "OCEANIA", labelHe: "אוקיאניה" },
];

/*
  Every country the question bank actually has questions about.

  THIS LIST IS DERIVED FROM THE BANK, NOT FROM AMBITION. These are the thirty
  distinct COUNTRY scope values on production, and the comment on each line is
  its active question count at the time of writing. Ten of them were listed
  before, which is why the builder's country step looked thin: it was offering a
  third of the countries the bank can answer about.

  The long tail is deliberately INCLUDED rather than trimmed. A country with
  eight questions cannot fill a ten-question quiz, and the wizard says so — it
  renders the real count and disables the card with "לא מספיק שאלות כרגע". That
  is more useful than hiding it, because "Scotland is not here" and "Scotland
  has eight questions" are different facts and only one of them is true.

  Nothing here is aspirational: a code with no questions would show zero and
  never be selectable, so adding one would be a lie the UI then has to tell.
*/
export const COUNTRIES: CountryRef[] = [
  // ---- Europe ----
  { code: "ESP", nameHe: "ספרד", nameEn: "Spain", continent: "EUROPE", flag: "🇪🇸" }, // 1,483
  { code: "ENG", nameHe: "אנגליה", nameEn: "England", continent: "EUROPE", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" }, // 1,337
  { code: "ITA", nameHe: "איטליה", nameEn: "Italy", continent: "EUROPE", flag: "🇮🇹" }, // 1,134
  { code: "FRA", nameHe: "צרפת", nameEn: "France", continent: "EUROPE", flag: "🇫🇷" }, // 698
  { code: "GER", nameHe: "גרמניה", nameEn: "Germany", continent: "EUROPE", flag: "🇩🇪" }, // 504
  { code: "NED", nameHe: "הולנד", nameEn: "Netherlands", continent: "EUROPE", flag: "🇳🇱" }, // 459
  { code: "POR", nameHe: "פורטוגל", nameEn: "Portugal", continent: "EUROPE", flag: "🇵🇹" }, // 211
  { code: "TUR", nameHe: "טורקיה", nameEn: "Turkey", continent: "EUROPE", flag: "🇹🇷" }, // 10
  { code: "SCO", nameHe: "סקוטלנד", nameEn: "Scotland", continent: "EUROPE", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" }, // 8
  { code: "GRE", nameHe: "יוון", nameEn: "Greece", continent: "EUROPE", flag: "🇬🇷" }, // 7
  { code: "CRO", nameHe: "קרואטיה", nameEn: "Croatia", continent: "EUROPE", flag: "🇭🇷" }, // 6
  { code: "BEL", nameHe: "בלגיה", nameEn: "Belgium", continent: "EUROPE", flag: "🇧🇪" }, // 6
  { code: "RUS", nameHe: "רוסיה", nameEn: "Russia", continent: "EUROPE", flag: "🇷🇺" }, // 6
  { code: "SUI", nameHe: "שווייץ", nameEn: "Switzerland", continent: "EUROPE", flag: "🇨🇭" }, // 4
  { code: "SRB", nameHe: "סרביה", nameEn: "Serbia", continent: "EUROPE", flag: "🇷🇸" }, // 4
  { code: "AUT", nameHe: "אוסטריה", nameEn: "Austria", continent: "EUROPE", flag: "🇦🇹" }, // 4
  { code: "UKR", nameHe: "אוקראינה", nameEn: "Ukraine", continent: "EUROPE", flag: "🇺🇦" }, // 3
  { code: "SWE", nameHe: "שוודיה", nameEn: "Sweden", continent: "EUROPE", flag: "🇸🇪" }, // 3
  { code: "ROU", nameHe: "רומניה", nameEn: "Romania", continent: "EUROPE", flag: "🇷🇴" }, // 3
  { code: "POL", nameHe: "פולין", nameEn: "Poland", continent: "EUROPE", flag: "🇵🇱" }, // 3
  { code: "NOR", nameHe: "נורווגיה", nameEn: "Norway", continent: "EUROPE", flag: "🇳🇴" }, // 3

  // ---- South America ----
  { code: "BRA", nameHe: "ברזיל", nameEn: "Brazil", continent: "SOUTH_AMERICA", flag: "🇧🇷" }, // 438
  { code: "ARG", nameHe: "ארגנטינה", nameEn: "Argentina", continent: "SOUTH_AMERICA", flag: "🇦🇷" }, // 231
  { code: "URU", nameHe: "אורוגוואי", nameEn: "Uruguay", continent: "SOUTH_AMERICA", flag: "🇺🇾" }, // 12

  // ---- Asia. Israel is a core domain for this audience, not a long-tail entry. ----
  { code: "ISR", nameHe: "ישראל", nameEn: "Israel", continent: "ASIA", flag: "🇮🇱" }, // 55
  { code: "KSA", nameHe: "ערב הסעודית", nameEn: "Saudi Arabia", continent: "ASIA", flag: "🇸🇦" }, // 12
  { code: "CHN", nameHe: "סין", nameEn: "China", continent: "ASIA", flag: "🇨🇳" }, // 6
  { code: "JPN", nameHe: "יפן", nameEn: "Japan", continent: "ASIA", flag: "🇯🇵" }, // 3

  // ---- North America ----
  { code: "USA", nameHe: "ארצות הברית", nameEn: "United States", continent: "NORTH_AMERICA", flag: "🇺🇸" }, // 11
  { code: "CAN", nameHe: "קנדה", nameEn: "Canada", continent: "NORTH_AMERICA", flag: "🇨🇦" }, // 6
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

/**
 * The domestic league each supported country has in the bank.
 *
 * Drives the wizard's country → league drill-down, so the step can only ever
 * offer a league that exists: a country with no entry here skips the league
 * question entirely rather than showing an empty list. Brazil and Argentina are
 * absent deliberately — their clubs are in the bank, their domestic leagues are
 * not exposed as a filter.
 */
export const LEAGUE_BY_COUNTRY: Record<string, string> = {
  ENG: "PREMIER_LEAGUE",
  ESP: "LA_LIGA",
  ITA: "SERIE_A",
  GER: "BUNDESLIGA",
  FRA: "LIGUE_1",
  POR: "LIGA_PORTUGAL",
  NED: "EREDIVISIE",
  ISR: "ISRAELI_PREMIER_LEAGUE",
};

/**
 * Question-count presets.
 *
 * 15 was added for the wizard, whose step 2 offers 5/10/15/20 — four taps on one
 * line, which is what "one screen, one decision" needs. 30 and 50 stay in the
 * allow-list because stored challenges and daily configurations were created
 * with them and must keep resolving.
 */
export const QUESTION_COUNTS = [5, 10, 15, 20, 30, 50] as const;

/** What the wizard offers. The rest of QUESTION_COUNTS stays valid, just unlisted. */
export const WIZARD_QUESTION_COUNTS = [5, 10, 15, 20] as const;

// Deterministic, playful rank labels derived from accuracy percentage.
export function rankFromAccuracy(accuracy: number): RankLabel {
  if (accuracy >= 95) return "אגדה";
  if (accuracy >= 80) return "מומחה";
  if (accuracy >= 60) return "פרשן";
  if (accuracy >= 35) return "אוהד";
  return "צופה מזדמן";
}

export const DEFAULT_QUIZ_DURATION_QUESTIONS = 10;
