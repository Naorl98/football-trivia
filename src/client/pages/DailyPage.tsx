import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Quiz } from "../../shared/types";
import { fetchDaily } from "../lib/api";
import { saveActiveQuiz } from "../lib/quizSession";
import { sound } from "../lib/sound";
import { Icon } from "../components/Icon";
import { Loading } from "../components/Loading";
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

  function start() {
    if (!quiz) return;
    sound.play("click");
    saveActiveQuiz({ quiz, startedAt: Date.now(), isDaily: true });
    navigate("/play");
  }

  return (
    <div className="page gate">
      {error && (
        <div className="plate a-pop">
          <span className="plate-mark">
            <Icon name="calendar" size={23} />
          </span>
          <h1 className="plate-title">אתגר היום לא נטען</h1>
          <p className="plate-text">{error}</p>
          <button className="btn btn-primary" onClick={() => navigate("/build")}>
            בנו חידון משלכם
          </button>
        </div>
      )}

      {!error && !quiz && <Loading label="טוען את אתגר היום" />}

      {quiz && (
        <div className="plate a-pop">
          <span className="plate-mark">
            <Icon name="calendar" size={23} />
          </span>
          <h1 className="plate-title">אתגר יומי</h1>
          <div className="plate-meta">
            <span className="tag tag-green">{date}</span>
            <span className="tag">{quiz.questions.length} שאלות</span>
          </div>
          <p className="plate-text">אותן שאלות לכל מי שנכנס היום. מחר נטען סבב חדש.</p>
          <button className="btn btn-primary" onClick={start}>
            התחל
            <Icon name="arrow" size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
