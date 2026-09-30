import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CATEGORIES,
  COMPETITIONS,
  COUNTRIES,
  DIFFICULTY_LABELS,
  ENABLED_GAME_MODES,
  GAME_MODE_LABELS,
  QUESTION_COUNTS,
  REGIONS,
} from "../../shared/constants";
import type { AnswerMode, Category, Difficulty, GameMode, QuizConfiguration, Region } from "../../shared/types";
import { fetchAvailableCount } from "../lib/api";
import { startQuiz } from "../lib/startQuiz";
import { sound } from "../lib/sound";
import { Icon } from "../components/Icon";
import "./BuilderPage.css";

const DIFFICULTY_OPTIONS: (Difficulty | "MIXED")[] = ["MIXED", "EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];

// A one-line character note per level, so "בלתי אפשרי" means something before
// you have played it.
const DIFFICULTY_NOTES: Record<Difficulty | "MIXED", string> = {
  MIXED: "תערובת של כל הרמות",
  EASY: "שמות שכל אוהד מכיר",
  NORMAL: "ידע כדורגל סביר",
  HARD: "פרטים שדורשים מעקב אמיתי",
  EXPERT: "עונות, גמרים ומעברים ספציפיים",
  IMPOSSIBLE: "שאלות שגם פרשנים יפספסו",
};

export function BuilderPage() {
  const navigate = useNavigate();

  const [region, setRegion] = useState<Region>("WORLD");
  const [countries, setCountries] = useState<string[]>([]);
  const [competitions, setCompetitions] = useState<string[]>(["ALL"]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty | "MIXED">("MIXED");
  const [questionCount, setQuestionCount] = useState<(typeof QUESTION_COUNTS)[number]>(10);
  const [gameMode, setGameMode] = useState<GameMode>("CLASSIC");
  const [answerMode, setAnswerMode] = useState<AnswerMode>("MULTIPLE_CHOICE");

  const [availableCount, setAvailableCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config: QuizConfiguration = useMemo(
    () => ({ region, countries, competitions, categories, difficulty, questionCount, gameMode, answerMode }),
    [region, countries, competitions, categories, difficulty, questionCount, gameMode, answerMode]
  );

  useEffect(() => {
    let cancelled = false;
    setCounting(true);
    const timer = setTimeout(() => {
      fetchAvailableCount(config)
        .then((res) => !cancelled && setAvailableCount(res.availableCount))
        .catch(() => !cancelled && setAvailableCount(null))
        .finally(() => !cancelled && setCounting(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config]);

  function toggle<T>(list: T[], value: T, setter: (v: T[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function handleStart() {
    setError(null);
    setStarting(true);
    // First real gesture of the session — safe point to arm the audio context.
    sound.play("click");
    try {
      await startQuiz(navigate, config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "משהו השתבש, נסו שוב.");
    } finally {
      setStarting(false);
    }
  }

  const realCompetitions = COMPETITIONS.filter((c) => c.type !== "GROUP");
  const groupCompetitions = COMPETITIONS.filter((c) => c.type === "GROUP");
  const shortfall = availableCount !== null && availableCount > 0 && availableCount < questionCount;

  return (
    <div className="page builder">
      <header className="builder-head">
        <p className="label builder-kicker">טופס · בניית מבחן</p>
        <h1 className="builder-title display">הרכיבו את המבחן שלכם</h1>
        <p className="prose builder-lede">
          כל שדה מצמצם את מאגר השאלות. המספר בתחתית המסך מתעדכן בזמן אמת, כך שתדעו בדיוק מה נשאר
          לפני שמתחילים.
        </p>
      </header>

      <hr className="rule" />

      <Field index="01" title="איך עונים?" hint="תשובה חופשית זמינה לשאלות עם תשובה יחידה וכינויים מוצהרים.">
        <div className="mode-pair">
          <ModeCard
            active={answerMode === "MULTIPLE_CHOICE"}
            icon="list"
            title="אמריקאי"
            sub="בוחרים מתוך ארבע אפשרויות"
            onClick={() => setAnswerMode("MULTIPLE_CHOICE")}
          />
          <ModeCard
            active={answerMode === "FREE_TEXT"}
            icon="keyboard"
            title="תשובה חופשית"
            sub="מקלידים בעצמכם, עם רמזים"
            onClick={() => setAnswerMode("FREE_TEXT")}
          />
        </div>
      </Field>

      <Field index="02" title="סוג משחק">
        <ChipRow
          items={ENABLED_GAME_MODES.map((mode) => ({ key: mode, label: GAME_MODE_LABELS[mode] }))}
          isOn={(key) => gameMode === key}
          onPick={(key) => setGameMode(key as GameMode)}
          groupLabel="סוג משחק"
        />
      </Field>

      <Field index="03" title="טווח גיאוגרפי">
        <ChipRow
          items={REGIONS.map((r) => ({ key: r.code, label: r.labelHe }))}
          isOn={(key) => region === key}
          onPick={(key) => setRegion(key as Region)}
          groupLabel="טווח גיאוגרפי"
        />
      </Field>

      <Field index="04" title="מדינות" hint="אופציונלי — אפשר לבחור כמה.">
        <ChipRow
          items={COUNTRIES.map((c) => ({ key: c.code, label: c.nameHe }))}
          isOn={(key) => countries.includes(key)}
          onPick={(key) => toggle(countries, key, setCountries)}
          groupLabel="מדינות"
        />
      </Field>

      <Field index="05" title="ליגות ותחרויות">
        <ChipRow
          items={groupCompetitions.map((c) => ({ key: c.code, label: c.nameHe }))}
          isOn={(key) => competitions.includes(key)}
          onPick={(key) => setCompetitions([key])}
          groupLabel="קבוצות ליגות"
        />
        <ChipRow
          className="chip-row-second"
          items={realCompetitions.map((c) => ({ key: c.code, label: c.nameHe }))}
          isOn={(key) => competitions.includes(key)}
          onPick={(key) =>
            toggle(
              competitions.filter((code) => !groupCompetitions.some((g) => g.code === code)),
              key,
              setCompetitions
            )
          }
          groupLabel="תחרויות בודדות"
        />
      </Field>

      <Field index="06" title="קטגוריות" hint="אופציונלי — בלי בחירה מגיעות שאלות מכל הקטגוריות.">
        <ChipRow
          items={CATEGORIES.map((c) => ({ key: c.code, label: c.labelHe }))}
          isOn={(key) => categories.includes(key as Category)}
          onPick={(key) => toggle(categories, key as Category, setCategories)}
          groupLabel="קטגוריות"
        />
      </Field>

      <Field index="07" title="רמת קושי" hint={DIFFICULTY_NOTES[difficulty]}>
        <div className="ladder" role="group" aria-label="רמת קושי">
          {DIFFICULTY_OPTIONS.map((level, i) => (
            <button
              key={level}
              className={`rung ${difficulty === level ? "on" : ""}`}
              aria-pressed={difficulty === level}
              onClick={() => setDifficulty(level)}
            >
              {/* A rising bar chart of five steps: the ladder is legible as a
                  ladder, not just six words in a row. */}
              <span className="rung-bars" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((bar) => (
                  <span key={bar} className={`rung-bar ${i > 0 && bar < i ? "is-lit" : ""}`} />
                ))}
              </span>
              <span className="rung-label">{level === "MIXED" ? "מעורב" : DIFFICULTY_LABELS[level]}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field index="08" title="מספר שאלות">
        <ChipRow
          items={QUESTION_COUNTS.map((n) => ({ key: String(n), label: String(n) }))}
          isOn={(key) => questionCount === Number(key)}
          onPick={(key) => setQuestionCount(Number(key) as (typeof QUESTION_COUNTS)[number])}
          groupLabel="מספר שאלות"
        />
      </Field>

      {/* ---------- Sticky start bar ---------- */}
      <div className="builder-bar">
        <div className="builder-bar-inner">
          <p className="builder-count" role="status" aria-live="polite">
            {counting ? (
              <span className="ink-3">בודק זמינות…</span>
            ) : availableCount === null ? (
              <span className="ink-3">לא הצלחנו לבדוק זמינות</span>
            ) : availableCount === 0 ? (
              <span className="builder-count-zero">אין שאלות לסינון הזה — הרחיבו את הבחירה</span>
            ) : (
              <>
                <strong className="figures builder-count-n">{availableCount}</strong>
                <span className="ink-3"> שאלות זמינות</span>
                {shortfall && (
                  <span className="builder-count-warn"> · פחות מ-{questionCount}, המבחן יהיה קצר יותר</span>
                )}
              </>
            )}
          </p>
          <button className="btn btn-ink" disabled={starting || availableCount === 0} onClick={handleStart}>
            {starting ? "יוצר מבחן…" : "התחילו"}
            {!starting && <Icon name="arrow" size={18} />}
          </button>
        </div>
        {error && (
          <p className="builder-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  index,
  title,
  hint,
  children,
}: {
  index: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="field">
      <div className="section-head">
        <span className="section-index">{index}</span>
        <h2 className="section-title">{title}</h2>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
      {children}
    </section>
  );
}

function ChipRow({
  items,
  isOn,
  onPick,
  groupLabel,
  className = "",
}: {
  items: { key: string; label: string }[];
  isOn: (key: string) => boolean;
  onPick: (key: string) => void;
  groupLabel: string;
  className?: string;
}) {
  return (
    <div className={`chip-row ${className}`.trim()} role="group" aria-label={groupLabel}>
      {items.map((item) => (
        <button
          key={item.key}
          className="chip"
          aria-pressed={isOn(item.key)}
          onClick={() => onPick(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ModeCard({
  active,
  icon,
  title,
  sub,
  onClick,
}: {
  active: boolean;
  icon: "list" | "keyboard";
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button className={`mode card card-pressable ${active ? "is-active" : ""}`} aria-pressed={active} onClick={onClick}>
      <span className="mode-mark">
        <Icon name={icon} size={24} />
      </span>
      <span className="mode-title">{title}</span>
      <span className="mode-sub">{sub}</span>
    </button>
  );
}
