// Prominence: how well known a thing is to *this* audience.
//
// WHY THIS EXISTS
//
// Production labelled this HARD:
//
//   "לאיזו קבוצה עבר C. Dagba מ-Auxerre בשנת 2024?"
//
// Colin Dagba is a fringe full-back; the move was between a Ligue 1 side and a
// newly promoted one; almost nobody playing a Hebrew football quiz has heard of
// him. The question is answerable and verifiable, so it belongs in the bank —
// but a player who reads it thinks "who is this?", and that reaction is the
// definition of EXPERT or IMPOSSIBLE, not HARD.
//
// The old model could not tell the difference, because its only subject signal
// was `subjectProminence`, which almost every caller left unset. So difficulty
// came down to the question's shape and how old the fact was, and 53% of the
// bank landed on HARD.
//
// Prominence is scored here from the data we actually hold, on one scale per
// dimension, so the difficulty model can combine them instead of guessing.
//
// THE AUDIENCE IS THE POINT. Football IQ is Hebrew-first. The Israeli Premier
// League is therefore a CORE competition even though it is not globally elite,
// and the J-League is not even though it is professionally comparable. That is
// not a judgement about the football; it is a statement about what the people
// playing this quiz have watched.

/**
 * How familiar a competition's world is.
 *
 *  CORE      — the audience follows it. Can produce any difficulty.
 *  NEAR_CORE — adjacent and partly followed. A modest increase.
 *  NON_CORE  — outside the audience's football. A strong increase.
 */
export type DomainTier = "CORE" | "NEAR_CORE" | "NON_CORE";

/**
 * The core football universe, by the app's own competition codes.
 *
 * These are the codes in src/shared/constants.ts, which is what question scopes
 * are tagged with — so this table and the builder's filters cannot drift apart.
 */
export const CORE_COMPETITIONS = new Set([
  "PREMIER_LEAGUE",
  "LA_LIGA",
  "SERIE_A",
  "BUNDESLIGA",
  "LIGUE_1",
  "LIGA_PORTUGAL",
  // Hebrew-first product: the domestic league is core by audience, not by UEFA
  // coefficient. See the module header.
  "ISRAELI_PREMIER_LEAGUE",
  "UCL",
  "UEL",
  "WORLD_CUP",
  "EURO",
  "COPA_AMERICA",
]);

/**
 * One step out. Followed by the keen rather than the casual.
 *
 * The Eredivisie is here rather than in CORE because the app supports Liga
 * Portugal as its sixth major European league (TOP_6_EUROPE), and the audience's
 * attention follows that grouping. The Conference League is here for the same
 * reason the Europa League is core and it is not: finals get watched, group
 * stages do not.
 */
export const NEAR_CORE_COMPETITIONS = new Set(["EREDIVISIE", "UECL"]);

/** Competition country names that belong to the core leagues, for provider rows. */
const CORE_COUNTRIES = new Set(["England", "Spain", "Italy", "Germany", "France", "Portugal", "Israel"]);
const NEAR_CORE_COUNTRIES = new Set(["Netherlands", "Brazil", "Argentina"]);

export interface CompetitionProminenceInput {
  /** The app's own code, where the competition maps to one. */
  localCode?: string | null;
  /** The provider's country for the competition. */
  countryName?: string | null;
  /** The provider's own priority, 1 = most important. */
  priority?: number | null;
  /** LEAGUE | CUP | CONTINENTAL | INTERNATIONAL, as stored. */
  type?: string | null;
}

/**
 * Which tier a competition sits in.
 *
 * A mapped local code is decisive, because those are exactly the competitions
 * the product chose to expose. Everything else is judged on country and the
 * provider's priority: a top-flight division in a core country that we simply
 * have not given a code to is still near-core football, while an unmapped
 * competition in an unlisted country is the Asian/African/second-division case
 * the spec asks to push upward.
 */
export function competitionTier(input: CompetitionProminenceInput): DomainTier {
  const code = input.localCode ?? null;
  if (code && CORE_COMPETITIONS.has(code)) return "CORE";
  if (code && NEAR_CORE_COMPETITIONS.has(code)) return "NEAR_CORE";

  const country = input.countryName ?? null;
  if (country && CORE_COUNTRIES.has(country)) {
    // A cup or a lower division inside a core country: familiar ground, but not
    // the competition the audience actually watches week to week.
    return (input.priority ?? 9) <= 2 ? "CORE" : "NEAR_CORE";
  }
  if (country && NEAR_CORE_COUNTRIES.has(country)) return "NEAR_CORE";

  // National-team football at large is followed well beyond the four tournaments
  // named above — a World Cup qualifier is not obscure.
  if ((input.type ?? "").toUpperCase() === "INTERNATIONAL") return "NEAR_CORE";

  return "NON_CORE";
}

