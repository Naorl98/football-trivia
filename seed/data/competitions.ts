// Competition results — every row below was cross-checked against the
// published finals/champions tables on Wikipedia (which mirrors the official
// UEFA/FIFA/league records) during the data-expansion phase.
//
// PROVENANCE NOTE: prose summaries returned alongside those tables were found
// to contain errors (e.g. a Ballon d'Or list that placed Bobby Charlton in
// 1993), so only structured per-row table data was used and the Ballon d'Or
// year-by-year list was dropped entirely. Title-count claims are derived by
// counting rows here rather than copied from any summary.
//
// Clubs are referenced by id from clubs.ts. `null` means the club is not in the
// registry — generators simply skip the variants that would need to name it.

export interface ClubFinal {
  year: number;
  winner: string; // club id
  runnerUp: string | null; // club id or null when not in the registry
  score?: string;
  note?: string;
}

export interface NationFinal {
  year: number;
  hostHe: string;
  winner: string; // nation code
  runnerUp: string; // nation code
  score: string;
}

export const NATIONS: Record<string, { he: string; aliases: string[] }> = {
  BRA: { he: "ברזיל", aliases: ["Brazil"] },
  ARG: { he: "ארגנטינה", aliases: ["Argentina"] },
  GER: { he: "גרמניה", aliases: ["Germany"] },
  FRG: { he: "מערב גרמניה", aliases: ["West Germany", "גרמניה"] },
  ITA: { he: "איטליה", aliases: ["Italy"] },
  FRA: { he: "צרפת", aliases: ["France"] },
  ESP: { he: "ספרד", aliases: ["Spain"] },
  ENG: { he: "אנגליה", aliases: ["England"] },
  NED: { he: "הולנד", aliases: ["Netherlands", "Holland"] },
  URU: { he: "אורוגוואי", aliases: ["Uruguay"] },
  POR: { he: "פורטוגל", aliases: ["Portugal"] },
  CZE: { he: "צ'כוסלובקיה", aliases: ["Czechoslovakia"] },
  CZR: { he: "צ'כיה", aliases: ["Czech Republic"] },
  HUN: { he: "הונגריה", aliases: ["Hungary"] },
  SWE: { he: "שוודיה", aliases: ["Sweden"] },
  CRO: { he: "קרואטיה", aliases: ["Croatia"] },
  URS: { he: "ברית המועצות", aliases: ["Soviet Union", "USSR"] },
  YUG: { he: "יוגוסלביה", aliases: ["Yugoslavia"] },
  DEN: { he: "דנמרק", aliases: ["Denmark"] },
  GRE: { he: "יוון", aliases: ["Greece"] },
  BEL: { he: "בלגיה", aliases: ["Belgium"] },
};

