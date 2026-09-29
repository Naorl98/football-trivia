import type { AnswerRecord, Quiz, ScoreBreakdown } from "../../shared/types";

const ACTIVE_KEY = "fiq_active_quiz";
const RESULT_KEY = "fiq_last_result";

export interface ActiveQuizSession {
  quiz: Quiz;
  startedAt: number;
  challengePublicId?: string;
  isDaily?: boolean;
}

export interface QuizResultSession {
  quiz: Quiz;
  answers: AnswerRecord[];
  score: ScoreBreakdown;
  durationSeconds: number;
  challengePublicId?: string;
}

export function saveActiveQuiz(session: ActiveQuizSession) {
  sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(session));
}

export function loadActiveQuiz(): ActiveQuizSession | null {
  const raw = sessionStorage.getItem(ACTIVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveQuizSession;
  } catch {
    return null;
  }
}

export function clearActiveQuiz() {
  sessionStorage.removeItem(ACTIVE_KEY);
}

export function saveResult(result: QuizResultSession) {
  sessionStorage.setItem(RESULT_KEY, JSON.stringify(result));
}

export function loadResult(): QuizResultSession | null {
  const raw = sessionStorage.getItem(RESULT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QuizResultSession;
  } catch {
    return null;
  }
}
