import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DIFFICULTY_LABELS } from "../../shared/constants";
import { computeScore } from "../../shared/scoring";
import type { AnswerRecord } from "../../shared/types";
import { submitAttempt } from "../lib/api";
import { clearActiveQuiz, loadActiveQuiz, saveResult } from "../lib/quizSession";
import "./QuizPage.css";

export function QuizPage() {
  const navigate = useNavigate();
  const session = useMemo(() => loadActiveQuiz(), []);

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState(Date.now());
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!session) navigate("/build", { replace: true });
  }, [session, navigate]);

  useEffect(() => {
    setQuestionStartedAt(Date.now());
  }, [index]);

  if (!session) return null;
  const activeSession = session;

  const { quiz } = activeSession;
  const question = quiz.questions[index];
  const total = quiz.questions.length;
  const isLast = index === total - 1;
  const liveScore = computeScore(answers);
  const answered = selectedOptionId !== null;

  function handleSelect(optionId: number) {
    if (answered) return;
    setSelectedOptionId(optionId);
    const opt = question.options.find((o) => o.id === optionId);
    const record: AnswerRecord = {
      questionId: question.id,
      selectedOptionId: optionId,
      correct: !!opt?.isCorrect,
      timeMs: Date.now() - questionStartedAt,
    };
    setAnswers((prev) => [...prev, record]);
  }

  async function handleNext() {
    if (!isLast) {
      setIndex((i) => i + 1);
      setSelectedOptionId(null);
      return;
    }
    setFinishing(true);
    const durationSeconds = Math.round((Date.now() - activeSession.startedAt) / 1000);
    const finalScore = computeScore(answers);
    try {
      await submitAttempt({ answers, durationSeconds, challengePublicId: activeSession.challengePublicId });
    } catch {
      // Non-fatal — the player still sees their results even if logging fails.
    }
    saveResult({
      quiz,
      answers,
      score: finalScore,
      durationSeconds,
      challengePublicId: activeSession.challengePublicId,
    });
    clearActiveQuiz();
    navigate("/results");
  }

  const isClueMode = question.mode === "WHO_AM_I" || question.mode === "CAREER_PATH";

  return (
    <div className="container quiz-page">
      <div className="quiz-header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="quiz-progress-label">
            שאלה {index + 1} מתוך {total}
          </span>
          <span className="quiz-score text-gold">{liveScore.points} נקודות</span>
        </div>
        <div className="progress-track" style={{ marginTop: 8 }}>
          <div className="progress-fill" style={{ width: `${((index + (answered ? 1 : 0)) / total) * 100}%` }} />
        </div>
        <div className="row gap-2" style={{ marginTop: 10 }}>
          <span className="badge badge-green">{DIFFICULTY_LABELS[question.difficulty]}</span>
        </div>
      </div>

      <div key={question.id} className="quiz-body animate-in">
        {isClueMode && question.clues.length > 0 && (
          <div className={`clue-box ${question.mode === "CAREER_PATH" ? "clue-path" : ""}`}>
            {question.clues
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((clue, i, arr) => (
                <div key={i} className="clue-item">
                  <span className="clue-text">
                    {question.mode === "CAREER_PATH" ? clue.text : `"${clue.text}"`}
                  </span>
                  {question.mode === "CAREER_PATH" && i < arr.length - 1 && <span className="clue-arrow">↓</span>}
                </div>
              ))}
          </div>
        )}

        <h1 className="quiz-question">{question.questionHe}</h1>

        <div className="options-grid">
          {question.options.map((opt) => {
            let cls = "option-btn";
            if (answered) {
              if (opt.isCorrect) cls += " correct";
              else if (opt.id === selectedOptionId) cls += " incorrect";
              else cls += " muted";
            }
            return (
              <button key={opt.id} className={cls} onClick={() => handleSelect(opt.id)} disabled={answered}>
                {opt.text}
              </button>
            );
          })}
        </div>

        {answered && question.explanationHe && (
          <div className="explanation-box animate-in">
            <p>{question.explanationHe}</p>
          </div>
        )}
      </div>

      {answered && (
        <div className="quiz-footer">
          <button className="btn btn-primary btn-block" onClick={handleNext} disabled={finishing}>
            {finishing ? "שומר תוצאות…" : isLast ? "סיום ותוצאות" : "לשאלה הבאה"}
          </button>
        </div>
      )}
    </div>
  );
}