// ---------------------------------------------------------------------------
// European Cup / UEFA Champions League finals
// ---------------------------------------------------------------------------
export const UCL_FINALS: ClubFinal[] = [
  { year: 1956, winner: "real_madrid", runnerUp: null, score: "4–3" },
  { year: 1957, winner: "real_madrid", runnerUp: "fiorentina", score: "2–0" },
  { year: 1958, winner: "real_madrid", runnerUp: "milan", score: "3–2" },
  { year: 1959, winner: "real_madrid", runnerUp: null, score: "2–0" },
  { year: 1960, winner: "real_madrid", runnerUp: "frankfurt", score: "7–3" },
  { year: 1961, winner: "benfica", runnerUp: "barcelona", score: "3–2" },
  { year: 1962, winner: "benfica", runnerUp: "real_madrid", score: "5–3" },
  { year: 1963, winner: "milan", runnerUp: "benfica", score: "2–1" },
  { year: 1964, winner: "inter", runnerUp: "real_madrid", score: "3–1" },
  { year: 1965, winner: "inter", runnerUp: "benfica", score: "1–0" },
  { year: 1966, winner: "real_madrid", runnerUp: "partizan", score: "2–1" },
  { year: 1967, winner: "celtic", runnerUp: "inter", score: "2–1" },
  { year: 1968, winner: "man_utd", runnerUp: "benfica", score: "4–1" },
  { year: 1969, winner: "milan", runnerUp: "ajax", score: "4–1" },
  { year: 1970, winner: "feyenoord", runnerUp: "celtic", score: "2–1" },
  { year: 1971, winner: "ajax", runnerUp: "panathinaikos", score: "2–0" },
  { year: 1972, winner: "ajax", runnerUp: "inter", score: "2–0" },
  { year: 1973, winner: "ajax", runnerUp: "juventus", score: "1–0" },
  { year: 1974, winner: "bayern", runnerUp: "atletico", score: "1–1 (חוזר 4–0)" },
  { year: 1975, winner: "bayern", runnerUp: "leeds", score: "2–0" },
  { year: 1976, winner: "bayern", runnerUp: "saint_etienne", score: "1–0" },
  { year: 1977, winner: "liverpool", runnerUp: "monchengladbach", score: "3–1" },
  { year: 1978, winner: "liverpool", runnerUp: "club_brugge", score: "1–0" },
  { year: 1979, winner: "nottingham", runnerUp: "malmo", score: "1–0" },
  { year: 1980, winner: "nottingham", runnerUp: "hamburg", score: "1–0" },
  { year: 1981, winner: "liverpool", runnerUp: "real_madrid", score: "1–0" },
  { year: 1982, winner: "aston_villa", runnerUp: "bayern", score: "1–0" },
  { year: 1983, winner: "hamburg", runnerUp: "juventus", score: "1–0" },
  { year: 1984, winner: "liverpool", runnerUp: "roma", score: "1–1 (פנדלים)" },
  { year: 1985, winner: "juventus", runnerUp: "liverpool", score: "1–0" },
  { year: 1986, winner: "steaua", runnerUp: "barcelona", score: "0–0 (פנדלים)" },
  { year: 1987, winner: "porto", runnerUp: "bayern", score: "2–1" },
  { year: 1988, winner: "psv", runnerUp: "benfica", score: "0–0 (פנדלים)" },
  { year: 1989, winner: "milan", runnerUp: "steaua", score: "4–0" },
  { year: 1990, winner: "milan", runnerUp: "benfica", score: "1–0" },
  { year: 1991, winner: "red_star", runnerUp: "marseille", score: "0–0 (פנדלים)" },
  { year: 1992, winner: "barcelona", runnerUp: "sampdoria", score: "1–0" },
  { year: 1993, winner: "marseille", runnerUp: "milan", score: "1–0" },
  { year: 1994, winner: "milan", runnerUp: "barcelona", score: "4–0" },
  { year: 1995, winner: "ajax", runnerUp: "milan", score: "1–0" },
  { year: 1996, winner: "juventus", runnerUp: "ajax", score: "1–1 (פנדלים)" },
  { year: 1997, winner: "dortmund", runnerUp: "juventus", score: "3–1" },
  { year: 1998, winner: "real_madrid", runnerUp: "juventus", score: "1–0" },
  { year: 1999, winner: "man_utd", runnerUp: "bayern", score: "2–1" },
  { year: 2000, winner: "real_madrid", runnerUp: "valencia", score: "3–0" },
  { year: 2001, winner: "bayern", runnerUp: "valencia", score: "1–1 (פנדלים)" },
  { year: 2002, winner: "real_madrid", runnerUp: "leverkusen", score: "2–1" },
  { year: 2003, winner: "milan", runnerUp: "juventus", score: "0–0 (פנדלים)" },
  { year: 2004, winner: "porto", runnerUp: "monaco", score: "3–0" },
  { year: 2005, winner: "liverpool", runnerUp: "milan", score: "3–3 (פנדלים)" },
  { year: 2006, winner: "barcelona", runnerUp: "arsenal", score: "2–1" },
  { year: 2007, winner: "milan", runnerUp: "liverpool", score: "2–1" },
  { year: 2008, winner: "man_utd", runnerUp: "chelsea", score: "1–1 (פנדלים)" },
  { year: 2009, winner: "barcelona", runnerUp: "man_utd", score: "2–0" },
  { year: 2010, winner: "inter", runnerUp: "bayern", score: "2–0" },
  { year: 2011, winner: "barcelona", runnerUp: "man_utd", score: "3–1" },
  { year: 2012, winner: "chelsea", runnerUp: "bayern", score: "1–1 (פנדלים)" },
  { year: 2013, winner: "bayern", runnerUp: "dortmund", score: "2–1" },
  { year: 2014, winner: "real_madrid", runnerUp: "atletico", score: "4–1" },
  { year: 2015, winner: "barcelona", runnerUp: "juventus", score: "3–1" },
  { year: 2016, winner: "real_madrid", runnerUp: "atletico", score: "1–1 (פנדלים)" },
  { year: 2017, winner: "real_madrid", runnerUp: "juventus", score: "4–1" },
  { year: 2018, winner: "real_madrid", runnerUp: "liverpool", score: "3–1" },
  { year: 2019, winner: "liverpool", runnerUp: "tottenham", score: "2–0" },
  { year: 2020, winner: "bayern", runnerUp: "psg", score: "1–0" },
  { year: 2021, winner: "chelsea", runnerUp: "man_city", score: "1–0" },
  { year: 2022, winner: "real_madrid", runnerUp: "liverpool", score: "1–0" },
  { year: 2023, winner: "man_city", runnerUp: "inter", score: "1–0" },
  { year: 2024, winner: "real_madrid", runnerUp: "dortmund", score: "2–0" },
  { year: 2025, winner: "psg", runnerUp: "inter", score: "5–0" },
  { year: 2026, winner: "psg", runnerUp: "arsenal", score: "1–1 (פנדלים 4–3)" },
];

