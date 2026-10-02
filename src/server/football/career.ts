// Career semantics.
//
// WHY THIS EXISTS
//
// "באיזו קבוצה התחיל X?" looks like one question. It is at least six:
//
//   youth club                 — where he was schooled
//   reserve team               — where he played senior football for the B side
//   first senior club          — the first club he was registered to as a senior
//   professional debut club    — where he first played a competitive senior match
//   first recorded provider club — the earliest row the provider happens to hold
//   loan club                  — somewhere he was sent, not somewhere he moved
//
// These are different facts with different answers, and the provider gives us
// the last one. Taking MIN(season) and calling it "where his career started" is
// therefore not a shortcut — it is a different claim, and for anyone whose early
// years were not harvested it is a false one. Production holds "Barcelona B",
// "Real Madrid II", "Bayern München II" and "Borussia Dortmund II" as teams, and
// 50 active career-path questions already listed a reserve side as the first
// club in the path.
//
// So: nothing here infers a career start. It reports which concept the data
// supports, with what confidence, and the generators word the question to match.
// Where no concept is supported, no question is produced.

import { classifyTeam, parentClubName, type TeamKind } from "./entities.ts";

/**
 * The distinct career facts. Never interchangeable.
 */
export type CareerConcept =
  | "YOUTH_CLUB"
  | "RESERVE_TEAM"
  | "FIRST_SENIOR_CLUB"
  | "PROFESSIONAL_DEBUT_CLUB"
  | "FIRST_RECORDED_PROVIDER_CLUB"
  | "LOAN_CLUB"
  | "NATIONAL_TEAM";

export const CAREER_CONCEPTS: CareerConcept[] = [
  "YOUTH_CLUB", "RESERVE_TEAM", "FIRST_SENIOR_CLUB", "PROFESSIONAL_DEBUT_CLUB",
  "FIRST_RECORDED_PROVIDER_CLUB", "LOAN_CLUB", "NATIONAL_TEAM",
];

/** How much a stated fact can be trusted. Only HIGH and MEDIUM reach production. */
export type FactConfidence = "HIGH" | "MEDIUM" | "LOW";

export const PRODUCTION_CONFIDENCE: FactConfidence[] = ["HIGH", "MEDIUM"];

export const isProductionEligible = (confidence: FactConfidence): boolean =>
  confidence === "HIGH" || confidence === "MEDIUM";

// ---------------------------------------------------------------------------
// One spell at one team
// ---------------------------------------------------------------------------

export interface CareerEntryInput {
  teamId: number;
  teamName: string;
  isNational?: boolean | number | null;
  teamKindOverride?: TeamKind | null;
  season?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  isLoan?: boolean | number | null;
  /** How the relationship was learned: 'squad', 'transfer', 'stats', … */
  source?: string | null;
}

export interface CareerEntry extends CareerEntryInput {
  kind: TeamKind;
  concept: CareerConcept;
  year: number | null;
  loan: boolean;
}

const yearOf = (entry: CareerEntryInput): number | null => {
  if (typeof entry.season === "number" && Number.isFinite(entry.season)) return entry.season;
  if (entry.startDate) {
    const year = Number(entry.startDate.slice(0, 4));
    if (Number.isFinite(year)) return year;
  }
  return null;
};

/**
 * Which concept one stored spell represents.
 *
 * Note what this deliberately does NOT do: it never returns FIRST_SENIOR_CLUB or
 * PROFESSIONAL_DEBUT_CLUB. Neither can be read off a single row — both are
 * claims about the *absence* of anything earlier, which is a property of the
 * whole career and of how complete the record is. They are decided in
 * `resolveCareerStart`, and only there.
 */
export function classifyCareerEntry(input: CareerEntryInput): CareerEntry {
  const kind = classifyTeam({
    name: input.teamName,
    isNational: input.isNational,
    override: input.teamKindOverride ?? null,
  });
  const loan = input.isLoan === true || input.isLoan === 1;

  const concept: CareerConcept =
    kind === "NATIONAL_TEAM" || kind === "YOUTH_NATIONAL_TEAM"
      ? "NATIONAL_TEAM"
      : kind === "YOUTH_TEAM"
        ? "YOUTH_CLUB"
        : kind === "RESERVE_TEAM"
          ? "RESERVE_TEAM"
          : loan
            ? "LOAN_CLUB"
            : "FIRST_RECORDED_PROVIDER_CLUB";

  return { ...input, kind, concept, year: yearOf(input), loan };
}

