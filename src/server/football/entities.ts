// The football entity model.
//
// WHY THIS EXISTS
//
// API-Football stores clubs and national teams in one `teams` table, youth and
// reserve sides alongside senior ones, and distinguishes them only by a boolean
// (`national`) that is wrong for youth internationals. Everything downstream —
// transfers, career paths, distractors — then treats a "team" as a single kind
// of thing, and the bank fills up with questions like:
//
//   "לאיזו קבוצה עבר X מ-Monaco?"   options: Lille, Japan, Sevilla, Porto
//
// Japan is a national team. It can never be the answer to a club transfer, and
// a player looking at those four options knows that, so the question is both
// wrong-looking and easier than its difficulty claims. Measured in production
// before this module: 2,291 active club-transfer questions had at least one
// national team among their options.
//
// So a team is classified ONCE, here, into a semantic kind, and every generator
// states which kind it needs. The provider's boolean is an input to that
// decision, not the decision.

/**
 * What a question's answer *is*, independent of how it is phrased.
 *
 * Every archetype declares one of these (see ./archetypes.ts) and the distractor
 * engine refuses to mix them. The list is deliberately narrow: a type exists here
 * only where confusing it with another produces a broken question.
 */
export type EntityType =
  | "PLAYER"
  | "CLUB"
  | "NATIONAL_TEAM"
  | "COUNTRY"
  | "COMPETITION"
  | "STADIUM"
  | "COACH"
  | "POSITION"
  | "POSITION_GROUP"
  | "SEASON"
  | "SCORELINE"
  | "COUNT";

export const ENTITY_TYPES: EntityType[] = [
  "PLAYER", "CLUB", "NATIONAL_TEAM", "COUNTRY", "COMPETITION", "STADIUM",
  "COACH", "POSITION", "POSITION_GROUP", "SEASON", "SCORELINE", "COUNT",
];

/**
 * What kind of team a `teams` row actually describes.
 *
 * CLUB is the only kind a club question may use. The other four exist so they
 * can be *excluded* by name rather than by an ad-hoc regex at each call site,
 * and so career semantics can tell a B-team spell from a senior one.
 */
export type TeamKind =
  | "CLUB"
  | "NATIONAL_TEAM"
  /** Croatia U21, England U19 — a national team, but not *the* national team. */
  | "YOUTH_NATIONAL_TEAM"
  /** Barcelona B, Real Madrid II, Bayern München II. A senior side, not the first team. */
  | "RESERVE_TEAM"
  /** Chelsea U21, Borussia Dortmund U19. Academy football. */
  | "YOUTH_TEAM";

export const TEAM_KINDS: TeamKind[] = [
  "CLUB", "NATIONAL_TEAM", "YOUTH_NATIONAL_TEAM", "RESERVE_TEAM", "YOUTH_TEAM",
];

/** The entity type a team of each kind can legally answer. */
export function entityTypeOfTeam(kind: TeamKind): EntityType {
  return kind === "NATIONAL_TEAM" || kind === "YOUTH_NATIONAL_TEAM" ? "NATIONAL_TEAM" : "CLUB";
}

/**
 * Whether a team may appear in a club question, as the answer or as a distractor.
 *
 * Reserve and youth sides are excluded even though they are technically clubs.
 * "Bayern München II" as one of four options in a transfer question is not a
 * plausible wrong answer — it is a provider artefact, and seeing one tells the
 * player which options were generated rather than chosen.
 */
export function isAskableClub(kind: TeamKind): boolean {
  return kind === "CLUB";
}