// ---------------------------------------------------------------------------
// UEFA Cup / Europa League finals (1990 onward)
// ---------------------------------------------------------------------------
export const UEL_FINALS: ClubFinal[] = [
  { year: 1990, winner: "juventus", runnerUp: "fiorentina" },
  { year: 1991, winner: "inter", runnerUp: "roma" },
  { year: 1992, winner: "ajax", runnerUp: "torino" },
  { year: 1993, winner: "juventus", runnerUp: "dortmund" },
  { year: 1994, winner: "inter", runnerUp: null },
  { year: 1995, winner: "parma", runnerUp: "juventus" },
  { year: 1996, winner: "bayern", runnerUp: "bordeaux" },
  { year: 1997, winner: "schalke", runnerUp: "inter" },
  { year: 1998, winner: "inter", runnerUp: "lazio", score: "3–0" },
  { year: 1999, winner: "parma", runnerUp: "marseille", score: "3–0" },
  { year: 2000, winner: "galatasaray", runnerUp: "arsenal", score: "0–0 (פנדלים)" },
  { year: 2001, winner: "liverpool", runnerUp: null, score: "5–4" },
  { year: 2002, winner: "feyenoord", runnerUp: "dortmund", score: "3–2" },
  { year: 2003, winner: "porto", runnerUp: "celtic", score: "3–2" },
  { year: 2004, winner: "valencia", runnerUp: "marseille", score: "2–0" },
  { year: 2005, winner: "cska_moscow", runnerUp: "sporting", score: "3–1" },
  { year: 2006, winner: "sevilla", runnerUp: "middlesbrough", score: "4–0" },
  { year: 2007, winner: "sevilla", runnerUp: "espanyol", score: "2–2 (פנדלים)" },
  { year: 2008, winner: "zenit", runnerUp: "rangers", score: "2–0" },
  { year: 2009, winner: "shakhtar", runnerUp: "werder", score: "2–1" },
  { year: 2010, winner: "atletico", runnerUp: "fulham", score: "2–1" },
  { year: 2011, winner: "porto", runnerUp: "braga", score: "1–0" },
  { year: 2012, winner: "atletico", runnerUp: "athletic", score: "3–0" },
  { year: 2013, winner: "chelsea", runnerUp: "benfica", score: "2–1" },
  { year: 2014, winner: "sevilla", runnerUp: "benfica", score: "0–0 (פנדלים)" },
  { year: 2015, winner: "sevilla", runnerUp: null, score: "3–2" },
  { year: 2016, winner: "sevilla", runnerUp: "liverpool", score: "3–1" },
  { year: 2017, winner: "man_utd", runnerUp: "ajax", score: "2–0" },
  { year: 2018, winner: "atletico", runnerUp: "marseille", score: "3–0" },
  { year: 2019, winner: "chelsea", runnerUp: "arsenal", score: "4–1" },
  { year: 2020, winner: "sevilla", runnerUp: "inter", score: "3–2" },
  { year: 2021, winner: "villarreal", runnerUp: "man_utd", score: "1–1 (פנדלים)" },
  { year: 2022, winner: "frankfurt", runnerUp: "rangers", score: "1–1 (פנדלים)" },
  { year: 2023, winner: "sevilla", runnerUp: "roma", score: "1–1 (פנדלים)" },
  { year: 2024, winner: "atalanta", runnerUp: "leverkusen", score: "3–0" },
  { year: 2025, winner: "tottenham", runnerUp: "man_utd", score: "1–0" },
  { year: 2026, winner: "aston_villa", runnerUp: "freiburg", score: "3–0" },
];

