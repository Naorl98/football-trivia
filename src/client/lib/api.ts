import type { AnswerRecord, Quiz, QuizChallenge, QuizConfiguration, ScoreBreakdown } from "../../shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export function fetchQuiz(config: QuizConfiguration): Promise<Quiz> {
  return request<Quiz>("/api/quiz", { method: "POST", body: JSON.stringify(config) });
}

export function fetchAvailableCount(config: QuizConfiguration): Promise<{ availableCount: number }> {
  return request("/api/quiz/count", { method: "POST", body: JSON.stringify(config) });
}

export function createChallenge(config: QuizConfiguration): Promise<{ challenge: QuizChallenge; quiz: Quiz }> {
  return request("/api/challenges", { method: "POST", body: JSON.stringify(config) });
}

export function fetchChallenge(publicId: string): Promise<{ challenge: QuizChallenge; quiz: Quiz }> {
  return request(`/api/challenges/${encodeURIComponent(publicId)}`);
}

export function fetchDaily(): Promise<{ date: string; quiz: Quiz }> {
  return request("/api/daily");
}

export function submitAttempt(payload: {
  answers: AnswerRecord[];
  durationSeconds: number;
  challengePublicId?: string;
}): Promise<{ attemptId: number; score: ScoreBreakdown }> {
  return request("/api/attempts", { method: "POST", body: JSON.stringify(payload) });
}
