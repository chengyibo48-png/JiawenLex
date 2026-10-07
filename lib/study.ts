import type { Attempt, Profile, Question, Skill, StudyTask, VocabularyWord } from "./types";

export const skills: Skill[] = ["reading", "listening", "writing", "speaking"];
export const skillLabels: Record<Skill | "vocabulary", { zh: string; en: string }> = {
  reading: { zh: "阅读", en: "Reading" },
  listening: { zh: "听力", en: "Listening" },
  writing: { zh: "写作", en: "Writing" },
  speaking: { zh: "口语", en: "Speaking" },
  vocabulary: { zh: "词汇", en: "Vocabulary" },
};

export function localDate(date = new Date(), timezone?: string): string {
  if (timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    return ["year", "month", "day"].map((type) => parts.find((p) => p.type === type)!.value).join("-");
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfWeek(date = new Date(), timezone?: string): string {
  const copy = timezone ? new Date(localDate(date, timezone) + "T12:00:00") : new Date(date);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return localDate(copy);
}

export function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

export function reviewWord(word: VocabularyWord, known: boolean): VocabularyWord {
  const interval = known ? (word.interval_days < 1 ? 1 : Math.min(60, word.interval_days * 2)) : 1;
  return {
    ...word, interval_days: interval, streak: known ? word.streak + 1 : 0,
    last_reviewed_at: new Date().toISOString(), due_at: addDays(new Date(), interval).toISOString(),
  };
}

// Dashboard badges need only a count; avoid allocating and sorting the entire queue.
export function countDueWords(words: VocabularyWord[], now = Date.now()): number {
  let count = 0;
  for (const word of words) if (Date.parse(word.due_at) <= now) count++;
  return count;
}

export function dueWords(words: VocabularyWord[]): VocabularyWord[] {
  const now = Date.now();
  return words.filter((word) => new Date(word.due_at).getTime() <= now).sort((a, b) => a.due_at.localeCompare(b.due_at));
}

export function weakSkills(attempts: Attempt[]): Skill[] {
  const scored = skills.map((skill) => {
    const relevant = attempts.filter((a) => a.skill === skill && (!a.question_stats?.length || !a.question_stats.every((row) => ["listening_text", "vocabulary"].includes(row.type))) && ((skill !== "reading" && skill !== "listening") || a.learning_kind === "first"));
    if (skill === "reading" || skill === "listening") {
      const items = relevant.reduce((sum, a) => sum + (a.question_count ?? 0), 0);
      const correct = relevant.reduce((sum, a) => sum + (a.correct_count ?? 0), 0);
      return { skill, samples: items, score: items >= 10 && relevant.length >= 2 ? correct / items : null };
    }
    const feedbackAttempts = relevant.filter((a) => a.feedback || a.feedback_tags?.length);
    const tags = feedbackAttempts.flatMap((a) => [...new Set(a.feedback?.tags ?? a.feedback_tags ?? [])]);
    const repeated = tags.filter((tag, index) => tags.indexOf(tag) !== index).length;
    return { skill, samples: feedbackAttempts.length, score: feedbackAttempts.length >= 3 && repeated >= 2 ? 1 / (1 + repeated) : null };
  });
  return scored.filter((row) => row.score !== null && row.score < 0.7).sort((a, b) => (a.score ?? 1) - (b.score ?? 1)).map((row) => row.skill);
}

export function generateWeeklyTasks(profile: Profile, attempts: Attempt[], existing: StudyTask[], now = new Date()): StudyTask[] {
  const calendarNow = new Date(localDate(now, profile.timezone) + "T12:00:00");
  const week = startOfWeek(calendarNow);
  const preserved = existing.filter((task) => task.week_start === week && (task.status !== "todo" || task.source !== "rule"));
  const priorities = weakSkills(attempts);
  const order: (Skill | "vocabulary")[] = profile.track === "general" ? ["vocabulary"] : ["reading", "listening", "writing", "speaking", "vocabulary"];
  const hours = Math.min(80, Math.max(1, profile.weekly_hours || 1));
  const budget = Math.round(hours * 60);
  let remaining = Math.max(0, budget - preserved.reduce((sum, task) => sum + task.minutes, 0));
  const available = remaining;
  const weights = order.map((skill) => ({ skill, weight: (skill === "vocabulary" ? 0.8 : 1) + (priorities.includes(skill as Skill) ? 0.5 : 0) }));
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
  const today = calendarNow;
  const daysLeft = 7 - ((today.getDay() + 6) % 7);
  const newTasks: StudyTask[] = [];
  for (const [index, item] of weights.entries()) {
    if (remaining < 10) break;
    let allocation = index === weights.length - 1 ? remaining : Math.min(remaining, Math.max(10, Math.round(available * item.weight / totalWeight)));
    const skill = item.skill;
    while (allocation > 0) {
    const minutes = allocation <= 69 ? allocation : 60;
    newTasks.push({
      id: crypto.randomUUID(), owner_id: profile.id, week_start: week,
      planned_date: localDate(addDays(today, newTasks.length % daysLeft)),
      skill, title: profile.language === "en" ? (skill === "vocabulary" ? "Review due vocabulary" : `Practise ${skillLabels[skill].en.toLowerCase()}`) : (skill === "vocabulary" ? "复习到期词汇" : `完成一组${skillLabels[skill].zh}练习`),
      minutes, status: "todo", source: "rule",
      rationale: profile.language === "en" ? (priorities.includes(skill as Skill) ? "Repeated practice trends suggest more practice" : "Based on your remaining weekly study time") : (priorities.includes(skill as Skill) ? "近期多次练习的趋势提示需要增加练习" : "依据本周剩余可学习时间安排"),
      material_id: null, created_at: new Date().toISOString(),
    });
    remaining -= minutes;
    allocation -= minutes;
    }
  }
  return [...preserved, ...newTasks];
}


/** Interpret only explicit answer rubrics, never numbers in the question stem. */
export function answerWordRule(question: Pick<Question, "word_limit" | "answer_limit_text">): { words: number; additionalNumber: boolean } | null {
  const rubric = question.answer_limit_text?.normalize("NFKC").toUpperCase() ?? "";
  const names: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  const match = /(?:NO MORE THAN\s+)?(ONE|TWO|THREE|FOUR|FIVE|\d+)\s+WORDS?\b/.exec(rubric);
  const inferred = match ? names[match[1]] ?? Number(match[1]) : undefined;
  const words = question.word_limit ?? inferred;
  if (!Number.isSafeInteger(words) || !words || words < 1) return null;
  return { words, additionalNumber: /WORDS?\s+AND\s*\/\s*OR\s+(?:A\s+)?NUMBER\b/.test(rubric) || /WORDS?\s+AND\s+(?:A\s+)?NUMBER\b/.test(rubric) };
}

export function withinAnswerWordRule(question: Pick<Question, "word_limit" | "answer_limit_text">, answer: string): boolean {
  const rule = answerWordRule(question);
  if (!rule) return true;
  // A hyphenated word remains one token. An explicit AND/OR A NUMBER permits
  // one numeric token in addition to the word allowance; it is not a third word.
  const tokens = answer.normalize("NFKC").trim().split(/\s+/).filter(Boolean);
  const numeric = tokens.filter((token) => /^[+-]?(?:\d+(?:[,.:/-]\d+)*)(?:%)?$/.test(token)).length;
  return tokens.length - (rule.additionalNumber && numeric > 0 ? 1 : 0) <= rule.words;
}

export function isCorrectAnswer(question: Question, answer: string): boolean {
  if (question.verified === false) return false;
  if (question.verification_level === "administrator_approved" || question.answer_mode === "open") return false;
  if (question.answer_mode === "multi_choice") {
    let selected: unknown;
    try { selected = JSON.parse(answer); } catch { return false; }
    if (!Array.isArray(selected) || !selected.every((item) => typeof item === "string")) return false;
    const expected = [...new Set(question.answers.map(normaliseAnswer).filter(Boolean))].sort();
    const actual = [...new Set(selected.map(normaliseAnswer).filter(Boolean))].sort();
    return expected.length > 0 && expected.length === actual.length && expected.every((item, index) => item === actual[index]);
  }
  if (!question.answers.some((accepted) => accepted.trim()) || !answer.trim()) return false;
  if (question.answer_mode !== "single_choice" && !withinAnswerWordRule(question, answer)) return false;
  return question.answers.some((accepted) => accepted.trim() && normaliseAnswer(accepted) === normaliseAnswer(answer));
}

export function isGradableQuestion(question: Question): boolean {
  if (question.verified === false) return false;
  if (question.verification_level === "administrator_approved") return false;
  if (question.answer_mode === "open") return false;
  if (question.answer_mode === "multi_choice") return question.answers.some((accepted) => accepted.trim()) && !!question.choices?.length;
  return question.answers.some((accepted) => accepted.trim());
}

export function groupAttemptHistory(attempts: Attempt[]): { recent: Attempt[]; archived: Attempt[] } {
  const counts = new Map<string, number>();
  const recent: Attempt[] = [], archived: Attempt[] = [];
  const sorted = [...attempts].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at) || b.id.localeCompare(a.id));
  for (const attempt of sorted) {
    const key = `${attempt.skill}:${attempt.material_id ?? "free"}`;
    const count = counts.get(key) ?? 0;
    (count < 5 ? recent : archived).push(attempt);
    counts.set(key, count + 1);
  }
  return { recent, archived };
}

export function daysUntil(date: string | null, timezone?: string): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00Z`).getTime();
  const current = new Date(`${localDate(new Date(), timezone)}T00:00:00Z`).getTime();
  return Math.max(0, Math.ceil((target - current) / 86400000));
}

export function normaliseAnswer(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}
