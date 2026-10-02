// Position normalisation.
//
// WHY THIS EXISTS
//
// Production asked "באיזו עמדה משחק מוחמד סלאח?" and answered "חלוץ".
//
// That answer came from one line of code: a four-entry lookup turning the stored
// code FW into the Hebrew word for striker. But FW is a *unit* — the front line —
// and "חלוץ" is a *role* within it. Salah has spent his whole Liverpool career on
// the right wing. So the question asked for a precise fact and was answered from
// data that only supports a broad one, and the result is not a hard question: it
// is a wrong one.
//
// The provider makes this easy to get wrong. API-Football returns exactly four
// position values — Goalkeeper, Defender, Midfielder, Attacker — for both the
// players and the squads endpoints. There is no detailed role in the feed at all.
// So the rule that matters is not "translate better", it is:
//
//   ASK THE QUESTION THE DATA SUPPORTS.
//
// Broad data gets a broad question ("באיזו חוליה משחק?" → התקפה). A precise
// question is only generated where a precise role is actually known, which in
// practice means curated. Confidence is carried explicitly so a generator cannot
// forget to check.
//
// Goalkeeper is the one honest exception, and it is a football fact rather than a
// convenience: the unit and the role are the same thing. A keeper is a keeper.

export type DetailedPosition =
  | "GK"
  | "CB" | "LB" | "RB" | "LWB" | "RWB"
  | "DM" | "CM" | "AM" | "LM" | "RM"
  | "LW" | "RW" | "CF" | "ST";

export const DETAILED_POSITIONS: DetailedPosition[] = [
  "GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "CM", "AM", "LM", "RM", "LW", "RW", "CF", "ST",
];

export type BroadPosition = "GOALKEEPER" | "DEFENDER" | "MIDFIELDER" | "FORWARD";

export const BROAD_POSITIONS: BroadPosition[] = ["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD"];

/** How much to trust a resolved *detailed* role. */
export type PositionConfidence = "HIGH" | "MEDIUM" | "LOW";

/** Which unit each detailed role belongs to. One direction only — the other is lossy. */
export const BROAD_OF: Record<DetailedPosition, BroadPosition> = {
  GK: "GOALKEEPER",
  CB: "DEFENDER", LB: "DEFENDER", RB: "DEFENDER", LWB: "DEFENDER", RWB: "DEFENDER",
  DM: "MIDFIELDER", CM: "MIDFIELDER", AM: "MIDFIELDER", LM: "MIDFIELDER", RM: "MIDFIELDER",
  LW: "FORWARD", RW: "FORWARD", CF: "FORWARD", ST: "FORWARD",
};

export const broadOf = (detailed: DetailedPosition): BroadPosition => BROAD_OF[detailed];

/**
 * Hebrew for each detailed role.
 *
 * "חלוץ" belongs to ST and nowhere else. That word is the whole bug this module
 * exists to fix, so it is spent on the one role it actually names.
 */
export const DETAILED_HE: Record<DetailedPosition, string> = {
  GK: "שוער",
  CB: "בלם",
  LB: "מגן שמאלי",
  RB: "מגן ימני",
  LWB: "מגן כנף שמאלי",
  RWB: "מגן כנף ימני",
  DM: "קשר הגנתי",
  CM: "קשר מרכזי",
  AM: "קשר התקפי",
  LM: "קשר שמאלי",
  RM: "קשר ימני",
  LW: "קיצוני שמאלי",
  RW: "קיצוני ימני",
  CF: "חלוץ מרכזי",
  ST: "חלוץ",
};

/** Hebrew for each unit. These are the only four answers a broad question has. */
export const BROAD_HE: Record<BroadPosition, string> = {
  GOALKEEPER: "שוער",
  DEFENDER: "הגנה",
  MIDFIELDER: "קישור",
  FORWARD: "התקפה",
};

/**
 * Detailed roles that are confusable with each other, for distractor selection.
 *
 * A precise-role question is only hard if the wrong options are roles the player
 * might plausibly have played. Offering "שוער" against "קיצוני ימני" is not a
 * question. Each group holds roles a fan could reasonably mix up.
 */
export const CONFUSABLE_WITH: Record<DetailedPosition, DetailedPosition[]> = {
  GK: ["CB", "LB", "RB"],
  CB: ["LB", "RB", "DM"],
  LB: ["LWB", "CB", "LM"],
  RB: ["RWB", "CB", "RM"],
  LWB: ["LB", "LM", "LW"],
  RWB: ["RB", "RM", "RW"],
  DM: ["CM", "CB", "AM"],
  CM: ["DM", "AM", "RM"],
  AM: ["CM", "CF", "LW"],
  LM: ["LW", "CM", "LB"],
  RM: ["RW", "CM", "RB"],
  LW: ["LM", "RW", "CF"],
  RW: ["RM", "LW", "CF"],
  CF: ["ST", "AM", "LW"],
  ST: ["CF", "LW", "RW"],
};

