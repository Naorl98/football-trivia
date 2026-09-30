// Tracks recently-seen question ids so consecutive games feel fresh.
//
// The list is a sliding window, never a permanent block list: the engine only
// de-prioritises these ids, so a player who has seen everything still gets a
// full quiz.

const KEY = "fiq_recent_questions";
const WINDOW = 300;

export function getRecentQuestionIds(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

export function rememberQuestionIds(ids: number[]): void {
  try {
    const merged = [...ids, ...getRecentQuestionIds()];
    const deduped = [...new Set(merged)].slice(0, WINDOW);
    localStorage.setItem(KEY, JSON.stringify(deduped));
  } catch {
    // Storage unavailable — repeats are a small cost, not a failure.
  }
}