/** How much a tier costs on the difficulty scale. Consumed by ./difficulty.ts. */
export const DOMAIN_TIER_WEIGHT: Record<DomainTier, number> = {
  CORE: 0,
  NEAR_CORE: 0.6,
  NON_CORE: 1.6,
};

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------

export interface ClubProminenceInput {
  /** The club's own league code, where it maps to one. */
  localCode?: string | null;
  countryName?: string | null;
  /** Best (lowest) provider priority across the competitions it has played in. */
  competitionPriority?: number | null;
  /** How many European campaigns we hold for it. */
  europeanSeasons?: number;
  /** How many league or cup titles we hold for it. */
  titles?: number;
  /** How many harvested competition-seasons it appears in: a coverage proxy. */
  harvestedSeasons?: number;
  /** True for a club named in the curated registry, which is itself a fame list. */
  curated?: boolean;
}

/**
 * Club prominence, 0 (Real Madrid) to 3 (a fourth-tier side nobody has heard of).
 *
 * The signals are all things the database actually knows. `curated` is the
 * strongest of them and is not a shortcut: seed/data/clubs.ts was assembled as a
 * list of clubs a Hebrew-speaking fan recognises, so membership in it is the most
 * direct evidence of recognition available anywhere in this codebase.
 */
export function clubProminence(input: ClubProminenceInput): number {
  if (input.curated) {
    // Even inside the curated set there is a gap between Barcelona and Maccabi
    // Netanya, and titles are what separates them.
    const titles = input.titles ?? 0;
    if (titles >= 3) return 0;
    if (titles >= 1) return 0.4;
    return 0.9;
  }

  let score = 2.4;
  const tier = competitionTier({
    localCode: input.localCode,
    countryName: input.countryName,
    priority: input.competitionPriority,
  });
  if (tier === "CORE") score -= 1.0;
  else if (tier === "NEAR_CORE") score -= 0.4;

  if ((input.europeanSeasons ?? 0) >= 1) score -= 0.5;
  if ((input.europeanSeasons ?? 0) >= 3) score -= 0.3;
  if ((input.titles ?? 0) >= 1) score -= 0.5;
  if ((input.titles ?? 0) >= 3) score -= 0.3;
  // A club we hold several seasons for is one that keeps appearing in the
  // competitions worth harvesting.
  if ((input.harvestedSeasons ?? 0) >= 3) score -= 0.2;

  // A club with no competition record at all entered the database as the far end
  // of somebody's transfer. Those are the unanswerable ones.
  if (input.competitionPriority === null || input.competitionPriority === undefined) score += 0.6;

  return clamp(score, 0, 3);
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface PlayerFameInput {
  /** Curated tier, 1 = global icon. The strongest signal by far. */
  curatedTier?: 1 | 2 | 3 | null;
  /** Senior national-team appearances on record, or simply whether any exist. */
  hasSeniorNationalTeam?: boolean;
  /** Appearances recorded in CORE competitions. */
  coreAppearances?: number;
  /** Appearances recorded in the Champions League / Europa League. */
  europeanAppearances?: number;
  /** Distinct clubs on record in core leagues. */
  coreClubs?: number;
  /** Trophies on record. */
  trophies?: number;
  /** Distinct clubs on record anywhere — a coverage proxy, not a fame proxy. */
  recordedClubs?: number;
  /** Transfers on record. A player the provider tracks closely is a tracked player. */
  recordedTransfers?: number;
  /** Seasons of statistics on record. */
  recordedSeasons?: number;
  /** Best (lowest) prominence among the clubs he has played for. */
  bestClubProminence?: number | null;
}

/**
 * Player fame, 0 (Messi) to 3 (a fringe squad member).
 *
 * WHAT THIS IS NOT: a measure of how good the player is. A very good player in
 * the Danish Superliga scores worse than a mediocre one at Manchester United,
 * because the question is only ever "will the person reading this recognise the
 * name".
 *
 * WHY COVERAGE COUNTS. Appearances, transfers and stat rows are not fame, but
 * the provider's coverage correlates with it hard: API-Football holds deep
 * records for players in competitions people pay to watch and almost nothing for
 * the rest. Used as a weak signal alongside the real ones, it separates "we know
 * nothing about him" from "he is simply not famous", and those deserve different
 * difficulties.
 */
export function playerFame(input: PlayerFameInput): number {
  if (input.curatedTier) {
    return input.curatedTier === 1 ? 0 : input.curatedTier === 2 ? 0.8 : 1.5;
  }

  let score = 2.9;

  const core = input.coreAppearances ?? 0;
  if (core >= 200) score -= 1.3;
  else if (core >= 100) score -= 1.0;
  else if (core >= 40) score -= 0.6;
  else if (core >= 10) score -= 0.3;

  const european = input.europeanAppearances ?? 0;
  if (european >= 40) score -= 0.5;
  else if (european >= 10) score -= 0.3;

  if ((input.coreClubs ?? 0) >= 2) score -= 0.3;
  if ((input.coreClubs ?? 0) >= 4) score -= 0.2;
  if ((input.trophies ?? 0) >= 1) score -= 0.3;
  if ((input.trophies ?? 0) >= 5) score -= 0.3;
  if (input.hasSeniorNationalTeam) score -= 0.4;

  // Coverage, as a weak tie-breaker only.
  if ((input.recordedSeasons ?? 0) >= 6) score -= 0.2;
  if ((input.recordedTransfers ?? 0) >= 4) score -= 0.15;
  if ((input.recordedClubs ?? 0) >= 6) score -= 0.15;

  // Playing for a famous club is itself recognition: a squad player at Real
  // Madrid is better known than a star at Lorient.
  const bestClub = input.bestClubProminence;
  if (bestClub !== null && bestClub !== undefined) {
    if (bestClub <= 0.5) score -= 0.5;
    else if (bestClub <= 1.2) score -= 0.25;
  }

  return clamp(score, 0, 3);
}

/**
 * Whether a subject is too obscure for the lower difficulties.
 *
 * The guard the spec asks for, stated once so every caller gets the same answer:
 * a player nobody recognises does not belong in EASY or NORMAL at all, and
 * belongs in HARD only when the *fact* is famous independently of him.
 */
export const OBSCURE_FAME_THRESHOLD = 2.2;
export const VERY_OBSCURE_FAME_THRESHOLD = 2.7;

export const isObscureSubject = (fame: number): boolean => fame >= OBSCURE_FAME_THRESHOLD;
export const isVeryObscureSubject = (fame: number): boolean => fame >= VERY_OBSCURE_FAME_THRESHOLD;

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/**
 * How well known one particular fact is, independent of its subject.
 *
 *  HEADLINE — the move or result itself was news everybody saw. Mbappé to Real
 *             Madrid; Ronaldo to Al-Nassr; Messi to Inter Miami. This is the
 *             override that lets a globally famous fact in a non-core league
 *             stay accessible, which the spec asks for explicitly.
 *  KNOWN    — a fact a follower of that competition would know.
 *  OBSCURE  — a fact true, verifiable, and of interest to almost nobody.
 */
export type FactProminence = "HEADLINE" | "KNOWN" | "OBSCURE";

export const FACT_PROMINENCE_WEIGHT: Record<FactProminence, number> = {
  HEADLINE: -1.4,
  KNOWN: 0,
  OBSCURE: 0.7,
};

export interface FactProminenceInput {
  /** Fame of the person the fact is about, on the playerFame scale. */
  subjectFame?: number;
  /** Prominence of the most famous club involved, on the clubProminence scale. */
  bestClubProminence?: number;
  /** Prominence of the least famous club involved. */
  worstClubProminence?: number;
  /** The tier of the competition the fact sits in. */
  tier?: DomainTier;
  /** The year of the fact, for recency. */
  year?: number | null;
}

/**
 * Classifies a fact's prominence from its parts.
 *
 * The HEADLINE test is deliberately strict — a globally famous player AND two
 * prominent clubs AND a recent date. "Mbappé joined Real Madrid" passes. "An
 * obscure youth move by Mbappé" does not, which is precisely the distinction the
 * spec calls out: not every fact about a famous player is easy.
 */
export function factProminence(input: FactProminenceInput): FactProminence {
  const fame = input.subjectFame ?? 1.5;
  const best = input.bestClubProminence ?? 1.5;
  const worst = input.worstClubProminence ?? best;
  const year = input.year ?? null;
  const recent = year === null ? false : year >= 2015;

  if (fame <= 0.5 && best <= 0.6 && worst <= 1.2 && recent) return "HEADLINE";
  if (fame >= OBSCURE_FAME_THRESHOLD && worst >= 2.0) return "OBSCURE";
  if (input.tier === "NON_CORE" && fame >= 1.8) return "OBSCURE";
  return "KNOWN";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
