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
import type { Category, Difficulty, GameMode, QuizConfiguration, Region } from "../../shared/types";
import { fetchAvailableCount } from "../lib/api";
import { startQuiz } from "../lib/startQuiz";
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

  const [availableCount, setAvailableCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config: QuizConfiguration = useMemo(
    () => ({ region, countries, competitions, categories, difficulty, questionCount, gameMode }),
    [region, countries, competitions, categories, difficulty, questionCount, gameMode]
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

  return (
    <div className="container builder">
      <h1 className="builder-title">בנו את החידון שלכם</h1>
      <p className="text-dim">התאימו אישית את החידון — טווח גיאוגרפי, ליגות, קטגוריות ורמת קושי.</p>

      <section className="builder-section">
        <h2>סוג משחק</h2>
        <div className="pill-row">
          {ENABLED_GAME_MODES.map((mode) => (
            <button
              key={mode}
              className={`pill ${gameMode === mode ? "selected" : ""}`}
              onClick={() => setGameMode(mode)}
            >
              {GAME_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </section>

      <section className="builder-section">
        <h2>טווח גיאוגרפי</h2>
        <div className="pill-row">
          {REGIONS.map((r) => (
            <button
              key={r.code}
              className={`pill ${region === r.code ? "selected" : ""}`}
              onClick={() => setRegion(r.code)}
            >
              {r.labelHe}
            </button>
          ))}
        </div>
      </section>

      <section className="builder-section">
        <h2>מדינות ספציפיות (אופציונלי)</h2>
        <div className="pill-row">
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              className={`pill ${countries.includes(c.code) ? "selected" : ""}`}
              onClick={() => toggle(countries, c.code, setCountries)}
            >
              {c.nameHe}
            </button>
          ))}
        </div>
      </section>

      <section className="builder-section">
        <h2>ליגות ותחרויות</h2>
        <div className="pill-row">
          {groupCompetitions.map((c) => (
            <button
              key={c.code}
              className={`pill ${competitions.includes(c.code) ? "selected" : ""}`}
              onClick={() => setCompetitions([c.code])}
            >
              {c.nameHe}
            </button>
          ))}
        </div>
        <div className="pill-row" style={{ marginTop: 8 }}>
          {realCompetitions.map((c) => (
            <button
              key={c.code}
              className={`pill ${competitions.includes(c.code) ? "selected" : ""}`}
              onClick={() =>
                toggle(
                  competitions.filter((code) => !groupCompetitions.some((g) => g.code === code)),
                  c.code,
                  setCompetitions
                )
              }
            >
              {c.nameHe}
            </button>
          ))}
        </div>
      </section>

      <section className="builder-section">
        <h2>קטגוריות</h2>
        <div className="pill-row">
          {CATEGORIES.map((c) => (
            <button
              key={c.code}
              className={`pill ${categories.includes(c.code) ? "selected" : ""}`}
              onClick={() => toggle(categories, c.code, setCategories)}
            >
              {c.labelHe}
            </button>
          ))}
        </div>
      </section>

      <section className="builder-section">
        <h2>רמת קושי</h2>
        <div className="pill-row">
          {DIFFICULTY_OPTIONS.map((d) => (
            <button
              key={d}
              className={`pill ${difficulty === d ? "selected" : ""}`}
              onClick={() => setDifficulty(d)}
            >
              {d === "MIXED" ? "מעורב" : DIFFICULTY_LABELS[d]}
            </button>
          ))}
        </div>
      </section>

      <section className="builder-section">
        <h2>מספר שאלות</h2>
        <div className="pill-row">
          {QUESTION_COUNTS.map((n) => (
            <button
              key={n}
              className={`pill ${questionCount === n ? "selected" : ""}`}
              onClick={() => setQuestionCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <div className="builder-footer">
        <div className="availability">
          {counting
            ? "בודק זמינות שאלות…"
            : availableCount !== null && (
                <span className={availableCount === 0 ? "text-danger" : "text-dim"}>
                  {availableCount === 0
                    ? "אין שאלות מתאימות לסינון הזה — נסו להרחיב"
                    : `${availableCount} שאלות זמינות בהתאמה לבחירה שלכם`}
                </span>
              )}
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <button
          className="btn btn-primary btn-block"
          disabled={starting || availableCount === 0}
          onClick={handleStart}
        >
          {starting ? "יוצר חידון…" : "התחל משחק"}
        </button>
      </div>
    </div>
  );
}
