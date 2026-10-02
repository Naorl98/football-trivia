// The semantic validation gate.
//
// Every generated question passes through here before it may become ACTIVE.
//
// THE RULE THE WHOLE MODULE IS BUILT ON: when the data is ambiguous, REJECT.
// Not "ask a vaguer question", not "pick the likelier reading" — reject. A
// smaller bank that is true is worth more than a large one a player stops
// trusting, and a player only has to meet two wrong answers to stop trusting all
// 15,000 of them.
//
// The structural checks that were already in place — four distinct options, one
// correct, no free-text answer colliding with a distractor — stay where they
// are, in knowledgeGenerators.validateAndDedupe. What is added here is the layer
// above them: whether the question means what it says.

import { ARCHETYPES, answerTypeFor, type Archetype } from "./archetypes.ts";
import { isEligibleCandidate } from "./distractors.ts";
import type { Candidate, EntityType } from "./entities.ts";
import type { CareerConcept, FactConfidence, MovementKind } from "./career.ts";
import { isProductionEligible, LOAN_WORDING_HE, MOVED_PERMANENTLY_HE } from "./career.ts";
import type { PositionConfidence, PositionQuestionShape } from "./positions.ts";
import type { Band, DifficultySignals } from "./difficulty.ts";
import { OBSCURE_FAME_THRESHOLD, VERY_OBSCURE_FAME_THRESHOLD } from "./prominence.ts";

export type IssueSeverity = "REJECT" | "WARN";

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
}

/**
 * The semantic facts a question must carry to be validated.
 *
 * All optional on the question type itself, so the legacy generators keep
 * compiling — but a question that omits `archetype` is reported as unvalidatable
 * rather than passing by default. Silence is not consent here: the whole point
 * is that an un-annotated question is one nobody has checked.
 */
export interface SemanticFacts {
  archetype?: Archetype;
  /** For RESOLVED_TEAM archetypes: which of the two this question answers. */
  resolvedTeamType?: Extract<EntityType, "CLUB" | "NATIONAL_TEAM">;
  answerCandidate?: Candidate;
  distractorCandidates?: Candidate[];
  careerConcept?: CareerConcept;
  movement?: MovementKind;
  positionShape?: PositionQuestionShape;
  positionConfidence?: PositionConfidence;
  factConfidence?: FactConfidence;
  difficultySignals?: DifficultySignals;
}

export interface ValidatableQuestion extends SemanticFacts {
  semanticKey: string;
  questionHe: string;
  explanationHe: string;
  options: string[];
  correctIndex: number;
  difficulty: Band;
  clues?: string[];
  freeText?: boolean;
}

const reject = (code: string, message: string): ValidationIssue => ({ code, severity: "REJECT", message });
const warn = (code: string, message: string): ValidationIssue => ({ code, severity: "WARN", message });

/**
 * Hebrew prepositions jammed against a Latin-script word.
 *
 * Production text: "לאיזו קבוצה עבר C. Dagba מAuxerre בשנת 2024?". The missing
 * maqaf is what string concatenation does when one operand is RTL and the other
 * is not, and it reads as a bug to anybody who can read Hebrew. Caught here
 * rather than left to review because it is mechanical and there were thousands.
 */
const GLUED_PREPOSITION = /[מלבוכש](?=[A-Za-z])/;

/** Vague career wording. Only ever correct by accident — see career.ts. */
const VAGUE_CAREER_WORDING = /באיזו קבוצה התחיל|איפה התחיל|where did .* start/i;

/**
 * Validates one question's meaning.
 *
 * Returns every issue found rather than the first, because the audit report is
 * more useful than a boolean and because a question with three problems should
 * not have to be re-run three times to discover them.
 */
