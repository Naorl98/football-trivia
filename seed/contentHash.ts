// The question content fingerprint.
//
// WHY IT IS SHARED
//
// `questions.content_hash` is how the incremental applier knows which questions
// have changed. Two things write it now: build-seed.mjs, when it emits the
// curated bank, and questions-audit.mjs, when it repairs a stored question in
// place. If they computed it differently, a repaired question would look changed
// to the applier for ever and be rewritten on every run — about 30 rows a time,
// for a question that is already correct.
//
// So the function lives here and both import it. One definition, one behaviour.

import { createHash } from "node:crypto";

export interface FreeTextSpec {
  canonical: string;
  aliases: string[];
}

export interface HashableQuestion {
  mode: string;
  category: string;
  difficulty: string;
  questionHe: string;
  explanationHe: string;
  sourceLabel: string;
  options: string[];
  correctIndex: number;
  clues?: string[];
  scopes?: { type: string; value: string }[];
}

/**
 * Fingerprints everything that will land in D1 for one question.
 *
 * Hashed from the source data rather than the generated SQL text, so a
 * formatting change to the emitter does not invalidate the whole bank and
 * trigger a full rewrite. Anything that changes a stored value changes the
 * hash; nothing else does.
 *
 * The field order and the exact shape are load-bearing — JSON.stringify is
 * order-sensitive, so this object literal IS the format. Do not reorder it
 * without accepting a full rewrite of the bank.
 */
export function contentHashFor(input: {
  id: number;
  q: HashableQuestion;
  freeTextSpec?: FreeTextSpec | null;
  hints?: string[] | null;
  semanticKey?: string | null;
}): string {
  const { id, q } = input;
  return createHash("sha256")
    .update(
      JSON.stringify({
        id,
        mode: q.mode,
        category: q.category,
        difficulty: q.difficulty,
        questionHe: q.questionHe,
        explanationHe: q.explanationHe,
        sourceLabel: q.sourceLabel,
        options: q.options,
        correctIndex: q.correctIndex,
        clues: q.clues ?? [],
        scopes: q.scopes ?? [],
        freeText: input.freeTextSpec ?? null,
        hints: input.hints ?? [],
        semanticKey: input.semanticKey ?? null,
      })
    )
    .digest("hex")
    .slice(0, 32);
}
