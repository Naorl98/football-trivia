// Player registry — verified senior career club sequences.
//
// ACCURACY CONTRACT
// `seq: "full"`    — clubs[] is the player's complete, consecutive sequence of
//                    senior *permanent* clubs. Safe for "which club before/after X".
// `seq: "partial"` — clubs[] is a correct subset in correct order, but may omit
//                    early/loan/late spells. Only used for career-path and
//                    club-connection questions, never for before/after.
// `firstListed`    — clubs[0] really is the first senior club. Required for
//                    "where did X start" questions.
//
// Loan spells are omitted throughout; `seq: "full"` describes permanent moves.

export type Tier = 1 | 2 | 3; // 1 = global icon, 2 = very well known, 3 = known to keen fans

export interface PlayerRecord {
  id: string;
  en: string;
  he: string;
  aliases: string[]; // extra accepted forms (short names, Hebrew variants)
  nat: string; // nationality code
  pos: "GK" | "DF" | "MF" | "FW";
  tier: Tier;
  clubs: string[]; // ordered club ids
  seq: "full" | "partial";
  firstListed: boolean;
}

export const PLAYERS: PlayerRecord[] = [
  // ================= Global icons =================
  { id: "messi", en: "Lionel Messi", he: "ליאו מסי", aliases: ["Messi", "מסי", "ליונל מסי", "Leo Messi"], nat: "ARG", pos: "FW", tier: 1, clubs: ["barcelona", "psg", "inter_miami"], seq: "full", firstListed: true },
  { id: "ronaldo_cr", en: "Cristiano Ronaldo", he: "כריסטיאנו רונאלדו", aliases: ["Ronaldo", "CR7", "רונאלדו", "כריסטיאנו"], nat: "POR", pos: "FW", tier: 1, clubs: ["sporting", "man_utd", "real_madrid", "juventus", "man_utd", "al_nassr"], seq: "full", firstListed: true },
  { id: "neymar", en: "Neymar", he: "ניימאר", aliases: ["Neymar Jr", "ניימר"], nat: "BRA", pos: "FW", tier: 1, clubs: ["santos", "barcelona", "psg", "al_hilal"], seq: "partial", firstListed: true },
  { id: "mbappe", en: "Kylian Mbappé", he: "קיליאן אמבפה", aliases: ["Mbappe", "Mbappé", "אמבפה", "קיליאן"], nat: "FRA", pos: "FW", tier: 1, clubs: ["monaco", "psg", "real_madrid"], seq: "full", firstListed: true },
  { id: "haaland", en: "Erling Haaland", he: "ארלינג הולנד", aliases: ["Haaland", "הולנד"], nat: "NOR", pos: "FW", tier: 1, clubs: ["molde", "salzburg", "dortmund", "man_city"], seq: "partial", firstListed: false },
  { id: "lewandowski", en: "Robert Lewandowski", he: "רוברט לבנדובסקי", aliases: ["Lewandowski", "לבנדובסקי"], nat: "POL", pos: "FW", tier: 1, clubs: ["lech", "dortmund", "bayern", "barcelona"], seq: "partial", firstListed: false },
  { id: "ibrahimovic", en: "Zlatan Ibrahimović", he: "זלאטן איברהימוביץ'", aliases: ["Zlatan", "Ibrahimovic", "זלאטן", "איברהימוביץ"], nat: "SWE", pos: "FW", tier: 1, clubs: ["malmo", "ajax", "juventus", "inter", "barcelona", "milan", "psg", "man_utd", "la_galaxy", "milan"], seq: "full", firstListed: true },
  { id: "suarez_l", en: "Luis Suárez", he: "לואיס סוארס", aliases: ["Suarez", "Suárez", "סוארס"], nat: "URU", pos: "FW", tier: 1, clubs: ["nacional", "groningen", "ajax", "liverpool", "barcelona", "atletico", "gremio", "inter_miami"], seq: "full", firstListed: true },
  { id: "modric", en: "Luka Modrić", he: "לוקה מודריץ'", aliases: ["Modric", "מודריץ"], nat: "CRO", pos: "MF", tier: 1, clubs: ["dinamo_zagreb", "tottenham", "real_madrid"], seq: "partial", firstListed: true },
  { id: "salah", en: "Mohamed Salah", he: "מוחמד סלאח", aliases: ["Salah", "סלאח", "מו סלאח"], nat: "EGY", pos: "FW", tier: 1, clubs: ["basel", "chelsea", "roma", "liverpool"], seq: "partial", firstListed: false },
  { id: "de_bruyne", en: "Kevin De Bruyne", he: "קווין דה בריינה", aliases: ["De Bruyne", "דה בריינה", "KDB"], nat: "BEL", pos: "MF", tier: 1, clubs: ["chelsea", "wolfsburg", "man_city"], seq: "partial", firstListed: false },
  { id: "kane", en: "Harry Kane", he: "הארי קיין", aliases: ["Kane", "קיין"], nat: "ENG", pos: "FW", tier: 1, clubs: ["tottenham", "bayern"], seq: "full", firstListed: true },
  { id: "benzema", en: "Karim Benzema", he: "קרים בנזמה", aliases: ["Benzema", "בנזמה"], nat: "FRA", pos: "FW", tier: 1, clubs: ["lyon", "real_madrid", "al_ittihad"], seq: "full", firstListed: true },
  { id: "griezmann", en: "Antoine Griezmann", he: "אנטואן גריזמן", aliases: ["Griezmann", "גריזמן"], nat: "FRA", pos: "FW", tier: 1, clubs: ["real_sociedad", "atletico", "barcelona", "atletico"], seq: "full", firstListed: true },

  // ================= Modern stars =================
  { id: "vinicius", en: "Vinícius Júnior", he: "ויניסיוס ז'וניור", aliases: ["Vinicius", "Vinícius", "Vini Jr", "Vini", "ויניסיוס", "ויני"], nat: "BRA", pos: "FW", tier: 1, clubs: ["flamengo", "real_madrid"], seq: "full", firstListed: true },
  { id: "rodrygo", en: "Rodrygo", he: "רודריגו", aliases: ["Rodrygo Goes"], nat: "BRA", pos: "FW", tier: 2, clubs: ["santos", "real_madrid"], seq: "full", firstListed: true },
  { id: "bellingham", en: "Jude Bellingham", he: "ג'וד בלינגהאם", aliases: ["Bellingham", "בלינגהאם"], nat: "ENG", pos: "MF", tier: 1, clubs: ["dortmund", "real_madrid"], seq: "partial", firstListed: false },
  { id: "kroos", en: "Toni Kroos", he: "טוני קרוס", aliases: ["Kroos", "קרוס"], nat: "GER", pos: "MF", tier: 1, clubs: ["bayern", "real_madrid"], seq: "partial", firstListed: true },
  { id: "courtois", en: "Thibaut Courtois", he: "טיבו קורטואה", aliases: ["Courtois", "קורטואה"], nat: "BEL", pos: "GK", tier: 1, clubs: ["genk_placeholder", "chelsea", "real_madrid"], seq: "partial", firstListed: false },
  { id: "alisson", en: "Alisson", he: "אליסון", aliases: ["Alisson Becker"], nat: "BRA", pos: "GK", tier: 2, clubs: ["internacional", "roma", "liverpool"], seq: "full", firstListed: true },
  { id: "ederson", en: "Ederson", he: "אדרסון", aliases: [], nat: "BRA", pos: "GK", tier: 2, clubs: ["benfica", "man_city"], seq: "partial", firstListed: false },
  { id: "van_dijk", en: "Virgil van Dijk", he: "וירג'יל ואן דייק", aliases: ["Van Dijk", "ואן דייק"], nat: "NED", pos: "DF", tier: 1, clubs: ["groningen", "celtic", "southampton", "liverpool"], seq: "full", firstListed: true },
  { id: "rudiger", en: "Antonio Rüdiger", he: "אנטוניו רודיגר", aliases: ["Rudiger", "רודיגר"], nat: "GER", pos: "DF", tier: 2, clubs: ["stuttgart", "roma", "chelsea", "real_madrid"], seq: "full", firstListed: true },
  { id: "hakimi", en: "Achraf Hakimi", he: "אשרף חכימי", aliases: ["Hakimi", "חכימי"], nat: "MAR", pos: "DF", tier: 2, clubs: ["real_madrid", "inter", "psg"], seq: "partial", firstListed: true },
  { id: "kounde", en: "Jules Koundé", he: "ז'ול קונדה", aliases: ["Kounde", "קונדה"], nat: "FRA", pos: "DF", tier: 3, clubs: ["bordeaux", "sevilla", "barcelona"], seq: "full", firstListed: true },
  { id: "rodri", en: "Rodri", he: "רודרי", aliases: ["Rodrigo Hernandez"], nat: "ESP", pos: "MF", tier: 2, clubs: ["villarreal", "atletico", "man_city"], seq: "partial", firstListed: false },
  { id: "gundogan", en: "İlkay Gündoğan", he: "אילקאי גונדואן", aliases: ["Gundogan", "גונדואן"], nat: "GER", pos: "MF", tier: 2, clubs: ["dortmund", "man_city", "barcelona", "man_city"], seq: "partial", firstListed: false },
  { id: "bernardo", en: "Bernardo Silva", he: "ברנרדו סילבה", aliases: ["Bernardo", "סילבה"], nat: "POR", pos: "MF", tier: 2, clubs: ["benfica", "monaco", "man_city"], seq: "full", firstListed: true },
  { id: "bruno_fernandes", en: "Bruno Fernandes", he: "ברונו פרננדש", aliases: ["Bruno", "פרננדש"], nat: "POR", pos: "MF", tier: 2, clubs: ["udinese", "sampdoria", "sporting", "man_utd"], seq: "partial", firstListed: false },
  { id: "dembele_o", en: "Ousmane Dembélé", he: "עוסמאן דמבלה", aliases: ["Dembele", "Dembélé", "דמבלה"], nat: "FRA", pos: "FW", tier: 1, clubs: ["rennes", "dortmund", "barcelona", "psg"], seq: "full", firstListed: true },
  { id: "kimmich", en: "Joshua Kimmich", he: "יהושע קימיך", aliases: ["Kimmich", "קימיך"], nat: "GER", pos: "MF", tier: 2, clubs: ["leipzig", "bayern"], seq: "partial", firstListed: false },
  { id: "musiala", en: "Jamal Musiala", he: "ג'מאל מוסיאלה", aliases: ["Musiala", "מוסיאלה"], nat: "GER", pos: "MF", tier: 2, clubs: ["bayern"], seq: "partial", firstListed: false },
  { id: "saka", en: "Bukayo Saka", he: "בוקאיו סאקה", aliases: ["Saka", "סאקה"], nat: "ENG", pos: "FW", tier: 2, clubs: ["arsenal"], seq: "full", firstListed: true },
  { id: "foden", en: "Phil Foden", he: "פיל פודן", aliases: ["Foden", "פודן"], nat: "ENG", pos: "MF", tier: 2, clubs: ["man_city"], seq: "full", firstListed: true },
  { id: "osimhen", en: "Victor Osimhen", he: "ויקטור אוסימן", aliases: ["Osimhen", "אוסימן"], nat: "NGA", pos: "FW", tier: 2, clubs: ["charleroi_placeholder", "lille", "napoli"], seq: "partial", firstListed: false },
  { id: "son", en: "Son Heung-min", he: "סון הונג-מין", aliases: ["Son", "סון"], nat: "KOR", pos: "FW", tier: 2, clubs: ["hamburg", "leverkusen", "tottenham"], seq: "partial", firstListed: true },
  { id: "kvaratskhelia", en: "Khvicha Kvaratskhelia", he: "חביצ'ה קברצחליה", aliases: ["Kvaratskhelia", "Kvara", "קברצחליה"], nat: "GEO", pos: "FW", tier: 3, clubs: ["napoli", "psg"], seq: "partial", firstListed: false },
  { id: "lautaro", en: "Lautaro Martínez", he: "לאוטרו מרטינס", aliases: ["Lautaro", "Lautaro Martinez", "לאוטרו"], nat: "ARG", pos: "FW", tier: 2, clubs: ["racing_club", "inter"], seq: "full", firstListed: true },
  { id: "di_maria", en: "Ángel Di María", he: "אנחל די מריה", aliases: ["Di Maria", "Di María", "די מריה"], nat: "ARG", pos: "FW", tier: 2, clubs: ["rosario_central", "benfica", "real_madrid", "man_utd", "psg", "juventus", "benfica"], seq: "full", firstListed: true },

  // ================= Recent-era greats =================
  { id: "iniesta", en: "Andrés Iniesta", he: "אנדרס איניאסטה", aliases: ["Iniesta", "איניאסטה"], nat: "ESP", pos: "MF", tier: 1, clubs: ["barcelona", "vissel_kobe"], seq: "partial", firstListed: true },
  { id: "xavi", en: "Xavi", he: "צ'אבי", aliases: ["Xavi Hernandez", "צאבי"], nat: "ESP", pos: "MF", tier: 1, clubs: ["barcelona"], seq: "partial", firstListed: true },
  { id: "pique", en: "Gerard Piqué", he: "ג'רארד פיקה", aliases: ["Pique", "Piqué", "פיקה"], nat: "ESP", pos: "DF", tier: 1, clubs: ["man_utd", "barcelona"], seq: "partial", firstListed: true },
  { id: "busquets", en: "Sergio Busquets", he: "סרחיו בוסקטס", aliases: ["Busquets", "בוסקטס"], nat: "ESP", pos: "MF", tier: 2, clubs: ["barcelona", "inter_miami"], seq: "partial", firstListed: true },
  { id: "jordi_alba", en: "Jordi Alba", he: "ז'ורדי אלבה", aliases: ["Alba", "אלבה"], nat: "ESP", pos: "DF", tier: 2, clubs: ["valencia", "barcelona", "inter_miami"], seq: "partial", firstListed: false },
  { id: "ramos", en: "Sergio Ramos", he: "סרחיו ראמוס", aliases: ["Ramos", "ראמוס"], nat: "ESP", pos: "DF", tier: 1, clubs: ["sevilla", "real_madrid", "psg", "sevilla"], seq: "full", firstListed: true },
  { id: "casillas", en: "Iker Casillas", he: "איקר קסייאס", aliases: ["Casillas", "קסייאס"], nat: "ESP", pos: "GK", tier: 1, clubs: ["real_madrid", "porto"], seq: "full", firstListed: true },
  { id: "torres_f", en: "Fernando Torres", he: "פרננדו טורס", aliases: ["Torres", "טורס", "El Nino"], nat: "ESP", pos: "FW", tier: 1, clubs: ["atletico", "liverpool", "chelsea", "atletico"], seq: "partial", firstListed: true },
  { id: "villa", en: "David Villa", he: "דיוויד וייה", aliases: ["Villa", "וייה"], nat: "ESP", pos: "FW", tier: 2, clubs: ["zaragoza", "valencia", "barcelona", "atletico"], seq: "partial", firstListed: false },
  { id: "silva_d", en: "David Silva", he: "דיוויד סילבה", aliases: ["David Silva"], nat: "ESP", pos: "MF", tier: 2, clubs: ["valencia", "man_city", "real_sociedad"], seq: "partial", firstListed: false },
  { id: "fabregas", en: "Cesc Fàbregas", he: "סֶסְק פאברגאס", aliases: ["Fabregas", "Cesc", "פאברגאס"], nat: "ESP", pos: "MF", tier: 2, clubs: ["arsenal", "barcelona", "chelsea", "monaco"], seq: "partial", firstListed: true },
  { id: "xabi_alonso", en: "Xabi Alonso", he: "צ'אבי אלונסו", aliases: ["Xabi Alonso", "אלונסו"], nat: "ESP", pos: "MF", tier: 2, clubs: ["real_sociedad", "liverpool", "real_madrid", "bayern"], seq: "full", firstListed: true },

  { id: "zidane", en: "Zinedine Zidane", he: "זינדין זידאן", aliases: ["Zidane", "זידאן", "Zizou"], nat: "FRA", pos: "MF", tier: 1, clubs: ["bordeaux", "juventus", "real_madrid"], seq: "partial", firstListed: false },
  { id: "henry", en: "Thierry Henry", he: "תיירי אנרי", aliases: ["Henry", "אנרי"], nat: "FRA", pos: "FW", tier: 1, clubs: ["monaco", "juventus", "arsenal", "barcelona", "ny_red_bulls"], seq: "full", firstListed: true },
  { id: "ribery", en: "Franck Ribéry", he: "פרנק ריברי", aliases: ["Ribery", "Ribéry", "ריברי"], nat: "FRA", pos: "FW", tier: 2, clubs: ["marseille", "bayern", "fiorentina"], seq: "partial", firstListed: false },
  { id: "evra", en: "Patrice Evra", he: "פטריס אברה", aliases: ["Evra", "אברה"], nat: "FRA", pos: "DF", tier: 3, clubs: ["monaco", "man_utd", "juventus", "marseille"], seq: "partial", firstListed: false },
  { id: "kante", en: "N'Golo Kanté", he: "נגולו קנטה", aliases: ["Kante", "Kanté", "קנטה"], nat: "FRA", pos: "MF", tier: 2, clubs: ["caen_placeholder", "leicester", "chelsea", "al_ittihad"], seq: "partial", firstListed: false },
  { id: "pogba", en: "Paul Pogba", he: "פול פוגבה", aliases: ["Pogba", "פוגבה"], nat: "FRA", pos: "MF", tier: 2, clubs: ["man_utd", "juventus", "man_utd", "juventus"], seq: "partial", firstListed: true },
  { id: "varane", en: "Raphaël Varane", he: "רפאל ורן", aliases: ["Varane", "ורן"], nat: "FRA", pos: "DF", tier: 2, clubs: ["lens", "real_madrid", "man_utd"], seq: "full", firstListed: true },
  { id: "lloris", en: "Hugo Lloris", he: "הוגו יוריס", aliases: ["Lloris", "יוריס"], nat: "FRA", pos: "GK", tier: 2, clubs: ["nice", "lyon", "tottenham"], seq: "partial", firstListed: true },
  { id: "giroud", en: "Olivier Giroud", he: "אוליבייה ז'ירו", aliases: ["Giroud", "ז'ירו"], nat: "FRA", pos: "FW", tier: 2, clubs: ["montpellier", "arsenal", "chelsea", "milan"], seq: "partial", firstListed: false },
  { id: "anelka", en: "Nicolas Anelka", he: "ניקולא אנלקה", aliases: ["Anelka", "אנלקה"], nat: "FRA", pos: "FW", tier: 3, clubs: ["psg", "arsenal", "real_madrid", "psg", "liverpool", "man_city", "fenerbahce", "bolton_placeholder", "chelsea"], seq: "partial", firstListed: true },
  { id: "trezeguet", en: "David Trezeguet", he: "דיוויד טרזגה", aliases: ["Trezeguet", "טרזגה"], nat: "FRA", pos: "FW", tier: 3, clubs: ["monaco", "juventus"], seq: "partial", firstListed: false },
  { id: "makelele", en: "Claude Makélélé", he: "קלוד מקללה", aliases: ["Makelele", "מקללה"], nat: "FRA", pos: "MF", tier: 3, clubs: ["nantes", "marseille", "celta", "real_madrid", "chelsea", "psg"], seq: "partial", firstListed: false },

  { id: "beckham", en: "David Beckham", he: "דיוויד בקהאם", aliases: ["Beckham", "בקהאם"], nat: "ENG", pos: "MF", tier: 1, clubs: ["man_utd", "real_madrid", "la_galaxy", "psg"], seq: "partial", firstListed: true },
  { id: "gerrard", en: "Steven Gerrard", he: "סטיבן ג'רארד", aliases: ["Gerrard", "ג'רארד"], nat: "ENG", pos: "MF", tier: 1, clubs: ["liverpool", "la_galaxy"], seq: "full", firstListed: true },
  { id: "lampard", en: "Frank Lampard", he: "פרנק למפארד", aliases: ["Lampard", "למפארד"], nat: "ENG", pos: "MF", tier: 1, clubs: ["west_ham", "chelsea", "man_city"], seq: "partial", firstListed: true },
  { id: "rooney", en: "Wayne Rooney", he: "וויין רוני", aliases: ["Rooney", "רוני"], nat: "ENG", pos: "FW", tier: 1, clubs: ["everton", "man_utd", "everton"], seq: "partial", firstListed: true },
  { id: "owen", en: "Michael Owen", he: "מייקל אוון", aliases: ["Owen", "אוון"], nat: "ENG", pos: "FW", tier: 2, clubs: ["liverpool", "real_madrid", "newcastle", "man_utd", "stoke"], seq: "full", firstListed: true },
  { id: "shearer", en: "Alan Shearer", he: "אלן שירר", aliases: ["Shearer", "שירר"], nat: "ENG", pos: "FW", tier: 2, clubs: ["southampton", "blackburn", "newcastle"], seq: "full", firstListed: true },
  { id: "scholes", en: "Paul Scholes", he: "פול סקולס", aliases: ["Scholes", "סקולס"], nat: "ENG", pos: "MF", tier: 2, clubs: ["man_utd"], seq: "full", firstListed: true },
  { id: "giggs", en: "Ryan Giggs", he: "ראיין גיגס", aliases: ["Giggs", "גיגס"], nat: "WAL", pos: "MF", tier: 2, clubs: ["man_utd"], seq: "full", firstListed: true },
  { id: "terry", en: "John Terry", he: "ג'ון טרי", aliases: ["Terry", "טרי"], nat: "ENG", pos: "DF", tier: 2, clubs: ["chelsea", "aston_villa"], seq: "partial", firstListed: true },
  { id: "ferdinand", en: "Rio Ferdinand", he: "ריו פרדיננד", aliases: ["Ferdinand", "פרדיננד"], nat: "ENG", pos: "DF", tier: 2, clubs: ["west_ham", "leeds", "man_utd", "qpr"], seq: "full", firstListed: true },
  { id: "sterling", en: "Raheem Sterling", he: "ראחים סטרלינג", aliases: ["Sterling", "סטרלינג"], nat: "ENG", pos: "FW", tier: 2, clubs: ["liverpool", "man_city", "chelsea"], seq: "partial", firstListed: true },

  { id: "ronaldinho", en: "Ronaldinho", he: "רונאלדיניו", aliases: ["רונלדיניו"], nat: "BRA", pos: "FW", tier: 1, clubs: ["gremio", "psg", "barcelona", "milan", "flamengo", "atletico_mineiro"], seq: "full", firstListed: true },
  { id: "ronaldo_r9", en: "Ronaldo", he: "רונאלדו הברזילאי", aliases: ["Ronaldo Nazario", "R9", "הפנומנו", "רונאלדו נזאריו"], nat: "BRA", pos: "FW", tier: 1, clubs: ["cruzeiro", "psv", "barcelona", "inter", "real_madrid", "milan", "corinthians"], seq: "full", firstListed: true },
  { id: "kaka", en: "Kaká", he: "קאקה", aliases: ["Kaka"], nat: "BRA", pos: "MF", tier: 1, clubs: ["sao_paulo", "milan", "real_madrid", "milan", "orlando"], seq: "full", firstListed: true },
  { id: "roberto_carlos", en: "Roberto Carlos", he: "רוברטו קרלוס", aliases: [], nat: "BRA", pos: "DF", tier: 2, clubs: ["palmeiras", "inter", "real_madrid", "fenerbahce"], seq: "partial", firstListed: false },
  { id: "rivaldo", en: "Rivaldo", he: "ריבאלדו", aliases: [], nat: "BRA", pos: "FW", tier: 2, clubs: ["palmeiras", "deportivo", "barcelona", "milan", "olympiacos"], seq: "partial", firstListed: false },
  { id: "cafu", en: "Cafu", he: "קאפו", aliases: [], nat: "BRA", pos: "DF", tier: 3, clubs: ["sao_paulo", "roma", "milan"], seq: "partial", firstListed: true },
  { id: "dani_alves", en: "Dani Alves", he: "דני אלבס", aliases: ["Alves", "אלבס"], nat: "BRA", pos: "DF", tier: 2, clubs: ["sevilla", "barcelona", "juventus", "psg", "sao_paulo", "barcelona"], seq: "partial", firstListed: false },
  { id: "thiago_silva", en: "Thiago Silva", he: "תיאגו סילבה", aliases: ["Thiago Silva"], nat: "BRA", pos: "DF", tier: 2, clubs: ["fluminense", "milan", "psg", "chelsea", "fluminense"], seq: "partial", firstListed: false },
  { id: "coutinho", en: "Philippe Coutinho", he: "פיליפה קוטיניו", aliases: ["Coutinho", "קוטיניו"], nat: "BRA", pos: "MF", tier: 2, clubs: ["inter", "liverpool", "barcelona", "aston_villa", "vasco"], seq: "partial", firstListed: false },
  { id: "firmino", en: "Roberto Firmino", he: "רוברטו פירמינו", aliases: ["Firmino", "פירמינו"], nat: "BRA", pos: "FW", tier: 2, clubs: ["hoffenheim", "liverpool", "al_hilal"], seq: "partial", firstListed: false },
  { id: "marcelo", en: "Marcelo", he: "מרסלו", aliases: [], nat: "BRA", pos: "DF", tier: 2, clubs: ["fluminense", "real_madrid", "olympiacos", "fluminense"], seq: "partial", firstListed: true },
  { id: "casemiro", en: "Casemiro", he: "קאסמירו", aliases: [], nat: "BRA", pos: "MF", tier: 2, clubs: ["sao_paulo", "real_madrid", "man_utd"], seq: "partial", firstListed: true },
  { id: "pele", en: "Pelé", he: "פלה", aliases: ["Pele", "Edson Arantes"], nat: "BRA", pos: "FW", tier: 1, clubs: ["santos", "ny_cosmos_placeholder"], seq: "partial", firstListed: true },
  { id: "romario", en: "Romário", he: "רומאריו", aliases: ["Romario"], nat: "BRA", pos: "FW", tier: 2, clubs: ["vasco", "psv", "barcelona", "flamengo"], seq: "partial", firstListed: false },

  { id: "maradona", en: "Diego Maradona", he: "דייגו מראדונה", aliases: ["Maradona", "מראדונה"], nat: "ARG", pos: "FW", tier: 1, clubs: ["argentinos", "boca", "barcelona", "napoli", "sevilla"], seq: "partial", firstListed: true },
  { id: "aguero", en: "Sergio Agüero", he: "סרחיו אגואירו", aliases: ["Aguero", "Agüero", "אגואירו", "Kun"], nat: "ARG", pos: "FW", tier: 1, clubs: ["independiente", "atletico", "man_city", "barcelona"], seq: "full", firstListed: true },
  { id: "tevez", en: "Carlos Tévez", he: "קרלוס טבס", aliases: ["Tevez", "טבס"], nat: "ARG", pos: "FW", tier: 2, clubs: ["boca", "corinthians", "west_ham", "man_utd", "man_city", "juventus", "boca"], seq: "partial", firstListed: true },
  { id: "higuain", en: "Gonzalo Higuaín", he: "גונסאלו היגוואין", aliases: ["Higuain", "היגוואין"], nat: "ARG", pos: "FW", tier: 2, clubs: ["river", "real_madrid", "napoli", "juventus", "inter_miami"], seq: "partial", firstListed: true },
  { id: "dybala", en: "Paulo Dybala", he: "פאולו דיבאלה", aliases: ["Dybala", "דיבאלה"], nat: "ARG", pos: "FW", tier: 2, clubs: ["palermo_placeholder", "juventus", "roma"], seq: "partial", firstListed: false },
  { id: "mascherano", en: "Javier Mascherano", he: "חבייר מסצ'ראנו", aliases: ["Mascherano", "מסצ'ראנו"], nat: "ARG", pos: "MF", tier: 3, clubs: ["river", "corinthians", "west_ham", "liverpool", "barcelona"], seq: "partial", firstListed: true },
  { id: "batistuta", en: "Gabriel Batistuta", he: "גבריאל באטיסטוטה", aliases: ["Batistuta", "באטיסטוטה", "Batigol"], nat: "ARG", pos: "FW", tier: 2, clubs: ["boca", "fiorentina", "roma", "inter"], seq: "partial", firstListed: false },
  { id: "cavani", en: "Edinson Cavani", he: "אדינסון קוואני", aliases: ["Cavani", "קוואני"], nat: "URU", pos: "FW", tier: 2, clubs: ["danubio", "palermo_placeholder", "napoli", "psg", "man_utd", "valencia", "boca"], seq: "partial", firstListed: true },
  { id: "forlan", en: "Diego Forlán", he: "דייגו פורלאן", aliases: ["Forlan", "פורלאן"], nat: "URU", pos: "FW", tier: 3, clubs: ["independiente", "man_utd", "villarreal", "atletico", "inter"], seq: "partial", firstListed: false },
  { id: "godin", en: "Diego Godín", he: "דייגו גודין", aliases: ["Godin", "גודין"], nat: "URU", pos: "DF", tier: 3, clubs: ["nacional", "villarreal", "atletico", "inter"], seq: "partial", firstListed: true },

  // ================= Italy / Germany / Netherlands greats =================
  { id: "buffon", en: "Gianluigi Buffon", he: "ג'אנלואיג'י בופון", aliases: ["Buffon", "בופון"], nat: "ITA", pos: "GK", tier: 1, clubs: ["parma", "juventus", "psg", "juventus", "parma"], seq: "full", firstListed: true },
  { id: "maldini", en: "Paolo Maldini", he: "פאולו מלדיני", aliases: ["Maldini", "מלדיני"], nat: "ITA", pos: "DF", tier: 1, clubs: ["milan"], seq: "full", firstListed: true },
  { id: "totti", en: "Francesco Totti", he: "פרנצ'סקו טוטי", aliases: ["Totti", "טוטי"], nat: "ITA", pos: "FW", tier: 1, clubs: ["roma"], seq: "full", firstListed: true },
  { id: "del_piero", en: "Alessandro Del Piero", he: "אלסנדרו דל פיירו", aliases: ["Del Piero", "דל פיירו"], nat: "ITA", pos: "FW", tier: 2, clubs: ["padova_placeholder", "juventus"], seq: "partial", firstListed: false },
  { id: "pirlo", en: "Andrea Pirlo", he: "אנדריאה פירלו", aliases: ["Pirlo", "פירלו"], nat: "ITA", pos: "MF", tier: 2, clubs: ["brescia", "inter", "milan", "juventus", "ny_city_placeholder"], seq: "partial", firstListed: true },
  { id: "nesta", en: "Alessandro Nesta", he: "אלסנדרו נסטה", aliases: ["Nesta", "נסטה"], nat: "ITA", pos: "DF", tier: 3, clubs: ["lazio", "milan"], seq: "partial", firstListed: true },
  { id: "cannavaro", en: "Fabio Cannavaro", he: "פאביו קנאבארו", aliases: ["Cannavaro", "קנאבארו"], nat: "ITA", pos: "DF", tier: 3, clubs: ["napoli", "parma", "inter", "juventus", "real_madrid"], seq: "partial", firstListed: true },
  { id: "baggio", en: "Roberto Baggio", he: "רוברטו באג'ו", aliases: ["Baggio", "באג'ו"], nat: "ITA", pos: "FW", tier: 2, clubs: ["fiorentina", "juventus", "milan", "bologna", "inter", "brescia"], seq: "partial", firstListed: false },
  { id: "inzaghi_f", en: "Filippo Inzaghi", he: "פיליפו אינזאגי", aliases: ["Inzaghi", "אינזאגי"], nat: "ITA", pos: "FW", tier: 3, clubs: ["parma", "atalanta", "juventus", "milan"], seq: "partial", firstListed: false },
  { id: "verratti", en: "Marco Verratti", he: "מרקו ורטי", aliases: ["Verratti", "ורטי"], nat: "ITA", pos: "MF", tier: 3, clubs: ["pescara_placeholder", "psg"], seq: "partial", firstListed: false },
  { id: "donnarumma", en: "Gianluigi Donnarumma", he: "ג'אנלואיג'י דונארומה", aliases: ["Donnarumma", "דונארומה"], nat: "ITA", pos: "GK", tier: 2, clubs: ["milan", "psg", "man_city"], seq: "partial", firstListed: true },

  { id: "beckenbauer", en: "Franz Beckenbauer", he: "פרנץ בקנבאואר", aliases: ["Beckenbauer", "בקנבאואר"], nat: "GER", pos: "DF", tier: 2, clubs: ["bayern", "ny_cosmos_placeholder", "hamburg"], seq: "partial", firstListed: true },
  { id: "muller_g", en: "Gerd Müller", he: "גרד מולר", aliases: ["Gerd Muller", "מולר"], nat: "GER", pos: "FW", tier: 2, clubs: ["bayern"], seq: "partial", firstListed: false },
  { id: "muller_t", en: "Thomas Müller", he: "תומאס מולר", aliases: ["Thomas Muller", "תומאס מולר"], nat: "GER", pos: "FW", tier: 2, clubs: ["bayern"], seq: "partial", firstListed: true },
  { id: "klose", en: "Miroslav Klose", he: "מירוסלב קלוזה", aliases: ["Klose", "קלוזה"], nat: "GER", pos: "FW", tier: 2, clubs: ["kaiserslautern", "werder", "bayern", "lazio"], seq: "full", firstListed: true },
  { id: "ozil", en: "Mesut Özil", he: "מסוט אוזיל", aliases: ["Ozil", "Özil", "אוזיל"], nat: "GER", pos: "MF", tier: 2, clubs: ["schalke", "werder", "real_madrid", "arsenal", "fenerbahce"], seq: "full", firstListed: true },
  { id: "neuer", en: "Manuel Neuer", he: "מנואל נוייר", aliases: ["Neuer", "נוייר"], nat: "GER", pos: "GK", tier: 2, clubs: ["schalke", "bayern"], seq: "full", firstListed: true },
  { id: "ballack", en: "Michael Ballack", he: "מיכאל באלאק", aliases: ["Ballack", "באלאק"], nat: "GER", pos: "MF", tier: 3, clubs: ["kaiserslautern", "leverkusen", "bayern", "chelsea", "leverkusen"], seq: "partial", firstListed: false },
  { id: "kahn", en: "Oliver Kahn", he: "אוליבר קאהן", aliases: ["Kahn", "קאהן"], nat: "GER", pos: "GK", tier: 3, clubs: ["karlsruhe_placeholder", "bayern"], seq: "partial", firstListed: false },
  { id: "sammer", en: "Matthias Sammer", he: "מתיאס סאמר", aliases: ["Sammer", "סאמר"], nat: "GER", pos: "DF", tier: 3, clubs: ["stuttgart", "inter", "dortmund"], seq: "partial", firstListed: false },

  { id: "cruyff", en: "Johan Cruyff", he: "יוהאן קרויף", aliases: ["Cruyff", "קרויף"], nat: "NED", pos: "FW", tier: 1, clubs: ["ajax", "barcelona", "la_galaxy_placeholder", "feyenoord"], seq: "partial", firstListed: true },
  { id: "van_basten", en: "Marco van Basten", he: "מארקו ואן באסטן", aliases: ["Van Basten", "ואן באסטן"], nat: "NED", pos: "FW", tier: 2, clubs: ["ajax", "milan"], seq: "full", firstListed: true },
  { id: "gullit", en: "Ruud Gullit", he: "רוד חוליט", aliases: ["Gullit", "חוליט"], nat: "NED", pos: "MF", tier: 3, clubs: ["feyenoord", "psv", "milan", "sampdoria", "chelsea"], seq: "partial", firstListed: false },
  { id: "rijkaard", en: "Frank Rijkaard", he: "פרנק רייקארד", aliases: ["Rijkaard", "רייקארד"], nat: "NED", pos: "MF", tier: 3, clubs: ["ajax", "milan", "ajax"], seq: "partial", firstListed: true },
  { id: "bergkamp", en: "Dennis Bergkamp", he: "דניס ברגקמפ", aliases: ["Bergkamp", "ברגקמפ"], nat: "NED", pos: "FW", tier: 2, clubs: ["ajax", "inter", "arsenal"], seq: "full", firstListed: true },
  { id: "van_nistelrooy", en: "Ruud van Nistelrooy", he: "רוד ואן ניסטלרוי", aliases: ["Van Nistelrooy", "ואן ניסטלרוי"], nat: "NED", pos: "FW", tier: 2, clubs: ["heerenveen_placeholder", "psv", "man_utd", "real_madrid", "hamburg", "malaga_placeholder"], seq: "partial", firstListed: false },
  { id: "robben", en: "Arjen Robben", he: "אריאן רובן", aliases: ["Robben", "רובן"], nat: "NED", pos: "FW", tier: 2, clubs: ["groningen", "psv", "chelsea", "real_madrid", "bayern", "groningen"], seq: "full", firstListed: true },
  { id: "sneijder", en: "Wesley Sneijder", he: "ווסלי סניידר", aliases: ["Sneijder", "סניידר"], nat: "NED", pos: "MF", tier: 2, clubs: ["ajax", "real_madrid", "inter", "galatasaray", "nice"], seq: "partial", firstListed: true },
  { id: "seedorf", en: "Clarence Seedorf", he: "קלארנס סיידורף", aliases: ["Seedorf", "סיידורף"], nat: "NED", pos: "MF", tier: 3, clubs: ["ajax", "sampdoria", "real_madrid", "inter", "milan"], seq: "partial", firstListed: true },
  { id: "davids", en: "Edgar Davids", he: "אדגר דאוויס", aliases: ["Davids", "דאוויס"], nat: "NED", pos: "MF", tier: 3, clubs: ["ajax", "milan", "juventus", "barcelona", "inter", "tottenham"], seq: "partial", firstListed: true },
  { id: "kluivert", en: "Patrick Kluivert", he: "פטריק קלוויבר", aliases: ["Kluivert", "קלוויבר"], nat: "NED", pos: "FW", tier: 3, clubs: ["ajax", "milan", "barcelona", "newcastle", "valencia", "psv"], seq: "partial", firstListed: true },
  { id: "depay", en: "Memphis Depay", he: "ממפיס דפאי", aliases: ["Depay", "Memphis", "דפאי"], nat: "NED", pos: "FW", tier: 3, clubs: ["psv", "man_utd", "lyon", "barcelona", "atletico"], seq: "partial", firstListed: true },

  // ================= Portugal / Belgium / other =================
  { id: "figo", en: "Luís Figo", he: "לואיס פיגו", aliases: ["Figo", "פיגו"], nat: "POR", pos: "FW", tier: 2, clubs: ["sporting", "barcelona", "real_madrid", "inter"], seq: "full", firstListed: true },
  { id: "eusebio", en: "Eusébio", he: "אוזביו", aliases: ["Eusebio"], nat: "POR", pos: "FW", tier: 3, clubs: ["benfica"], seq: "partial", firstListed: false },
  { id: "deco", en: "Deco", he: "דקו", aliases: [], nat: "POR", pos: "MF", tier: 3, clubs: ["porto", "barcelona", "chelsea", "fluminense"], seq: "partial", firstListed: false },
  { id: "pepe", en: "Pepe", he: "פפה", aliases: [], nat: "POR", pos: "DF", tier: 3, clubs: ["porto", "real_madrid", "besiktas", "porto"], seq: "partial", firstListed: false },
  { id: "joao_felix", en: "João Félix", he: "ז'ואאו פליקס", aliases: ["Joao Felix", "Felix", "פליקס"], nat: "POR", pos: "FW", tier: 3, clubs: ["benfica", "atletico", "chelsea"], seq: "partial", firstListed: true },
  { id: "hazard", en: "Eden Hazard", he: "אדן אזאר", aliases: ["Hazard", "אזאר"], nat: "BEL", pos: "FW", tier: 2, clubs: ["lille", "chelsea", "real_madrid"], seq: "full", firstListed: true },
  { id: "lukaku", en: "Romelu Lukaku", he: "רומלו לוקאקו", aliases: ["Lukaku", "לוקאקו"], nat: "BEL", pos: "FW", tier: 2, clubs: ["anderlecht", "chelsea", "everton", "man_utd", "inter", "chelsea", "napoli"], seq: "partial", firstListed: true },
  { id: "eto_o", en: "Samuel Eto'o", he: "סמואל אטו", aliases: ["Eto'o", "Etoo", "אטו"], nat: "CMR", pos: "FW", tier: 2, clubs: ["real_madrid", "mallorca", "barcelona", "inter", "anzhi_placeholder", "chelsea", "everton"], seq: "partial", firstListed: false },
  { id: "drogba", en: "Didier Drogba", he: "דידייה דרוגבה", aliases: ["Drogba", "דרוגבה"], nat: "CIV", pos: "FW", tier: 2, clubs: ["guingamp_placeholder", "marseille", "chelsea", "galatasaray", "chelsea"], seq: "partial", firstListed: false },
  { id: "toure_y", en: "Yaya Touré", he: "יאיה טורה", aliases: ["Yaya Toure", "טורה"], nat: "CIV", pos: "MF", tier: 3, clubs: ["olympiacos", "monaco", "barcelona", "man_city"], seq: "partial", firstListed: false },
  { id: "mane", en: "Sadio Mané", he: "סאדיו מאנה", aliases: ["Mane", "Mané", "מאנה"], nat: "SEN", pos: "FW", tier: 2, clubs: ["salzburg", "southampton", "liverpool", "bayern", "al_nassr"], seq: "partial", firstListed: false },
  { id: "weah_g", en: "George Weah", he: "ג'ורג' וואה", aliases: ["Weah", "וואה"], nat: "LBR", pos: "FW", tier: 3, clubs: ["monaco", "psg", "milan", "chelsea", "man_city", "marseille"], seq: "partial", firstListed: false },
  { id: "yashin", en: "Lev Yashin", he: "לב יאשין", aliases: ["Yashin", "יאשין"], nat: "URS", pos: "GK", tier: 3, clubs: ["dinamo_moscow_placeholder"], seq: "partial", firstListed: true },
  { id: "hagi", en: "Gheorghe Hagi", he: "גאורגה האג'י", aliases: ["Hagi", "האג'י"], nat: "ROU", pos: "MF", tier: 3, clubs: ["steaua", "real_madrid", "brescia", "barcelona", "galatasaray"], seq: "partial", firstListed: false },
  { id: "stoichkov", en: "Hristo Stoichkov", he: "חריסטו סטויצ'קוב", aliases: ["Stoichkov", "סטויצ'קוב"], nat: "BUL", pos: "FW", tier: 3, clubs: ["cska_sofia_placeholder", "barcelona", "parma", "barcelona"], seq: "partial", firstListed: false },
  { id: "shevchenko", en: "Andriy Shevchenko", he: "אנדריי שבצ'נקו", aliases: ["Shevchenko", "שבצנקו", "שבצ'נקו"], nat: "UKR", pos: "FW", tier: 2, clubs: ["dynamo_kyiv_placeholder", "milan", "chelsea", "milan"], seq: "partial", firstListed: false },
  { id: "nedved", en: "Pavel Nedvěd", he: "פאבל נדבד", aliases: ["Nedved", "נדבד"], nat: "CZE", pos: "MF", tier: 3, clubs: ["sparta_prague_placeholder", "lazio", "juventus"], seq: "partial", firstListed: false },
  { id: "rakitic", en: "Ivan Rakitić", he: "איבן ראקיטיץ'", aliases: ["Rakitic", "ראקיטיץ"], nat: "CRO", pos: "MF", tier: 3, clubs: ["basel", "schalke", "sevilla", "barcelona", "sevilla"], seq: "full", firstListed: true },
  { id: "mandzukic", en: "Mario Mandžukić", he: "מריו מנדז'וקיץ'", aliases: ["Mandzukic", "מנדזוקיץ"], nat: "CRO", pos: "FW", tier: 3, clubs: ["dinamo_zagreb", "wolfsburg", "bayern", "atletico", "juventus", "milan"], seq: "partial", firstListed: false },
  { id: "kovacic", en: "Mateo Kovačić", he: "מאטאו קובאצ'יץ'", aliases: ["Kovacic", "קובאצ'יץ"], nat: "CRO", pos: "MF", tier: 3, clubs: ["dinamo_zagreb", "inter", "real_madrid", "chelsea", "man_city"], seq: "partial", firstListed: false },
  { id: "benayoun", en: "Yossi Benayoun", he: "יוסי בניון", aliases: ["Benayoun", "בניון"], nat: "ISR", pos: "MF", tier: 3, clubs: ["maccabi_haifa", "racing_santander", "west_ham", "liverpool", "chelsea", "maccabi_haifa"], seq: "partial", firstListed: false },
  { id: "zahavi", en: "Eran Zahavi", he: "ערן זהבי", aliases: ["Zahavi", "זהבי"], nat: "ISR", pos: "FW", tier: 3, clubs: ["hapoel_tlv", "palermo_placeholder", "maccabi_tlv", "guangzhou", "psv", "maccabi_tlv"], seq: "partial", firstListed: false },
];

