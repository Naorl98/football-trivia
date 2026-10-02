import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  COMPETITIONS,
  COUNTRIES,
  DIFFICULTY_LABELS,
  WIZARD_QUESTION_COUNTS,
} from "../../shared/constants";
import type { AnswerMode, Difficulty } from "../../shared/types";
import { fetchAvailableCount, messageHeOf } from "../lib/api";
import {
  canAdvance,
  countriesIn,
  INITIAL_STATE,
  leagueOf,
  QUICK_PICKS,
  stepsFor,
  SUPPORTED_CONTINENTS,
  summaryOf,
  toConfiguration,
  type StepId,
  type WizardState,
} from "../lib/builderWizard";
import { startQuiz } from "../lib/startQuiz";
import { sound } from "../lib/sound";
import { Icon } from "../components/Icon";
import "./BuilderPage.css";

const DIFFICULTY_OPTIONS: (Difficulty | "MIXED")[] = ["MIXED", "EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];

const ANSWER_MODE_LABELS: Record<AnswerMode, string> = {
  FREE_TEXT: "תשובה חופשית",
  MULTIPLE_CHOICE: "אמריקאי",
};

const competitionLabel = (code: string) =>
  COMPETITIONS.find((c) => c.code === code)?.nameHe ?? code;
const countryLabel = (code: string) => COUNTRIES.find((c) => c.code === code)?.nameHe ?? code;

const STEP_TITLES: Record<StepId, string> = {
  mode: "איך משחקים?",
  settings: "הגדרות המשחק",
  scope: "מאיפה השאלות?",
  region: "איזה אזור?",
  summary: "הכול מוכן",
};

/**
 * The game-creation wizard.
 *
 * WHAT WAS WRONG WITH THE OLD BUILDER. Every control was on screen at once:
 * seven region chips, three competition groups, eleven leagues, ten countries,
 * fourteen categories, five game modes, six difficulties and five question
 * counts — about sixty tap targets, on a page that scrolled for most of a phone
 * screen and hid the start button below the fold. Nothing on it was broken.
 * It just never told you what you were deciding.
 *
 * ONE SCREEN, ONE DECISION. Each step asks a single question, fits a 390×844
 * phone without scrolling, and keeps its primary action visible. Steps the
 * answers make unnecessary are skipped rather than disabled — choosing "כל
 * העולם" means the geography step does not exist, not that it is greyed out.
 *
 * GOING BACK NEVER COSTS ANYTHING. All of it is one state object (see
 * lib/builderWizard.ts), so a step that is revisited is still filled in. The
 * steps are not separate forms and nothing is unmounted.
 */
export function BuilderPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [index, setIndex] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableCount, setAvailableCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const steps = useMemo(() => stepsFor(state), [state]);
  // The step list shrinks and grows as the scope changes, so the cursor is
  // clamped rather than trusted. Without this, switching from "אזור מסוים" to
  // "כל העולם" while standing on the region step would point past the end.
  const step = steps[Math.min(index, steps.length - 1)];
  const config = useMemo(() => toConfiguration(state), [state]);

  const patch = (next: Partial<WizardState>) => {
    sound.play("select");
    setState((prev) => ({ ...prev, ...next }));
  };

  /*
    Availability is read for the real configuration, debounced.

    Shown on the settings step, where the difficulty and the count are chosen and
    a thin pool is most likely, and again on the summary. It is the real
    compatible pool count — the same number the engine will draw from — because a
    builder that cheerfully offers 20 questions from a filter holding 14 has lied
    before the game even starts.
  */
  useEffect(() => {
    let cancelled = false;
    setCounting(true);
    const timer = setTimeout(() => {
      fetchAvailableCount(config)
        .then((res) => !cancelled && setAvailableCount(res.availableCount))
        .catch(() => !cancelled && setAvailableCount(null))
        .finally(() => !cancelled && setCounting(false));
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config]);

  // Each step change moves focus to the new heading. A wizard that swaps the
  // whole screen without telling a screen reader is a wizard a screen reader
  // user cannot follow.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const atLast = step === "summary";
  const none = availableCount === 0;
  const short = availableCount !== null && availableCount > 0 && availableCount < state.questionCount;

  function back() {
    setError(null);
    sound.play("select");
    setIndex((i) => Math.max(0, Math.min(i, steps.length - 1) - 1));
  }

  function next() {
    setError(null);
    sound.play("click");
    setIndex((i) => Math.min(steps.length - 1, Math.min(i, steps.length - 1) + 1));
  }

  async function start() {
    setError(null);
    setStarting(true);
    sound.play("click");
    try {
      await startQuiz(navigate, config);
    } catch (e) {
      setError(messageHeOf(e));
    } finally {
      setStarting(false);
    }
  }

  const summary = summaryOf(state, {
    answerMode: ANSWER_MODE_LABELS,
    difficulty: DIFFICULTY_LABELS,
    competition: competitionLabel,
    country: countryLabel,
  });

  return (
    <div className="page wiz">
      <div className="wiz-head">
        <button
          className="wiz-back"
          onClick={back}
          disabled={index === 0}
          aria-label="חזרה לשלב הקודם"
        >
          <Icon name="arrow" size={18} />
        </button>
        <h1 className="wiz-title" ref={headingRef} tabIndex={-1}>
          {STEP_TITLES[step]}
        </h1>
        <p className="wiz-progress" aria-label={`שלב ${steps.indexOf(step) + 1} מתוך ${steps.length}`}>
          <span className="wiz-progress-num">{steps.indexOf(step) + 1}</span>
          <span className="wiz-progress-sep">/</span>
          <span>{steps.length}</span>
        </p>
      </div>

      {/* The step body. `key` is the step id, so the fade runs on a change of
          step and not on every keystroke inside one — and because the state
          lives above this, remounting the body costs nothing. */}
      <div className="wiz-body" key={step}>
        {step === "mode" && (
          <fieldset className="wiz-group wiz-group-tall">
            <legend className="sr-only">מצב תשובה</legend>
            {(
              [
                { key: "FREE_TEXT", label: "תשובה חופשית", note: "כותבים את התשובה", icon: "keyboard" as const },
                { key: "MULTIPLE_CHOICE", label: "אמריקאי", note: "בוחרים מתוך אפשרויות", icon: "list" as const },
              ] as const
            ).map((option) => (
              <button
                key={option.key}
                className={`wiz-card ${state.answerMode === option.key ? "is-on" : ""}`}
                aria-pressed={state.answerMode === option.key}
                onClick={() => patch({ answerMode: option.key as AnswerMode })}
              >
                <Icon name={option.icon} size={26} />
                <span className="wiz-card-label">{option.label}</span>
                <span className="wiz-card-note">{option.note}</span>
              </button>
            ))}
          </fieldset>
        )}

        {step === "settings" && (
          <>
            <Field label="רמת קושי">
              <div className="wiz-pills" role="group" aria-label="רמת קושי">
                {DIFFICULTY_OPTIONS.map((d) => (
                  <button
                    key={d}
                    className={`wiz-pill ${state.difficulty === d ? "is-on" : ""}`}
                    aria-pressed={state.difficulty === d}
                    onClick={() => patch({ difficulty: d })}
                  >
                    {d === "MIXED" ? "מעורב" : DIFFICULTY_LABELS[d]}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="מספר שאלות">
              <div className="wiz-counts" role="group" aria-label="מספר שאלות">
                {WIZARD_QUESTION_COUNTS.map((n) => (
                  <button
                    key={n}
                    className={`wiz-count ${state.questionCount === n ? "is-on" : ""}`}
                    aria-pressed={state.questionCount === n}
                    onClick={() => patch({ questionCount: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>

            <Availability
              counting={counting}
              count={availableCount}
              requested={state.questionCount}
            />
          </>
        )}

        {step === "scope" && (
          <>
            <div className="wiz-group" role="group" aria-label="טווח השאלות">
              <button
                className={`wiz-card wiz-card-row ${state.scope === "WORLD" ? "is-on" : ""}`}
                aria-pressed={state.scope === "WORLD"}
                onClick={() => patch({ scope: "WORLD", quickPick: null })}
              >
                <Icon name="globe" size={22} />
                <span className="wiz-card-label">כל העולם</span>
              </button>
              <button
                className={`wiz-card wiz-card-row ${state.scope === "REGION" ? "is-on" : ""}`}
                aria-pressed={state.scope === "REGION"}
                onClick={() => patch({ scope: "REGION", quickPick: null })}
              >
                <Icon name="shield" size={22} />
                <span className="wiz-card-label">אזור מסוים</span>
              </button>
            </div>

            {/* Quick choices are a separate, labelled section — and they are
                split in two, because a competition narrows WHERE the football
                comes from while an archetype changes WHAT the question is. The
                old builder put both in one chip row, which is how somebody
                picked "מי אני?" expecting a filter. */}
            <Field label="בחירות מהירות">
              <div className="wiz-quick-label">תחרות</div>
              <div className="wiz-chips" role="group" aria-label="תחרויות">
                {QUICK_PICKS.filter((p) => p.kind === "COMPETITION").map((pick) => (
                  <button
                    key={pick.key}
                    className={`wiz-chip ${state.quickPick === pick.key ? "is-on" : ""}`}
                    aria-pressed={state.quickPick === pick.key}
                    onClick={() => patch({ scope: "PRESET", quickPick: pick.key })}
                  >
                    {pick.labelHe}
                  </button>
                ))}
              </div>
              <div className="wiz-quick-label">סוג שאלה</div>
              <div className="wiz-chips" role="group" aria-label="סוגי שאלות">
                {QUICK_PICKS.filter((p) => p.kind === "ARCHETYPE").map((pick) => (
                  <button
                    key={pick.key}
                    className={`wiz-chip ${state.quickPick === pick.key ? "is-on" : ""}`}
                    aria-pressed={state.quickPick === pick.key}
                    onClick={() => patch({ scope: "PRESET", quickPick: pick.key })}
                  >
                    {pick.labelHe}
                  </button>
                ))}
              </div>
            </Field>
          </>
        )}

        {step === "region" && (
          /* Progressive drill-down: a level appears only once the one above it
             has been answered, so the step never shows three lists at once. */
          <>
            <Field label="יבשת">
              <div className="wiz-chips" role="group" aria-label="יבשת">
                {SUPPORTED_CONTINENTS.map((continent) => (
                  <button
                    key={continent.code}
                    className={`wiz-chip ${state.continent === continent.code ? "is-on" : ""}`}
                    aria-pressed={state.continent === continent.code}
                    onClick={() => patch({ continent: continent.code, country: null, league: null })}
                  >
                    {continent.labelHe}
                  </button>
                ))}
              </div>
            </Field>

            {state.continent && (
              <Field label="מדינה">
                <div className="wiz-chips" role="group" aria-label="מדינה">
                  <button
                    className={`wiz-chip ${state.country === null ? "is-on" : ""}`}
                    aria-pressed={state.country === null}
                    onClick={() => patch({ country: null, league: null })}
                  >
                    כל היבשת
                  </button>
                  {countriesIn(state.continent).map((country) => (
                    <button
                      key={country.code}
                      className={`wiz-chip ${state.country === country.code ? "is-on" : ""}`}
                      aria-pressed={state.country === country.code}
                      onClick={() => patch({ country: country.code, league: null })}
                    >
                      {country.nameHe}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {state.country && leagueOf(state.country) && (
              <Field label="ליגה">
                <div className="wiz-chips" role="group" aria-label="ליגה">
                  <button
                    className={`wiz-chip ${state.league === null ? "is-on" : ""}`}
                    aria-pressed={state.league === null}
                    onClick={() => patch({ league: null })}
                  >
                    כל הליגות
                  </button>
                  <button
                    className={`wiz-chip ${state.league !== null ? "is-on" : ""}`}
                    aria-pressed={state.league !== null}
                    onClick={() => patch({ league: leagueOf(state.country!) })}
                  >
                    {competitionLabel(leagueOf(state.country!)!)}
                  </button>
                </div>
              </Field>
            )}
          </>
        )}

        {step === "summary" && (
          <>
            <dl className="wiz-summary">
              {summary.map((item) => (
                <div className="wiz-summary-row" key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                  <button
                    className="wiz-edit"
                    onClick={() => {
                      sound.play("select");
                      setIndex(Math.max(0, steps.indexOf(item.step)));
                    }}
                  >
                    שינוי
                  </button>
                </div>
              ))}
            </dl>
            <Availability counting={counting} count={availableCount} requested={state.questionCount} />
          </>
        )}
      </div>

      {/* The action sits in a sticky dock that respects the iPhone safe area and
          never covers content: the body reserves its height. */}
      <div className="wiz-dock">
        <div className="page wiz-dock-inner">
          {error && (
            <p className="wiz-error" role="alert">
              {error}
            </p>
          )}
          {atLast ? (
            <button className="btn btn-primary btn-block" disabled={starting || none} onClick={start}>
              {starting ? "יוצר…" : "התחל משחק"}
              {!starting && <Icon name="arrow" size={17} />}
            </button>
          ) : (
            <button
              className="btn btn-primary btn-block"
              disabled={!canAdvance(state, step)}
              onClick={next}
            >
              המשך
              <Icon name="arrow" size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="wiz-field">
      <h2 className="wiz-field-label">{label}</h2>
      {children}
    </section>
  );
}

/**
 * The real compatible pool count.
 *
 * Three states, and the middle one is the point: a filter that holds fewer
 * questions than were asked for says so here, before the player commits, rather
 * than producing a short quiz without explanation. Questions are never
 * duplicated to fill a quota.
 */
function Availability({
  counting,
  count,
  requested,
}: {
  counting: boolean;
  count: number | null;
  requested: number;
}) {
  return (
    <p className="wiz-avail" role="status" aria-live="polite">
      {counting ? (
        <span className="faint">בודק…</span>
      ) : count === null ? (
        <span className="faint">לא הצלחנו לבדוק זמינות</span>
      ) : count === 0 ? (
        <span className="red">אין שאלות מתאימות — הרחיבו את הסינון</span>
      ) : count < requested ? (
        <span className="amber">
          קיימות <b className="num">{count.toLocaleString("he-IL")}</b> שאלות שמתאימות לבחירה
        </span>
      ) : (
        <span className="muted">
          <b className="num green">{count.toLocaleString("he-IL")}</b> שאלות זמינות
        </span>
      )}
    </p>
  );
}