// ---------------------------------------------------------------------------
// Parsing provider strings
// ---------------------------------------------------------------------------

/**
 * Detailed-role spellings, for providers and feeds that carry them.
 *
 * API-Football does not, today — it returns only the four broad values. This map
 * is still the right shape, because the moment a detailed feed is wired in, a
 * precise question becomes legitimate without any other change. Until then the
 * broad branch below is what fires, and it says so.
 */
const DETAILED_ALIASES: Record<string, DetailedPosition> = {
  "goalkeeper": "GK", "keeper": "GK", "gk": "GK",
  "centre-back": "CB", "center-back": "CB", "centre back": "CB", "center back": "CB",
  "central defender": "CB", "cb": "CB",
  "left-back": "LB", "left back": "LB", "lb": "LB",
  "right-back": "RB", "right back": "RB", "rb": "RB",
  "left wing-back": "LWB", "left wingback": "LWB", "lwb": "LWB",
  "right wing-back": "RWB", "right wingback": "RWB", "rwb": "RWB",
  "defensive midfield": "DM", "defensive midfielder": "DM", "holding midfielder": "DM", "dm": "DM",
  "central midfield": "CM", "central midfielder": "CM", "centre midfield": "CM", "cm": "CM",
  "attacking midfield": "AM", "attacking midfielder": "AM", "am": "AM",
  "left midfield": "LM", "left midfielder": "LM", "lm": "LM",
  "right midfield": "RM", "right midfielder": "RM", "rm": "RM",
  "left winger": "LW", "left wing": "LW", "lw": "LW",
  "right winger": "RW", "right wing": "RW", "rw": "RW",
  "centre-forward": "CF", "center-forward": "CF", "centre forward": "CF", "center forward": "CF",
  "second striker": "CF", "cf": "CF",
  "striker": "ST", "st": "ST", "number 9": "ST",
};