export const PLAYER_BY_ID = new Map(PLAYERS.map((p) => [p.id, p]));

// Nationality display names for the Hebrew UI, plus accepted free-text forms.
export const NATIONALITIES: Record<string, { he: string; aliases: string[] }> = {
  ARG: { he: "ארגנטינה", aliases: ["Argentina", "ארגנטינאי"] },
  BRA: { he: "ברזיל", aliases: ["Brazil", "ברזילאי"] },
  POR: { he: "פורטוגל", aliases: ["Portugal", "פורטוגזי"] },
  ESP: { he: "ספרד", aliases: ["Spain", "ספרדי"] },
  FRA: { he: "צרפת", aliases: ["France", "צרפתי"] },
  ENG: { he: "אנגליה", aliases: ["England", "אנגלי"] },
  GER: { he: "גרמניה", aliases: ["Germany", "גרמני"] },
  ITA: { he: "איטליה", aliases: ["Italy", "איטלקי"] },
  NED: { he: "הולנד", aliases: ["Netherlands", "Holland", "הולנדי"] },
  BEL: { he: "בלגיה", aliases: ["Belgium", "בלגי"] },
  URU: { he: "אורוגוואי", aliases: ["Uruguay", "אורוגוואי"] },
  POL: { he: "פולין", aliases: ["Poland", "פולני"] },
  SWE: { he: "שוודיה", aliases: ["Sweden", "שוודי"] },
  NOR: { he: "נורווגיה", aliases: ["Norway", "נורווגי"] },
  CRO: { he: "קרואטיה", aliases: ["Croatia", "קרואטי"] },
  EGY: { he: "מצרים", aliases: ["Egypt", "מצרי"] },
  SEN: { he: "סנגל", aliases: ["Senegal", "סנגלי"] },
  CIV: { he: "חוף השנהב", aliases: ["Ivory Coast", "Cote d'Ivoire"] },
  CMR: { he: "קמרון", aliases: ["Cameroon", "קמרוני"] },
  KOR: { he: "דרום קוריאה", aliases: ["South Korea", "Korea"] },
  ISR: { he: "ישראל", aliases: ["Israel", "ישראלי"] },
  WAL: { he: "ויילס", aliases: ["Wales", "ולשי"] },
  NGA: { he: "ניגריה", aliases: ["Nigeria", "ניגרי"] },
  MAR: { he: "מרוקו", aliases: ["Morocco", "מרוקאי"] },
  GEO: { he: "גאורגיה", aliases: ["Georgia", "גאורגי"] },
  UKR: { he: "אוקראינה", aliases: ["Ukraine", "אוקראיני"] },
  CZE: { he: "צ'כיה", aliases: ["Czech Republic", "צ'כי"] },
  ROU: { he: "רומניה", aliases: ["Romania", "רומני"] },
  BUL: { he: "בולגריה", aliases: ["Bulgaria", "בולגרי"] },
  LBR: { he: "ליבריה", aliases: ["Liberia"] },
  URS: { he: "ברית המועצות", aliases: ["Soviet Union", "USSR"] },
};