// ---------------------------------------------------------------------------
// FIFA World Cup finals
// ---------------------------------------------------------------------------
export const WORLD_CUP_FINALS: NationFinal[] = [
  { year: 1930, hostHe: "אורוגוואי", winner: "URU", runnerUp: "ARG", score: "4–2" },
  { year: 1934, hostHe: "איטליה", winner: "ITA", runnerUp: "CZE", score: "2–1" },
  { year: 1938, hostHe: "צרפת", winner: "ITA", runnerUp: "HUN", score: "4–2" },
  { year: 1950, hostHe: "ברזיל", winner: "URU", runnerUp: "BRA", score: "2–1" },
  { year: 1954, hostHe: "שווייץ", winner: "FRG", runnerUp: "HUN", score: "3–2" },
  { year: 1958, hostHe: "שוודיה", winner: "BRA", runnerUp: "SWE", score: "5–2" },
  { year: 1962, hostHe: "צ'ילה", winner: "BRA", runnerUp: "CZE", score: "3–1" },
  { year: 1966, hostHe: "אנגליה", winner: "ENG", runnerUp: "FRG", score: "4–2" },
  { year: 1970, hostHe: "מקסיקו", winner: "BRA", runnerUp: "ITA", score: "4–1" },
  { year: 1974, hostHe: "מערב גרמניה", winner: "FRG", runnerUp: "NED", score: "2–1" },
  { year: 1978, hostHe: "ארגנטינה", winner: "ARG", runnerUp: "NED", score: "3–1" },
  { year: 1982, hostHe: "ספרד", winner: "ITA", runnerUp: "FRG", score: "3–1" },
  { year: 1986, hostHe: "מקסיקו", winner: "ARG", runnerUp: "FRG", score: "3–2" },
  { year: 1990, hostHe: "איטליה", winner: "FRG", runnerUp: "ARG", score: "1–0" },
  { year: 1994, hostHe: "ארצות הברית", winner: "BRA", runnerUp: "ITA", score: "0–0 (פנדלים 3–2)" },
  { year: 1998, hostHe: "צרפת", winner: "FRA", runnerUp: "BRA", score: "3–0" },
  { year: 2002, hostHe: "דרום קוריאה ויפן", winner: "BRA", runnerUp: "GER", score: "2–0" },
  { year: 2006, hostHe: "גרמניה", winner: "ITA", runnerUp: "FRA", score: "1–1 (פנדלים 5–3)" },
  { year: 2010, hostHe: "דרום אפריקה", winner: "ESP", runnerUp: "NED", score: "1–0" },
  { year: 2014, hostHe: "ברזיל", winner: "GER", runnerUp: "ARG", score: "1–0" },
  { year: 2018, hostHe: "רוסיה", winner: "FRA", runnerUp: "CRO", score: "4–2" },
  { year: 2022, hostHe: "קטאר", winner: "ARG", runnerUp: "FRA", score: "3–3 (פנדלים 4–2)" },
  { year: 2026, hostHe: "ארה\"ב, קנדה ומקסיקו", winner: "ESP", runnerUp: "ARG", score: "1–0 (אחרי הארכה)" },
];

