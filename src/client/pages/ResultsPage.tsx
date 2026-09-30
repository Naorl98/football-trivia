import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CATEGORIES } from "../../shared/constants";
import type { Category } from "../../shared/types";
import { createChallenge, fetchQuiz } from "../lib/api";
import { loadResult, saveActiveQuiz } from "../lib/quizSession";
import { getRecentQuestionIds } from "../lib/recentQuestions";
import { IqMeter } from "../components/IqMeter";
import { Confetti } from "../components/Confetti";
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

  if (!result) return null;

  const { quiz, score, durationSeconds } = result;

  const categoryBreakdown = useMemo(() => {
    const map = new Map<Category, { correct: number; total: number }>();
    for (const answer of result.answers) {
      const question = quiz.questions.find((q) => q.id === answer.questionId);
      if (!question) continue;
      const entry = map.get(question.category) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (answer.correct) entry.correct += 1;
      map.set(question.category, entry);
    }
    return [...map.entries()];
  }, [result, quiz]);

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
        setShareMessage("הקישור הועתק ללוח!");
      }
    } catch {
      setShareMessage("לא הצלחנו ליצור קישור שיתוף, נסו שוב.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="container results-page">
      <Confetti active={score.footballIq >= 75} />

      <div className="results-hero animate-pop">
        <IqMeter value={score.footballIq} label={score.rank} />
        <div className="results-score">
          {score.correct} <span className="text-dim">/ {score.total}</span>
        </div>
        <div className="results-accuracy text-green">{score.accuracy}% הצלחה</div>
        <div className="row gap-2" style={{ justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
          <span className="badge">{formatDuration(durationSeconds)}</span>
          {score.bestStreak >= 2 && <span className="badge badge-gold">🔥 {score.bestStreak} ברצף</span>}
        </div>
      </div>

      <div className="results-stats card">
        <div className="stat">
          <span className="stat-value text-green">{score.correct}</span>
          <span className="stat-label text-dim">נכונות</span>
        </div>
        <div className="stat-divider" />
        <div className="stat">
          <span className="stat-value" style={{ color: "var(--danger)" }}>
            {score.incorrect}
          </span>
          <span className="stat-label text-dim">שגויות</span>
        </div>
        {score.revealed > 0 && (
          <>
            <div className="stat-divider" />
            <div className="stat">
              <span className="stat-value text-gold">{score.revealed}</span>
              <span className="stat-label text-dim">נחשפו</span>
            </div>
          </>
        )}
        <div className="stat-divider" />
        <div className="stat">
          <span className="stat-value text-gold">{score.points}</span>
          <span className="stat-label text-dim">נקודות</span>
        </div>
      </div>

      {categoryBreakdown.length > 0 && (
        <div className="results-categories">
          <h2 className="section-title">פילוח לפי קטגוריה</h2>
          <div className="stack gap-2">
            {categoryBreakdown.map(([cat, stats]) => (
              <div key={cat} className="category-row card">
                <span>{CATEGORY_LABELS[cat] ?? cat}</span>
                <span className="text-dim category-count">
                  {stats.correct}/{stats.total}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="results-actions">
        <button className="btn btn-primary btn-block" disabled={replaying} onClick={handleReplay}>
          {replaying ? "טוען…" : "משחק נוסף"}
        </button>
        <button className="btn btn-gold btn-block" disabled={sharing} onClick={handleShare}>
          {sharing ? "יוצר קישור…" : "הזמן חברים 🎯"}
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => navigate("/build")}>
          צור חידון חדש
        </button>
        {shareMessage && <p className="text-center text-dim">{shareMessage}</p>}
      </div>
    </div>
  );
}