/** Whether a team may appear in a national-team question. */
export function isAskableNationalTeam(kind: TeamKind): boolean {
  return kind === "NATIONAL_TEAM";
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Suffixes that mark a second team.
 *
 * Anchored to the end of the name, because the substring forms are all real
 * senior clubs: "Atletico Madrid" contains "Atletic", "Willem II" ends in "II"
 * and is a first-division Dutch club, "Internacional" contains "II" nowhere but
 * "Inter" everywhere. Anchoring plus the exception list below is what keeps this
 * from quietly demoting real clubs.
 */
const RESERVE_SUFFIX = /\s(?:II|III|B|C|Atl[eè]tic|Castilla|Reserves?|B\sTeam|Bis)$/i;

/** Youth-team markers: an age group at the end of the name. */
const YOUTH_SUFFIX = /\s[UI]-?(?:14|15|16|17|18|19|20|21|22|23)$/i;

/** Also seen as a standalone word rather than a suffix ("Nice U21 B"). */
const YOUTH_ANYWHERE = /\b[UI]-?(?:14|15|16|17|18|19|20|21|22|23)\b/i;

/** Women's football is a separate competition pyramid, not a reserve side. */
const WOMEN_SUFFIX = /\s(?:W|Women|Feminino|Femenino|Femminile|\(W\))$/i;

/**
 * Senior clubs whose own name ends in a reserve marker.
 *
 * An allow-list rather than a cleverer pattern, because the thing that separates
 * "Willem II" from "Auxerre II" is not in the string — it is the knowledge that
 * one is a Dutch first-division club and the other is a French fourth-tier
 * reserve side. Short on purpose: anchoring the pattern to the end of the name
 * already excludes every club that merely *contains* a marker ("Atletico
 * Madrid", "Internacional", "Athletic Club"), so only true suffix collisions
 * need naming here.
 */
const SENIOR_DESPITE_SUFFIX = new Set(
  [
    "Willem II", // Netherlands, Eredivisie
  ].map((name) => name.toLowerCase())
);

export interface TeamClassificationInput {
  name: string;
  /** The provider's own `national` flag, as stored in teams.is_national. */
  isNational?: boolean | number | null;
  /** A curated override, when the provider and the patterns both get it wrong. */
  override?: TeamKind | null;
}

/**
 * The semantic kind of one team.
 *
 * Order matters and is the whole design:
 *
 *  1. A curated override wins. There is no pattern that gets every club right.
 *  2. A youth age group wins over the provider's flag, because the flag is wrong
 *     for exactly this case: API-Football returns `national: false` for
 *     "Croatia U21", so believing it puts a youth international squad into the
 *     club pool. Production held three of them.
 *  3. The provider's flag decides senior national teams. It is reliable there.
 *  4. Reserve suffixes, after the senior allow-list.
 *  5. Everything else is a club.
 */
export function classifyTeam(input: TeamClassificationInput): TeamKind {
  if (input.override) return input.override;

  const name = (input.name ?? "").trim();
  const lower = name.toLowerCase();
  const flaggedNational = input.isNational === true || input.isNational === 1;

  if (YOUTH_SUFFIX.test(name) || YOUTH_ANYWHERE.test(name)) {
    // An age group on a country name is a youth international side; on a club
    // name it is an academy team. `looksLikeCountry` is what separates them.
    const base = name.replace(YOUTH_SUFFIX, "").replace(YOUTH_ANYWHERE, "").trim();
    return flaggedNational || looksLikeCountry(base) ? "YOUTH_NATIONAL_TEAM" : "YOUTH_TEAM";
  }

  if (flaggedNational) return "NATIONAL_TEAM";

  // Women's sides are senior clubs in their own pyramid. Not reserve teams, and
  // not currently asked about — but misclassifying them as reserves would hide
  // that, so they are named.
  if (WOMEN_SUFFIX.test(name)) return "CLUB";

  if (!SENIOR_DESPITE_SUFFIX.has(lower) && RESERVE_SUFFIX.test(name)) return "RESERVE_TEAM";

  return "CLUB";
}

/**
 * The parent club of a reserve or youth side, by name.
 *
 * Mechanical: strip the suffix and see whether a senior club of that name is
 * known. "Barcelona B" -> "Barcelona", "Bayern München II" -> "Bayern München".
 * Returns null rather than guessing when no senior club matches, which is the
 * common case for lower-division reserve sides whose first team was never
 * harvested.
 */
export function parentClubName(name: string, seniorClubNames: Set<string>): string | null {
  const stripped = (name ?? "")
    .replace(YOUTH_SUFFIX, "")
    .replace(RESERVE_SUFFIX, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped || stripped === name.trim()) return null;
  if (seniorClubNames.has(stripped)) return stripped;
  // Provider naming differs between a first team and its reserve side often
  // enough to be worth one normalisation pass: "Atlético Madrid II" against
  // "Atletico Madrid".
  const folded = fold(stripped);
  for (const candidate of seniorClubNames) {
    if (fold(candidate) === folded) return candidate;
  }
  return null;
}

const fold = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Country names a youth suffix can be attached to.
 *
 * Only the countries this product's data actually reaches. A name not on the
 * list falls through to YOUTH_TEAM, which is the safe direction: a misfiled
 * academy side is excluded from club questions either way, and only the
 * national-team pool would be polluted by the opposite mistake.
 */
const COUNTRY_NAMES = new Set(
  [
    "Albania", "Algeria", "Argentina", "Australia", "Austria", "Belgium", "Bolivia", "Bosnia",
    "Brazil", "Bulgaria", "Cameroon", "Canada", "Chile", "China", "Colombia", "Costa Rica",
    "Croatia", "Czech Republic", "Denmark", "Ecuador", "Egypt", "England", "Finland", "France",
    "Georgia", "Germany", "Ghana", "Greece", "Hungary", "Iceland", "Iran", "Iraq", "Ireland",
    "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan", "Mexico", "Morocco", "Netherlands",
    "New Zealand", "Nigeria", "North Macedonia", "Northern Ireland", "Norway", "Paraguay", "Peru",
    "Poland", "Portugal", "Qatar", "Romania", "Russia", "Saudi Arabia", "Scotland", "Senegal",
    "Serbia", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", "Sweden",
    "Switzerland", "Tunisia", "Turkey", "Ukraine", "Uruguay", "USA", "Venezuela", "Wales",
  ].map(fold)
);

export function looksLikeCountry(name: string): boolean {
  return COUNTRY_NAMES.has(fold(name));
}

// ---------------------------------------------------------------------------
// Typed candidates — what the distractor engine and the validator exchange
// ---------------------------------------------------------------------------

/**
 * One possible answer, carrying its own type.
 *
 * The type travels WITH the value rather than being inferred from it later. That
 * is the single change that makes the entity-type invariant enforceable: a
 * function handed a list of these cannot accidentally mix kinds, because mixing
 * them is visible in the data instead of hidden in a string.
 */
export interface Candidate {
  text: string;
  type: EntityType;
  /** For teams: which kind, so club questions can exclude reserve sides. */
  teamKind?: TeamKind;
  /** 0 = household name, 3 = nobody has heard of it. Drives plausibility. */
  prominence?: number;
  /** Free-form tags used to rank plausibility: country, league code, era. */
  country?: string | null;
  competitionCode?: string | null;
  era?: number | null;
  /** The entity's own id, where one exists, for exclusion by identity. */
  id?: number | string | null;
}

export const clubCandidate = (
  text: string,
  extra: Omit<Partial<Candidate>, "text" | "type"> = {}
): Candidate => ({ text, type: "CLUB", teamKind: "CLUB", ...extra });

export const nationalTeamCandidate = (
  text: string,
  extra: Omit<Partial<Candidate>, "text" | "type"> = {}
): Candidate => ({ text, type: "NATIONAL_TEAM", teamKind: "NATIONAL_TEAM", ...extra });

export const playerCandidate = (
  text: string,
  extra: Omit<Partial<Candidate>, "text" | "type"> = {}
): Candidate => ({ text, type: "PLAYER", ...extra });
