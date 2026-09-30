// Football IQ — curated seed question bank.
//
// DATA ACCURACY POLICY:
// Every question below is written from well-established, widely documented
// football facts (World Cup/Euro/Champions League results, well-known transfers,
// club nicknames/stadiums, career histories of globally famous players). No
// statistic that changes season-to-season (e.g. "current top scorer") is used
// unless the record has been stable for years. All rows are marked verified=1.
// If a fact could not be confidently verified it was left out entirely rather
// than guessed — see README.md "Data accuracy" section for the documented
// limitation on question bank size vs. the 100-question target.
//
// mode: CLASSIC | WHO_AM_I | CAREER_PATH | CLUB_CONNECTION | GUESS_THE_CLUB
// scopes: REGION | COUNTRY | COMPETITION | CLUB  (see src/shared/constants.ts)

export type SeedDifficulty = "EASY" | "NORMAL" | "HARD" | "EXPERT" | "IMPOSSIBLE";
export type SeedMode = "CLASSIC" | "WHO_AM_I" | "CAREER_PATH" | "CLUB_CONNECTION" | "GUESS_THE_CLUB";
export type SeedCategory =
  | "PLAYERS" | "CLUBS" | "NATIONAL_TEAMS" | "CAREERS" | "TRANSFERS" | "TITLES"
  | "STATS" | "COACHES" | "STADIUMS" | "CHAMPIONS_LEAGUE" | "WORLD_CUP"
  | "WHO_AM_I" | "GUESS_THE_CLUB" | "CAREER_PATH";

export interface SeedScope {
  type: "REGION" | "COUNTRY" | "COMPETITION" | "CLUB";
  value: string;
}

export interface SeedQuestion {
  mode: SeedMode;
  category: SeedCategory;
  difficulty: SeedDifficulty;
  questionHe: string;
  explanationHe: string;
  options: string[]; // exactly 4
  correctIndex: number;
  clues?: string[]; // WHO_AM_I / CAREER_PATH only, ordered
  scopes: SeedScope[];
  sourceLabel: string;
}

const WORLD: SeedScope = { type: "REGION", value: "WORLD" };
const EUROPE: SeedScope = { type: "REGION", value: "EUROPE" };
const SOUTH_AMERICA: SeedScope = { type: "REGION", value: "SOUTH_AMERICA" };
const comp = (v: string): SeedScope => ({ type: "COMPETITION", value: v });
const country = (v: string): SeedScope => ({ type: "COUNTRY", value: v });