// ---------------------------------------------------------------------------
// UEFA European Championship finals
// ---------------------------------------------------------------------------
export const EURO_FINALS: NationFinal[] = [
  { year: 1960, hostHe: "צרפת", winner: "URS", runnerUp: "YUG", score: "2–1" },
  { year: 1964, hostHe: "ספרד", winner: "ESP", runnerUp: "URS", score: "2–1" },
  { year: 1968, hostHe: "איטליה", winner: "ITA", runnerUp: "YUG", score: "1–1 (חוזר 2–0)" },
  { year: 1972, hostHe: "בלגיה", winner: "FRG", runnerUp: "URS", score: "3–0" },
  { year: 1976, hostHe: "יוגוסלביה", winner: "CZE", runnerUp: "FRG", score: "2–2 (פנדלים 5–3)" },
  { year: 1980, hostHe: "איטליה", winner: "FRG", runnerUp: "BEL", score: "2–1" },
  { year: 1984, hostHe: "צרפת", winner: "FRA", runnerUp: "ESP", score: "2–0" },
  { year: 1988, hostHe: "מערב גרמניה", winner: "NED", runnerUp: "URS", score: "2–0" },
  { year: 1992, hostHe: "שוודיה", winner: "DEN", runnerUp: "GER", score: "2–0" },
  { year: 1996, hostHe: "אנגליה", winner: "GER", runnerUp: "CZR", score: "2–1" },
  { year: 2000, hostHe: "בלגיה והולנד", winner: "FRA", runnerUp: "ITA", score: "2–1" },
  { year: 2004, hostHe: "פורטוגל", winner: "GRE", runnerUp: "POR", score: "1–0" },
  { year: 2008, hostHe: "אוסטריה ושווייץ", winner: "ESP", runnerUp: "GER", score: "1–0" },
  { year: 2012, hostHe: "פולין ואוקראינה", winner: "ESP", runnerUp: "ITA", score: "4–0" },
  { year: 2016, hostHe: "צרפת", winner: "POR", runnerUp: "FRA", score: "1–0" },
  { year: 2020, hostHe: "אירופה (מארחות מרובות)", winner: "ITA", runnerUp: "ENG", score: "1–1 (פנדלים 3–2)" },
  { year: 2024, hostHe: "גרמניה", winner: "ESP", runnerUp: "ENG", score: "2–1" },
];

// ---------------------------------------------------------------------------
// Domestic league champions
// ---------------------------------------------------------------------------
export interface LeagueSeason {
  season: string; // "2023-24"
  champion: string; // club id
}

