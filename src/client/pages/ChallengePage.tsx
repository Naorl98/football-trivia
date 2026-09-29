import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GAME_MODE_LABELS } from "../../shared/constants";
import type { Quiz } from "../../shared/types";
import { fetchChallenge } from "../lib/api";
import { saveActiveQuiz } from "../lib/quizSession";
import "./IntroPage.css";

export function ChallengePage() {
  const { publicId } = useParams<{ publicId: string }>();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicId) return;
    fetchChallenge(publicId)
      .then((res) => setQuiz(res.quiz))
      .catch(() => setError("האתגר הזה לא נמצא, ייתכן שפג תוקפו."));
  }, [publicId]);

  function handleStart() {
    if (!quiz || !publicId) return;
    saveActiveQuiz({ quiz, startedAt: Date.now(), challengePublicId: publicId });
    navigate("/play");
  }

  return (
    <div className="container intro-page">
      {error && (
        <div className="card intro-card text-center">
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => navigate("/build")}>
            צור חידון חדש
          </button>
        </div>
      )}
      {!error && !quiz && <p className="text-center text-dim">טוען אתגר…</p>}
      {quiz && (
        <div className="card intro-card animate-pop">
          <div className="intro-emoji">🎯</div>
          <h1>הוזמנת לאתגר Football IQ!</h1>
          <p className="text-dim">
            {quiz.questions.length} שאלות במצב {GAME_MODE_LABELS[quiz.configuration.gameMode]}. אותן שאלות בדיוק —
            מי יזכה בניקוד הגבוה יותר?
          </p>
          <button className="btn btn-primary btn-block" onClick={handleStart}>
            קבלו את האתגר
          </button>
        </div>
      )}
    </div>
  );
}
