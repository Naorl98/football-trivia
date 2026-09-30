import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CATEGORIES } from "../../shared/constants";
import type { Category } from "../../shared/types";
import { createChallenge, fetchQuiz } from "../lib/api";
import { loadResult, saveActiveQuiz } from "../lib/quizSession";
import { getRecentQuestionIds } from "../lib/recentQuestions";
import { IqMeter } from "../components/IqMeter";
import { Confetti } from "../components/Confetti";
import { Icon, FlameMark } from "../components/Icon";
import { sound } from "../lib/sound";
import "./ResultsPage.css";

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.code, c.labelHe]));

export function ResultsPage() {
  const navigate = useNavigate();
  const result = useMemo(() => loadResult(), []);
  const [replaying, setReplaying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!result) navigate("/", { replace: true });
  }, [result, navigate]);

  const categoryBreakdown = useMemo(() => {
    if (!result) return [];
    const map = new Map<Category, { correct: number; total: number }>();
    for (const answer of result.answers) {
      const question = result.quiz.questions.find((q) => q.id === answer.questionId);
      if (!question) continue;
      const entry = map.get(question.category) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (answer.correct) entry.correct += 1;
      map.set(question.category, entry);
    }
    // Strongest categories first: the report should open with what went well.
    return [...map.entries()].sort((a, b) => b[1].correct / b[1].total - a[1].correct / a[1].total);
  }, [result]);

  if (!result) return null;

  const { quiz, score, durationSeconds } = result;

  async function handleReplay() {
    setReplaying(true);
    sound.play("click");
    try {
      // Ask for questions the player has not just seen.
      const fresh = await fetchQuiz({
        ...quiz.configuration,
        excludeQuestionIds: getRecentQuestionIds(),
      });
      saveActiveQuiz({ quiz: fresh, startedAt: Date.now() });
      navigate("/play");
    } finally {
      setReplaying(false);
    }
  }

  async function handleShare() {
    setSharing(true);
    setShareMessage(null);
    try {
      const { challenge } = await createChallenge(quiz.configuration);
      const url = `${window.location.origin}/challenge/${challenge.publicId}`;
      const shareData = {
        title: "Football IQ",
        text: `קיבלתי ${score.points}/${score.total} ב-Football IQ. מוכנים להתמודד?`,
        url,
      };
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(url);
        setShareMessage("הקישור הועתק ללוח.");
      }
    } catch {
      setShareMessage("לא הצלחנו ליצור קישור שיתוף, נסו שוב.");
    } finally {
      setSharing(false);
    }
  }

  const tally = [
    { value: score.correct, label: "נכונות", tone: "pitch" },
    { value: score.incorrect, label: "שגויות", tone: "spot" },
    ...(score.revealed > 0 ? [{ value: score.revealed, label: "נחשפו", tone: "ink" }] : []),
    { value: `${score.accuracy}%`, label: "דיוק", tone: "ink" },
  ];

  return (
    <div className="page results">
      <Confetti active={score.footballIq >= 75} />

      {/* ---------- The stub: score + rating ---------- */}
      <section className="stub" aria-labelledby="results-heading">
        <header className="stub-head">
          <p className="label">דוח סיכום</p>
          <span className="stub-rule" aria-hidden="true" />
          <p className="label stub-meta">
            {quiz.questions.length} שאלות · {formatDuration(durationSeconds)}
          </p>
        </header>

        <h1 id="results-heading" className="sr-only">
          התוצאות שלכם: {score.correct} מתוך {score.total} נכונות, ציון Football IQ {score.footballIq}
        </h1>

        <IqMeter value={score.footballIq} label={score.rank} />

        {/* Forced LTR: a score is read "2/10" in every language, and bidi would
            otherwise render the pair as "10/2" inside this RTL page. */}
        <p className="stub-score figures" dir="ltr" aria-hidden="true">
          <span className="stub-score-correct">{score.correct}</span>
          <span className="stub-score-slash">/</span>
          <span className="stub-score-total">{score.total}</span>
        </p>

        {score.bestStreak >= 2 && (
          <p className="stub-streak">
            <FlameMark size={15} />
            הרצף הארוך שלכם: <strong className="figures">{score.bestStreak}</strong>
          </p>
        )}

        {/* Perforated tear line, then the tally — a ticket you rip in half. */}
        <div className="perf" aria-hidden="true" />

        <dl className="tally">
          {tally.map((cell) => (
            <div className="tally-cell" key={cell.label}>
              <dt className={`tally-value figures tone-${cell.tone}`}>{cell.value}</dt>
              <dd className="tally-label label">{cell.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------- Category breakdown ---------- */}
      {categoryBreakdown.length > 0 && (
        <section className="results-block" aria-labelledby="breakdown-title">
          <div className="section-head">
            <span className="section-index">01</span>
            <h2 id="breakdown-title" className="section-title">
              פילוח לפי קטגוריה
            </h2>
          </div>

          <table className="breakdown">
            <thead className="sr-only">
              <tr>
                <th scope="col">קטגוריה</th>
                <th scope="col">נכונות מתוך סך השאלות</th>
              </tr>
            </thead>
            <tbody>
              {categoryBreakdown.map(([cat, stats], i) => {
                const pct = Math.round((stats.correct / stats.total) * 100);
                return (
                  <tr key={cat} className="breakdown-row">
                    <th scope="row" className="breakdown-name">
                      {CATEGORY_LABELS[cat] ?? cat}
                    </th>
                    <td className="breakdown-meter">
                      {/* A ruled bar, not a rounded pill — it shares the
                          scoreboard's language. */}
                      <span className="meter" aria-hidden="true">
                        <span
                          className="meter-fill"
                          style={{ width: `${pct}%`, animationDelay: `${i * 70}ms` }}
                        />
                      </span>
                      <span className="breakdown-count figures">
                        {stats.correct}/{stats.total}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* ---------- Actions ----------
          Deliberately not scroll-revealed: these are the only way out of this
          screen, and gating them behind an IntersectionObserver would leave a
          player stranded if it never fires. */}
      <div className="results-actions">
        <button className="btn btn-ink btn-block" disabled={replaying} onClick={handleReplay}>
          <Icon name="replay" size={18} />
          {replaying ? "טוען…" : "סבב נוסף"}
        </button>
        <button className="btn btn-spot btn-block" disabled={sharing} onClick={handleShare}>
          <Icon name="share" size={18} />
          {sharing ? "יוצר קישור…" : "אתגרו חברים"}
        </button>
        <button className="btn btn-outline btn-block" onClick={() => navigate("/build")}>
          <Icon name="sliders" size={18} />
          בנו מבחן חדש
        </button>
        <p className="results-share-msg" role="status">
          {shareMessage ?? ""}
        </p>
      </div>
    </div>
  );
}