/**
 * A player's club career, with national teams, youth and reserve sides removed.
 *
 * This is what a "club career path" means, and it is a filter rather than a
 * sort: a path that runs Lyon → France → Real Madrid is not a career, it is two
 * careers interleaved, and showing it as one is the bug.
 */
export function clubCareerOnly(entries: CareerEntry[]): CareerEntry[] {
  return entries.filter((entry) => entry.kind === "CLUB");
}

export function nationalCareerOnly(entries: CareerEntry[]): CareerEntry[] {
  return entries.filter((entry) => entry.kind === "NATIONAL_TEAM");
}

// ---------------------------------------------------------------------------
// Career start
// ---------------------------------------------------------------------------

export interface CareerStart {
  concept: CareerConcept;
  teamName: string;
  teamId: number;
  year: number | null;
  confidence: FactConfidence;
  /** The Hebrew question this concept may be asked with, and nothing else. */
  questionHe: (playerHe: string) => string;
  /** Why the confidence is what it is, for the audit report. */
  reason: string;
}

/**
 * Hebrew wording per concept.
 *
 * The vague form — "באיזו קבוצה התחיל X?" — is absent on purpose. It is the only
 * wording that was ever wrong, because it is the only one that does not say
 * which of the six facts it means. Every concept here names itself.
 */
export const CAREER_START_QUESTION_HE: Record<CareerConcept, (playerHe: string) => string> = {
  YOUTH_CLUB: (p) => `באיזו מחלקת נוער שיחק ${p}?`,
  RESERVE_TEAM: (p) => `באיזו קבוצת המשך (קבוצה ב') שיחק ${p}?`,
  FIRST_SENIOR_CLUB: (p) => `באיזה מועדון ערך ${p} את הופעת הבכורה בקבוצה הבוגרת?`,
  PROFESSIONAL_DEBUT_CLUB: (p) => `באיזו קבוצה ערך ${p} את הופעת הבכורה המקצוענית?`,
  // Phrased as what it is: the earliest club the database holds. Never asked in
  // production (see `resolveCareerStart`), but named so the audit can say so.
  FIRST_RECORDED_PROVIDER_CLUB: (p) => `מהו המועדון המוקדם ביותר שמתועד עבור ${p}?`,
  LOAN_CLUB: (p) => `לאיזו קבוצה הושאל ${p}?`,
  NATIONAL_TEAM: (p) => `את איזו נבחרת מייצג ${p}?`,
};

export interface CareerStartInput {
  entries: CareerEntryInput[];
  /**
   * A curated, verified first senior club. The override layer: the one way to
   * state FIRST_SENIOR_CLUB, because no amount of provider data can establish
   * that nothing earlier exists.
   */
  verifiedFirstSeniorClub?: { teamId: number; teamName: string; year?: number | null } | null;
  /** Senior club names, so a reserve side can be traced to its first team. */
  seniorClubNames?: Set<string>;
}

/**
 * What, if anything, can be said about where a career began.
 *
 * THE RULE THAT MATTERS: a career start is only ever asserted from a curated,
 * verified fact. Everything derived from the provider is reported as
 * FIRST_RECORDED_PROVIDER_CLUB at LOW confidence, which keeps it out of
 * production entirely. That is a deliberate loss of questions — the alternative
 * is the Busquets failure, where the earliest row in the database is a B-team
 * spell or an incomplete import and the question confidently states the wrong
 * club.
 *
 * Returns null when nothing at all can be said.
 */
