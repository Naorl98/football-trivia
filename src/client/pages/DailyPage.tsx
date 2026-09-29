import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Quiz } from "../../shared/types";
import { fetchDaily } from "../lib/api";
import { saveActiveQuiz } from "../lib/quizSession";
import "./IntroPage.css";

export function DailyPage() {
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDaily()
      .then((res) => {
        setQuiz(res.quiz);
        setDate(res.date);
      })
      .catch(() => setError("לא הצלחנו לטעון את אתגר היום. נסו שוב מאוחר יותר."));
  }, []);

  function handleStart() {
    if (!quiz) return;
    saveActiveQuiz({ quiz, startedAt: Date.now(), isDaily: true });
    navigate("/play");
  }

  return (
    <div className="container intro-page">
      {error && <p className="text-center text-dim">{error}</p>}
      {!error && !quiz && <p className="text-center text-dim">טוען אתגר יומי…</p>}
      {quiz && (
        <div className="card intro-card animate-pop">
          <div className="intro-emoji">🔥</div>
          <h1>אתגר יומי</h1>
          <p className="text-dim">
            {date} · {quiz.questions.length} שאלות זהות לכל השחקנים היום. חוזרים מחר לאתגר חדש!
          </p>
          <button className="btn btn-primary btn-block" onClick={handleStart}>
            התחל אתגר יומי
          </button>
        </div>
      )}
    </div>
  );
}
