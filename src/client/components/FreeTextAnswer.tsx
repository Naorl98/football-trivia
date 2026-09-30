import { useEffect, useRef, useState } from "react";
import type { Question } from "../../shared/types";
import { matchAnswer } from "../../shared/answerMatching";
import { sound } from "../lib/sound";
import { Icon } from "./Icon";
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
      inputRef.current?.focus();
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
        <ol className="ft-hints">
          {question.hints.slice(0, hintsShown).map((hint, i) => (
            <li key={i} className="ft-hint anim-rise">
              <span className="ft-hint-index label">רמז {i + 1}</span>
              <span className="ft-hint-text">{hint}</span>
            </li>
          ))}
        </ol>
      )}

      {!resolved && (
        <>
          <form
            className={`ft-form ${shake ? "ft-shake" : ""}`}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="sr-only" htmlFor="ft-input">
              הקלידו את התשובה
            </label>
            <input
              id="ft-input"
              ref={inputRef}
              className="ft-input"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="שם השחקן, המועדון או הנבחרת…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="send"
              dir="auto"
            />
            <button className="btn btn-ink ft-submit" type="submit">
              שליחה
            </button>
          </form>

          <p className="ft-tolerance">עברית או אנגלית, עם כינויים — ושגיאות הקלדה סבירות מתקבלות.</p>

          <div className="ft-actions">
            <button type="button" className="btn btn-quiet btn-sm" onClick={showNextHint} disabled={hintsLeft === 0}>
              <Icon name="bulb" size={16} />
              {hintsLeft === 0 ? "אין רמזים נוספים" : `רמז (${hintsLeft})`}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${confirmingReveal ? "btn-spot" : "btn-quiet"}`}
              onClick={reveal}
              onBlur={() => setConfirmingReveal(false)}
            >
              <Icon name="eye" size={16} />
              {confirmingReveal ? "בטוחים? חשוף" : "חשוף תשובה"}
            </button>
          </div>
        </>
      )}

      {resolved && (
        <div
          className={`ft-result anim-stamp ${
            resolved.correct ? "is-correct" : resolved.revealed ? "is-revealed" : "is-wrong"
          }`}
        >
          <p className="ft-result-head">
            <span className="ft-result-icon">
              <Icon
                name={resolved.correct ? "check" : resolved.revealed ? "eye" : "cross"}
                size={20}
                strokeWidth={2.4}
              />
            </span>
            {resolved.correct ? "נכון" : resolved.revealed ? "נחשף" : "לא נכון"}
          </p>
          {!resolved.correct && resolved.typed && (
            <p className="ft-typed">
              <span className="label">כתבתם</span> {resolved.typed}
            </p>
          )}
          <p className="ft-canonical">
            <span className="label">התשובה</span> <strong>{question.canonicalAnswer}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