export function validateSemantics(question: ValidatableQuestion): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { archetype } = question;

  // ---- the archetype, and the answer type it declares ----
  if (!archetype) {
    issues.push(
      reject("missing-archetype", "no archetype declared, so nothing about this question can be checked")
    );
  } else if (!ARCHETYPES[archetype]) {
    issues.push(reject("unknown-archetype", `unknown archetype: ${archetype}`));
  }

  let expected: EntityType | null = null;
  if (archetype && ARCHETYPES[archetype]) {
    const spec = ARCHETYPES[archetype];
    if (spec.answerType === "RESOLVED_TEAM" && !question.resolvedTeamType) {
      issues.push(
        reject(
          "unresolved-answer-type",
          `${archetype} answers with a club or a national team and this question does not say which`
        )
      );
    } else {
      expected = answerTypeFor(archetype, question.resolvedTeamType);
    }
  }

  // ---- the answer, and every distractor, must be that type ----
  const answer = question.answerCandidate;
  const distractors = question.distractorCandidates;

  if (expected && !answer) {
    issues.push(reject("missing-answer-candidate", "the answer carries no entity type"));
  }
  if (expected && answer) {
    if (answer.type !== expected) {
      issues.push(
        reject(
          "answer-type-mismatch",
          `${archetype} expects ${expected}; the answer "${answer.text}" is ${answer.type}`
        )
      );
    } else if (!isEligibleCandidate(answer, expected)) {
      issues.push(
        reject(
          "answer-kind-ineligible",
          `the answer "${answer.text}" is a ${answer.teamKind ?? "unclassified team"} and cannot answer a ${expected} question`
        )
      );
    }
  }

  if (expected && (!distractors || distractors.length === 0)) {
    issues.push(reject("missing-distractor-candidates", "the distractors carry no entity types"));
  }
  if (expected && distractors) {
    for (const candidate of distractors) {
      if (candidate.type !== expected) {
        issues.push(
          reject(
            "distractor-type-mismatch",
            `option "${candidate.text}" is ${candidate.type}, but ${archetype} answers with ${expected}`
          )
        );
      } else if (!isEligibleCandidate(candidate, expected)) {
        issues.push(
          reject(
            "distractor-kind-ineligible",
            `option "${candidate.text}" is a ${candidate.teamKind ?? "unclassified team"} and cannot stand in a ${expected} question`
          )
        );
      }
    }
  }

  // ---- career semantics ----
  if (question.careerConcept) {
    const concept = question.careerConcept;
    if (concept === "FIRST_RECORDED_PROVIDER_CLUB") {
      issues.push(
        reject(
          "career-start-from-provider-ordering",
          "the earliest provider row is not a career start; only a verified first senior club may be asked"
        )
      );
    }
    if (concept === "RESERVE_TEAM" && !/קבוצה ב|קבוצת המשך|מחלקת נוער/.test(question.questionHe)) {
      issues.push(
        reject(
          "reserve-team-presented-as-senior",
          "the fact is about a reserve side but the wording does not say so"
        )
      );
    }
    if (concept === "LOAN_CLUB" && !LOAN_WORDING_HE.test(question.questionHe)) {
      issues.push(reject("loan-presented-as-transfer", "the fact is a loan but the wording calls it a move"));
    }
  }

  if (VAGUE_CAREER_WORDING.test(question.questionHe) && question.careerConcept !== "FIRST_SENIOR_CLUB") {
    issues.push(
      reject(
        "vague-career-wording",
        'the wording "באיזו קבוצה התחיל" does not say which of the six career-start facts it means'
      )
    );
  }

  // ---- transfer and loan semantics ----
  if (question.movement) {
    // MOVED_PERMANENTLY_HE rather than /\bעבר\b/ — see career.ts. The `\b`
    // version matches no Hebrew text at all, so this whole block used to pass
    // everything silently.
    const permanentWording = MOVED_PERMANENTLY_HE.test(question.questionHe);
    const loanWording = LOAN_WORDING_HE.test(question.questionHe);
    if (question.movement === "LOAN" && permanentWording && !loanWording) {
      issues.push(reject("loan-worded-as-permanent", "a loan is described as a permanent move"));
    }
    if (question.movement === "LOAN_RETURN" && !loanWording) {
      issues.push(reject("loan-return-worded-as-move", "a return from loan is described as a transfer"));
    }
    if (question.movement === "UNKNOWN" && permanentWording) {
      issues.push(
        warn(
          "unverified-movement-worded-as-permanent",
          'the provider does not say whether this was permanent; "הגיע" is the honest wording'
        )
      );
    }
  }

  // ---- position precision ----
  if (question.positionShape === "PRECISE") {
    const confidence = question.positionConfidence ?? "LOW";
    if (confidence === "LOW") {
      issues.push(
        reject(
          "precise-position-from-broad-data",
          "a precise role was asked from broad-category data — ask the broad question instead"
        )
      );
    }
  }

  // ---- fact confidence ----
  if (question.factConfidence && !isProductionEligible(question.factConfidence)) {
    issues.push(
      reject("low-fact-confidence", `fact confidence is ${question.factConfidence}; production needs HIGH or MEDIUM`)
    );
  }

  // ---- difficulty sanity, against the signals the question was scored from ----
  const signals = question.difficultySignals;
  if (signals) {
    const fame = signals.subjectFame;
    const headline = signals.factProminence === "HEADLINE";
    if (fame !== undefined && !headline) {
      if (fame >= VERY_OBSCURE_FAME_THRESHOLD && rank(question.difficulty) < rank("EXPERT")) {
        issues.push(
          reject(
            "obscure-subject-too-easy",
            `subject fame ${fame.toFixed(2)} is very obscure but the question is ${question.difficulty}`
          )
        );
      } else if (fame >= OBSCURE_FAME_THRESHOLD && rank(question.difficulty) < rank("HARD")) {
        issues.push(
          reject(
            "obscure-subject-in-easy-band",
            `subject fame ${fame.toFixed(2)} is obscure but the question is ${question.difficulty}`
          )
        );
      }
    }
    if (signals.tier === "NON_CORE" && !headline && rank(question.difficulty) < rank("HARD")) {
      issues.push(
        reject("non-core-too-easy", `a non-core-competition fact is labelled ${question.difficulty}`)
      );
    }
  }

  // ---- wording ----
  if (GLUED_PREPOSITION.test(question.questionHe) || GLUED_PREPOSITION.test(question.explanationHe)) {
    issues.push(
      warn("glued-hebrew-preposition", "a Hebrew preposition is attached directly to a Latin-script name")
    );
  }

  // ---- ambiguity: a clue list that repeats the answer gives it away ----
  if (question.clues && answer) {
    const answerKey = fold(answer.text);
    if (question.clues.some((clue) => fold(clue).includes(answerKey) && answerKey.length >= 4)) {
      issues.push(reject("clue-contains-answer", "one of the clues names the answer"));
    }
  }

  return issues;
}

const rank = (band: Band): number =>
  ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"].indexOf(band);

const fold = (value: string) =>
  (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export const hasRejection = (issues: ValidationIssue[]): boolean =>
  issues.some((issue) => issue.severity === "REJECT");

/**
 * Groups issues by code, for the audit report.
 *
 * The report is the product of this module as much as the gate is: "1,155
 * distractor-type-mismatch" is what makes a systemic bug visible, where fifteen
 * individual rejections look like noise.
 */
export function summarizeIssues(all: ValidationIssue[][]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issues of all) {
    for (const issue of issues) counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  }
  return counts;
}