export const seedQuestions: SeedQuestion[] = [
  // ===================== WORLD CUP =====================
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "EASY",
    questionHe: "איזו נבחרת זכתה הכי הרבה פעמים במונדיאל?",
    explanationHe: "ברזיל זכתה חמש פעמים: 1958, 1962, 1970, 1994 ו-2002 — יותר מכל נבחרת אחרת.",
    options: ["ברזיל", "גרמניה", "איטליה", "ארגנטינה"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("BRA")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "EASY",
    questionHe: "איזו מדינה אירחה את מונדיאל 2022?",
    explanationHe: "מונדיאל 2022 נערך בקטאר, בפעם הראשונה שהמונדיאל נערך בחורף בשל האקלים באזור.",
    options: ["קטאר", "איחוד האמירויות", "סעודיה", "ירדן"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "EASY",
    questionHe: "איזו נבחרת זכתה במונדיאל 2022?",
    explanationHe: "ארגנטינה בניצחונו של ליאו מסי, ניצחה את צרפת בגמר דרמטי בנקיטת פנדלים לאחר 3:3.",
    options: ["ארגנטינה", "צרפת", "ברזיל", "קרואטיה"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("ARG")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "EASY",
    questionHe: "איזו נבחרת זכתה במונדיאל 2018 ברוסיה?",
    explanationHe: "נבחרת צרפת זכתה במונדיאל השני שלה בגמר נגד קרואטיה, 4:2.",
    options: ["צרפת", "קרואטיה", "בלגיה", "אנגליה"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("FRA")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "מי כבש את שער הניצחון של גרמניה בגמר מונדיאל 2014 מול ארגנטינה?",
    explanationHe: "מריו גצה כבש בדקה 113 והעניק לגרמניה את התואר הרביעי שלה, 0:1.",
    options: ["מריו גצה", "תומאס מולר", "מסוט אוזיל", "מירוסלב קלוזה"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("GER")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "איזו נבחרת זכתה במונדיאל 2010 בדרום אפריקה?",
    explanationHe: "ספרד זכתה בתואר הראשון שלה בהיסטוריה, לאחר ניצחון 0:1 על הולנד בגמר בשער של איניאסטה.",
    options: ["ספרד", "הולנד", "גרמניה", "אורוגוואי"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("ESP")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "איזו נבחרת זכתה במונדיאל 2006 בגרמניה?",
    explanationHe: "איטליה זכתה בתואר הרביעי שלה, לאחר ניצחון בנקיטת פנדלים על צרפת בגמר שבו זידאן נפסל על נגיחה במטראצי.",
    options: ["איטליה", "צרפת", "גרמניה", "פורטוגל"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("ITA")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "HARD",
    questionHe: "מי מלך השערים ההיסטורי של המונדיאל, עם 16 שערים?",
    explanationHe: "מירוסלב קלוזה מגרמניה, עם 16 שערים בארבעה מונדיאלים (2002-2014), הוא מלך השערים ההיסטורי.",
    options: ["מירוסלב קלוזה", "רונאלדו הברזילאי", "פלה", "גרד מולר"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("GER")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "מי היה מלך השערים של מונדיאל 2022, עם 8 שערים?",
    explanationHe: "קיליאן אמבפה כבש 8 שערים במונדיאל 2022, כולל שלישייה בגמר מול ארגנטינה, וזכה בנעל הזהב.",
    options: ["קיליאן אמבפה", "ליאו מסי", "אוליבייה ז'ירו", "חוליאן אלווארס"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("FRA")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "HARD",
    questionHe: "איזו נבחרת אירחה וזכתה במונדיאל הראשון בהיסטוריה ב-1930?",
    explanationHe: "אורוגוואי אירחה וזכתה במונדיאל הראשון ב-1930, בניצחון על ארגנטינה בגמר.",
    options: ["אורוגוואי", "ארגנטינה", "ברזיל", "איטליה"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), SOUTH_AMERICA], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "מי היה קפטן נבחרת ארגנטינה שהרים את גביע המונדיאל ב-2022?",
    explanationHe: "ליאו מסי הרים את גביע העולם כקפטן ארגנטינה, בהישג שהשלים את הקריירה הבינלאומית שלו.",
    options: ["ליאו מסי", "אנחל די מריה", "פאולו דיבאלה", "רודריגו דה פאול"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("ARG")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "כל כמה שנים מתקיים המונדיאל?",
    explanationHe: "המונדיאל מתקיים אחת לארבע שנים מאז 1930 (למעט הפסקה בשנות מלחמת העולם השנייה).",
    options: ["4 שנים", "2 שנים", "3 שנים", "5 שנים"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "איזה שחקן כינויו 'יד האלוהים' ו'שער המאה' באותו משחק במונדיאל 1986?",
    explanationHe: "דייגו מראדונה כבש את שני השערים הידועים במשחק רבע הגמר של ארגנטינה מול אנגליה במונדיאל 1986.",
    options: ["דייגו מראדונה", "מריו קמפוס", "חורחה בורוצ'אגה", "דניאל פסארלה"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("ARG")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "באיזו מדינה נערך מונדיאל 1994?",
    explanationHe: "מונדיאל 1994 נערך בארצות הברית, וברזיל זכתה בתואר לאחר ניצחון בפנדלים על איטליה.",
    options: ["ארצות הברית", "מקסיקו", "קנדה", "ברזיל"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "איזו נבחרת זכתה במונדיאל 1990 באיטליה?",
    explanationHe: "מערב גרמניה זכתה בתואר השלישי שלה, בניצחון 0:1 על ארגנטינה בגמר.",
    options: ["מערב גרמניה", "ארגנטינה", "איטליה", "אנגליה"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("GER")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "כמה מונדיאלים זכה פלה במהלך הקריירה שלו?",
    explanationHe: "פלה זכה בשלושה מונדיאלים עם ברזיל: 1958, 1962 ו-1970 — היחיד בהיסטוריה שהשיג זאת.",
    options: ["3", "2", "4", "1"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("BRA")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "IMPOSSIBLE",
    questionHe: "בגיל כמה זכה פלה במונדיאל הראשון שלו ב-1958, כשהיה לצעיר הזוכים בהיסטוריה?",
    explanationHe: "פלה היה בן 17 בלבד כשזכה במונדיאל 1958 בשוודיה, ונותר לשחקן הצעיר ביותר שזכה במונדיאל.",
    options: ["17", "19", "16", "21"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("BRA")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "באיזו מדינה משותפת נערך מונדיאל 2002?",
    explanationHe: "מונדיאל 2002 היה הראשון שנערך באסיה, בארגון משותף של דרום קוריאה ויפן. ברזיל זכתה בתואר.",
    options: ["דרום קוריאה ויפן", "סין ויפן", "תאילנד ווייטנאם", "יפן והפיליפינים"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "EXPERT",
    questionHe: "מי החמיץ את הפנדל המכריע עבור איטליה בגמר מונדיאל 1994 מול ברזיל?",
    explanationHe: "רוברטו באג'ו החמיץ את הפנדל המכריע בגמר 1994, ומאפשר לברזיל לזכות בתואר.",
    options: ["רוברטו באג'ו", "פרנקו בארזי", "דמטריו אלברטיני", "דניאלה מאסארו"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("ITA")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "EASY",
    questionHe: "אילו שלוש מדינות אירחו יחד את מונדיאל 2026?",
    explanationHe: "מונדיאל 2026 היה הראשון עם 48 נבחרות, והתקיים במשותף בארצות הברית, קנדה ומקסיקו. ספרד זכתה בתואר בניצחון על ארגנטינה.",
    options: ["ארה\"ב, קנדה ומקסיקו", "ארה\"ב, ברזיל וקנדה", "מקסיקו, ספרד ופורטוגל", "קנדה, יפן וקוריאה"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP")], sourceLabel: "היסטוריית המונדיאל",
  },

  // ===================== CHAMPIONS LEAGUE =====================
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "EASY",
    questionHe: "איזו קבוצה זכתה הכי הרבה פעמים בליגת האלופות?",
    explanationHe: "ריאל מדריד זכתה בליגת האלופות 15 פעמים, יותר מכל קבוצה אחרת בהיסטוריה.",
    options: ["ריאל מדריד", "מילאן", "ליברפול", "ברצלונה"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ESP")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "EASY",
    questionHe: "מי מלך השערים ההיסטורי של ליגת האלופות?",
    explanationHe: "כריסטיאנו רונאלדו הוא מלך השערים ההיסטורי של ליגת האלופות, עם למעלה מ-140 שערים.",
    options: ["כריסטיאנו רונאלדו", "ליאו מסי", "רוברט לבנדובסקי", "קרים בנזמה"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "NORMAL",
    questionHe: "איזו קבוצה זכתה בליגת האלופות 2023, והשלימה טרפל היסטורי?",
    explanationHe: "מנצ'סטר סיטי ניצחה את אינטר מילאנו 0:1 בגמר 2023, והשלימה טרפל (ליגה, גביע וליגת האלופות).",
    options: ["מנצ'סטר סיטי", "אינטר מילאנו", "ריאל מדריד", "באיירן מינכן"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ENG")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "NORMAL",
    questionHe: "איזו קבוצה זכתה בליגת האלופות 2019, בגמר אנגלי כולו מול טוטנהאם?",
    explanationHe: "ליברפול ניצחה את טוטנהאם 0:2 בגמר 2019 במדריד, וזכתה בתואר השישי שלה.",
    options: ["ליברפול", "טוטנהאם", "צ'לסי", "ארסנל"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ENG")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "NORMAL",
    questionHe: "איזו קבוצה ביצעה את 'הנס איסטנבול' ב-2005, כשהשלימה מפנה מ-0:3 לניצחון בפנדלים?",
    explanationHe: "ליברפול פיגרה 0:3 למילאן במחצית הגמר ב-2005, השוותה ל-3:3 וניצחה בפנדלים.",
    options: ["ליברפול", "ניוקאסל יונייטד", "צ'לסי", "אברטון"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ENG")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "NORMAL",
    questionHe: "איזו קבוצה זכתה בליגת האלופות 2012, לאחר ניצחון בפנדלים על באיירן מינכן במינכן עצמה?",
    explanationHe: "צ'לסי ניצחה את באיירן מינכן בפנדלים על מגרשה של באיירן, ה-Allianz Arena, וזכתה בתואר הראשון שלה.",
    options: ["צ'לסי", "באיירן מינכן", "ריאל מדריד", "ברצלונה"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ENG")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "HARD",
    questionHe: "בגמר ליגת האלופות 2014, ריאל מדריד ניצחה את אתלטיקו מדריד והשלימה את ה'עשירית' שלה. מה היתה התוצאה?",
    explanationHe: "ריאל מדריד ניצחה 1:4 אחרי הארכה, לאחר שאתלטיקו הובילה עד דקה 93 (שער השוואה של רמוס).",
    options: ["1:4 אחרי הארכה", "0:1", "2:3", "0:2"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ESP")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "NORMAL",
    questionHe: "איזו קבוצה ניצחה את יובנטוס 1:4 בגמר ליגת האלופות 2017 בקרדיף?",
    explanationHe: "ריאל מדריד ניצחה את יובנטוס בגמר 2017, עם שני שערים של כריסטיאנו רונאלדו.",
    options: ["ריאל מדריד", "ברצלונה", "באיירן מינכן", "מנצ'סטר סיטי"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ESP")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "EXPERT",
    questionHe: "מי כבש את שער הניצחון של באיירן מינכן בגמר 2020 מול פריז סן ז'רמן, קבוצתו לשעבר?",
    explanationHe: "קינגסלי קומאן, בוגר אקדמיית פריז סן ז'רמן, כבש את שער הניצחון עבור באיירן מינכן נגד קבוצתו הישנה.",
    options: ["קינגסלי קומאן", "תומאס מולר", "רוברט לבנדובסקי", "סרג' גנאברי"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("GER")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "EXPERT",
    questionHe: "כמה פעמים זכה ליאו מסי בליגת האלופות עם ברצלונה?",
    explanationHe: "מסי זכה בליגת האלופות ארבע פעמים עם ברצלונה: 2006, 2009, 2011 ו-2015.",
    options: ["4", "3", "5", "2"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ESP")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "NORMAL",
    questionHe: "איזו קבוצה זכתה בליגת האלופות 2016, בגמר מדריד'ני כולו מול אתלטיקו?",
    explanationHe: "ריאל מדריד ניצחה את אתלטיקו מדריד בפנדלים בגמר 2016 בסן סירו, מילאנו.",
    options: ["ריאל מדריד", "אתלטיקו מדריד", "ברצלונה", "ולנסיה"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ESP")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "IMPOSSIBLE",
    questionHe: "איזו קבוצה צרפתית זכתה בגביע האלופות האירופי ב-1993, בעונה הראשונה תחת השם 'ליגת האלופות'?",
    explanationHe: "מארסיי זכתה בתואר האירופי היחיד שלה ב-1993, בעונה הראשונה שבה התחרות שונתה למתכונת 'ליגת האלופות'.",
    options: ["מארסיי", "פריז סן ז'רמן", "מונקו", "בורדו"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("FRA")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "HARD",
    questionHe: "מי המאמן היחיד שזכה בליגת האלופות עם שלוש קבוצות שונות?",
    explanationHe: "חוזה מוריניו זכה בליגת האלופות עם פורטו (2004) ואינטר מילאנו (2010); קרלו אנצ'לוטי זכה עם מילאן וריאל מדריד. אך המאמן שזכה עם שלוש קבוצות שונות הוא ארנסט האפל.",
    options: ["ארנסט האפל", "חוזה מוריניו", "קרלו אנצ'לוטי", "פפ גווארדיולה"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL")], sourceLabel: "היסטוריית ליגת האלופות",
  },

  // ===================== CLUBS / TITLES / STADIUMS =====================
  {
    mode: "CLASSIC", category: "STADIUMS", difficulty: "EASY",
    questionHe: "באיזה אצטדיון משחקת ריאל מדריד את משחקי הבית שלה?",
    explanationHe: "ריאל מדריד משחקת בסנטיאגו ברנבאו שבמדריד, אחד האצטדיונים המפורסמים בעולם.",
    options: ["סנטיאגו ברנבאו", "קאמפ נואו", "וונדה מטרופוליטנו", "סן מאמס"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "STADIUMS", difficulty: "EASY",
    questionHe: "באיזה אצטדיון משחקת ברצלונה את משחקי הבית שלה?",
    explanationHe: "ברצלונה משחקת בקאמפ נואו, אחד האצטדיונים הגדולים באירופה.",
    options: ["קאמפ נואו", "סנטיאגו ברנבאו", "מסטאייה", "סן סירו"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "STADIUMS", difficulty: "EASY",
    questionHe: "מהו הכינוי של אצטדיון הבית של מנצ'סטר יונייטד, אולד טראפורד?",
    explanationHe: "אולד טראפורד מכונה 'תיאטרון החלומות' (Theatre of Dreams).",
    options: ["תיאטרון החלומות", "בית האריות", "המבצר האדום", "קן הנשרים"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "STADIUMS", difficulty: "NORMAL",
    questionHe: "אילו שתי קבוצות מילאנזיות חולקות את אצטדיון סן סירו?",
    explanationHe: "מילאן ואינטר מילאנו, יריבות עירוניות, חולקות יחד את אצטדיון סן סירו (סטדיו ג'וזפה מאצה).",
    options: ["מילאן ואינטר מילאנו", "יובנטוס ומילאן", "רומא ולאציו", "נאפולי ואינטר"], correctIndex: 0,
    scopes: [EUROPE, comp("SERIE_A"), country("ITA")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "STADIUMS", difficulty: "NORMAL",
    questionHe: "איזה אצטדיון ידוע ב'קיר הצהוב' המפורסם שלו, היציע הגדול באירופה?",
    explanationHe: "היציע הדרומי של בורוסיה דורטמונד באצטדיון זיגנל איידונה פארק מכונה 'הקיר הצהוב', והוא יציע העמידה הגדול באירופה.",
    options: ["זיגנל איידונה פארק (דורטמונד)", "אליאנץ ארנה (באיירן)", "פולקספארקשטדיון (המבורג)", "אולימפיאשטדיון (ברלין)"], correctIndex: 0,
    scopes: [EUROPE, comp("BUNDESLIGA"), country("GER")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "TITLES", difficulty: "NORMAL",
    questionHe: "איזו קבוצה זכתה הכי הרבה פעמים באליפות הפרמיירליג (מאז 1992)?",
    explanationHe: "מנצ'סטר יונייטד זכתה 13 פעמים באליפות הפרמיירליג, יותר מכל קבוצה אחרת מאז שהתחרות שונתה לשמה הנוכחי ב-1992.",
    options: ["מנצ'סטר יונייטד", "מנצ'סטר סיטי", "ארסנל", "צ'לסי"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "TITLES", difficulty: "EASY",
    questionHe: "איזו קבוצה זכתה הכי הרבה פעמים באליפות לה ליגה הספרדית?",
    explanationHe: "ריאל מדריד היא הקבוצה המצליחה ביותר בהיסטוריית לה ליגה, עם יותר תארים מכל קבוצה אחרת.",
    options: ["ריאל מדריד", "ברצלונה", "אתלטיקו מדריד", "ולנסיה"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "TITLES", difficulty: "EASY",
    questionHe: "איזו קבוצה זכתה הכי הרבה פעמים באליפות איטליה (סרייה א')?",
    explanationHe: "יובנטוס היא הקבוצה המצליחה ביותר בהיסטוריית הסקודטו האיטלקי.",
    options: ["יובנטוס", "מילאן", "אינטר מילאנו", "רומא"], correctIndex: 0,
    scopes: [EUROPE, comp("SERIE_A"), country("ITA")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "TITLES", difficulty: "EASY",
    questionHe: "איזו קבוצה שולטת באליפות גרמניה (בונדסליגה) בעשור האחרון?",
    explanationHe: "באיירן מינכן זכתה באליפות הבונדסליגה 11 פעמים ברציפות בין 2013 ל-2023.",
    options: ["באיירן מינכן", "בורוסיה דורטמונד", "לייפציג", "באייר לברקוזן"], correctIndex: 0,
    scopes: [EUROPE, comp("BUNDESLIGA"), country("GER")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "CLUBS", difficulty: "EASY",
    questionHe: "מה הכינוי של מועדון מנצ'סטר יונייטד?",
    explanationHe: "מנצ'סטר יונייטד מכונה 'השדים האדומים' (Red Devils).",
    options: ["השדים האדומים", "האזרחים", "התותחנים", "האריות"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "CLUBS", difficulty: "EASY",
    questionHe: "מה הכינוי של מועדון ליברפול?",
    explanationHe: "ליברפול מכונה 'האדומים' (The Reds), על שם צבעי האצטדיון והמדים.",
    options: ["האדומים", "הכחולים", "התותחנים", "הזאבים"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "CLUBS", difficulty: "EASY",
    questionHe: "מה הכינוי של מועדון ארסנל?",
    explanationHe: "ארסנל מכונה 'התותחנים' (The Gunners), בשל שורשי המועדון כקבוצת פועלי תעשיית נשק.",
    options: ["התותחנים", "האזרחים", "הפטישים", "הענקים"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "CLUBS", difficulty: "NORMAL",
    questionHe: "מה הכינוי הנפוץ לאוהדי ולשחקני ברצלונה?",
    explanationHe: "ברצלונה מכונה 'בלאוגרנה' (Blaugrana) על שם צבעי הכחול-בורדו, ואוהדיה מכונים 'קולה' (Culés).",
    options: ["בלאוגרנה", "רוחינגרוס", "ביאנקונרי", "נראצורי"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "CLUBS", difficulty: "NORMAL",
    questionHe: "בין אילו שתי קבוצות מתקיים 'אל קלאסיקו' הספרדי המפורסם?",
    explanationHe: "אל קלאסיקו הוא הדרבי בין ריאל מדריד לברצלונה, אחד המשחקים הצפויים ביותר בעולם הכדורגל.",
    options: ["ריאל מדריד וברצלונה", "ריאל מדריד ואתלטיקו מדריד", "ברצלונה וסביליה", "אתלטיקו וולנסיה"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "CLUBS", difficulty: "NORMAL",
    questionHe: "בין אילו שתי קבוצות מתקיים ה'סופרקלאסיקו' הארגנטינאי?",
    explanationHe: "הסופרקלאסיקו הוא הדרבי הגדול בכדורגל הארגנטינאי, בין בוקה ג'וניורס לריבר פלייט.",
    options: ["בוקה ג'וניורס וריבר פלייט", "אינדפנדיינטה וראסינג", "סן לורנסו וולז סארספילד", "אסטודיאנטס וג'ימנסיה"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, country("ARG")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "CLUBS", difficulty: "NORMAL",
    questionHe: "בין אילו שתי קבוצות מתקיים ה'אולד פירם' הסקוטי?",
    explanationHe: "האולד פירם הוא הדרבי בין סלטיק לריינג'רס בגלזגו, אחד הדרבים העתיקים והנטענים בעולם.",
    options: ["סלטיק וריינג'רס", "הרטס והייברניאן", "אברדין ודנדי יונייטד", "קילמרנוק ומות'רוול"], correctIndex: 0,
    scopes: [EUROPE], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "CLUBS", difficulty: "EXPERT",
    questionHe: "איזה מועדון אנגלי נחשב, לפי תיעוד היסטורי נפוץ, לוותיק בעולם שעדיין פעיל, שנוסד ב-1857?",
    explanationHe: "שפילד FC, שנוסדה ב-1857, נחשבת למועדון הכדורגל הוותיק ביותר בעולם שעדיין פעיל כיום.",
    options: ["שפילד FC", "נוטס קאונטי", "סטוק סיטי", "עיריית ברמינגהאם"], correctIndex: 0,
    scopes: [EUROPE, country("ENG")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "STATS", difficulty: "NORMAL",
    questionHe: "מי מלך השערים ההיסטורי של ריאל מדריד?",
    explanationHe: "כריסטיאנו רונאלדו כבש 450 שערים עבור ריאל מדריד בין 2009-2018, ועקף את ראול לתואר מלך השערים ההיסטורי.",
    options: ["כריסטיאנו רונאלדו", "ראול גונזלס", "אלפרדו די סטפנו", "קרים בנזמה"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "עובדות סטטיסטיות",
  },
  {
    mode: "CLASSIC", category: "STATS", difficulty: "HARD",
    questionHe: "מי מלך השערים ההיסטורי של הפרמיירליג האנגלית?",
    explanationHe: "אלן שירר כבש 260 שערים בפרמיירליג, שיא שעדיין עומד.",
    options: ["אלן שירר", "וויין רוני", "האריי קיין", "תיירי אנרי"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות סטטיסטיות",
  },
  {
    mode: "CLASSIC", category: "STATS", difficulty: "EXPERT",
    questionHe: "מי מלך הבישולים (אסיסטים) ההיסטורי של הפרמיירליג?",
    explanationHe: "ראיין גיגס, אגדת מנצ'סטר יונייטד, הוא בעל שיא האסיסטים ההיסטורי בפרמיירליג.",
    options: ["ראיין גיגס", "סטיבן ג'רארד", "סזאר אזפיליקואטה", "קווין דה בריינה"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות סטטיסטיות",
  },
  {
    mode: "CLASSIC", category: "STATS", difficulty: "NORMAL",
    questionHe: "מי זכה בכדורגל הזהב הכי הרבה פעמים בהיסטוריה?",
    explanationHe: "ליאו מסי זכה בכדורגל הזהב שמונה פעמים, שיא היסטורי, כשכריסטיאנו רונאלדו במקום השני עם חמש זכיות.",
    options: ["ליאו מסי", "כריסטיאנו רונאלדו", "מישל פלטיני", "יוהאן קרויף"], correctIndex: 0,
    scopes: [WORLD], sourceLabel: "עובדות סטטיסטיות",
  },

  // ===================== TRANSFERS =====================
  {
    mode: "CLASSIC", category: "TRANSFERS", difficulty: "NORMAL",
    questionHe: "לאיזו קבוצה עבר ניימאר ב-2017 בעסקה ששברה את שיא סכום ההעברה העולמי?",
    explanationHe: "ניימאר עבר מברצלונה לפריז סן ז'רמן תמורת כ-222 מיליון אירו, שיא עולמי שעדיין לא נשבר.",
    options: ["פריז סן ז'רמן", "ריאל מדריד", "מנצ'סטר סיטי", "יובנטוס"], correctIndex: 0,
    scopes: [EUROPE, comp("LIGUE_1"), country("FRA")], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLASSIC", category: "TRANSFERS", difficulty: "NORMAL",
    questionHe: "לאיזו קבוצה עבר קיליאן אמבפה ב-2024, בתום החוזה שלו בפריז סן ז'רמן?",
    explanationHe: "אמבפה עבר לריאל מדריד ב-2024 בהעברה חופשית, לאחר שנים של שמועות על המעבר.",
    options: ["ריאל מדריד", "ליברפול", "מנצ'סטר סיטי", "ברצלונה"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLASSIC", category: "TRANSFERS", difficulty: "NORMAL",
    questionHe: "לאיזו קבוצה עבר ארלינג הולנד ב-2022 מבורוסיה דורטמונד?",
    explanationHe: "הולנד עבר למנצ'סטר סיטי ב-2022, ושבר שיאי כבישה כבר בעונת הבכורה שלו.",
    options: ["מנצ'סטר סיטי", "ריאל מדריד", "באיירן מינכן", "צ'לסי"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLASSIC", category: "TRANSFERS", difficulty: "HARD",
    questionHe: "מאיזו קבוצה עבר לואיס פיגו לריאל מדריד ב-2000, בעסקה שהפכה אותו לשנוא ביותר בקאמפ נואו?",
    explanationHe: "פיגו עבר מברצלונה לריאל מדריד היריבה ב-2000, מעבר שנחשב לאחד השנויים במחלוקת בהיסטוריה.",
    options: ["ברצלונה", "פורטו", "ספורטינג ליסבון", "אינטר מילאנו"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLASSIC", category: "TRANSFERS", difficulty: "NORMAL",
    questionHe: "באיזו עונה עזב ליאו מסי את ברצלונה, המועדון בו גדל, לאחר קשיים כלכליים של המועדון?",
    explanationHe: "מסי עזב את ברצלונה ב-2021 עקב אילוצי שכר לפי תקנות הליגה, ועבר לפריז סן ז'רמן.",
    options: ["2021", "2019", "2023", "2017"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLASSIC", category: "TRANSFERS", difficulty: "EASY",
    questionHe: "לאיזו קבוצה אמריקאית עבר ליאו מסי ב-2023 מפריז סן ז'רמן?",
    explanationHe: "מסי עבר לאינטר מיאמי בליגת ה-MLS האמריקאית ב-2023.",
    options: ["אינטר מיאמי", "לוס אנג'לס גלאקסי", "ניו יורק סיטי", "אטלנטה יונייטד"], correctIndex: 0,
    scopes: [WORLD], sourceLabel: "היסטוריית העברות",
  },

  // ===================== NATIONAL TEAMS =====================
  {
    mode: "CLASSIC", category: "NATIONAL_TEAMS", difficulty: "EASY",
    questionHe: "איזו נבחרת זכתה באליפות אירופה (יורו) 2024?",
    explanationHe: "ספרד זכתה ביורו 2024 בגרמניה, לאחר ניצחון 1:2 על אנגליה בגמר, ובכך השלימה שיא של ארבעה תארי יורו.",
    options: ["ספרד", "אנגליה", "הולנד", "צרפת"], correctIndex: 0,
    scopes: [EUROPE, comp("EURO"), country("ESP")], sourceLabel: "היסטוריית נבחרות",
  },
  {
    mode: "CLASSIC", category: "NATIONAL_TEAMS", difficulty: "NORMAL",
    questionHe: "כמה פעמים הגיעה נבחרת הולנד לגמר המונדיאל מבלי לזכות בו מעולם?",
    explanationHe: "הולנד הגיעה לגמר המונדיאל שלוש פעמים (1974, 1978, 2010) ומעולם לא זכתה בתואר.",
    options: ["3 פעמים", "2 פעמים", "4 פעמים", "פעם אחת"], correctIndex: 0,
    scopes: [EUROPE, country("NED")], sourceLabel: "היסטוריית נבחרות",
  },
  {
    mode: "CLASSIC", category: "NATIONAL_TEAMS", difficulty: "EXPERT",
    questionHe: "באיזה מונדיאל היחיד השתתפה אי פעם נבחרת ישראל?",
    explanationHe: "נבחרת ישראל השתתפה במונדיאל פעם אחת בלבד, ב-1970 במקסיקו.",
    options: ["מונדיאל 1970", "מונדיאל 1978", "מונדיאל 1986", "מונדיאל 1994"], correctIndex: 0,
    scopes: [comp("WORLD_CUP"), country("ISR")], sourceLabel: "היסטוריית נבחרת ישראל",
  },
  {
    mode: "CLASSIC", category: "NATIONAL_TEAMS", difficulty: "NORMAL",
    questionHe: "מהו הכינוי הנפוץ לנבחרת גרמניה בכדורגל?",
    explanationHe: "נבחרת גרמניה מכונה 'די מנשאפט' (Die Mannschaft), שפירושו 'הקבוצה'.",
    options: ["די מנשאפט", "לה סלסאו", "אצוררי", "לה רוחה"], correctIndex: 0,
    scopes: [EUROPE, country("GER")], sourceLabel: "היסטוריית נבחרות",
  },
  {
    mode: "CLASSIC", category: "NATIONAL_TEAMS", difficulty: "NORMAL",
    questionHe: "מהו הכינוי הנפוץ לנבחרת ברזיל בכדורגל?",
    explanationHe: "נבחרת ברזיל מכונה 'הסלסאו' (A Seleção), ולעיתים גם 'הקנריות' בשל צבע החולצה הצהוב.",
    options: ["הסלסאו", "לה טרי", "האורים והתומים", "הפומס"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, country("BRA")], sourceLabel: "היסטוריית נבחרות",
  },

  // ===================== COACHES =====================
  {
    mode: "CLASSIC", category: "COACHES", difficulty: "NORMAL",
    questionHe: "אילו שלוש קבוצות אימן פפ גווארדיולה במהלך הקריירה שלו כמאמן ראשי?",
    explanationHe: "גווארדיולה אימן את ברצלונה, באיירן מינכן ומנצ'סטר סיטי, וזכה בתארים גדולים בכל אחת מהן.",
    options: ["ברצלונה, באיירן מינכן ומנצ'סטר סיטי", "ריאל מדריד, באיירן ומנצ'סטר יונייטד", "ברצלונה, יובנטוס וצ'לסי", "אתלטיק בילבאו, באיירן וארסנל"], correctIndex: 0,
    scopes: [EUROPE], sourceLabel: "עובדות מאמנים",
  },
  {
    mode: "CLASSIC", category: "COACHES", difficulty: "NORMAL",
    questionHe: "איזה מאמן הוביל את לסטר סיטי לזכייה המפתיעה בפרמיירליג 2015-16?",
    explanationHe: "קלאודיו רניירי הוביל את לסטר סיטי לאחת ההפתעות הגדולות בהיסטוריית הספורט, זכייה באליפות אנגליה.",
    options: ["קלאודיו רניירי", "ברנדן רודג'רס", "נייג'ל פירסון", "רוברטו מרטינז"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות מאמנים",
  },
  {
    mode: "CLASSIC", category: "COACHES", difficulty: "HARD",
    questionHe: "איזה מאמן זכה בליגת האלופות שלוש פעמים ברציפות עם ריאל מדריד (2016-2018)?",
    explanationHe: "זינדין זידאן הוביל את ריאל מדריד לשלושה תארי ליגת אלופות רצופים, הישג נדיר בעידן המודרני.",
    options: ["זינדין זידאן", "רפאל בניטס", "קרלו אנצ'לוטי", "חוזה מוריניו"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ESP")], sourceLabel: "עובדות מאמנים",
  },
  {
    mode: "CLASSIC", category: "COACHES", difficulty: "HARD",
    questionHe: "איזה מאמן זכה בליגת האלופות עם שתי קבוצות שונות — מילאן וריאל מדריד — יותר מכל מאמן אחר (4 תארים)?",
    explanationHe: "קרלו אנצ'לוטי זכה בליגת האלופות ארבע פעמים: פעמיים עם מילאן ופעמיים עם ריאל מדריד (ולאחר מכן תואר חמישי ב-2024).",
    options: ["קרלו אנצ'לוטי", "אלכס פרגוסון", "בוב פייזלי", "חוזה מוריניו"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL")], sourceLabel: "עובדות מאמנים",
  },
  {
    mode: "CLASSIC", category: "COACHES", difficulty: "NORMAL",
    questionHe: "כמה שנים אימן סר אלכס פרגוסון את מנצ'סטר יונייטד (1986-2013)?",
    explanationHe: "פרגוסון אימן את מנצ'סטר יונייטד במשך כ-27 שנים, והפך למאמן המעוטר ביותר בכדורגל האנגלי.",
    options: ["כ-27 שנים", "כ-15 שנים", "כ-20 שנים", "כ-35 שנים"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות מאמנים",
  },
  {
    mode: "CLASSIC", category: "COACHES", difficulty: "NORMAL",
    questionHe: "איזה מאמן הוביל את ליברפול משנת 2015 ועד 2024, וזכה איתה בליגת האלופות ובפרמיירליג?",
    explanationHe: "יורגן קלופ אימן את ליברפול תשע שנים, וזכה בליגת האלופות 2019 ובפרמיירליג 2020.",
    options: ["יורגן קלופ", "רפאל בניטס", "ברנדן רודג'רס", "ארנה סלוט"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות מאמנים",
  },

  // ===================== PLAYERS (misc classic) =====================
  {
    mode: "CLASSIC", category: "PLAYERS", difficulty: "EASY",
    questionHe: "איזה שחקן ידוע בכינוי 'המלך פלה' וזכה בשלושה מונדיאלים עם ברזיל?",
    explanationHe: "פלה, ששמו האמיתי אדסון אריאנטס דו נסימנטו, נחשב לאחד השחקנים הגדולים בהיסטוריה.",
    options: ["פלה", "גרינקו", "זיקו", "רומאריו"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, country("BRA")], sourceLabel: "עובדות שחקנים",
  },
  {
    mode: "CLASSIC", category: "PLAYERS", difficulty: "NORMAL",
    questionHe: "מהו כינויו הנפוץ של דייגו מראדונה?",
    explanationHe: "מראדונה כונה 'אל פיבה דה אורו' (הילד הזהוב) ונחשב לאחת האגדות הגדולות בהיסטוריית הספורט.",
    options: ["אל פיבה דה אורו", "אל פנומנו", "הפיה הכחולה", "הנשר הלבן"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, country("ARG")], sourceLabel: "עובדות שחקנים",
  },
  {
    mode: "CLASSIC", category: "PLAYERS", difficulty: "EASY",
    questionHe: "מי כבש את שער הניצחון של ספרד בגמר מונדיאל 2010 מול הולנד?",
    explanationHe: "אנדרס איניאסטה כבש בדקות הסיום של ההארכה, והעניק לספרד את המונדיאל הראשון בתולדותיה.",
    options: ["אנדרס איניאסטה", "דיוויד וייה", "צ'אבי הרננדס", "פרננדו טורס"], correctIndex: 0,
    scopes: [EUROPE, comp("WORLD_CUP"), country("ESP")], sourceLabel: "עובדות שחקנים",
  },
  {
    mode: "CLASSIC", category: "PLAYERS", difficulty: "HARD",
    questionHe: "על שם מי נקראת בעיטת הפנדל המכונה 'פאנצ'קה', שבה כדור מוגלש במרכז השער?",
    explanationHe: "הבעיטה נקראת על שמו של אנטונין פאנצ'קה, שביצע אותה בגמר יורו 1976 עבור צ'כוסלובקיה.",
    options: ["אנטונין פאנצ'קה", "זינדין זידאן", "פרנצ' פוסקאש", "מישל פלטיני"], correctIndex: 0,
    scopes: [EUROPE, comp("EURO")], sourceLabel: "עובדות שחקנים",
  },
  {
    mode: "CLASSIC", category: "PLAYERS", difficulty: "NORMAL",
    questionHe: "איזה שחקן כבש שלושער (הט-טריק) בגמר מונדיאל 2022 ועדיין הפסיד בגמר?",
    explanationHe: "קיליאן אמבפה כבש שלושער בגמר 2022, אך צרפת הפסידה לארגנטינה בפנדלים.",
    options: ["קיליאן אמבפה", "ליאו מסי", "אנטואן גריזמן", "אוסמאן דמבלה"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("FRA")], sourceLabel: "עובדות שחקנים",
  },
  {
    mode: "CLASSIC", category: "PLAYERS", difficulty: "EXPERT",
    questionHe: "איזה שחקן כבש את שני השערים של מנצ'סטר יונייטד בדקות הסיום של גמר ליגת האלופות 1999 מול באיירן מינכן?",
    explanationHe: "טדי שרינגהאם השווה ואולה גונאר סולשייר כבש את שער הניצחון בתוספת הזמן, והשלים את ה'טרפל' ההיסטורי של יונייטד.",
    options: ["טדי שרינגהאם ואולה גונאר סולשייר", "רויקי גיגס ופול סקולס", "אנדי קול ודווייט יורק", "דיוויד בקהאם ורוי קין"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ENG")], sourceLabel: "עובדות שחקנים",
  },

  // ===================== CLUB CONNECTION =====================
  {
    mode: "CLUB_CONNECTION", category: "TRANSFERS", difficulty: "NORMAL",
    questionHe: "איזה שחקן שיחק גם בברצלונה וגם בפריז סן ז'רמן?",
    explanationHe: "ניימאר שיחק בברצלונה בין 2013-2017 ולאחר מכן עבר לפריז סן ז'רמן בהעברה שיא עולמי.",
    options: ["ניימאר", "אנטואן גריזמן", "לואיס סוארס", "עוסמאן דמבלה"], correctIndex: 0,
    scopes: [EUROPE, country("ESP"), country("FRA")], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLUB_CONNECTION", category: "TRANSFERS", difficulty: "NORMAL",
    questionHe: "איזה שחקן שיחק גם בריאל מדריד וגם ביובנטוס?",
    explanationHe: "כריסטיאנו רונאלדו שיחק בריאל מדריד 2009-2018 ולאחר מכן עבר ליובנטוס 2018-2021.",
    options: ["כריסטיאנו רונאלדו", "קאקה", "אנחל די מריה", "פאולו דיבאלה"], correctIndex: 0,
    scopes: [EUROPE, country("ESP"), country("ITA")], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLUB_CONNECTION", category: "TRANSFERS", difficulty: "HARD",
    questionHe: "איזה שוער שיחק גם בצ'לסי וגם בריאל מדריד?",
    explanationHe: "טיבו קורטואה שיחק בצ'לסי 2014-2018 (לאחר השאלה באתלטיקו) ולאחר מכן עבר לריאל מדריד ב-2018.",
    options: ["טיבו קורטואה", "פטר צ'ך", "קפא ארריזבלגה", "אדוארד מנדי"], correctIndex: 0,
    scopes: [EUROPE, country("ENG"), country("ESP")], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLUB_CONNECTION", category: "TRANSFERS", difficulty: "HARD",
    questionHe: "איזה שחקן ברזילאי שיחק גם בפריז סן ז'רמן, גם בברצלונה וגם במילאן?",
    explanationHe: "רונאלדיניו שיחק בפריז סן ז'רמן (2001-2003), ברצלונה (2003-2008) ומילאן (2008-2011).",
    options: ["רונאלדיניו", "קאקה", "רוברטו קרלוס", "ריבאלדו"], correctIndex: 0,
    scopes: [EUROPE, SOUTH_AMERICA], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLUB_CONNECTION", category: "TRANSFERS", difficulty: "NORMAL",
    questionHe: "איזה שחקן שיחק גם בליברפול וגם בברצלונה?",
    explanationHe: "לואיס סוארס שיחק בליברפול 2011-2014 ולאחר מכן עבר לברצלונה 2014-2020, שם היה חלק מ'הטרio המערכתי' עם מסי ונימאר.",
    options: ["לואיס סוארס", "פיליפה קוטיניו", "פרננדו טורס", "מייקל אוון"], correctIndex: 0,
    scopes: [EUROPE, country("ENG"), country("ESP")], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLUB_CONNECTION", category: "TRANSFERS", difficulty: "EXPERT",
    questionHe: "איזה מגן שיחק גם באקדמיית מנצ'סטר יונייטד וגם בברצלונה, שם הפך לאגדה?",
    explanationHe: "ג'רארד פיקה שיחק במנצ'סטר יונייטד 2004-2008 (כולל הופעות בקבוצה הבוגרת) ולאחר מכן חזר לברצלונה, מועדון ילדותו, ושיחק שם עד 2022.",
    options: ["ג'רארד פיקה", "מרק-אנדרה טר שטגן", "ז'ורדי אלבה", "סרחיו בוסקטס"], correctIndex: 0,
    scopes: [EUROPE, country("ENG"), country("ESP")], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLUB_CONNECTION", category: "TRANSFERS", difficulty: "NORMAL",
    questionHe: "איזה שחקן ברזילאי, המכונה 'הפנומנו', שיחק גם באינטר מילאנו וגם במילאן היריבה?",
    explanationHe: "רונאלדו הברזילאי שיחק באינטר מילאנו 1997-2002, ולאחר תקופה בריאל מדריד, סיים את הקריירה שלו באיטליה דווקא במילאן היריבה (2007-2008).",
    options: ["רונאלדו (הפנומנו)", "אדריאנו", "רונאלדיניו", "פאביו קנאבארו"], correctIndex: 0,
    scopes: [EUROPE, country("ITA")], sourceLabel: "היסטוריית העברות",
  },
  {
    mode: "CLUB_CONNECTION", category: "TRANSFERS", difficulty: "NORMAL",
    questionHe: "איזה חלוץ פולני שיחק גם בבאיירן מינכן וגם בברצלונה?",
    explanationHe: "רוברט לבנדובסקי שיחק בבאיירן מינכן 2014-2022 ולאחר מכן עבר לברצלונה ב-2022.",
    options: ["רוברט לבנדובסקי", "ארקדיוש מילק", "קשיישטוף פיונטק", "יאקוב בלשצ'יקובסקי"], correctIndex: 0,
    scopes: [EUROPE, country("GER"), country("ESP")], sourceLabel: "היסטוריית העברות",
  },

  // ===================== WHO AM I =====================
  {
    mode: "WHO_AM_I", category: "WHO_AM_I", difficulty: "NORMAL",
    questionHe: "מי אני?",
    explanationHe: "מדובר בזלאטן איברהימוביץ', חלוץ שוודי שסחף כמעט את כל המועדונים הגדולים באירופה.",
    clues: ["שיחקתי באיאקס", "שיחקתי ביובנטוס", "שיחקתי בברצלונה", "שיחקתי במילאן", "שיחקתי בפריז סן ז'רמן"],
    options: ["זלאטן איברהימוביץ'", "רוד ואן ניסטלרוי", "אדין דז'קו", "פרננדו טורס"], correctIndex: 0,
    scopes: [EUROPE], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "WHO_AM_I", category: "WHO_AM_I", difficulty: "EASY",
    questionHe: "מי אני?",
    explanationHe: "מדובר בכריסטיאנו רונאלדו, שחקן פורטוגזי שזכה בכדורגל הזהב חמש פעמים.",
    clues: ["נולדתי במדיירה, פורטוגל", "התחלתי את הקריירה שלי בספורטינג ליסבון", "זכיתי בכדורגל הזהב חמש פעמים", "שיחקתי בריאל מדריד ובמנצ'סטר יונייטד"],
    options: ["כריסטיאנו רונאלדו", "לואיס פיגו", "פפה", "ננו"], correctIndex: 0,
    scopes: [EUROPE, country("POR")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "WHO_AM_I", category: "WHO_AM_I", difficulty: "EASY",
    questionHe: "מי אני?",
    explanationHe: "מדובר בליאו מסי, שחקן ארגנטינאי שזכה בכדורגל הזהב פעמים רבות יותר מכל שחקן אחר.",
    clues: ["נולדתי ברוסאריו, ארגנטינה", "עברתי לברצלונה כשהייתי ילד", "זכיתי במונדיאל 2022 עם ארגנטינה", "זכיתי בכדורגל הזהב שמונה פעמים"],
    options: ["ליאו מסי", "סרחיו אגואירו", "אנחל די מריה", "פאולו דיבאלה"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, country("ARG")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "WHO_AM_I", category: "WHO_AM_I", difficulty: "HARD",
    questionHe: "מי אני?",
    explanationHe: "מדובר בדייגו מראדונה, שכבש את 'יד האלוהים' ו'שער המאה' באותו משחק במונדיאל 1986.",
    clues: ["נולדתי בארגנטינה בשכונה ענייה", "כבשתי שני שערים מפורסמים באותו משחק במונדיאל 1986", "שיחקתי בנאפולי ועזרתי לה לזכות באליפות איטליה", "כונתי 'אל פיבה דה אורו'"],
    options: ["דייגו מראדונה", "מריו קמפוס", "גבריאל באטיסטוטה", "חואן רומן ריקלמה"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, country("ARG")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "WHO_AM_I", category: "WHO_AM_I", difficulty: "NORMAL",
    questionHe: "מי אני?",
    explanationHe: "מדובר בפלה, שזכה בשלושה מונדיאלים ונחשב לאחת האגדות הגדולות בהיסטוריה.",
    clues: ["שמי האמיתי הוא אדסון אריאנטס דו נסימנטו", "זכיתי בשלושה מונדיאלים עם ברזיל", "שיחקתי כמעט את כל הקריירה שלי בסנטוס", "כונו אותי 'המלך'"],
    options: ["פלה", "גרינקו", "רומאריו", "זיקו"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, country("BRA")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "WHO_AM_I", category: "WHO_AM_I", difficulty: "NORMAL",
    questionHe: "מי אני?",
    explanationHe: "מדובר בניימאר, כוכב ברזילאי שעבר בהעברת שיא עולמי מברצלונה לפריז סן ז'רמן.",
    clues: ["נולדתי בברזיל", "שיחקתי בסנטוס לפני שעברתי לאירופה", "שיחקתי בברצלונה ולאחר מכן בפריז סן ז'רמן", "העברה שלי ב-2017 שברה שיא עולמי"],
    options: ["ניימאר", "פיליפה קוטיניו", "וויניציוס ז'וניור", "רודריגו"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, EUROPE, country("BRA")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "WHO_AM_I", category: "WHO_AM_I", difficulty: "HARD",
    questionHe: "מי אני?",
    explanationHe: "מדובר בלוקה מודריץ', קפטן נבחרת קרואטיה שזכה בכדורגל הזהב ב-2018.",
    clues: ["נולדתי בקרואטיה בתקופת מלחמה", "שיחקתי בטוטנהאם לפני שעברתי לריאל מדריד", "זכיתי בכדורגל הזהב ב-2018", "הובלתי את נבחרת קרואטיה לגמר המונדיאל 2018"],
    options: ["לוקה מודריץ'", "איבן ראקיטיץ'", "מריו מנג'וקיץ'", "איבן פריסיץ'"], correctIndex: 0,
    scopes: [EUROPE], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "WHO_AM_I", category: "WHO_AM_I", difficulty: "NORMAL",
    questionHe: "מי אני?",
    explanationHe: "מדובר בקיליאן אמבפה, כוכב צרפתי שכבש שלושער בגמר מונדיאל 2022.",
    clues: ["נולדתי בצרפת ליד פריז", "התחלתי את הקריירה שלי במונקו", "כבשתי שלושער בגמר מונדיאל 2022", "עברתי מפריז סן ז'רמן לריאל מדריד ב-2024"],
    options: ["קיליאן אמבפה", "אנטואן גריזמן", "אוסמאן דמבלה", "ראפאל ורן"], correctIndex: 0,
    scopes: [EUROPE, country("FRA")], sourceLabel: "קריירת שחקן",
  },

  // ===================== CAREER PATH =====================
  {
    mode: "CAREER_PATH", category: "CAREER_PATH", difficulty: "NORMAL",
    questionHe: "של מי מסלול הקריירה הזה?",
    explanationHe: "זהו מסלול הקריירה של כריסטיאנו רונאלדו — מספורטינג ליסבון ועד אל נאסר הסעודית, דרך שתי תקופות במנצ'סטר יונייטד.",
    clues: ["ספורטינג ליסבון", "מנצ'סטר יונייטד", "ריאל מדריד", "יובנטוס", "מנצ'סטר יונייטד", "אל נאסר"],
    options: ["כריסטיאנו רונאלדו", "וויין רוני", "קרים בנזמה", "אנחל די מריה"], correctIndex: 0,
    scopes: [EUROPE, country("POR")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "CAREER_PATH", category: "CAREER_PATH", difficulty: "HARD",
    questionHe: "של מי מסלול הקריירה הזה?",
    explanationHe: "זהו מסלול הקריירה של לואיס סוארס — מנסיונל אורוגוואי ועד אתלטיקו מדריד, דרך ברצלונה וליברפול.",
    clues: ["נסיונל (אורוגוואי)", "כרונינגן", "אייאקס", "ליברפול", "ברצלונה", "אתלטיקו מדריד"],
    options: ["לואיס סוארס", "אדינסון קוואני", "דייגו פורלאן", "דארווין נונייז"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, EUROPE], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "CAREER_PATH", category: "CAREER_PATH", difficulty: "EXPERT",
    questionHe: "של מי מסלול הקריירה הזה?",
    explanationHe: "זהו מסלול הקריירה של זלאטן איברהימוביץ' — ממאלמה השוודית ועד לוס אנג'לס גלאקסי, דרך כמעט כל מועדון גדול באירופה.",
    clues: ["מאלמה", "אייאקס", "יובנטוס", "אינטר מילאנו", "ברצלונה", "מילאן", "פריז סן ז'רמן", "מנצ'סטר יונייטד", "לוס אנג'לס גלאקסי"],
    options: ["זלאטן איברהימוביץ'", "אדין דז'קו", "רוד ואן ניסטלרוי", "מריו באלוטלי"], correctIndex: 0,
    scopes: [EUROPE], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "CAREER_PATH", category: "CAREER_PATH", difficulty: "NORMAL",
    questionHe: "של מי מסלול הקריירה הזה?",
    explanationHe: "זהו מסלול הקריירה של ניימאר — מסנטוס ועד אל הילאל הסעודית, דרך ברצלונה ופריז סן ז'רמן.",
    clues: ["סנטוס", "ברצלונה", "פריז סן ז'רמן", "אל הילאל"],
    options: ["ניימאר", "רונאלדיניו", "רוברינייו", "הוליק"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, EUROPE], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "CAREER_PATH", category: "CAREER_PATH", difficulty: "HARD",
    questionHe: "של מי מסלול הקריירה הזה?",
    explanationHe: "זהו מסלול הקריירה של רוברט לבנדובסקי — מלך פוזנן הפולנית ועד ברצלונה, דרך דורטמונד ובאיירן מינכן.",
    clues: ["לך פוזנן", "בורוסיה דורטמונד", "באיירן מינכן", "ברצלונה"],
    options: ["רוברט לבנדובסקי", "יאקוב בלשצ'יקובסקי", "ארקדיוש מילק", "קשיישטוף פיונטק"], correctIndex: 0,
    scopes: [EUROPE], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "CAREER_PATH", category: "CAREER_PATH", difficulty: "EXPERT",
    questionHe: "של מי מסלול הקריירה הזה?",
    explanationHe: "זהו מסלול הקריירה של תיירי אנרי — ממונקו ועד ניו יורק רד בולס, דרך יובנטוס, ארסנל וברצלונה.",
    clues: ["מונקו", "יובנטוס", "ארסנל", "ברצלונה", "ניו יורק רד בולס"],
    options: ["תיירי אנרי", "ניקולא אנלקה", "דייוויד טרזגה", "לואי סחא"], correctIndex: 0,
    scopes: [EUROPE, country("FRA")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "CAREER_PATH", category: "CAREER_PATH", difficulty: "NORMAL",
    questionHe: "של מי מסלול הקריירה הזה?",
    explanationHe: "זהו מסלול הקריירה של דיוויד בקהאם — ממנצ'סטר יונייטד ועד פריז סן ז'רמן, דרך ריאל מדריד ולוס אנג'לס גלאקסי.",
    clues: ["מנצ'סטר יונייטד", "ריאל מדריד", "לוס אנג'לס גלאקסי", "מילאן (השאלה)", "פריז סן ז'רמן"],
    options: ["דיוויד בקהאם", "מייקל אוון", "סטיבן ג'רארד", "פרנק למפארד"], correctIndex: 0,
    scopes: [EUROPE, country("ENG")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "CAREER_PATH", category: "CAREER_PATH", difficulty: "HARD",
    questionHe: "של מי מסלול הקריירה הזה?",
    explanationHe: "זהו מסלול הקריירה של רונאלדיניו — מגרמיו הברזילאית ועד פלמנגו, דרך פריז סן ז'רמן, ברצלונה ומילאן.",
    clues: ["גרמיו", "פריז סן ז'רמן", "ברצלונה", "מילאן", "פלמנגו"],
    options: ["רונאלדיניו", "קאקה", "רוביניו", "אדריאנו"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, EUROPE], sourceLabel: "קריירת שחקן",
  },

  // ===================== GUESS THE CLUB =====================
  {
    mode: "GUESS_THE_CLUB", category: "GUESS_THE_CLUB", difficulty: "EASY",
    questionHe: "איזו קבוצה זו: מכונה 'השדים האדומים', משחקת באולד טראפורד, ונחשבת לאחת הקבוצות המצליחות באנגליה?",
    explanationHe: "זוהי מנצ'סטר יונייטד — קבוצה מאנגליה שמשחקת באולד טראפורד המכונה 'תיאטרון החלומות'.",
    options: ["מנצ'סטר יונייטד", "ליברפול", "ארסנל", "צ'לסי"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "GUESS_THE_CLUB", category: "GUESS_THE_CLUB", difficulty: "EASY",
    questionHe: "איזו קבוצה זו: מכונה 'הבלאוגרנה', משחקת בקאמפ נואו, וזכתה בליגת האלופות פעמים רבות?",
    explanationHe: "זוהי ברצלונה — הקבוצה הקטלאנית המפורסמת, בעלת אחת האקדמיות הטובות בעולם (לה מסיה).",
    options: ["ברצלונה", "אתלטיקו מדריד", "סביליה", "ולנסיה"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "GUESS_THE_CLUB", category: "GUESS_THE_CLUB", difficulty: "NORMAL",
    questionHe: "איזו קבוצה זו: מכונה 'הלבנים', משחקת בסנטיאגו ברנבאו, וזכתה בליגת האלופות יותר מכל קבוצה אחרת?",
    explanationHe: "זוהי ריאל מדריד — הקבוצה המצליחה ביותר בהיסטוריית ליגת האלופות עם 15 תארים.",
    options: ["ריאל מדריד", "אתלטיקו מדריד", "ריאל בטיס", "אספניול"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "GUESS_THE_CLUB", category: "GUESS_THE_CLUB", difficulty: "NORMAL",
    questionHe: "איזו קבוצה זו: מכונה 'התותחנים', משחקת באצטדיון האמירויות בצפון לונדון?",
    explanationHe: "זוהי ארסנל — קבוצה מלונדון עם היסטוריה עשירה בפרמיירליג, כולל עונה שלמה ללא הפסד ב-2003-04.",
    options: ["ארסנל", "טוטנהאם", "צ'לסי", "וסטהאם"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "GUESS_THE_CLUB", category: "GUESS_THE_CLUB", difficulty: "NORMAL",
    questionHe: "איזו קבוצה זו: משחקת בסן סירו יחד עם יריבתה העירונית, צבעיה אדום-שחור, וכונה 'הרוסונרי'?",
    explanationHe: "זהו מילאן (AC Milan) — הצבעים האדום-שחור נותנים לה את הכינוי 'רוסונרי'.",
    options: ["מילאן", "אינטר מילאנו", "יובנטוס", "נאפולי"], correctIndex: 0,
    scopes: [EUROPE, comp("SERIE_A"), country("ITA")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "GUESS_THE_CLUB", category: "GUESS_THE_CLUB", difficulty: "NORMAL",
    questionHe: "איזו קבוצה זו: מכונה 'האזרחים', משחקת באיתיהאד סטדיום, ונשלטת על ידי קבוצת השקעות מאבו דאבי מאז 2008?",
    explanationHe: "זוהי מנצ'סטר סיטי — קבוצה שהפכה לכוח דומיננטי בכדורגל האנגלי והעולמי מאז רכישתה ב-2008.",
    options: ["מנצ'סטר סיטי", "מנצ'סטר יונייטד", "ניוקאסל יונייטד", "אברטון"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "GUESS_THE_CLUB", category: "GUESS_THE_CLUB", difficulty: "HARD",
    questionHe: "איזו קבוצה זו: אוהדיה מפורסמים ב'קיר הצהוב' שלהם, וצבעיה צהוב-שחור?",
    explanationHe: "זוהי בורוסיה דורטמונד — היציע הדרומי שלה, 'הקיר הצהוב', הוא יציע העמידה הגדול באירופה.",
    options: ["בורוסיה דורטמונד", "באיירן מינכן", "שאלקה 04", "באייר לברקוזן"], correctIndex: 0,
    scopes: [EUROPE, comp("BUNDESLIGA"), country("GER")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "GUESS_THE_CLUB", category: "GUESS_THE_CLUB", difficulty: "EASY",
    questionHe: "איזו קבוצה זו: הקבוצה המצליחה ביותר בגרמניה, משחקת באליאנץ ארנה?",
    explanationHe: "זוהי באיירן מינכן — הקבוצה הדומיננטית ביותר בכדורגל הגרמני.",
    options: ["באיירן מינכן", "בורוסיה דורטמונד", "לייפציג", "איינטרכט פרנקפורט"], correctIndex: 0,
    scopes: [EUROPE, comp("BUNDESLIGA"), country("GER")], sourceLabel: "עובדות מועדונים",
  },

  // ===================== DEEP HISTORY (EXPERT / IMPOSSIBLE) =====================
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "EXPERT",
    questionHe: "איזו קבוצה זכתה בגביע אלופות אירופה הראשון בהיסטוריה, ב-1956?",
    explanationHe: "ריאל מדריד זכתה בגביע האלופות הראשון ב-1956, והמשיכה לזכות בחמשת הראשונים ברציפות עד 1960.",
    options: ["ריאל מדריד", "בנפיקה", "מילאן", "אינטר מילאנו"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ESP")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "EXPERT",
    questionHe: "איזו קבוצה הולנדית זכתה בשלושה גביעי אלופות רצופים בין 1971 ל-1973?",
    explanationHe: "אייאקס אמסטרדם, בהובלת יוהאן קרויף ותפיסת 'הכדורגל הטוטאלי', זכתה בשלושה תארים רצופים.",
    options: ["אייאקס", "פיינורד", "PSV איינדהובן", "AZ אלקמאר"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), comp("EREDIVISIE"), country("NED")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "PLAYERS", difficulty: "IMPOSSIBLE",
    questionHe: "מי השוער היחיד בהיסטוריה שזכה בכדורגל הזהב?",
    explanationHe: "לב יאשין, השוער הסובייטי המכונה 'העכביש השחור', זכה בכדורגל הזהב ב-1963 — היחיד בתפקידו שהשיג זאת.",
    options: ["לב יאשין", "דינו זוף", "ג'אנלואיג'י בופון", "אוליבר קאהן"], correctIndex: 0,
    scopes: [EUROPE], sourceLabel: "היסטוריית כדורגל הזהב",
  },
  {
    mode: "CLASSIC", category: "PLAYERS", difficulty: "IMPOSSIBLE",
    questionHe: "מי היה הזוכה הראשון בכדורגל הזהב, ב-1956?",
    explanationHe: "סטנלי מת'יוס האנגלי היה הזוכה הראשון בפרס כדורגל הזהב, בגיל 41.",
    options: ["סטנלי מת'יוס", "אלפרדו די סטפנו", "פרנץ פושקאש", "ריימון קופה"], correctIndex: 0,
    scopes: [EUROPE, country("ENG")], sourceLabel: "היסטוריית כדורגל הזהב",
  },
  {
    mode: "CLASSIC", category: "NATIONAL_TEAMS", difficulty: "IMPOSSIBLE",
    questionHe: "איזו נבחרת זכתה באליפות אירופה הראשונה, ב-1960?",
    explanationHe: "ברית המועצות זכתה ביורו הראשון ב-1960, עם לב יאשין בשער, לאחר ניצחון על יוגוסלביה בגמר.",
    options: ["ברית המועצות", "יוגוסלביה", "ספרד", "צ'כוסלובקיה"], correctIndex: 0,
    scopes: [EUROPE, comp("EURO")], sourceLabel: "היסטוריית היורו",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "NORMAL",
    questionHe: "מה היתה התוצאה במשחק חצי הגמר בין גרמניה לברזיל במונדיאל 2014?",
    explanationHe: "גרמניה ניצחה 1:7 בבלו הוריזונטה — תבוסה היסטורית לברזיל המארחת שכונתה 'המינראסו'.",
    options: ["1:7 לגרמניה", "0:4 לגרמניה", "2:5 לגרמניה", "1:3 לגרמניה"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP"), country("BRA"), country("GER")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "EXPERT",
    questionHe: "מהו ה'מאראקאנאסו' של 1950?",
    explanationHe: "אורוגוואי ניצחה את ברזיל המארחת 1:2 במשחק המכריע באצטדיון המאראקנה, מול קהל עצום, וזכתה במונדיאל.",
    options: [
      "ניצחון אורוגוואי על ברזיל במשחק המכריע במאראקנה",
      "ניצחון ברזיל על אורוגוואי בגמר",
      "ביטול המונדיאל בשל מזג אוויר",
      "פלישת אוהדים למגרש בגמר",
    ], correctIndex: 0,
    scopes: [SOUTH_AMERICA, comp("WORLD_CUP"), country("BRA")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "IMPOSSIBLE",
    questionHe: "מי כבש את השער המהיר ביותר בהיסטוריית המונדיאל, לאחר 11 שניות בלבד?",
    explanationHe: "האקאן שוקור מטורקיה כבש אחרי 11 שניות במשחק על המקום השלישי במונדיאל 2002 מול דרום קוריאה.",
    options: ["האקאן שוקור", "קלאודיו קניחה", "ברייאן רובסון", "ואצלב מאשק"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "EXPERT",
    questionHe: "איזו נבחרת אפריקאית היתה הראשונה שהעפילה לרבע גמר מונדיאל?",
    explanationHe: "קמרון הגיעה לרבע הגמר במונדיאל 1990, בהובלת רוז'ה מילה, והפסידה לאנגליה בהארכה.",
    options: ["קמרון", "ניגריה", "גאנה", "סנגל"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "EXPERT",
    questionHe: "מי כבש שלושער בגמר המונדיאל של 1966?",
    explanationHe: "ג'ף הרסט כבש שלושער בניצחון אנגליה 2:4 על מערב גרמניה בגמר בוומבלי — השלושער היחיד אי פעם בגמר מונדיאל.",
    options: ["ג'ף הרסט", "בובי צ'ארלטון", "מרטין פיטרס", "רוג'ר האנט"], correctIndex: 0,
    scopes: [EUROPE, comp("WORLD_CUP"), country("ENG")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "COACHES", difficulty: "EXPERT",
    questionHe: "איזה מאמן הולנדי נחשב לאבי תפיסת 'הכדורגל הטוטאלי'?",
    explanationHe: "רינוס מיכלס פיתח את הכדורגל הטוטאלי באייאקס ובנבחרת הולנד של שנות ה-70.",
    options: ["רינוס מיכלס", "לואי ואן חאל", "גוס היטינק", "דיק אדבוקאט"], correctIndex: 0,
    scopes: [EUROPE, country("NED")], sourceLabel: "עובדות מאמנים",
  },
  {
    mode: "CLASSIC", category: "TITLES", difficulty: "HARD",
    questionHe: "איזו קבוצה סיימה את עונת 2003-04 בפרמיירליג ללא הפסד וכונתה 'האל-מנוצחים'?",
    explanationHe: "ארסנל בהנהגת ארסן ונגר סיימה את העונה ללא הפסד — הישג יחיד במינו בעידן הפרמיירליג.",
    options: ["ארסנל", "מנצ'סטר יונייטד", "צ'לסי", "ליברפול"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "היסטוריית הפרמיירליג",
  },
  {
    mode: "CLASSIC", category: "TITLES", difficulty: "HARD",
    questionHe: "איזו קבוצה גרמנית זכתה בטרפל ב-2013 (ליגה, גביע וליגת האלופות)?",
    explanationHe: "באיירן מינכן, בהובלת המאמן יופ הייקנס, זכתה בשלושת התארים בעונת 2012-13.",
    options: ["באיירן מינכן", "בורוסיה דורטמונד", "שאלקה 04", "וולפסבורג"], correctIndex: 0,
    scopes: [EUROPE, comp("BUNDESLIGA"), comp("UCL"), country("GER")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "TITLES", difficulty: "IMPOSSIBLE",
    questionHe: "איזו קבוצה זכתה בעונת הבונדסליגה הראשונה, ב-1963-64?",
    explanationHe: "קלן (1. FC Köln) זכתה באליפות בעונה הראשונה של הבונדסליגה המאוחדת.",
    options: ["קלן", "באיירן מינכן", "בורוסיה מנשנגלדבך", "המבורג"], correctIndex: 0,
    scopes: [EUROPE, comp("BUNDESLIGA"), country("GER")], sourceLabel: "היסטוריית הבונדסליגה",
  },
  {
    mode: "CLASSIC", category: "TITLES", difficulty: "IMPOSSIBLE",
    questionHe: "איזו קבוצה ארגנטינאית זכתה הכי הרבה פעמים בקופה ליברטדורס?",
    explanationHe: "אינדפנדיינטה זכתה שבע פעמים בקופה ליברטדורס, יותר מכל קבוצה אחרת ביבשת.",
    options: ["אינדפנדיינטה", "בוקה ג'וניורס", "ריבר פלייט", "פנרול"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, country("ARG")], sourceLabel: "היסטוריית קופה ליברטדורס",
  },
  {
    mode: "CLASSIC", category: "CLUBS", difficulty: "HARD",
    questionHe: "איזו קבוצה איטלקית מכונה 'הגברת הזקנה' (La Vecchia Signora)?",
    explanationHe: "יובנטוס מכונה 'הגברת הזקנה', כינוי שדבק בה עוד מתחילת המאה ה-20.",
    options: ["יובנטוס", "מילאן", "רומא", "לאציו"], correctIndex: 0,
    scopes: [EUROPE, comp("SERIE_A"), country("ITA")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "CLUBS", difficulty: "NORMAL",
    questionHe: "מה שמה של אקדמיית הנוער המפורסמת של ברצלונה?",
    explanationHe: "'לה מסיה' היא אקדמיית הנוער של ברצלונה, שממנה יצאו מסי, צ'אבי, איניאסטה ופוייול.",
    options: ["לה מסיה", "לה פבריקה", "קנטרה", "לה קסה"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "TITLES", difficulty: "HARD",
    questionHe: "איזו קבוצה זכתה הכי הרבה פעמים באליפות הולנד (אירדיוויזי)?",
    explanationHe: "אייאקס אמסטרדם היא הקבוצה המעוטרת ביותר בהיסטוריית האירדיוויזי.",
    options: ["אייאקס", "PSV איינדהובן", "פיינורד", "AZ אלקמאר"], correctIndex: 0,
    scopes: [EUROPE, comp("EREDIVISIE"), country("NED")], sourceLabel: "עובדות מועדונים",
  },
  {
    mode: "CLASSIC", category: "STATS", difficulty: "IMPOSSIBLE",
    questionHe: "מה היו היחסים שהוצעו בתחילת העונה לזכיית לסטר סיטי באליפות הפרמיירליג 2015-16?",
    explanationHe: "הסיכויים שהוצעו היו 5000-1 — אחת ההפתעות הגדולות בתולדות הספורט המקצועני.",
    options: ["5000-1", "500-1", "100-1", "50000-1"], correctIndex: 0,
    scopes: [EUROPE, comp("PREMIER_LEAGUE"), country("ENG")], sourceLabel: "היסטוריית הפרמיירליג",
  },
  {
    mode: "CLASSIC", category: "PLAYERS", difficulty: "EXPERT",
    questionHe: "מי זכה בכדור הזהב (השחקן המצטיין) של מונדיאל 2018?",
    explanationHe: "לוקה מודריץ' נבחר לשחקן המצטיין של מונדיאל 2018, לאחר שהוביל את קרואטיה לגמר.",
    options: ["לוקה מודריץ'", "קיליאן אמבפה", "אדן אזאר", "אנטואן גריזמן"], correctIndex: 0,
    scopes: [EUROPE, comp("WORLD_CUP")], sourceLabel: "היסטוריית המונדיאל",
  },
  {
    mode: "CLASSIC", category: "CHAMPIONS_LEAGUE", difficulty: "IMPOSSIBLE",
    questionHe: "איזה שחקן זכה בשישה גביעי אלופות עם ריאל מדריד בשנות ה-50 וה-60?",
    explanationHe: "פרנסיסקו חנטו זכה בשישה גביעי אלופות עם ריאל מדריד, שיא לשחקן יחיד באותה תקופה.",
    options: ["פרנסיסקו חנטו", "אלפרדו די סטפנו", "פרנץ פושקאש", "ריימון קופה"], correctIndex: 0,
    scopes: [EUROPE, comp("UCL"), country("ESP")], sourceLabel: "היסטוריית ליגת האלופות",
  },
  {
    mode: "CLASSIC", category: "CAREERS", difficulty: "NORMAL",
    questionHe: "באיזו קבוצה ספרדית שיחק יוהאן קרויף?",
    explanationHe: "קרויף עבר מאייאקס לברצלונה ב-1973, ולימים גם אימן אותה והניח את יסודות הסגנון שלה.",
    options: ["ברצלונה", "ריאל מדריד", "ולנסיה", "אתלטיקו מדריד"], correctIndex: 0,
    scopes: [EUROPE, comp("LA_LIGA"), country("ESP"), country("NED")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "CLASSIC", category: "WORLD_CUP", difficulty: "EXPERT",
    questionHe: "איזו מדינה הפכה לראשונה שאירחה משחקי מונדיאל בשלוש מהדורות שונות?",
    explanationHe: "מקסיקו אירחה את מונדיאל 1970 ו-1986, ואירחה משחקים גם במונדיאל 2026 המשותף.",
    options: ["מקסיקו", "איטליה", "ברזיל", "גרמניה"], correctIndex: 0,
    scopes: [WORLD, comp("WORLD_CUP")], sourceLabel: "היסטוריית המונדיאל",
  },

  // ===================== ISRAELI FOOTBALL =====================
  {
    mode: "CLASSIC", category: "CLUBS", difficulty: "EXPERT",
    questionHe: "איזו קבוצה ישראלית היתה הראשונה להעפיל לשלב הבתים של ליגת האלופות?",
    explanationHe: "מכבי חיפה העפילה לשלב הבתים של ליגת האלופות בעונת 2002-03, הישג ישראלי ראשון מסוגו.",
    options: ["מכבי חיפה", "מכבי תל אביב", "הפועל תל אביב", "בית\"ר ירושלים"], correctIndex: 0,
    scopes: [comp("ISRAELI_PREMIER_LEAGUE"), comp("UCL"), country("ISR")], sourceLabel: "היסטוריית הכדורגל הישראלי",
  },
  {
    mode: "CLASSIC", category: "CAREERS", difficulty: "HARD",
    questionHe: "איזה שחקן ישראלי שיחק גם בליברפול וגם בצ'לסי?",
    explanationHe: "יוסי בניון שיחק בווסטהאם, ליברפול, צ'לסי וארסנל — הקריירה האנגלית המפוארת ביותר של ישראלי.",
    options: ["יוסי בניון", "אייל ברקוביץ'", "תאל בן חיים", "דודו דהן"], correctIndex: 0,
    scopes: [comp("PREMIER_LEAGUE"), country("ISR"), country("ENG")], sourceLabel: "היסטוריית הכדורגל הישראלי",
  },

  // ===================== ADDITIONAL CLUE-BASED QUESTIONS =====================
  {
    mode: "WHO_AM_I", category: "WHO_AM_I", difficulty: "EXPERT",
    questionHe: "מי אני?",
    explanationHe: "מדובר ביוהאן קרויף — שחקן ומאמן שעיצב את הכדורגל המודרני באייאקס ובברצלונה.",
    clues: [
      "נולדתי באמסטרדם",
      "שיחקתי באייאקס וזכיתי איתה בשלושה גביעי אלופות רצופים",
      "עברתי לברצלונה ב-1973",
      "לימים אימנתי את ברצלונה והנחתי את יסודות הסגנון שלה",
    ],
    options: ["יוהאן קרויף", "מארקו ואן באסטן", "רוד חוליט", "פרנק רייקארד"], correctIndex: 0,
    scopes: [EUROPE, country("NED")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "WHO_AM_I", category: "WHO_AM_I", difficulty: "HARD",
    questionHe: "מי אני?",
    explanationHe: "מדובר ברוברט לבנדובסקי — חלוץ פולני שכבש בשיעור יוצא דופן בבונדסליגה ובליגת האלופות.",
    clues: [
      "נולדתי בפולין",
      "פרצתי בבורוסיה דורטמונד",
      "עברתי ליריבה באיירן מינכן בהעברה חופשית",
      "ב-2022 עברתי לברצלונה",
    ],
    options: ["רוברט לבנדובסקי", "מירוסלב קלוזה", "ארקדיוש מילק", "זלאטן איברהימוביץ'"], correctIndex: 0,
    scopes: [EUROPE, comp("BUNDESLIGA")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "CAREER_PATH", category: "CAREER_PATH", difficulty: "EXPERT",
    questionHe: "של מי מסלול הקריירה הזה?",
    explanationHe: "זהו מסלול הקריירה של קאקה — מסאו פאולו ועד אורלנדו סיטי, עם שתי תקופות במילאן.",
    clues: ["סאו פאולו", "מילאן", "ריאל מדריד", "מילאן", "אורלנדו סיטי"],
    options: ["קאקה", "רונאלדיניו", "רוביניו", "אלכסנדרה פאטו"], correctIndex: 0,
    scopes: [SOUTH_AMERICA, EUROPE, country("BRA")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "CAREER_PATH", category: "CAREER_PATH", difficulty: "HARD",
    questionHe: "של מי מסלול הקריירה הזה?",
    explanationHe: "זהו מסלול הקריירה של פרננדו טורס — מאתלטיקו מדריד וחזרה אליה, דרך ליברפול וצ'לסי.",
    clues: ["אתלטיקו מדריד", "ליברפול", "צ'לסי", "מילאן (השאלה)", "אתלטיקו מדריד"],
    options: ["פרננדו טורס", "דיוויד וייה", "דייגו קוסטה", "ראול גונזלס"], correctIndex: 0,
    scopes: [EUROPE, country("ESP"), country("ENG")], sourceLabel: "קריירת שחקן",
  },
  {
    mode: "CLUB_CONNECTION", category: "TRANSFERS", difficulty: "EXPERT",
    questionHe: "איזה שחקן שיחק גם באייאקס, גם במילאן וגם באינטר מילאנו?",
    explanationHe: "זלאטן איברהימוביץ' שיחק באייאקס, ולאחר מכן גם באינטר מילאנו (2006-2009) וגם במילאן (2010-2012, ושוב 2020-2023).",
    options: ["זלאטן איברהימוביץ'", "קלארנס סיידורף", "אדגר דאוויס", "פטריק קלוויר"], correctIndex: 0,
    scopes: [EUROPE, comp("SERIE_A"), comp("EREDIVISIE")], sourceLabel: "היסטוריית העברות",
  },
];
