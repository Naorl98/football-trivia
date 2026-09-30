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

export function BuilderPage() {
  const navigate = useNavigate();

  const [region, setRegion] = useState<Region>("WORLD");
  const [countries, setCountries] = useState<string[]>([]);
  const [competitions, setCompetitions] = useState<string[]>(["ALL"]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty | "MIXED">("MIXED");
  const [questionCount, setQuestionCount] = useState<(typeof QUESTION_COUNTS)[number]>(10);
  const [gameMode, setGameMode] = useState<GameMode>("CLASSIC");
  // Free text is the default: it is the mode the product is actually about.
  const [answerMode, setAnswerMode] = useState<AnswerMode>("FREE_TEXT");

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
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config]);

  function pick<T>(list: T[], value: T, setter: (v: T[]) => void) {
    sound.play("select");
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function choose<T>(value: T, setter: (v: T) => void) {
    sound.play("select");
    setter(value);
  }

  async function handleStart() {
    setError(null);
    setStarting(true);
    sound.play("click");
    try {
      await startQuiz(navigate, config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "משהו השתבש, נסו שוב.");
    } finally {
      setStarting(false);
    }
  }

  const groups = COMPETITIONS.filter((c) => c.type === "GROUP");
  const leagues = COMPETITIONS.filter((c) => c.type !== "GROUP");

  const none = availableCount === 0;
  const short = availableCount !== null && availableCount > 0 && availableCount < questionCount;

  const summary = [
    { label: "מצב", value: answerMode === "FREE_TEXT" ? "תשובה חופשית" : "אמריקאי" },
    { label: "סוג", value: GAME_MODE_LABELS[gameMode] },
    {
      label: "טווח",
      value:
        competitions.filter((c) => c !== "ALL").length > 0 || countries.length > 0
          ? `${competitions.filter((c) => c !== "ALL").length + countries.length} נבחרו`
          : REGIONS.find((r) => r.code === region)?.labelHe ?? "כל העולם",
    },
    { label: "קטגוריות", value: categories.length === 0 ? "הכול" : `${categories.length} נבחרו` },
    { label: "קושי", value: difficulty === "MIXED" ? "מעורב" : DIFFICULTY_LABELS[difficulty] },
    { label: "שאלות", value: String(questionCount) },
  ];

  return (
    <div className="page-wide page build">
      <h1 className="build-title a-fade-up">בנו חידון</h1>

      {/* The first and most consequential choice, so it gets the most weight
          on the page rather than sitting at the bottom as a pair of chips. */}
      <section className="mode-pick a-fade-up" aria-label="מצב משחק">
        <h2 className="build-label mode-pick-label">מצב משחק</h2>
        <div className="seg" role="group" aria-label="מצב משחק">
          {(
            [
              { key: "FREE_TEXT", label: "תשובה חופשית", icon: "keyboard" as const },
              { key: "MULTIPLE_CHOICE", label: "אמריקאי", icon: "list" as const },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              className={`seg-btn ${answerMode === option.key ? "is-on" : ""}`}
              aria-pressed={answerMode === option.key}
              onClick={() => choose(option.key as AnswerMode, setAnswerMode)}
            >
              <Icon name={option.icon} size={20} />
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <div className="build-grid">
      <div className="build-rows a-stagger">
        <Row index={0} label="אזור / ליגות">
          <Chips
            items={REGIONS.map((r) => ({ key: r.code, label: r.labelHe }))}
            on={(key) => region === key}
            pick={(key) => choose(key as Region, setRegion)}
            group="אזור"
          />
          <Chips
            items={groups.map((c) => ({ key: c.code, label: c.nameHe }))}
            on={(key) => competitions.includes(key)}
            pick={(key) => choose([key], setCompetitions)}
            group="קבוצות ליגות"
          />
          <Chips
            items={leagues.map((c) => ({ key: c.code, label: c.nameHe }))}
            on={(key) => competitions.includes(key)}
            pick={(key) =>
              pick(
                competitions.filter((code) => !groups.some((g) => g.code === code)),
                key,
                setCompetitions
              )
            }
            group="ליגות"
          />
          <Chips
            items={COUNTRIES.map((c) => ({ key: c.code, label: c.nameHe }))}
            on={(key) => countries.includes(key)}
            pick={(key) => pick(countries, key, setCountries)}
            group="מדינות"
          />
        </Row>

        <Row index={1} label="קטגוריות">
          <Chips
            items={CATEGORIES.map((c) => ({ key: c.code, label: c.labelHe }))}
            on={(key) => categories.includes(key as Category)}
            pick={(key) => pick(categories, key as Category, setCategories)}
            group="קטגוריות"
          />
          <Chips
            items={ENABLED_GAME_MODES.map((m) => ({ key: m, label: GAME_MODE_LABELS[m] }))}
            on={(key) => gameMode === key}
            pick={(key) => choose(key as GameMode, setGameMode)}
            group="סוג משחק"
          />
        </Row>

        <Row index={2} label="רמת קושי">
          <Chips
            items={DIFFICULTY_OPTIONS.map((d) => ({
              key: d,
              label: d === "MIXED" ? "מעורב" : DIFFICULTY_LABELS[d],
            }))}
            on={(key) => difficulty === key}
            pick={(key) => choose(key as Difficulty | "MIXED", setDifficulty)}
            group="רמת קושי"
          />
        </Row>

        <Row index={3} label="מספר שאלות">
          <Chips
            items={QUESTION_COUNTS.map((n) => ({ key: String(n), label: String(n) }))}
            on={(key) => questionCount === Number(key)}
            pick={(key) => choose(Number(key) as (typeof QUESTION_COUNTS)[number], setQuestionCount)}
            group="מספר שאלות"
          />
        </Row>
      </div>

      {/* Desktop only: fills the space beside a narrow form with something
          useful — what you have actually chosen, and the way out. */}
      <aside className="build-side" aria-label="סיכום הבחירה">
        <div className="side-card">
          <dl className="side-list">
            {summary.map((item) => (
              <div className="side-item" key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
          <p className="side-count">
            {counting ? (
              <span className="faint">בודק…</span>
            ) : availableCount === null ? (
              <span className="faint">לא הצלחנו לבדוק</span>
            ) : none ? (
              <span className="red">אין שאלות מתאימות</span>
            ) : short ? (
              <span className="amber">
                <b className="num">{availableCount}</b> בלבד — החידון יתקצר
              </span>
            ) : (
              <>
                <b className="num green">{availableCount}</b> <span className="muted">שאלות זמינות</span>
              </>
            )}
          </p>
          <button className="btn btn-primary btn-block" disabled={starting || none} onClick={handleStart}>
            {starting ? "יוצר…" : "התחל משחק"}
            {!starting && <Icon name="arrow" size={17} />}
          </button>
        </div>
      </aside>
      </div>

      {/* Availability is stated plainly, and a filter that cannot fill the quiz
          says so before the player commits — never silently after. */}
      <div className="build-bar">
        <div className="page build-bar-inner">
          <p className="build-count" role="status" aria-live="polite">
            {counting ? (
              <span className="faint">בודק…</span>
            ) : availableCount === null ? (
              <span className="faint">לא הצלחנו לבדוק זמינות</span>
            ) : none ? (
              <span className="red">אין שאלות מתאימות — הרחיבו את הסינון</span>
            ) : short ? (
              <span className="amber">
                יש <b className="num">{availableCount}</b> שאלות בלבד — החידון יהיה בן {availableCount}
              </span>
            ) : (
              <span className="muted">
                <b className="num green">{availableCount}</b> שאלות זמינות
              </span>
            )}
          </p>
          <button className="btn btn-primary" disabled={starting || none} onClick={handleStart}>
            {starting ? "יוצר…" : "התחל משחק"}
            {!starting && <Icon name="arrow" size={17} />}
          </button>
        </div>
        {error && (
          <p className="build-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ index, label, children }: { index: number; label: string; children: React.ReactNode }) {
  return (
    <section className="build-row" style={{ "--i": index } as React.CSSProperties}>
      <h2 className="build-label">{label}</h2>
      <div className="build-field">{children}</div>
    </section>
  );
}

function Chips({
  items,
  on,
  pick,
  group,
}: {
  items: { key: string; label: string }[];
  on: (key: string) => boolean;
  pick: (key: string) => void;
  group: string;
}) {
  return (
    <div className="chips" role="group" aria-label={group}>
      {items.map((item) => (
        <button key={item.key} className="chip" aria-pressed={on(item.key)} onClick={() => pick(item.key)}>
          <span className="chip-tick" aria-hidden="true">
            <Icon name="check" size={12} strokeWidth={3} />
          </span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
