// Club registry — the canonical reference every generator resolves against.
//
// `he` is what the Hebrew UI shows, `aliases` are the extra forms the
// free-text matcher should accept. Club identity here is deliberately
// conservative: only clubs whose country, league and common Hebrew rendering
// are unambiguous.

export interface ClubRecord {
  id: string;
  en: string;
  he: string;
  aliases: string[];
  country: string; // country code from src/shared/constants.ts COUNTRIES, or ISO-ish code
  league: string | null; // competition code
  stadium?: string;
  stadiumHe?: string;
  founded?: number;
  nicknameHe?: string;
}

export const CLUBS: ClubRecord[] = [
  // ---------- England ----------
  { id: "man_utd", en: "Manchester United", he: "מנצ'סטר יונייטד", aliases: ["Man United", "Man Utd", "יונייטד", "מנצסטר יונייטד"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "Old Trafford", stadiumHe: "אולד טראפורד", founded: 1878, nicknameHe: "השדים האדומים" },
  { id: "man_city", en: "Manchester City", he: "מנצ'סטר סיטי", aliases: ["Man City", "City", "סיטי", "מנצסטר סיטי"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "Etihad Stadium", stadiumHe: "אצטדיון האיתיהאד", founded: 1880, nicknameHe: "האזרחים" },
  { id: "liverpool", en: "Liverpool", he: "ליברפול", aliases: ["LFC"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "Anfield", stadiumHe: "אנפילד", founded: 1892, nicknameHe: "האדומים" },
  { id: "arsenal", en: "Arsenal", he: "ארסנל", aliases: ["The Gunners"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "Emirates Stadium", stadiumHe: "אצטדיון האמירויות", founded: 1886, nicknameHe: "התותחנים" },
  { id: "chelsea", en: "Chelsea", he: "צ'לסי", aliases: ["צלסי"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "Stamford Bridge", stadiumHe: "סטמפורד ברידג'", founded: 1905, nicknameHe: "הבלוז" },
  { id: "tottenham", en: "Tottenham Hotspur", he: "טוטנהאם", aliases: ["Tottenham", "Spurs", "טוטנהם"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "Tottenham Hotspur Stadium", founded: 1882 },
  { id: "everton", en: "Everton", he: "אברטון", aliases: [], country: "ENG", league: "PREMIER_LEAGUE", stadium: "Goodison Park", founded: 1878 },
  { id: "newcastle", en: "Newcastle United", he: "ניוקאסל", aliases: ["Newcastle", "ניוקסל"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "St James' Park", founded: 1892 },
  { id: "aston_villa", en: "Aston Villa", he: "אסטון וילה", aliases: ["Villa"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "Villa Park", founded: 1874 },
  { id: "leicester", en: "Leicester City", he: "לסטר סיטי", aliases: ["Leicester", "לסטר"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "King Power Stadium", founded: 1884 },
  { id: "west_ham", en: "West Ham United", he: "ווסטהאם", aliases: ["West Ham", "וסטהאם"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "London Stadium", founded: 1895 },
  { id: "blackburn", en: "Blackburn Rovers", he: "בלקבורן", aliases: ["Blackburn"], country: "ENG", league: "PREMIER_LEAGUE", founded: 1875 },
  { id: "nottingham", en: "Nottingham Forest", he: "נוטינגהאם פורסט", aliases: ["Nottingham Forest", "נוטינגהאם"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "City Ground", founded: 1865 },
  { id: "southampton", en: "Southampton", he: "סאות'המפטון", aliases: ["סאותהמפטון"], country: "ENG", league: "PREMIER_LEAGUE", founded: 1885 },
  { id: "leeds", en: "Leeds United", he: "לידס יונייטד", aliases: ["Leeds", "לידס"], country: "ENG", league: "PREMIER_LEAGUE", stadium: "Elland Road", founded: 1919 },
  { id: "fulham", en: "Fulham", he: "פולהאם", aliases: [], country: "ENG", league: "PREMIER_LEAGUE", founded: 1879 },

  // ---------- Spain ----------
  { id: "real_madrid", en: "Real Madrid", he: "ריאל מדריד", aliases: ["Real", "ריאל", "לוס בלנקוס"], country: "ESP", league: "LA_LIGA", stadium: "Santiago Bernabéu", stadiumHe: "סנטיאגו ברנבאו", founded: 1902, nicknameHe: "הלבנים" },
  { id: "barcelona", en: "Barcelona", he: "ברצלונה", aliases: ["Barca", "Barça", "FC Barcelona", "ברסה"], country: "ESP", league: "LA_LIGA", stadium: "Camp Nou", stadiumHe: "קאמפ נואו", founded: 1899, nicknameHe: "בלאוגרנה" },
  { id: "atletico", en: "Atlético Madrid", he: "אתלטיקו מדריד", aliases: ["Atletico Madrid", "Atleti", "אתלטיקו"], country: "ESP", league: "LA_LIGA", stadium: "Metropolitano", founded: 1903 },
  { id: "valencia", en: "Valencia", he: "ולנסיה", aliases: [], country: "ESP", league: "LA_LIGA", stadium: "Mestalla", stadiumHe: "מסטאייה", founded: 1919 },
  { id: "sevilla", en: "Sevilla", he: "סביליה", aliases: [], country: "ESP", league: "LA_LIGA", stadium: "Ramón Sánchez Pizjuán", founded: 1890 },
  { id: "villarreal", en: "Villarreal", he: "ויאריאל", aliases: [], country: "ESP", league: "LA_LIGA", founded: 1923 },
  { id: "athletic", en: "Athletic Bilbao", he: "אתלטיק בילבאו", aliases: ["Athletic Club", "בילבאו"], country: "ESP", league: "LA_LIGA", stadium: "San Mamés", founded: 1898 },
  { id: "real_sociedad", en: "Real Sociedad", he: "ריאל סוסיאדד", aliases: [], country: "ESP", league: "LA_LIGA", founded: 1909 },
  { id: "deportivo", en: "Deportivo La Coruña", he: "דפורטיבו לה קורוניה", aliases: ["Deportivo", "דפורטיבו"], country: "ESP", league: "LA_LIGA", founded: 1906 },
  { id: "espanyol", en: "Espanyol", he: "אספניול", aliases: [], country: "ESP", league: "LA_LIGA", founded: 1900 },

  // ---------- Italy ----------
  { id: "juventus", en: "Juventus", he: "יובנטוס", aliases: ["Juve", "יובה"], country: "ITA", league: "SERIE_A", stadium: "Allianz Stadium", founded: 1897, nicknameHe: "הגברת הזקנה" },
  { id: "milan", en: "AC Milan", he: "מילאן", aliases: ["Milan", "רוסונרי"], country: "ITA", league: "SERIE_A", stadium: "San Siro", stadiumHe: "סן סירו", founded: 1899, nicknameHe: "הרוסונרי" },
  { id: "inter", en: "Inter Milan", he: "אינטר מילאנו", aliases: ["Inter", "Internazionale", "אינטר"], country: "ITA", league: "SERIE_A", stadium: "San Siro", stadiumHe: "סן סירו", founded: 1908, nicknameHe: "הנראצורי" },
  { id: "roma", en: "Roma", he: "רומא", aliases: ["AS Roma"], country: "ITA", league: "SERIE_A", stadium: "Stadio Olimpico", founded: 1927 },
  { id: "napoli", en: "Napoli", he: "נאפולי", aliases: [], country: "ITA", league: "SERIE_A", stadium: "Stadio Diego Armando Maradona", founded: 1926 },
  { id: "lazio", en: "Lazio", he: "לאציו", aliases: [], country: "ITA", league: "SERIE_A", stadium: "Stadio Olimpico", founded: 1900 },
  { id: "fiorentina", en: "Fiorentina", he: "פיורנטינה", aliases: [], country: "ITA", league: "SERIE_A", founded: 1926 },
  { id: "sampdoria", en: "Sampdoria", he: "סמפדוריה", aliases: [], country: "ITA", league: "SERIE_A", founded: 1946 },
  { id: "parma", en: "Parma", he: "פארמה", aliases: [], country: "ITA", league: "SERIE_A", founded: 1913 },
  { id: "atalanta", en: "Atalanta", he: "אטאלנטה", aliases: [], country: "ITA", league: "SERIE_A", founded: 1907 },
  { id: "torino", en: "Torino", he: "טורינו", aliases: [], country: "ITA", league: "SERIE_A", founded: 1906 },

  // ---------- Germany ----------
  { id: "bayern", en: "Bayern Munich", he: "באיירן מינכן", aliases: ["Bayern", "באיירן"], country: "GER", league: "BUNDESLIGA", stadium: "Allianz Arena", stadiumHe: "אליאנץ ארנה", founded: 1900, nicknameHe: "הבווארים" },
  { id: "dortmund", en: "Borussia Dortmund", he: "בורוסיה דורטמונד", aliases: ["Dortmund", "BVB", "דורטמונד"], country: "GER", league: "BUNDESLIGA", stadium: "Signal Iduna Park", stadiumHe: "זיגנל איידונה פארק", founded: 1909 },
  { id: "leverkusen", en: "Bayer Leverkusen", he: "באייר לברקוזן", aliases: ["Leverkusen", "לברקוזן"], country: "GER", league: "BUNDESLIGA", stadium: "BayArena", founded: 1904 },
  { id: "schalke", en: "Schalke 04", he: "שאלקה 04", aliases: ["Schalke", "שאלקה"], country: "GER", league: "BUNDESLIGA", founded: 1904 },
  { id: "monchengladbach", en: "Borussia Mönchengladbach", he: "בורוסיה מנשנגלדבך", aliases: ["Gladbach", "מנשנגלדבך"], country: "GER", league: "BUNDESLIGA", founded: 1900 },
  { id: "werder", en: "Werder Bremen", he: "ורדר ברמן", aliases: ["Bremen", "ברמן"], country: "GER", league: "BUNDESLIGA", founded: 1899 },
  { id: "stuttgart", en: "VfB Stuttgart", he: "שטוטגרט", aliases: ["Stuttgart"], country: "GER", league: "BUNDESLIGA", founded: 1893 },
  { id: "hamburg", en: "Hamburger SV", he: "המבורג", aliases: ["Hamburg", "HSV"], country: "GER", league: "BUNDESLIGA", founded: 1887 },
  { id: "kaiserslautern", en: "1. FC Kaiserslautern", he: "קייזרסלאוטרן", aliases: ["Kaiserslautern"], country: "GER", league: "BUNDESLIGA", founded: 1900 },
  { id: "wolfsburg", en: "VfL Wolfsburg", he: "וולפסבורג", aliases: ["Wolfsburg"], country: "GER", league: "BUNDESLIGA", founded: 1945 },
  { id: "leipzig", en: "RB Leipzig", he: "לייפציג", aliases: ["Leipzig"], country: "GER", league: "BUNDESLIGA", founded: 2009 },
  { id: "frankfurt", en: "Eintracht Frankfurt", he: "איינטרכט פרנקפורט", aliases: ["Frankfurt", "פרנקפורט"], country: "GER", league: "BUNDESLIGA", founded: 1899 },
  { id: "koln", en: "1. FC Köln", he: "קלן", aliases: ["Koln", "Cologne"], country: "GER", league: "BUNDESLIGA", founded: 1948 },

  // ---------- France ----------
  { id: "psg", en: "Paris Saint-Germain", he: "פריז סן ז'רמן", aliases: ["PSG", "Paris SG", "פריז", "פ.ס.ז'"], country: "FRA", league: "LIGUE_1", stadium: "Parc des Princes", stadiumHe: "פארק דה פראנס", founded: 1970 },
  { id: "marseille", en: "Marseille", he: "מארסיי", aliases: ["Olympique Marseille", "OM"], country: "FRA", league: "LIGUE_1", stadium: "Stade Vélodrome", founded: 1899 },
  { id: "lyon", en: "Lyon", he: "ליון", aliases: ["Olympique Lyonnais", "OL"], country: "FRA", league: "LIGUE_1", founded: 1950 },
  { id: "monaco", en: "Monaco", he: "מונקו", aliases: ["AS Monaco"], country: "FRA", league: "LIGUE_1", stadium: "Stade Louis II", founded: 1924 },
  { id: "lille", en: "Lille", he: "ליל", aliases: ["LOSC"], country: "FRA", league: "LIGUE_1", founded: 1944 },
  { id: "saint_etienne", en: "Saint-Étienne", he: "סנט אטיין", aliases: ["Saint Etienne", "St Etienne"], country: "FRA", league: "LIGUE_1", founded: 1933 },
  { id: "nantes", en: "Nantes", he: "נאנט", aliases: [], country: "FRA", league: "LIGUE_1", founded: 1943 },
  { id: "bordeaux", en: "Bordeaux", he: "בורדו", aliases: [], country: "FRA", league: "LIGUE_1", founded: 1881 },
  { id: "montpellier", en: "Montpellier", he: "מונפלייה", aliases: [], country: "FRA", league: "LIGUE_1", founded: 1974 },
  { id: "lens", en: "Lens", he: "לאנס", aliases: ["RC Lens"], country: "FRA", league: "LIGUE_1", founded: 1906 },
  { id: "auxerre", en: "Auxerre", he: "אוסר", aliases: [], country: "FRA", league: "LIGUE_1", founded: 1905 },

  // ---------- Portugal ----------
  { id: "benfica", en: "Benfica", he: "בנפיקה", aliases: ["SL Benfica"], country: "POR", league: "LIGA_PORTUGAL", stadium: "Estádio da Luz", founded: 1904 },
  { id: "porto", en: "Porto", he: "פורטו", aliases: ["FC Porto"], country: "POR", league: "LIGA_PORTUGAL", stadium: "Estádio do Dragão", founded: 1893 },
  { id: "sporting", en: "Sporting CP", he: "ספורטינג ליסבון", aliases: ["Sporting", "Sporting Lisbon", "ספורטינג"], country: "POR", league: "LIGA_PORTUGAL", stadium: "Estádio José Alvalade", founded: 1906 },
  { id: "braga", en: "Braga", he: "בראגה", aliases: ["SC Braga"], country: "POR", league: "LIGA_PORTUGAL", founded: 1921 },

  // ---------- Netherlands ----------
  { id: "ajax", en: "Ajax", he: "אייאקס", aliases: ["AFC Ajax", "אאיאקס", "איאקס"], country: "NED", league: "EREDIVISIE", stadium: "Johan Cruyff Arena", founded: 1900 },
  { id: "psv", en: "PSV Eindhoven", he: "PSV איינדהובן", aliases: ["PSV", "איינדהובן"], country: "NED", league: "EREDIVISIE", founded: 1913 },
  { id: "feyenoord", en: "Feyenoord", he: "פיינורד", aliases: [], country: "NED", league: "EREDIVISIE", stadium: "De Kuip", founded: 1908 },
  { id: "az", en: "AZ Alkmaar", he: "AZ אלקמאר", aliases: ["AZ", "אלקמאר"], country: "NED", league: "EREDIVISIE", founded: 1967 },
  { id: "groningen", en: "Groningen", he: "כרונינגן", aliases: ["FC Groningen"], country: "NED", league: "EREDIVISIE", founded: 1971 },

  // ---------- Israel ----------
  { id: "maccabi_haifa", en: "Maccabi Haifa", he: "מכבי חיפה", aliases: ["מכבי חיפה"], country: "ISR", league: "ISRAELI_PREMIER_LEAGUE", stadium: "Sammy Ofer Stadium", stadiumHe: "אצטדיון סמי עופר", founded: 1913 },
  { id: "maccabi_tlv", en: "Maccabi Tel Aviv", he: "מכבי תל אביב", aliases: ["מכבי ת\"א"], country: "ISR", league: "ISRAELI_PREMIER_LEAGUE", stadium: "Bloomfield Stadium", stadiumHe: "אצטדיון בלומפילד", founded: 1906 },
  { id: "hapoel_tlv", en: "Hapoel Tel Aviv", he: "הפועל תל אביב", aliases: ["הפועל ת\"א"], country: "ISR", league: "ISRAELI_PREMIER_LEAGUE", stadium: "Bloomfield Stadium", founded: 1923 },
  { id: "beitar", en: "Beitar Jerusalem", he: "בית\"ר ירושלים", aliases: ["ביתר ירושלים", "בית״ר ירושלים"], country: "ISR", league: "ISRAELI_PREMIER_LEAGUE", stadium: "Teddy Stadium", stadiumHe: "אצטדיון טדי", founded: 1936 },
  { id: "hapoel_beer_sheva", en: "Hapoel Be'er Sheva", he: "הפועל באר שבע", aliases: ["הפועל ב\"ש"], country: "ISR", league: "ISRAELI_PREMIER_LEAGUE", founded: 1949 },

  // ---------- South America ----------
  { id: "santos", en: "Santos", he: "סנטוס", aliases: ["Santos FC"], country: "BRA", league: null, founded: 1912 },
  { id: "flamengo", en: "Flamengo", he: "פלמנגו", aliases: [], country: "BRA", league: null, stadium: "Maracanã", founded: 1895 },
  { id: "sao_paulo", en: "São Paulo", he: "סאו פאולו", aliases: ["Sao Paulo"], country: "BRA", league: null, founded: 1930 },
  { id: "gremio", en: "Grêmio", he: "גרמיו", aliases: ["Gremio"], country: "BRA", league: null, founded: 1903 },
  { id: "corinthians", en: "Corinthians", he: "קורינתיאנס", aliases: [], country: "BRA", league: null, founded: 1910 },
  { id: "palmeiras", en: "Palmeiras", he: "פלמיירס", aliases: [], country: "BRA", league: null, founded: 1914 },
  { id: "cruzeiro", en: "Cruzeiro", he: "קרוזיירו", aliases: [], country: "BRA", league: null, founded: 1921 },
  { id: "boca", en: "Boca Juniors", he: "בוקה ג'וניורס", aliases: ["Boca", "בוקה"], country: "ARG", league: null, stadium: "La Bombonera", founded: 1905 },
  { id: "river", en: "River Plate", he: "ריבר פלייט", aliases: ["River"], country: "ARG", league: null, stadium: "El Monumental", founded: 1901 },
  { id: "independiente", en: "Independiente", he: "אינדפנדיינטה", aliases: [], country: "ARG", league: null, founded: 1905 },
  { id: "newells", en: "Newell's Old Boys", he: "ניואלס אולד בויז", aliases: ["Newells"], country: "ARG", league: null, founded: 1903 },
  { id: "velez", en: "Vélez Sarsfield", he: "ולס סארספילד", aliases: ["Velez"], country: "ARG", league: null, founded: 1910 },
  { id: "nacional", en: "Nacional", he: "נסיונל", aliases: ["Club Nacional"], country: "URU", league: null, founded: 1899 },
  { id: "penarol", en: "Peñarol", he: "פנרול", aliases: ["Penarol"], country: "URU", league: null, founded: 1891 },

  // ---------- Rest of world / other Europe ----------
  { id: "celtic", en: "Celtic", he: "סלטיק", aliases: [], country: "SCO", league: null, stadium: "Celtic Park", founded: 1887 },
  { id: "rangers", en: "Rangers", he: "ריינג'רס", aliases: ["ריינג׳רס"], country: "SCO", league: null, stadium: "Ibrox", founded: 1872 },
  { id: "galatasaray", en: "Galatasaray", he: "גלאטסראי", aliases: [], country: "TUR", league: null, founded: 1905 },
  { id: "fenerbahce", en: "Fenerbahçe", he: "פנרבחצ'ה", aliases: ["Fenerbahce"], country: "TUR", league: null, founded: 1907 },
  { id: "al_nassr", en: "Al Nassr", he: "אל נאסר", aliases: ["Al-Nassr"], country: "KSA", league: null, founded: 1955 },
  { id: "al_hilal", en: "Al Hilal", he: "אל הילאל", aliases: ["Al-Hilal"], country: "KSA", league: null, founded: 1957 },
  { id: "inter_miami", en: "Inter Miami", he: "אינטר מיאמי", aliases: ["Inter Miami CF"], country: "USA", league: null, founded: 2018 },
  { id: "la_galaxy", en: "LA Galaxy", he: "לוס אנג'לס גלאקסי", aliases: ["Los Angeles Galaxy", "Galaxy"], country: "USA", league: null, founded: 1994 },
  { id: "ny_red_bulls", en: "New York Red Bulls", he: "ניו יורק רד בולס", aliases: ["NY Red Bulls"], country: "USA", league: null, founded: 1994 },
  { id: "orlando", en: "Orlando City", he: "אורלנדו סיטי", aliases: ["Orlando"], country: "USA", league: null, founded: 2010 },
  { id: "shakhtar", en: "Shakhtar Donetsk", he: "שחטאר דונייצק", aliases: ["Shakhtar"], country: "UKR", league: null, founded: 1936 },
  { id: "zenit", en: "Zenit Saint Petersburg", he: "זניט סנט פטרסבורג", aliases: ["Zenit"], country: "RUS", league: null, founded: 1925 },
  { id: "cska_moscow", en: "CSKA Moscow", he: "צסק\"א מוסקבה", aliases: ["CSKA"], country: "RUS", league: null, founded: 1911 },
  { id: "red_star", en: "Red Star Belgrade", he: "כוכב אדום בלגרד", aliases: ["Red Star"], country: "SRB", league: null, founded: 1945 },
  { id: "steaua", en: "Steaua București", he: "סטיאווה בוקרשט", aliases: ["Steaua", "Steaua Bucharest"], country: "ROU", league: null, founded: 1947 },
  { id: "panathinaikos", en: "Panathinaikos", he: "פנאתינייקוס", aliases: [], country: "GRE", league: null, founded: 1908 },
  { id: "malmo", en: "Malmö FF", he: "מאלמה", aliases: ["Malmo", "Malmo FF"], country: "SWE", league: null, founded: 1910 },
  { id: "club_brugge", en: "Club Brugge", he: "קלאב ברוז'", aliases: ["Brugge"], country: "BEL", league: null, founded: 1891 },
  { id: "anderlecht", en: "Anderlecht", he: "אנדרלכט", aliases: [], country: "BEL", league: null, founded: 1908 },
  { id: "salzburg", en: "Red Bull Salzburg", he: "רד בול זלצבורג", aliases: ["Salzburg", "RB Salzburg"], country: "AUT", league: null, founded: 1933 },
  { id: "dinamo_zagreb", en: "Dinamo Zagreb", he: "דינאמו זאגרב", aliases: ["Dinamo"], country: "CRO", league: null, founded: 1945 },
  { id: "molde", en: "Molde", he: "מולדה", aliases: [], country: "NOR", league: null, founded: 1911 },
  { id: "lech", en: "Lech Poznań", he: "לך פוזנן", aliases: ["Lech Poznan"], country: "POL", league: null, founded: 1922 },
  { id: "vissel_kobe", en: "Vissel Kobe", he: "ויסל קובה", aliases: [], country: "JPN", league: null, founded: 1966 },

  // ---------- Additional clubs referenced by career data ----------
  { id: "basel", en: "Basel", he: "באזל", aliases: ["FC Basel"], country: "SUI", league: null, founded: 1893 },
  { id: "udinese", en: "Udinese", he: "אודינזה", aliases: [], country: "ITA", league: "SERIE_A", founded: 1896 },
  { id: "genoa", en: "Genoa", he: "ג'נואה", aliases: [], country: "ITA", league: "SERIE_A", founded: 1893 },
  { id: "empoli", en: "Empoli", he: "אמפולי", aliases: [], country: "ITA", league: "SERIE_A", founded: 1920 },
  { id: "bologna", en: "Bologna", he: "בולוניה", aliases: [], country: "ITA", league: "SERIE_A", founded: 1909 },
  { id: "cagliari", en: "Cagliari", he: "קליארי", aliases: [], country: "ITA", league: "SERIE_A", founded: 1920 },
  { id: "brescia", en: "Brescia", he: "ברשה", aliases: [], country: "ITA", league: "SERIE_A", founded: 1911 },
  { id: "betis", en: "Real Betis", he: "ריאל בטיס", aliases: ["Betis", "בטיס"], country: "ESP", league: "LA_LIGA", founded: 1907 },
  { id: "getafe", en: "Getafe", he: "חטאפה", aliases: [], country: "ESP", league: "LA_LIGA", founded: 1946 },
  { id: "celta", en: "Celta Vigo", he: "סלטה ויגו", aliases: ["Celta"], country: "ESP", league: "LA_LIGA", founded: 1923 },
  { id: "mallorca", en: "Mallorca", he: "מיורקה", aliases: [], country: "ESP", league: "LA_LIGA", founded: 1916 },
  { id: "zaragoza", en: "Real Zaragoza", he: "סרגוסה", aliases: ["Zaragoza"], country: "ESP", league: "LA_LIGA", founded: 1932 },
  { id: "racing_santander", en: "Racing Santander", he: "רסינג סנטנדר", aliases: ["Racing"], country: "ESP", league: "LA_LIGA", founded: 1913 },
  { id: "crystal_palace", en: "Crystal Palace", he: "קריסטל פאלאס", aliases: ["Palace"], country: "ENG", league: "PREMIER_LEAGUE", founded: 1905 },
  { id: "wolves", en: "Wolverhampton Wanderers", he: "וולבס", aliases: ["Wolves", "Wolverhampton"], country: "ENG", league: "PREMIER_LEAGUE", founded: 1877 },
  { id: "stoke", en: "Stoke City", he: "סטוק סיטי", aliases: ["Stoke"], country: "ENG", league: "PREMIER_LEAGUE", founded: 1863 },
  { id: "sunderland", en: "Sunderland", he: "סנדרלנד", aliases: [], country: "ENG", league: "PREMIER_LEAGUE", founded: 1879 },
  { id: "qpr", en: "Queens Park Rangers", he: "QPR", aliases: ["QPR"], country: "ENG", league: "PREMIER_LEAGUE", founded: 1882 },
  { id: "middlesbrough", en: "Middlesbrough", he: "מידלסברו", aliases: [], country: "ENG", league: "PREMIER_LEAGUE", founded: 1876 },
  { id: "hoffenheim", en: "Hoffenheim", he: "הופנהיים", aliases: ["TSG Hoffenheim"], country: "GER", league: "BUNDESLIGA", founded: 1899 },
  { id: "mainz", en: "Mainz 05", he: "מיינץ", aliases: ["Mainz"], country: "GER", league: "BUNDESLIGA", founded: 1905 },
  { id: "freiburg", en: "SC Freiburg", he: "פרייבורג", aliases: ["Freiburg"], country: "GER", league: "BUNDESLIGA", founded: 1904 },
  { id: "hertha", en: "Hertha Berlin", he: "הרתה ברלין", aliases: ["Hertha"], country: "GER", league: "BUNDESLIGA", founded: 1892 },
  { id: "nice", en: "Nice", he: "ניס", aliases: ["OGC Nice"], country: "FRA", league: "LIGUE_1", founded: 1904 },
  { id: "rennes", en: "Rennes", he: "רן", aliases: ["Stade Rennais"], country: "FRA", league: "LIGUE_1", founded: 1901 },
  { id: "vitesse", en: "Vitesse", he: "ויטסה", aliases: [], country: "NED", league: "EREDIVISIE", founded: 1892 },
  { id: "twente", en: "Twente", he: "טוונטה", aliases: ["FC Twente"], country: "NED", league: "EREDIVISIE", founded: 1965 },
  { id: "vasco", en: "Vasco da Gama", he: "ואסקו דה גאמה", aliases: ["Vasco"], country: "BRA", league: null, founded: 1898 },
  { id: "internacional", en: "Internacional", he: "אינטרנסיונאל", aliases: ["Inter Porto Alegre"], country: "BRA", league: null, founded: 1909 },
  { id: "atletico_mineiro", en: "Atlético Mineiro", he: "אתלטיקו מינייירו", aliases: ["Atletico Mineiro"], country: "BRA", league: null, founded: 1908 },
  { id: "fluminense", en: "Fluminense", he: "פלומיננסה", aliases: [], country: "BRA", league: null, founded: 1902 },
  { id: "estudiantes", en: "Estudiantes", he: "אסטודיאנטס", aliases: [], country: "ARG", league: null, founded: 1905 },
  { id: "racing_club", en: "Racing Club", he: "רסינג קלוב", aliases: [], country: "ARG", league: null, founded: 1903 },
  { id: "argentinos", en: "Argentinos Juniors", he: "ארחנטינוס ג'וניורס", aliases: ["Argentinos"], country: "ARG", league: null, founded: 1904 },
  { id: "rosario_central", en: "Rosario Central", he: "רוסאריו סנטרל", aliases: [], country: "ARG", league: null, founded: 1889 },
  { id: "danubio", en: "Danubio", he: "דנוביו", aliases: [], country: "URU", league: null, founded: 1932 },
  { id: "defensor", en: "Defensor Sporting", he: "דפנסור ספורטינג", aliases: ["Defensor"], country: "URU", league: null, founded: 1913 },
  { id: "hajduk", en: "Hajduk Split", he: "היידוק ספליט", aliases: ["Hajduk"], country: "CRO", league: null, founded: 1911 },
  { id: "partizan", en: "Partizan", he: "פרטיזן בלגרד", aliases: ["Partizan Belgrade"], country: "SRB", league: null, founded: 1945 },
  { id: "olympiacos", en: "Olympiacos", he: "אולימפיאקוס", aliases: [], country: "GRE", league: null, founded: 1925 },
  { id: "besiktas", en: "Beşiktaş", he: "בשיקטאש", aliases: ["Besiktas"], country: "TUR", league: null, founded: 1903 },
  { id: "al_ittihad", en: "Al Ittihad", he: "אל איתיחאד", aliases: ["Al-Ittihad"], country: "KSA", league: null, founded: 1927 },
  { id: "toronto", en: "Toronto FC", he: "טורונטו FC", aliases: ["Toronto"], country: "CAN", league: null, founded: 2005 },
  { id: "montreal", en: "CF Montréal", he: "מונטריאול", aliases: ["Montreal Impact"], country: "CAN", league: null, founded: 1992 },
  { id: "shanghai_port", en: "Shanghai Port", he: "שנגחאי פורט", aliases: ["Shanghai SIPG"], country: "CHN", league: null, founded: 2005 },
  { id: "guangzhou", en: "Guangzhou FC", he: "גואנגג'ואו", aliases: ["Guangzhou Evergrande"], country: "CHN", league: null, founded: 1954 },
];

export const CLUB_BY_ID = new Map(CLUBS.map((c) => [c.id, c]));

export function club(id: string): ClubRecord {
  const found = CLUB_BY_ID.get(id);
  if (!found) throw new Error(`Unknown club id: ${id}`);
  return found;
}
