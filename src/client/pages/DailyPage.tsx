import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Quiz } from "../../shared/types";
import { fetchDaily } from "../lib/api";
import { saveActiveQuiz } from "../lib/quizSession";
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

  function handleStart() {
    if (!quiz) return;
    saveActiveQuiz({ quiz, startedAt: Date.now(), isDaily: true });
    navigate("/play");
  }

  return (
    <div className="page gate">
      {error && (
        <div className="plate card">
          <span className="plate-mark">
            <Icon name="calendar" size={26} />
          </span>
          <h1 className="plate-title">אתגר היום לא נטען</h1>
          <p className="plate-text">{error}</p>
          <button className="btn btn-ink" onClick={() => navigate("/build")}>
            בנו מבחן משלכם
          </button>
        </div>
      )}

      {!error && !quiz && <Loading label="טוען את אתגר היום" />}

      {quiz && (
        <div className="plate card">
          <span className="plate-mark">
            <Icon name="calendar" size={26} />
          </span>
          <p className="label plate-kicker">אתגר יומי</p>
          <h1 className="plate-title">אותן שאלות לכולם, היום</h1>
          <div className="plate-meta">
            <span className="stamp stamp-solid">{date}</span>
            <span className="stamp">{quiz.questions.length} שאלות</span>
          </div>
          <p className="plate-text">
            כל מי שנכנס היום מקבל בדיוק את אותן שאלות, כך שאפשר להשוות ציונים בלי לבנות כלום. מחר
            נטען סבב חדש.
          </p>
          <button className="btn btn-ink" onClick={handleStart}>
            התחילו
            <Icon name="arrow" size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
