import { useEffect, useRef, useState } from "react";
import type { Question } from "../../shared/types";
import { matchAnswer } from "../../shared/answerMatching";
import { sound } from "../lib/sound";
import "./FreeTextAnswer.css";

export interface FreeTextResult {
  correct: boolean;
  revealed: boolean;
  typed: string;
  hintsUsed: number;
}

interface Props {
  question: Question;
  onResolved: (result: FreeTextResult) => void;
  resolved: FreeTextResult | null;
}

export function FreeTextAnswer({ question, onResolved, resolved }: Props) {
  const [value, setValue] = useState("");
  const [hintsShown, setHintsShown] = useState(0);
  const [confirmingReveal, setConfirmingReveal] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset for each new question, and put the caret straight in the field on
  // desktop. Mobile keyboards are left to the player so the viewport does not
  // jump on every question.
  useEffect(() => {
    setValue("");
    setHintsShown(0);
    setConfirmingReveal(false);
    const isCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches;
    if (!isCoarsePointer) inputRef.current?.focus();
  }, [question.id]);

  function submit() {
    if (resolved) return;
    const typed = value.trim();
    if (!typed) {
      setShake(true);
      window.setTimeout(() => setShake(false), 400);
      return;
    }
    const result = matchAnswer(typed, {
      canonical: question.canonicalAnswer ?? "",
      aliases: question.aliases,
    });
    sound.play(result.correct ? "correct" : "wrong");
    onResolved({ correct: result.correct, revealed: false, typed, hintsUsed: hintsShown });
  }

  function reveal() {
    if (resolved) return;
    if (!confirmingReveal) {
      setConfirmingReveal(true);
      return;
    }
    sound.play("reveal");
    onResolved({ correct: false, revealed: true, typed: value.trim(), hintsUsed: hintsShown });
  }

  function showNextHint() {
    if (hintsShown >= question.hints.length) return;
    sound.play("hint");
    setHintsShown((n) => n + 1);
  }

  const hintsLeft = question.hints.length - hintsShown;

  return (
    <div className="ft">
      {hintsShown > 0 && (
        <ul className="ft-hints" aria-live="polite">
          {question.hints.slice(0, hintsShown).map((hint, i) => (
            <li key={i} className="ft-hint animate-in">
              <span className="ft-hint-index">רמז {i + 1}</span>
              <span>{hint}</span>
            </li>
          ))}
        </ul>
      )}

      {!resolved && (
        <form
          className={`ft-form ${shake ? "ft-shake" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            className="ft-input"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="הקלידו את התשובה…"
            aria-label="התשובה שלכם"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
            dir="auto"
          />
          <button className="btn btn-primary ft-submit" type="submit">
            שליחה
          </button>
        </form>
      )}

      {!resolved && (
        <div className="ft-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={showNextHint}
            disabled={hintsLeft === 0}
          >
            {hintsLeft === 0 ? "אין רמזים נוספים" : `רמז (${hintsLeft})`}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${confirmingReveal ? "btn-gold" : "btn-ghost"}`}
            onClick={reveal}
            onBlur={() => setConfirmingReveal(false)}
          >
            {confirmingReveal ? "בטוחים? גלו את התשובה" : "גלה תשובה"}
          </button>
        </div>
      )}

      {resolved && (
        <div
          className={`ft-result animate-pop ${
            resolved.correct ? "ft-correct" : resolved.revealed ? "ft-revealed" : "ft-wrong"
          }`}
          role="status"
        >
          <div className="ft-result-head">
            <span className="ft-result-icon" aria-hidden="true">
              {resolved.correct ? "✓" : resolved.revealed ? "👁" : "✕"}
            </span>
            <span className="ft-result-title">
              {resolved.correct ? "נכון!" : resolved.revealed ? "גילית את התשובה" : "לא בדיוק"}
            </span>
          </div>
          {!resolved.correct && resolved.typed && (
            <p className="ft-typed">
              כתבתם: <span>{resolved.typed}</span>
            </p>
          )}
          <p className="ft-canonical">
            התשובה: <strong>{question.canonicalAnswer}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
