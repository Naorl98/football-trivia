import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GAME_MODE_LABELS } from "../../shared/constants";
import type { Quiz } from "../../shared/types";
import { fetchChallenge } from "../lib/api";
import { saveActiveQuiz } from "../lib/quizSession";
import { sound } from "../lib/sound";
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

  function start() {
    if (!quiz || !publicId) return;
    sound.play("click");
    saveActiveQuiz({ quiz, startedAt: Date.now(), challengePublicId: publicId });
    navigate("/play");
  }

  return (
    <div className="page gate">
      {error && (
        <div className="plate a-pop">
          <span className="plate-mark">
            <Icon name="target" size={23} />
          </span>
          <h1 className="plate-title">האתגר לא נמצא</h1>
          <p className="plate-text">{error}</p>
          <button className="btn btn-primary" onClick={() => navigate("/build")}>
            בנו חידון משלכם
          </button>
        </div>
      )}

      {!error && !quiz && <Loading label="טוען את האתגר" />}

      {quiz && (
        <div className="plate a-pop">
          <span className="plate-mark">
            <Icon name="target" size={23} />
          </span>
          <h1 className="plate-title">הוזמנתם לאתגר</h1>
          <div className="plate-meta">
            <span className="tag tag-green">{GAME_MODE_LABELS[quiz.configuration.gameMode]}</span>
            <span className="tag">{quiz.questions.length} שאלות</span>
          </div>
          <p className="plate-text">אותן שאלות בדיוק, באותו סדר. מי ייקח?</p>
          <button className="btn btn-primary" onClick={start}>
            קבלו את האתגר
            <Icon name="arrow" size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
