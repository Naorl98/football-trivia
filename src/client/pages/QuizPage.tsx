import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DIFFICULTY_LABELS } from "../../shared/constants";
import { computeScore } from "../../shared/scoring";
import type { AnswerRecord } from "../../shared/types";
import { submitAttempt } from "../lib/api";
import { clearActiveQuiz, loadActiveQuiz, saveResult } from "../lib/quizSession";
import { rememberQuestionIds } from "../lib/recentQuestions";
import { sound } from "../lib/sound";
import { FreeTextAnswer, type FreeTextResult } from "../components/FreeTextAnswer";
import { StreakBadge, isStreakMilestone } from "../components/StreakBadge";
import "./QuizPage.css";

// A small set of short entrance animations, cycled so consecutive questions
// don't use the same one. Each is 200-500ms and CSS-only.
const TRANSITIONS = ["t-slide", "t-flip", "t-spotlight", "t-rise"] as const;

export function QuizPage() {
  const navigate = useNavigate();
  const session = useMemo(() => loadActiveQuiz(), []);

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null);
  const [freeTextResult, setFreeTextResult] = useState<FreeTextResult | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState(Date.now());
  const [finishing, setFinishing] = useState(false);
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);

  // A stale or malformed stored session must not white-screen the app.
  const sessionIsPlayable = !!session?.quiz?.questions?.length;

  useEffect(() => {
    if (!sessionIsPlayable) navigate("/build", { replace: true });
  }, [sessionIsPlayable, navigate]);

  useEffect(() => {
    setQuestionStartedAt(Date.now());
  }, [index]);

  // Remember what was served so the next quiz can prefer unseen questions.
  useEffect(() => {
    if (session) rememberQuestionIds(session.quiz.questions.map((q) => q.id));
  }, [session]);

  if (!session || !sessionIsPlayable) return null;
  const activeSession = session;

  const { quiz } = activeSession;
  const question = quiz.questions[index];
  const total = quiz.questions.length;
  const isLast = index === total - 1;
  const liveScore = computeScore(answers);
  const isFreeText = quiz.configuration.answerMode === "FREE_TEXT" && question.supportsFreeText;
  const answered = isFreeText ? freeTextResult !== null : selectedOptionId !== null;

  // Current streak, for the live badge.
  let currentStreak = 0;
  for (let i = answers.length - 1; i >= 0; i--) {
    if (answers[i].correct) currentStreak++;
    else break;
  }

  function registerAnswer(record: AnswerRecord) {
    setAnswers((prev) => {
      const next = [...prev, record];
      let streak = 0;
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].correct) streak++;
        else break;
      }
      if (record.correct && isStreakMilestone(streak)) sound.play("streak");
      return next;
    });
    setFlash(record.correct ? "correct" : "wrong");
    window.setTimeout(() => setFlash(null), 600);
  }

  function handleSelect(optionId: number) {
    if (answered) return;
    setSelectedOptionId(optionId);
    const opt = question.options.find((o) => o.id === optionId);
    const correct = !!opt?.isCorrect;
    sound.play(correct ? "correct" : "wrong");
    registerAnswer({
      questionId: question.id,
      selectedOptionId: optionId,
      correct,
      timeMs: Date.now() - questionStartedAt,
    });
  }

  function handleFreeText(result: FreeTextResult) {
    setFreeTextResult(result);
    registerAnswer({
      questionId: question.id,
      selectedOptionId: null,
      typedAnswer: result.typed,
      correct: result.correct,
      revealed: result.revealed,
      hintsUsed: result.hintsUsed,
      timeMs: Date.now() - questionStartedAt,
    });
  }

  async function handleNext() {
    if (!isLast) {
      sound.play("next");
      setIndex((i) => i + 1);
      setSelectedOptionId(null);
      setFreeTextResult(null);
      return;
    }
    setFinishing(true);
    sound.play("complete");
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
  const transition = TRANSITIONS[index % TRANSITIONS.length];

  return (
    <div className="container quiz-page">
      {flash && <div className={`answer-flash flash-${flash}`} aria-hidden="true" />}

      <div className="quiz-header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="quiz-progress-label">
            שאלה {index + 1} מתוך {total}
          </span>
          <span className="row gap-2">
            <StreakBadge streak={currentStreak} />
            <span className="quiz-score text-gold">{liveScore.points} נקודות</span>
          </span>
        </div>
        <div className="progress-track" style={{ marginTop: 8 }}>
          <div className="progress-fill" style={{ width: `${((index + (answered ? 1 : 0)) / total) * 100}%` }} />
        </div>
        <div className="row gap-2" style={{ marginTop: 10 }}>
          <span className="badge badge-green">{DIFFICULTY_LABELS[question.difficulty]}</span>
          {isFreeText && <span className="badge">תשובה חופשית</span>}
        </div>
      </div>

      <div key={question.id} className={`quiz-body ${transition}`}>
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

        {isFreeText ? (
          <FreeTextAnswer question={question} onResolved={handleFreeText} resolved={freeTextResult} />
        ) : (
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
                  <span className="option-text">{opt.text}</span>
                  {answered && opt.isCorrect && (
                    <span className="option-mark" aria-label="תשובה נכונה">
                      ✓
                    </span>
                  )}
                  {answered && !opt.isCorrect && opt.id === selectedOptionId && (
                    <span className="option-mark" aria-label="התשובה שלכם, שגויה">
                      ✕
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

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
