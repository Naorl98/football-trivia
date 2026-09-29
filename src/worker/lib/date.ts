// Israel-aware calendar date so every player sees the same daily challenge
// regardless of the timezone their device reports.
export function israelDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date); // en-CA formats as YYYY-MM-DD
}
