import test from "node:test";
import assert from "node:assert/strict";
import { generateWeeklyTasks, groupAttemptHistory, isCorrectAnswer, localDate, reviewWord, startOfWeek, weakSkills } from "../lib/study.ts";

const profile = { id: "owner", track: "academic", language: "zh", weekly_hours: 10 };
const sunday = new Date("2026-10-04T12:00:00");
const task = (id, status = "todo", source = "rule", minutes = 30) => ({ id, status, source, minutes, week_start: startOfWeek(sunday) });
test("Sunday plans stay inside the same week and within valid session lengths", () => {
  const rows = generateWeeklyTasks(profile, [], [], sunday);
  assert.ok(rows.length > 5);
  assert.ok(rows.every((row) => row.planned_date === localDate(sunday) && row.minutes >= 10 && row.minutes <= 69));
  assert.equal(rows.reduce((sum, row) => sum + row.minutes, 0), 600);
});
test("Completed, skipped, manual and AI tasks survive rebalance", () => {
  const preserved = [task("done", "done"), task("skipped", "skipped"), task("manual", "todo", "manual"), task("ai", "todo", "ai")];
  const rows = generateWeeklyTasks(profile, [], [...preserved, task("old")], sunday);
  for (const record of preserved) assert.ok(rows.includes(record));
  assert.equal(rows.some((row) => row.id === "old"), false);
  assert.equal(rows.reduce((sum, row) => sum + row.minutes, 0), 600);
});
test("GT and 80-hour budgets split into valid sessions", () => {
  const rows = generateWeeklyTasks({ ...profile, track: "general", weekly_hours: 80 }, [], [], sunday);
  assert.ok(rows.every((row) => row.skill === "vocabulary" && row.minutes <= 69));
  assert.equal(rows.reduce((sum, row) => sum + row.minutes, 0), 4800);
});
test("Small remaining budgets never generate a sub-10-minute task", () => {
  for (let minutes = 1; minutes < 60; minutes++) {
    const rows = generateWeeklyTasks({ ...profile, weekly_hours: 1 }, [], [task("done", "done", "rule", minutes)], sunday);
    assert.ok(rows.filter((row) => row.id !== "done").every((row) => row.minutes >= 10));
    assert.ok(rows.reduce((sum, row) => sum + row.minutes, 0) <= 60);
  }
});
test("Rebalance never rewrites completed work exceeding the budget", () => {
  const completed = task("done", "done", "rule", 120);
  assert.deepEqual(generateWeeklyTasks({ ...profile, weekly_hours: 1 }, [], [completed], sunday), [completed]);
});
test("Scoring handles blanks, variants, Unicode normalization and word limits", () => {
  const question = { answers: [" City  parks ", "parks", ""], word_limit: 2 };
  assert.equal(isCorrectAnswer(question, "ＣＩＴＹ parks"), true);
  assert.equal(isCorrectAnswer(question, ""), false);
  assert.equal(isCorrectAnswer({ ...question, word_limit: 1 }, "city parks"), false);
});
test("Exactly five recent records survive equal timestamps, grouped by skill", () => {
  const records = Array.from({ length: 7 }, (_, index) => ({ id: String(index), material_id: null, skill: "writing", submitted_at: "2026-10-01" }));
  records.push({ id: "speaking", material_id: null, skill: "speaking", submitted_at: "2026-10-01" });
  const result = groupAttemptHistory(records);
  assert.equal(result.recent.length, 6); assert.equal(result.archived.length, 2);
});
test("Duplicate tags within one feedback cannot establish a weak skill", () => {
  const rows = [{ skill: "writing", feedback: { tags: ["grammar", "grammar", "grammar"] } }, { skill: "writing" }, { skill: "writing" }];
  assert.deepEqual(weakSkills(rows), []);
});
test("Repeated feedback themes and purged summaries remain useful", () => {
  const rows = Array.from({ length: 3 }, () => ({ skill: "writing", purged_at: "2026-10-01", feedback_tags: ["grammar"], feedback: null }));
  assert.deepEqual(weakSkills(rows), ["writing"]);
});
test("Vocabulary review advances known words and resets forgotten words", () => {
  assert.equal(reviewWord({ interval_days: 0, streak: 0 }, true).interval_days, 1);
  assert.equal(reviewWord({ interval_days: 40, streak: 8 }, true).interval_days, 60);
  assert.equal(reviewWord({ interval_days: 40, streak: 8 }, false).streak, 0);
});
