// Streak milestones get an audible and visual beat; ordinary increments stay
// quiet so the feedback keeps meaning something.
const MILESTONES = [3, 5, 10, 15, 20];

export function isStreakMilestone(streak: number): boolean {
  return MILESTONES.includes(streak);
}