export function resolveCareerStart(input: CareerStartInput): CareerStart | null {
  const entries = input.entries.map(classifyCareerEntry);
  if (entries.length === 0) return null;

  if (input.verifiedFirstSeniorClub) {
    const verified = input.verifiedFirstSeniorClub;
    return {
      concept: "FIRST_SENIOR_CLUB",
      teamName: verified.teamName,
      teamId: verified.teamId,
      year: verified.year ?? null,
      confidence: "HIGH",
      questionHe: CAREER_START_QUESTION_HE.FIRST_SENIOR_CLUB,
      reason: "curated verified first senior club",
    };
  }

  const dated = entries.filter((e) => e.year !== null).sort((a, b) => a.year! - b.year!);
  const earliest = dated[0] ?? entries[0];

  // A reserve side is reported as what it is, and where its first team is known
  // the relationship is stated rather than collapsed.
  if (earliest.kind === "RESERVE_TEAM") {
    const parent = input.seniorClubNames
      ? parentClubName(earliest.teamName, input.seniorClubNames)
      : null;
    return {
      concept: "RESERVE_TEAM",
      teamName: earliest.teamName,
      teamId: earliest.teamId,
      year: earliest.year,
      confidence: "LOW",
      questionHe: CAREER_START_QUESTION_HE.RESERVE_TEAM,
      reason: parent
        ? `earliest recorded team is the reserve side of ${parent}`
        : "earliest recorded team is a reserve side",
    };
  }

  if (earliest.kind === "YOUTH_TEAM" || earliest.kind === "YOUTH_NATIONAL_TEAM") {
    return {
      concept: "YOUTH_CLUB",
      teamName: earliest.teamName,
      teamId: earliest.teamId,
      year: earliest.year,
      confidence: "LOW",
      questionHe: CAREER_START_QUESTION_HE.YOUTH_CLUB,
      reason: "earliest recorded team is a youth side",
    };
  }

  if (earliest.loan) {
    return {
      concept: "LOAN_CLUB",
      teamName: earliest.teamName,
      teamId: earliest.teamId,
      year: earliest.year,
      confidence: "LOW",
      questionHe: CAREER_START_QUESTION_HE.LOAN_CLUB,
      reason: "earliest recorded spell is a loan",
    };
  }

  return {
    concept: "FIRST_RECORDED_PROVIDER_CLUB",
    teamName: earliest.teamName,
    teamId: earliest.teamId,
    year: earliest.year,
    confidence: "LOW",
    questionHe: CAREER_START_QUESTION_HE.FIRST_RECORDED_PROVIDER_CLUB,
    reason: "earliest provider row only — completeness of the record is unknown",
  };
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export type MovementKind = "PERMANENT" | "LOAN" | "LOAN_RETURN" | "FREE" | "UNKNOWN";

/**
 * What kind of move a transfer row describes.
 *
 * API-Football's `transfer_type` is a free-text field holding a fee ("€ 45M"), a
 * word ("Loan", "Free", "N/A"), or nothing. "Loan" and "Free" are the two that
 * change what the question may say; a fee means a permanent move; anything else
 * is UNKNOWN and gets the neutral wording.
 */
export function classifyMovement(transferType: string | null | undefined): MovementKind {
  const value = (transferType ?? "").trim().toLowerCase();
  if (!value || value === "n/a" || value === "-") return "UNKNOWN";
  if (/back\s+from\s+loan|end\s+of\s+loan|return.*loan/.test(value)) return "LOAN_RETURN";
  if (/loan/.test(value)) return "LOAN";
  if (/free/.test(value)) return "FREE";
  if (/[€$£]|\d\s*m\b|\d\s*k\b|\bfee\b|million/.test(value)) return "PERMANENT";
  return "UNKNOWN";
}

/**
 * Hebrew wording per movement kind.
 *
 * A loan is not a transfer, and calling one "עבר" states that a player changed
 * clubs permanently when he did not. The neutral forms are used for UNKNOWN,
 * because "עבר" claims more than a blank provider field supports — "שיחק"/"הגיע"
 * are true of a loan and a permanent move alike.
 */
export const MOVEMENT_QUESTION_HE: Record<
  MovementKind,
  { to: (player: string, from: string, when: string) => string; from: (player: string, to: string, when: string) => string }
> = {
  PERMANENT: {
    to: (player, from, when) => `לאיזו קבוצה עבר ${player} ${hePrefix("מ", from)}${when}?`,
    from: (player, to, when) => `מאיזו קבוצה עבר ${player} ${hePrefix("ל", to)}${when}?`,
  },
  FREE: {
    to: (player, from, when) => `לאיזו קבוצה עבר ${player} ${hePrefix("מ", from)}${when}?`,
    from: (player, to, when) => `מאיזו קבוצה עבר ${player} ${hePrefix("ל", to)}${when}?`,
  },
  LOAN: {
    to: (player, from, when) => `לאיזו קבוצה הושאל ${player} ${hePrefix("מ", from)}${when}?`,
    from: (player, to, when) => `מאיזו קבוצה הושאל ${player} ${hePrefix("ל", to)}${when}?`,
  },
  LOAN_RETURN: {
    to: (player, from, when) => `לאיזו קבוצה חזר ${player} מהשאלה ${hePrefix("ב", from)}${when}?`,
    from: (player, to, when) => `מאיזו השאלה חזר ${player} ${hePrefix("ל", to)}${when}?`,
  },
  UNKNOWN: {
    to: (player, from, when) => `לאיזו קבוצה הגיע ${player} ${hePrefix("מ", from)}${when}?`,
    from: (player, to, when) => `מאיזו קבוצה הגיע ${player} ${hePrefix("ל", to)}${when}?`,
  },
};

export const MOVEMENT_EXPLANATION_HE: Record<MovementKind, (player: string, from: string, to: string, when: string) => string> = {
  PERMANENT: (player, from, to, when) =>
    `${player} עבר ${hePrefix("מ", from)} ${hePrefix("ל", to)}${when}.`,
  FREE: (player, from, to, when) =>
    `${player} עבר ${hePrefix("מ", from)} ${hePrefix("ל", to)}${when} ללא תשלום.`,
  LOAN: (player, from, to, when) =>
    `${player} הושאל ${hePrefix("מ", from)} ${hePrefix("ל", to)}${when}.`,
  LOAN_RETURN: (player, from, to, when) =>
    `${player} חזר מהשאלה ${hePrefix("ב", from)} ${hePrefix("ל", to)}${when}.`,
  UNKNOWN: (player, from, to, when) =>
    `${player} הגיע ${hePrefix("ל", to)} ${hePrefix("מ", from)}${when}.`,
};

/**
 * Hebrew prefixes before a Latin-script name.
 *
 * "לאיזו קבוצה עבר C. Dagba מAuxerre" — that is production text, and the missing
 * separator between מ and a Latin A is not a typo, it is what string
 * concatenation does when one side is RTL and the other is not. Hebrew attaches
 * these prepositions directly to a Hebrew word and takes a maqaf before a
 * foreign one.
 */
/**
 * "עבר" as a whole word.
 *
 * WHY NOT `\bעבר\b`. JavaScript's `\b` is defined against `\w`, which is
 * `[A-Za-z0-9_]` — every Hebrew letter is a non-word character, so there is no
 * boundary between a space and an ע and the pattern matches nothing at all. A
 * check written that way silently passes everything, which is worse than no
 * check: it was in the validation gate and in a test asserting the opposite, and
 * both reported success on text that should have failed.
 *
 * Hebrew word boundaries have to be spelled out as "not preceded or followed by
 * another Hebrew letter".
 */
export const MOVED_PERMANENTLY_HE = /(?<![֐-׿])עבר(?![֐-׿])/;

/** Loan wording, in either a question or an explanation. */
export const LOAN_WORDING_HE = /הושאל|השאלה/;

export function hePrefix(
  preposition: "מ" | "ל" | "ב",
  name: string,
  options: { definiteArticle?: boolean } = {}
): string {
  const value = (name ?? "").trim();
  const first = value[0] ?? "";
  if (!/[֐-׿]/.test(first)) return `${preposition}-${value}`;

  /*
    THE DEFINITE ARTICLE IS NOT INFERRED, IT IS DECLARED.

    ב and ל swallow a following definite article — "ב" + "הליגה האירופית" is
    written "בליגה האירופית". But a club called "הפועל תל אביב" carries that ה as
    part of its name, and "בפועל תל אביב" is simply wrong. Nothing in the string
    distinguishes the two cases, so the caller says which it has, and the
    default is to leave the name alone. Getting a club's name wrong is worse than
    an uncontracted preposition before a common noun.
  */
  if (options.definiteArticle && (preposition === "ב" || preposition === "ל") && value.startsWith("ה")) {
    return `${preposition}${value.slice(1)}`;
  }
  return `${preposition}${value}`;
}
