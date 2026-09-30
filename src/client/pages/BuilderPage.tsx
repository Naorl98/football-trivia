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

  return (
    <div className="page build">
      <h1 className="build-title a-fade-up">בנו חידון</h1>

      <div className="build-rows a-stagger">
        <Row index={0} label="אזור">
          <Chips
            items={REGIONS.map((r) => ({ key: r.code, label: r.labelHe }))}
            on={(key) => region === key}
            pick={(key) => choose(key as Region, setRegion)}
            group="אזור"
          />
        </Row>

        <Row index={1} label="מדינה / ליגות">
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

        <Row index={2} label="קטגוריה">
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

        <Row index={3} label="רמת קושי">
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

        <Row index={4} label="מספר שאלות">
          <Chips
            items={QUESTION_COUNTS.map((n) => ({ key: String(n), label: String(n) }))}
            on={(key) => questionCount === Number(key)}
            pick={(key) => choose(Number(key) as (typeof QUESTION_COUNTS)[number], setQuestionCount)}
            group="מספר שאלות"
          />
        </Row>

        <Row index={5} label="מצב תשובה">
          <Chips
            items={[
              { key: "MULTIPLE_CHOICE", label: "אמריקאי" },
              { key: "FREE_TEXT", label: "תשובה חופשית" },
            ]}
            on={(key) => answerMode === key}
            pick={(key) => choose(key as AnswerMode, setAnswerMode)}
            group="מצב תשובה"
          />
        </Row>
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