/** The four values the provider actually emits, plus the synonyms seen in the wild. */
const BROAD_ALIASES: Record<string, BroadPosition> = {
  "goalkeeper": "GOALKEEPER", "keeper": "GOALKEEPER", "gk": "GOALKEEPER", "g": "GOALKEEPER",
  "defender": "DEFENDER", "defence": "DEFENDER", "defense": "DEFENDER", "df": "DEFENDER", "d": "DEFENDER",
  "midfielder": "MIDFIELDER", "midfield": "MIDFIELDER", "mf": "MIDFIELDER", "m": "MIDFIELDER",
  "attacker": "FORWARD", "forward": "FORWARD", "attack": "FORWARD", "fw": "FORWARD", "f": "FORWARD",
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** A detailed role, if the string names one. Null for a broad category. */
export function parseDetailedPosition(value: string | null | undefined): DetailedPosition | null {
  if (!value) return null;
  const key = normalize(value);
  const direct = DETAILED_ALIASES[key];
  if (!direct) return null;
  // "Goalkeeper" parses to GK here *and* to GOALKEEPER below. That is not a
  // conflict: see the module header.
  return direct;
}

/** The unit a string names, whether it was written broadly or precisely. */
export function parseBroadPosition(value: string | null | undefined): BroadPosition | null {
  if (!value) return null;
  const key = normalize(value);
  const broad = BROAD_ALIASES[key];
  if (broad) return broad;
  const detailed = DETAILED_ALIASES[key];
  return detailed ? broadOf(detailed) : null;
}

/** The four-letter codes the curated seed registry uses. */
export type SeedPositionCode = "GK" | "DF" | "MF" | "FW";

const SEED_BROAD: Record<SeedPositionCode, BroadPosition> = {
  GK: "GOALKEEPER",
  DF: "DEFENDER",
  MF: "MIDFIELDER",
  FW: "FORWARD",
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface PositionEvidence {
  /**
   * A curated precise role. The override layer, and the only source that can
   * produce HIGH confidence today.
   */
  curatedRole?: DetailedPosition | null;
  /** A detailed role from a reliable current/recent feed, where one exists. */
  providerDetailed?: string | null;
  /** Detailed squad metadata — same parsing, a notch less trusted. */
  squadDetailed?: string | null;
  /** The provider's broad category. In practice this is all API-Football gives. */
  providerBroad?: string | null;
  /** The curated registry's broad code. */
  seedBroad?: SeedPositionCode | null;
}

export interface ResolvedPosition {
  /** The precise role, or null when nothing establishes one. */
  detailed: DetailedPosition | null;
  /** The unit. Available from far more evidence than the role is. */
  broad: BroadPosition | null;
  /** Confidence in `detailed`, never in `broad`. LOW whenever detailed is null. */
  confidence: PositionConfidence;
  source:
    | "curated"
    | "provider-detailed"
    | "squad-detailed"
    | "goalkeeper-identity"
    | "provider-broad"
    | "seed-broad"
    | "none";
}

const NO_POSITION: ResolvedPosition = {
  detailed: null,
  broad: null,
  confidence: "LOW",
  source: "none",
};

/**
 * Resolves a player's position from the best available evidence.
 *
 * The evidence ladder is the spec's, with one rule imposed on top of it that
 * matters more than the order: BROAD EVIDENCE NEVER OVERWRITES A PRECISE ROLE,
 * and never *becomes* one. A broad value sets `broad` and leaves `detailed`
 * null, which is what makes the broad/precise distinction survive all the way to
 * the question text instead of being flattened on the way.
 */
export function resolvePosition(evidence: PositionEvidence): ResolvedPosition {
  // 1. Curated precise role.
  if (evidence.curatedRole) {
    return {
      detailed: evidence.curatedRole,
      broad: broadOf(evidence.curatedRole),
      confidence: "HIGH",
      source: "curated",
    };
  }

  // 2. A detailed role from the provider, where the feed carries one.
  const providerDetailed = parseDetailedPosition(evidence.providerDetailed);
  if (providerDetailed && !isBroadOnlyString(evidence.providerDetailed)) {
    return {
      detailed: providerDetailed,
      broad: broadOf(providerDetailed),
      confidence: "HIGH",
      source: "provider-detailed",
    };
  }

  // 3. Detailed squad metadata.
  const squadDetailed = parseDetailedPosition(evidence.squadDetailed);
  if (squadDetailed && !isBroadOnlyString(evidence.squadDetailed)) {
    return {
      detailed: squadDetailed,
      broad: broadOf(squadDetailed),
      confidence: "MEDIUM",
      source: "squad-detailed",
    };
  }

  // 4. Broad category. Sets the unit and stops — except for a goalkeeper, where
  //    the unit IS the role.
  const broad =
    parseBroadPosition(evidence.providerBroad) ??
    parseBroadPosition(evidence.providerDetailed) ??
    parseBroadPosition(evidence.squadDetailed) ??
    (evidence.seedBroad ? SEED_BROAD[evidence.seedBroad] : null);

  if (!broad) return NO_POSITION;

  if (broad === "GOALKEEPER") {
    return { detailed: "GK", broad, confidence: "HIGH", source: "goalkeeper-identity" };
  }

  return {
    detailed: null,
    broad,
    confidence: "LOW",
    source: evidence.providerBroad ? "provider-broad" : "seed-broad",
  };
}

/**
 * Whether a string is one of the four unit names.
 *
 * Needed because "Goalkeeper" is a legitimate key in both alias tables, so
 * `parseDetailedPosition` returning GK does not by itself prove the source was
 * precise. Without this check a provider field reading "Defender" would never
 * reach the broad branch — it would stop at step 2 as a detailed role, which is
 * exactly the flattening this module exists to prevent.
 */
function isBroadOnlyString(value: string | null | undefined): boolean {
  if (!value) return false;
  const key = normalize(value);
  if (key === "goalkeeper" || key === "gk" || key === "keeper") return false; // genuinely precise
  return key in BROAD_ALIASES;
}

/**
 * Whether a precise-role question may be generated from this resolution.
 *
 * HIGH or MEDIUM only, and a role must actually be present. LOW means the
 * generator must either ask the broad question or produce nothing — see
 * `positionQuestionShape`.
 */
export function supportsPreciseQuestion(resolved: ResolvedPosition): boolean {
  return resolved.detailed !== null && (resolved.confidence === "HIGH" || resolved.confidence === "MEDIUM");
}

export type PositionQuestionShape = "PRECISE" | "BROAD" | "NONE";

/** Which position question, if any, the evidence supports. */
export function positionQuestionShape(resolved: ResolvedPosition): PositionQuestionShape {
  if (supportsPreciseQuestion(resolved)) return "PRECISE";
  if (resolved.broad) return "BROAD";
  return "NONE";
}

/** The Hebrew wording for each shape. Kept beside the shape so they cannot drift. */
export const POSITION_QUESTION_HE = {
  /** Asks for the role. Only legal when the role is known. */
  PRECISE: (playerHe: string) => `מה התפקיד המדויק של ${playerHe}?`,
  /** Asks for the unit. Always legal when the unit is known. */
  BROAD: (playerHe: string) => `באיזו חוליה משחק ${playerHe}?`,
} as const;