export const LEAGUE_CHAMPIONS: { league: string; leagueHe: string; seasons: LeagueSeason[] }[] = [
  {
    league: "PREMIER_LEAGUE",
    leagueHe: "הפרמיירליג",
    seasons: [
      { season: "1992-93", champion: "man_utd" }, { season: "1993-94", champion: "man_utd" },
      { season: "1994-95", champion: "blackburn" }, { season: "1995-96", champion: "man_utd" },
      { season: "1996-97", champion: "man_utd" }, { season: "1997-98", champion: "arsenal" },
      { season: "1998-99", champion: "man_utd" }, { season: "1999-00", champion: "man_utd" },
      { season: "2000-01", champion: "man_utd" }, { season: "2001-02", champion: "arsenal" },
      { season: "2002-03", champion: "man_utd" }, { season: "2003-04", champion: "arsenal" },
      { season: "2004-05", champion: "chelsea" }, { season: "2005-06", champion: "chelsea" },
      { season: "2006-07", champion: "man_utd" }, { season: "2007-08", champion: "man_utd" },
      { season: "2008-09", champion: "man_utd" }, { season: "2009-10", champion: "chelsea" },
      { season: "2010-11", champion: "man_utd" }, { season: "2011-12", champion: "man_city" },
      { season: "2012-13", champion: "man_utd" }, { season: "2013-14", champion: "man_city" },
      { season: "2014-15", champion: "chelsea" }, { season: "2015-16", champion: "leicester" },
      { season: "2016-17", champion: "chelsea" }, { season: "2017-18", champion: "man_city" },
      { season: "2018-19", champion: "man_city" }, { season: "2019-20", champion: "liverpool" },
      { season: "2020-21", champion: "man_city" }, { season: "2021-22", champion: "man_city" },
      { season: "2022-23", champion: "man_city" }, { season: "2023-24", champion: "man_city" },
      { season: "2024-25", champion: "liverpool" }, { season: "2025-26", champion: "arsenal" },
    ],
  },
  {
    league: "LA_LIGA",
    leagueHe: "לה ליגה",
    seasons: [
      { season: "1990-91", champion: "barcelona" }, { season: "1991-92", champion: "barcelona" },
      { season: "1992-93", champion: "barcelona" }, { season: "1993-94", champion: "barcelona" },
      { season: "1994-95", champion: "real_madrid" }, { season: "1995-96", champion: "atletico" },
      { season: "1996-97", champion: "real_madrid" }, { season: "1997-98", champion: "barcelona" },
      { season: "1998-99", champion: "barcelona" }, { season: "1999-00", champion: "deportivo" },
      { season: "2000-01", champion: "real_madrid" }, { season: "2001-02", champion: "valencia" },
      { season: "2002-03", champion: "real_madrid" }, { season: "2003-04", champion: "valencia" },
      { season: "2004-05", champion: "barcelona" }, { season: "2005-06", champion: "barcelona" },
      { season: "2006-07", champion: "real_madrid" }, { season: "2007-08", champion: "real_madrid" },
      { season: "2008-09", champion: "barcelona" }, { season: "2009-10", champion: "barcelona" },
      { season: "2010-11", champion: "barcelona" }, { season: "2011-12", champion: "real_madrid" },
      { season: "2012-13", champion: "barcelona" }, { season: "2013-14", champion: "atletico" },
      { season: "2014-15", champion: "barcelona" }, { season: "2015-16", champion: "barcelona" },
      { season: "2016-17", champion: "real_madrid" }, { season: "2017-18", champion: "barcelona" },
      { season: "2018-19", champion: "barcelona" }, { season: "2019-20", champion: "real_madrid" },
      { season: "2020-21", champion: "atletico" }, { season: "2021-22", champion: "real_madrid" },
      { season: "2022-23", champion: "barcelona" }, { season: "2023-24", champion: "real_madrid" },
      { season: "2024-25", champion: "barcelona" }, { season: "2025-26", champion: "barcelona" },
    ],
  },
  {
    league: "SERIE_A",
    leagueHe: "סרייה א׳",
    seasons: [
      { season: "1990-91", champion: "sampdoria" }, { season: "1991-92", champion: "milan" },
      { season: "1992-93", champion: "milan" }, { season: "1993-94", champion: "milan" },
      { season: "1994-95", champion: "juventus" }, { season: "1995-96", champion: "milan" },
      { season: "1996-97", champion: "juventus" }, { season: "1997-98", champion: "juventus" },
      { season: "1998-99", champion: "milan" }, { season: "1999-00", champion: "lazio" },
      { season: "2000-01", champion: "roma" }, { season: "2001-02", champion: "juventus" },
      { season: "2002-03", champion: "juventus" }, { season: "2003-04", champion: "milan" },
      { season: "2004-05", champion: "juventus" }, { season: "2005-06", champion: "inter" },
      { season: "2006-07", champion: "inter" }, { season: "2007-08", champion: "inter" },
      { season: "2008-09", champion: "inter" }, { season: "2009-10", champion: "inter" },
      { season: "2010-11", champion: "milan" }, { season: "2011-12", champion: "juventus" },
      { season: "2012-13", champion: "juventus" }, { season: "2013-14", champion: "juventus" },
      { season: "2014-15", champion: "juventus" }, { season: "2015-16", champion: "juventus" },
      { season: "2016-17", champion: "juventus" }, { season: "2017-18", champion: "juventus" },
      { season: "2018-19", champion: "juventus" }, { season: "2019-20", champion: "juventus" },
      { season: "2020-21", champion: "inter" }, { season: "2021-22", champion: "milan" },
      { season: "2022-23", champion: "napoli" }, { season: "2023-24", champion: "inter" },
      { season: "2024-25", champion: "napoli" }, { season: "2025-26", champion: "inter" },
    ],
  },
  {
    league: "BUNDESLIGA",
    leagueHe: "הבונדסליגה",
    seasons: [
      { season: "1990-91", champion: "kaiserslautern" }, { season: "1991-92", champion: "stuttgart" },
      { season: "1992-93", champion: "werder" }, { season: "1993-94", champion: "bayern" },
      { season: "1994-95", champion: "dortmund" }, { season: "1995-96", champion: "dortmund" },
      { season: "1996-97", champion: "bayern" }, { season: "1997-98", champion: "kaiserslautern" },
      { season: "1998-99", champion: "bayern" }, { season: "1999-00", champion: "bayern" },
      { season: "2000-01", champion: "bayern" }, { season: "2001-02", champion: "dortmund" },
      { season: "2002-03", champion: "bayern" }, { season: "2003-04", champion: "werder" },
      { season: "2004-05", champion: "bayern" }, { season: "2005-06", champion: "bayern" },
      { season: "2006-07", champion: "stuttgart" }, { season: "2007-08", champion: "bayern" },
      { season: "2008-09", champion: "wolfsburg" }, { season: "2009-10", champion: "bayern" },
      { season: "2010-11", champion: "dortmund" }, { season: "2011-12", champion: "dortmund" },
      { season: "2012-13", champion: "bayern" }, { season: "2013-14", champion: "bayern" },
      { season: "2014-15", champion: "bayern" }, { season: "2015-16", champion: "bayern" },
      { season: "2016-17", champion: "bayern" }, { season: "2017-18", champion: "bayern" },
      { season: "2018-19", champion: "bayern" }, { season: "2019-20", champion: "bayern" },
      { season: "2020-21", champion: "bayern" }, { season: "2021-22", champion: "bayern" },
      { season: "2022-23", champion: "bayern" }, { season: "2023-24", champion: "leverkusen" },
    ],
  },
  {
    league: "LIGUE_1",
    leagueHe: "ליגה 1 הצרפתית",
    seasons: [
      { season: "1990-91", champion: "marseille" }, { season: "1991-92", champion: "marseille" },
      { season: "1993-94", champion: "psg" }, { season: "1994-95", champion: "nantes" },
      { season: "1995-96", champion: "auxerre" }, { season: "1996-97", champion: "monaco" },
      { season: "1997-98", champion: "lens" }, { season: "1998-99", champion: "bordeaux" },
      { season: "1999-00", champion: "monaco" }, { season: "2000-01", champion: "nantes" },
      { season: "2001-02", champion: "lyon" }, { season: "2002-03", champion: "lyon" },
      { season: "2003-04", champion: "lyon" }, { season: "2004-05", champion: "lyon" },
      { season: "2005-06", champion: "lyon" }, { season: "2006-07", champion: "lyon" },
      { season: "2007-08", champion: "lyon" }, { season: "2008-09", champion: "bordeaux" },
      { season: "2009-10", champion: "marseille" }, { season: "2010-11", champion: "lille" },
      { season: "2011-12", champion: "montpellier" }, { season: "2012-13", champion: "psg" },
      { season: "2013-14", champion: "psg" }, { season: "2014-15", champion: "psg" },
      { season: "2015-16", champion: "psg" }, { season: "2016-17", champion: "monaco" },
      { season: "2017-18", champion: "psg" }, { season: "2018-19", champion: "psg" },
      { season: "2019-20", champion: "psg" }, { season: "2020-21", champion: "lille" },
      { season: "2021-22", champion: "psg" }, { season: "2022-23", champion: "psg" },
      { season: "2023-24", champion: "psg" }, { season: "2024-25", champion: "psg" },
      { season: "2025-26", champion: "psg" },
    ],
  },
];
