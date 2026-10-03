import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  COMPETITIONS,
  COUNTRIES,
  DIFFICULTY_LABELS,
  WIZARD_QUESTION_COUNTS,
} from "../../shared/constants";
import { MIXED_TYPE_KEY, QUESTION_TYPES } from "../../shared/questionTypes";
import type { AnswerMode, Difficulty } from "../../shared/types";
import { fetchAvailability, fetchAvailableCount, messageHeOf, type AvailabilityResponse } from "../lib/api";
import {
  canAdvance,
  competitionsForCountry,
  countriesIn,
  dimensionFor,
  INITIAL_STATE,
  leagueOf,
  orientationOf,
  PRESETS,
  SCOPE_COMPETITIONS,
  stepsFor,
  SUPPORTED_CONTINENTS,
  summaryOf,
  toConfiguration,
  type ScopeKind,
  type StepId,
  type WizardState,
} from "../lib/builderWizard";
import { startQuiz } from "../lib/startQuiz";
import { sound } from "../lib/sound";
import { Icon } from "../components/Icon";
import "./BuilderPage.css";

const DIFFICULTY_OPTIONS: (Difficulty | "MIXED")[] = ["MIXED", "EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];

/** The count the product recommends, highlighted rather than preselected-and-hidden. */
const RECOMMENDED_COUNT = 10;

const ANSWER_MODE_LABELS: Record<AnswerMode, string> = {
  FREE_TEXT: "תשובה חופשית",
  MULTIPLE_CHOICE: "אמריקאי",
};

const competitionLabel = (code: string) => COMPETITIONS.find((c) => c.code === code)?.nameHe ?? code;
const countryLabel = (code: string) => COUNTRIES.find((c) => c.code === code)?.nameHe ?? code;

const STEP_TITLES: Record<StepId, string> = {
  type: "איזה סוג שאלות?",
  mode: "איך משחקים?",
  settings: "הגדרות המשחק",
  scope: "מאיפה השאלות?",
  continent: "איזו יבשת?",
  country: "איזו מדינה?",
  league: "איזו ליגה?",
  competition: "איזו תחרות?",
  preset: "בחירות מהירות",
  summary: "הכול מוכן",
};

/** A country list long enough to need a search box. */
const SEARCHABLE_FROM = 10;

/**
 * The game-creation wizard.
 *
 * TWO FAILURE MODES, AND THIS IS THE SECOND PASS THROUGH THEM.
 *
 * The original builder put every control on screen at once: about sixty tap
 * targets, a page that scrolled for most of a phone screen, and the start button
 * below the fold. Nothing on it was broken. It just never told you what you were
 * deciding.
 *
 * The wizard that replaced it fixed that and overshot. Four steps, two of which
 * offered two cards each, on a 390x844 screen — a title, two buttons and
 * seventy per cent empty space. That is not low cognitive load, it is a product
 * that looks like it has nothing in it.
 *
 * SO: THE SAME STRUCTURE, WITH THE CHOICES BACK. One screen still asks one
 * question and still fits a phone without scrolling. But each step now offers
 * what the DATA justifies — twelve question types, thirty countries, every
 * competition with questions behind it — as a compact card grid carrying an
 * icon, a one-line note and a real availability count. Density comes from
 * meaningful options and live numbers, never from making the cards bigger.
 *
 * COUNTS ARE REAL AND THEY GATE SELECTION. Every card shows what it would
 * actually give you, read from the bank through /api/quiz/options, and a card
 * that cannot fill the requested quiz is disabled with "לא מספיק שאלות כרגע"
 * rather than hidden. A builder that offers twenty questions from a filter
 * holding fourteen has lied before the game starts.
 *
 * GOING BACK NEVER COSTS ANYTHING. All of it is one state object (see
 * lib/builderWizard.ts), so a revisited step is still filled in. The steps are
 * not separate forms and nothing is unmounted.
 */
export function BuilderPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [index, setIndex] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableCount, setAvailableCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [options, setOptions] = useState<AvailabilityResponse | null>(null);
  const [countryQuery, setCountryQuery] = useState("");
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const steps = useMemo(() => stepsFor(state), [state]);
  // The step list shrinks and grows as the scope changes, so the cursor is
  // clamped rather than trusted. Without this, switching from "אזור מסוים" to
  // "כל העולם" while standing on the country step would point past the end.
  const step = steps[Math.min(index, steps.length - 1)];
  const config = useMemo(() => toConfiguration(state), [state]);

  const patch = (next: Partial<WizardState>) => {
    sound.play("select");
    setState((prev) => ({ ...prev, ...next }));
  };

  /*
    Availability is read for the real configuration, debounced.

    It is the real compatible pool count — the same number the engine will draw
    from — because a builder that cheerfully offers 20 questions from a filter
    holding 14 has lied before the game even starts.
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

  /*
    Per-option counts for the step on screen, and only for that step.

    The dimension is the step's own (see dimensionFor), because the server
    answers each one with a single GROUP BY: asking for all five on every step
    would pay five times over for four numbers nobody can see. A step with no
    options to count — the answer mode, the summary — asks for nothing at all.
  */
  const dimensions = useMemo(() => dimensionFor(step), [step]);
  useEffect(() => {
    if (dimensions.length === 0) {
      setOptions(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      // Mode-spanning whenever the chosen type is mixed — not only on the type
      // step — so every later step's counts match what the grid will draw.
      fetchAvailability(config, dimensions, { anyMode: state.questionType === MIXED_TYPE_KEY })
        .then((res) => !cancelled && setOptions(res))
        .catch(() => !cancelled && setOptions(null));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `config` is in the deps because a count is only true for the selection it
    // was measured under: changing the difficulty changes every country's count.
  }, [config, dimensions, state.questionType]);

  // Each step change moves focus to the new heading. A wizard that swaps the
  // whole screen without telling a screen reader is a wizard a screen reader
  // user cannot follow.
  useEffect(() => {
    headingRef.current?.focus();
    setCountryQuery("");
  }, [step]);

  const atLast = step === "summary";
  const none = availableCount === 0;
  const stepNumber = steps.indexOf(step) + 1;

  /**
   * Whether an option with `count` questions can be chosen.
   *
   * The threshold is the requested quiz length, not an arbitrary floor: an
   * option is "not enough" precisely when it cannot fill the quiz the player
   * asked for, so picking 5 questions instead of 20 re-enables options and the
   * reason is visible on the card. An unknown count never disables anything —
   * a failed availability request must not lock the builder.
   */
  const enough = (count: number | undefined) => count === undefined || count >= state.questionCount;

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

  const continentCountries = state.continent ? countriesIn(state.continent) : [];
  const searchable = continentCountries.length >= SEARCHABLE_FROM;
  const visibleCountries = searchable
    ? continentCountries.filter(
        (c) =>
          c.nameHe.includes(countryQuery.trim()) ||
          c.nameEn.toLowerCase().includes(countryQuery.trim().toLowerCase())
      )
    : continentCountries;

  return (
    <div className="page wiz">
      <div className="wiz-head">
        <button className="wiz-back" onClick={back} disabled={index === 0} aria-label="חזרה לשלב הקודם">
          <Icon name="arrow" size={18} />
        </button>
        <h1 className="wiz-title" ref={headingRef} tabIndex={-1}>
          {STEP_TITLES[step]}
        </h1>
        <p className="wiz-progress" aria-label={`שלב ${stepNumber} מתוך ${steps.length}`}>
          <span className="wiz-progress-num">{stepNumber}</span>
          <span className="wiz-progress-sep">/</span>
          <span>{steps.length}</span>
        </p>
      </div>

      {/* Orientation, from the third step on: what has been chosen already, in
          one line. Not the summary — a player four steps in wants to remember
          their answers, not read a receipt. */}
      {stepNumber > 2 && !atLast && (
        <p className="wiz-orient">{orientationOf(state, { answerMode: ANSWER_MODE_LABELS, difficulty: DIFFICULTY_LABELS })}</p>
      )}

      {/* The step body. `key` is the step id, so the fade runs on a change of
          step and not on every keystroke inside one — and because the state
          lives above this, remounting the body costs nothing. */}
      <div className="wiz-body" key={step}>
        {step === "type" && (
          /* Thirteen cards, so the list lives in a scroll area of its own. The
             document must not scroll — that is the whole point of the wizard —
             but a step with thirteen real choices cannot fit a 390x844 phone,
             and the honest resolution is to move the overflow inside the step
             where the header and the primary action stay put. */
          <div className="wiz-grid wiz-grid-tight wiz-scroll" role="group" aria-label="סוג שאלות">
            {/* Mixed first and visually marked as the recommendation: it is the
                default, it shows off the breadth of the bank, and it is a real
                draw across eleven types rather than an absent filter. */}
            <OptionCard
              icon="sliders"
              label="מעורב"
              note="מכל הסוגים"
              count={options?.types?.[MIXED_TYPE_KEY]}
              selected={state.questionType === MIXED_TYPE_KEY}
              recommended
              disabled={!enough(options?.types?.[MIXED_TYPE_KEY])}
              onClick={() => patch({ questionType: MIXED_TYPE_KEY })}
            />
            {QUESTION_TYPES.map((type) => (
              <OptionCard
                key={type.key}
                icon={type.icon}
                label={type.labelHe}
                note={type.noteHe}
                count={options?.types?.[type.key]}
                selected={state.questionType === type.key}
                disabled={!enough(options?.types?.[type.key])}
                onClick={() => patch({ questionType: type.key })}
              />
            ))}
          </div>
        )}

        {step === "mode" && (
          /* No "מעורב" here, deliberately. Mixing free text and multiple choice
             inside one quiz means the input method changes under the player
             between questions, which is a worse experience than either mode on
             its own — the spec's own instruction is to prefer clarity over
             forcing a Mixed option, and this is the step where that applies. */
          <div className="wiz-grid wiz-grid-tall" role="group" aria-label="מצב תשובה">
            {(
              [
                { key: "FREE_TEXT", label: "תשובה חופשית", note: "כותבים את התשובה", icon: "keyboard" },
                { key: "MULTIPLE_CHOICE", label: "אמריקאי", note: "בוחרים מתוך אפשרויות", icon: "list" },
              ] as const
            ).map((option) => (
              <OptionCard
                key={option.key}
                icon={option.icon}
                label={option.label}
                note={option.note}
                selected={state.answerMode === option.key}
                onClick={() => patch({ answerMode: option.key as AnswerMode })}
              />
            ))}
          </div>
        )}

        {step === "settings" && (
          <>
            <Field label="רמת קושי">
              <div className="wiz-pills" role="group" aria-label="רמת קושי">
                {DIFFICULTY_OPTIONS.map((d) => (
                  <button
                    key={d}
                    className={`wiz-pill ${state.difficulty === d ? "is-on" : ""} ${d === "MIXED" ? "is-rec" : ""}`}
                    aria-pressed={state.difficulty === d}
                    onClick={() => patch({ difficulty: d })}
                  >
                    {d === "MIXED" ? "מעורב" : DIFFICULTY_LABELS[d]}
                  </button>
                ))}
              </div>
              <p className="wiz-hint">
                {state.difficulty === "MIXED"
                  ? "תערובת מאוזנת — רוב השאלות שחקניות, עם טעימה מהרמות הגבוהות"
                  : "כל השאלות באותה רמה"}
              </p>
            </Field>

            <Field label="מספר שאלות">
              <div className="wiz-counts" role="group" aria-label="מספר שאלות">
                {WIZARD_QUESTION_COUNTS.map((n) => (
                  <button
                    key={n}
                    className={`wiz-count ${state.questionCount === n ? "is-on" : ""} ${n === RECOMMENDED_COUNT ? "is-rec" : ""}`}
                    aria-pressed={state.questionCount === n}
                    onClick={() => patch({ questionCount: n })}
                  >
                    {n}
                    {n === RECOMMENDED_COUNT && <span className="wiz-count-rec">מומלץ</span>}
                  </button>
                ))}
              </div>
            </Field>

            <Availability counting={counting} count={availableCount} requested={state.questionCount} />
          </>
        )}

        {step === "scope" && (
          <div className="wiz-grid wiz-grid-fill" role="group" aria-label="טווח השאלות">
            {(
              [
                { kind: "WORLD", icon: "globe", label: "כל העולם", note: "מכל הליגות והנבחרות", rec: true },
                { kind: "REGION", icon: "shield", label: "אזור מסוים", note: "יבשת, מדינה או ליגה" },
                { kind: "COMPETITION", icon: "flame", label: "תחרות", note: "ליגת האלופות, מונדיאל ועוד" },
                { kind: "PRESET", icon: "sliders", label: "בחירות מהירות", note: "סטים מוכנים למשחק" },
              ] as const
            ).map((option) => (
              <OptionCard
                key={option.kind}
                icon={option.icon}
                label={option.label}
                note={option.note}
                recommended={"rec" in option ? option.rec : false}
                selected={state.scope === option.kind}
                onClick={() =>
                  patch({
                    scope: option.kind as ScopeKind,
                    // Switching branch clears the other branches' answers, so a
                    // half-finished drill-down cannot leak into a preset query.
                    preset: null,
                    competition: null,
                    continent: null,
                    country: null,
                    league: null,
                  })
                }
              />
            ))}
          </div>
        )}

        {step === "continent" && (
          <div className="wiz-grid wiz-grid-tight wiz-grid-fill" role="group" aria-label="יבשת">
            {SUPPORTED_CONTINENTS.map((continent) => {
              const count = options?.continents?.[continent.code];
              return (
                <OptionCard
                  key={continent.code}
                  icon="globe"
                  label={continent.labelHe}
                  count={count}
                  selected={state.continent === continent.code}
                  disabled={!enough(count)}
                  onClick={() => patch({ continent: continent.code, country: null, league: null })}
                />
              );
            })}
          </div>
        )}

        {step === "country" && (
          <>
            {searchable && (
              <input
                className="wiz-search"
                type="search"
                value={countryQuery}
                onChange={(e) => setCountryQuery(e.target.value)}
                placeholder="חיפוש מדינה"
                aria-label="חיפוש מדינה"
              />
            )}
            {/* A scroll area INSIDE the step, not a longer page. Twenty-one
                European countries cannot fit a phone screen, and the one thing
                the redesign must not undo is the document scrolling: the step
                header and the primary action stay put while the list moves. */}
            <div className={`wiz-scroll ${searchable ? "wiz-scroll-search" : ""}`}>
              <div className="wiz-grid wiz-grid-tight" role="group" aria-label="מדינה">
                <OptionCard
                  icon="globe"
                  label="כל היבשת"
                  note="בלי לבחור מדינה"
                  selected={state.country === null}
                  onClick={() => patch({ country: null, league: null })}
                />
                {visibleCountries.map((country) => {
                  const count = options?.countries?.[country.code];
                  return (
                    <OptionCard
                      key={country.code}
                      flag={country.flag}
                      label={country.nameHe}
                      count={count}
                      selected={state.country === country.code}
                      disabled={!enough(count)}
                      onClick={() => patch({ country: country.code, league: null })}
                    />
                  );
                })}
              </div>
              {visibleCountries.length === 0 && <p className="wiz-hint">לא נמצאה מדינה בשם הזה</p>}
            </div>
          </>
        )}

        {step === "league" && state.country && (
          /* The domestic league AND the continental competitions the country's
             clubs appear in. Scope matching is AND across dimensions now, so
             "Spain" plus "Champions League" means Spanish clubs in the
             Champions League — a real filter, and the reason this step has five
             options instead of the two it had when it was built from
             LEAGUE_BY_COUNTRY alone. */
          <div className="wiz-grid wiz-grid-tight wiz-grid-fill" role="group" aria-label="ליגה">
            <OptionCard
              icon="sliders"
              label="מעורב"
              note="כל התחרויות במדינה"
              count={options?.countries?.[state.country]}
              selected={state.league === null}
              recommended
              onClick={() => patch({ league: null })}
            />
            {competitionsForCountry(state.country).map((code) => {
              const count = options?.competitions?.[code];
              return (
                <OptionCard
                  key={code}
                  icon={code === leagueOf(state.country!) ? "trophy" : "flame"}
                  label={competitionLabel(code)}
                  count={count}
                  selected={state.league === code}
                  disabled={!enough(count)}
                  onClick={() => patch({ league: code })}
                />
              );
            })}
          </div>
        )}

        {step === "competition" && (
          <div className="wiz-scroll">
            <div className="wiz-grid wiz-grid-tight" role="group" aria-label="תחרות">
              {SCOPE_COMPETITIONS.map((competition) => {
                const count = options?.competitions?.[competition.code];
                return (
                  <OptionCard
                    key={competition.code}
                    icon={competition.type === "LEAGUE" ? "trophy" : "flame"}
                    label={competition.nameHe}
                    count={count}
                    selected={state.competition === competition.code}
                    disabled={!enough(count)}
                    onClick={() => patch({ competition: competition.code })}
                  />
                );
              })}
            </div>
          </div>
        )}

        {step === "preset" && (
          <div className="wiz-scroll">
            <div className="wiz-grid wiz-grid-wide" role="group" aria-label="בחירות מהירות">
              {PRESETS.map((preset) => {
                const count = options?.presets?.[preset.key];
                const capped = count !== undefined && options?.presetCeiling === count;
                return (
                  <OptionCard
                    key={preset.key}
                    icon={preset.icon}
                    label={preset.labelHe}
                    note={preset.noteHe}
                    count={count}
                    countSuffix={capped ? "+" : ""}
                    selected={state.preset === preset.key}
                    disabled={!enough(count)}
                    onClick={() => patch({ preset: preset.key })}
                  />
                );
              })}
            </div>
          </div>
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
            <button className="btn btn-primary btn-block" disabled={!canAdvance(state, step)} onClick={next}>
              המשך
              <Icon name="arrow" size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One selectable card: icon or flag, label, optional note, real count.
 *
 * The count is what makes a dense grid informative rather than merely full.
 * "ישראל — 55" tells a player something true that no amount of card styling
 * can, and it is also the reason the card can be disabled honestly: the number
 * and the reason it is not selectable are the same fact.
 */
function OptionCard({
  icon,
  flag,
  label,
  note,
  count,
  countSuffix = "",
  selected,
  disabled = false,
  recommended = false,
  onClick,
}: {
  icon?: string;
  flag?: string;
  label: string;
  note?: string;
  count?: number;
  countSuffix?: string;
  selected: boolean;
  disabled?: boolean;
  recommended?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`wiz-card ${selected ? "is-on" : ""} ${disabled ? "is-off" : ""} ${recommended ? "is-rec" : ""}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {flag ? (
        <span className="wiz-card-flag" aria-hidden="true">
          {flag}
        </span>
      ) : (
        icon && <Icon name={icon as never} size={22} />
      )}
      <span className="wiz-card-label">{label}</span>
      {note && <span className="wiz-card-note">{note}</span>}
      {disabled ? (
        <span className="wiz-card-count is-off">לא מספיק שאלות כרגע</span>
      ) : (
        count !== undefined && (
          <span className="wiz-card-count">
            {count.toLocaleString("he-IL")}
            {countSuffix} שאלות
          </span>
        )
      )}
      {recommended && !disabled && <span className="wiz-card-rec">מומלץ</span>}
    </button>
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
