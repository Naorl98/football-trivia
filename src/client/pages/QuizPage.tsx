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
import { Scoreboard } from "../components/Scoreboard";
import { Icon } from "../components/Icon";
import { isStreakMilestone } from "../lib/streak";
import "./QuizPage.css";

// Entrance treatments, cycled so consecutive questions never repeat one. Each
// is CSS-only and under 400ms, so they read as page turns rather than effects.
const TRANSITIONS = ["t-turn", "t-slide", "t-settle", "t-wipe"] as const;

// Answer letters, in Hebrew — the keyboard shortcuts map onto these positions.
const OPTION_MARKS = ["א", "ב", "ג", "ד", "ה", "ו"];

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

  const question = sessionIsPlayable ? session!.quiz.questions[index] : null;
  const isFreeText =
    !!question && session!.quiz.configuration.answerMode === "FREE_TEXT" && question.supportsFreeText;
  const answered = isFreeText ? freeTextResult !== null : selectedOptionId !== null;

  // Number keys pick an answer: faster for everyone, and a real alternative to
  // pointing for anyone who cannot use a mouse comfortably.
  useEffect(() => {
    if (!question || answered || isFreeText) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const position = Number(event.key);
      if (!Number.isInteger(position) || position < 1 || position > question.options.length) return;
      const option = question.options[position - 1];
      if (option) handleSelect(option.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleSelect is a hoisted declaration in this scope and always reads the
    // current question, so it is intentionally not a dependency.
  }, [question, answered, isFreeText]);

  if (!session || !sessionIsPlayable || !question) return null;
  const activeSession = session;

  const { quiz } = activeSession;
  const total = quiz.questions.length;
  const isLast = index === total - 1;
  const liveScore = computeScore(answers);

  // Current streak, for the scoreboard.
  let currentStreak = 0;
  for (let i = answers.length - 1; i >= 0; i--) {
    if (answers[i].correct) currentStreak++;
    else break;
  }

  const pipResults = answers.map((a): "hit" | "miss" => (a.correct ? "hit" : "miss"));

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
    window.setTimeout(() => setFlash(null), 620);
  }

  function handleSelect(optionId: number) {
    if (selectedOptionId !== null) return;
    setSelectedOptionId(optionId);
    const opt = question!.options.find((o) => o.id === optionId);
    const correct = !!opt?.isCorrect;
    sound.play(correct ? "correct" : "wrong");
    registerAnswer({
      questionId: question!.id,
      selectedOptionId: optionId,
      correct,
      timeMs: Date.now() - questionStartedAt,
    });
  }

  function handleFreeText(result: FreeTextResult) {
    setFreeTextResult(result);
    registerAnswer({
      questionId: question!.id,
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
  const chosen = question.options.find((o) => o.id === selectedOptionId);

  // One sentence stating the outcome, for the live region below the answers.
  const verdict = !answered
    ? ""
    : isFreeText
      ? freeTextResult!.correct
        ? "נכון."
        : `לא נכון. התשובה היא ${question.canonicalAnswer}.`
      : chosen?.isCorrect
        ? "נכון."
        : `לא נכון. התשובה היא ${question.options.find((o) => o.isCorrect)?.text}.`;

  return (
    <div className="page quiz">
      {flash && <div className={`flash flash-${flash}`} aria-hidden="true" />}

      <Scoreboard
        index={index}
        total={total}
        results={pipResults}
        points={liveScore.points}
        streak={currentStreak}
        difficultyLabel={DIFFICULTY_LABELS[question.difficulty]}
        freeText={isFreeText}
      />

      <article key={question.id} className={`sheet ${transition}`}>
        {isClueMode && question.clues.length > 0 && (
          <div className={`clues ${question.mode === "CAREER_PATH" ? "clues-path" : ""}`}>
            <p className="label clues-head">{question.mode === "CAREER_PATH" ? "מסלול" : "רמזים"}</p>
            <ol className="clues-list">
              {question.clues
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((clue, i) => (
                  <li key={i} className="clue">
                    <span className="clue-dot" aria-hidden="true" />
                    <span className="clue-text">{clue.text}</span>
                  </li>
                ))}
            </ol>
          </div>
        )}

        <h1 className="quiz-q display" id="quiz-question">
          {question.questionHe}
        </h1>

        {isFreeText ? (
          <FreeTextAnswer question={question} onResolved={handleFreeText} resolved={freeTextResult} />
        ) : (
          <div className="options" role="group" aria-labelledby="quiz-question">
            {question.options.map((opt, i) => {
              const state = !answered
                ? ""
                : opt.isCorrect
                  ? "is-correct"
                  : opt.id === selectedOptionId
                    ? "is-wrong"
                    : "is-out";
              return (
                <button
                  key={opt.id}
                  className={`option ${state}`}
                  onClick={() => handleSelect(opt.id)}
                  disabled={answered}
                >
                  <span className="option-mark figures" aria-hidden="true">
                    {OPTION_MARKS[i] ?? i + 1}
                  </span>
                  <span className="option-text">{opt.text}</span>
                  {answered && (opt.isCorrect || opt.id === selectedOptionId) && (
                    <span className="option-verdict" aria-hidden="true">
                      <Icon name={opt.isCorrect ? "check" : "cross"} size={19} strokeWidth={2.4} />
                    </span>
                  )}
                  {answered && opt.isCorrect && <span className="sr-only">— התשובה הנכונה</span>}
                  {answered && !opt.isCorrect && opt.id === selectedOptionId && (
                    <span className="sr-only">— הבחירה שלכם, שגויה</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Announced once per answer, with the explanation folded in so a
            screen-reader user gets the same payoff as a sighted one. */}
        <p className="sr-only" role="status" aria-live="polite">
          {answered ? `${verdict} ${question.explanationHe ?? ""}` : ""}
        </p>

        {answered && question.explanationHe && (
          <aside className="note anim-rise">
            <p className="label note-head">הרחבה</p>
            <p className="note-text">{question.explanationHe}</p>
          </aside>
        )}
      </article>

      {answered && (
        <div className="quiz-foot">
          <button className="btn btn-ink btn-block" onClick={handleNext} disabled={finishing} autoFocus>
            {finishing ? "שומר תוצאות…" : isLast ? "סיום וצפייה בתוצאות" : "לשאלה הבאה"}
            {!finishing && <Icon name="arrow" size={18} />}
          </button>
        </div>
      )}

      {!answered && !isFreeText && (
        <p className="quiz-hint">
          טיפ: אפשר לבחור גם במקשי המספרים 1–{question.options.length}
        </p>
      )}
    </div>
  );
}
