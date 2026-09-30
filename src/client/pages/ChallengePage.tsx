import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GAME_MODE_LABELS } from "../../shared/constants";
import type { Quiz } from "../../shared/types";
import { fetchChallenge } from "../lib/api";
import { saveActiveQuiz } from "../lib/quizSession";
import { Icon } from "../components/Icon";
import { Loading } from "../components/Loading";
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
    <div className="page gate">
      {error && (
        <div className="plate card">
          <span className="plate-mark">
            <Icon name="target" size={26} />
          </span>
          <h1 className="plate-title">האתגר לא נמצא</h1>
          <p className="plate-text">{error}</p>
          <button className="btn btn-ink" onClick={() => navigate("/build")}>
            בנו מבחן משלכם
          </button>
        </div>
      )}

      {!error && !quiz && <Loading label="טוען את האתגר" />}

      {quiz && (
        <div className="plate card">
          <span className="plate-mark">
            <Icon name="target" size={26} />
          </span>
          <p className="label plate-kicker">הוזמנתם לאתגר</p>
          <h1 className="plate-title">אותן שאלות בדיוק. מי ייקח?</h1>
          <div className="plate-meta">
            <span className="stamp stamp-solid">{GAME_MODE_LABELS[quiz.configuration.gameMode]}</span>
            <span className="stamp">{quiz.questions.length} שאלות</span>
          </div>
          <p className="plate-text">
            מי ששלח לכם את הקישור כבר שיחק את הסבב הזה. אתם מקבלים את אותן שאלות, באותו סדר.
          </p>
          <button className="btn btn-ink" onClick={handleStart}>
            קבלו את האתגר
            <Icon name="arrow" size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
