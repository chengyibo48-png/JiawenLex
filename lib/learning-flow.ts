import type { PracticeSession } from "./practice-sessions";

/** Opening a set or changing its display preferences is not learning activity. */
export function hasLearningActivity(session: PracticeSession): boolean {
  const state = session.state;
  return state.phase === "active" && (Object.values(state.answers).some(value => {
    const answer = value.trim();
    return answer !== "" && answer !== "[]";
  }) || state.elapsedSeconds > 0 || state.startedAt !== null || state.flagged.length > 0 || state.revealed.length > 0);
}

/** Add calendar days after resolving the user's timezone, rather than adding 24 hours. */
export function nextCalendarDate(date: string, days = 1): string {
  const value = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) throw new Error("Invalid calendar date");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function mergeById<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.some(existing => existing.id === row.id)
    ? rows.map(existing => existing.id === row.id ? row : existing)
    : [...rows, row];
}
