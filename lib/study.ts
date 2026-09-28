import type { Attempt, Profile, Skill, StudyTask, VocabularyWord } from "./types";

export const skills: Skill[] = ["reading", "listening", "writing", "speaking"];
export const skillLabels: Record<Skill | "vocabulary", { zh: string; en: string }> = {
  reading: { zh: "阅读", en: "Reading" },
  listening: { zh: "听力", en: "Listening" },
  writing: { zh: "写作", en: "Writing" },
  speaking: { zh: "口语", en: "Speaking" },
  vocabulary: { zh: "词汇", en: "Vocabulary" },
};

export function localDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfWeek(date = new Date()): string {
  const copy = new Date(date);
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

export function dueWords(words: VocabularyWord[]): VocabularyWord[] {
  const now = Date.now();
  return words.filter((word) => new Date(word.due_at).getTime() <= now).sort((a, b) => a.due_at.localeCompare(b.due_at));
}

export function weakSkills(attempts: Attempt[]): Skill[] {
  const scored = skills.map((skill) => {
    const relevant = attempts.filter((a) => a.skill === skill && !a.purged_at);
    if (skill === "reading" || skill === "listening") {
      const items = relevant.reduce((sum, a) => sum + (a.question_count ?? 0), 0);
      const correct = relevant.reduce((sum, a) => sum + (a.correct_count ?? 0), 0);
      return { skill, samples: items, score: items >= 10 && relevant.length >= 2 ? correct / items : null };
    }
    const tags = relevant.flatMap((a) => a.feedback?.tags ?? []);
    const repeated = tags.filter((tag, index) => tags.indexOf(tag) !== index).length;
    return { skill, samples: relevant.length, score: relevant.length >= 3 ? 1 / (1 + repeated) : null };
  });
  return scored.filter((row) => row.score !== null && row.score < 0.7).sort((a, b) => (a.score ?? 1) - (b.score ?? 1)).map((row) => row.skill);
}

export function generateWeeklyTasks(profile: Profile, attempts: Attempt[], existing: StudyTask[]): StudyTask[] {
  const week = startOfWeek();
  const preserved = existing.filter((task) => task.week_start === week && (task.status !== "todo" || task.source === "manual"));
  const priorities = weakSkills(attempts);
  const order: (Skill | "vocabulary")[] = profile.track === "general" ? ["vocabulary"] : ["reading", "listening", "writing", "speaking", "vocabulary"];
  const hours = Math.max(1, profile.weekly_hours || 1);
  const budget = Math.round(hours * 60);
  let remaining = Math.max(0, budget - preserved.reduce((sum, task) => sum + task.minutes, 0));
  const weights = order.map((skill) => ({ skill, weight: (skill === "vocabulary" ? 0.8 : 1) + (priorities.includes(skill as Skill) ? 0.5 : 0) }));
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
  const today = new Date();
  const newTasks: StudyTask[] = [];
  for (const [index, item] of weights.entries()) {
    if (remaining < 15) break;
    const minutes = Math.min(remaining, Math.max(15, Math.round((budget * item.weight / totalWeight) / 5) * 5));
    const skill = item.skill;
    newTasks.push({
      id: crypto.randomUUID(), owner_id: profile.id, week_start: week,
      planned_date: localDate(addDays(today, index % 7)),
      skill, title: skill === "vocabulary" ? "复习到期词汇" : `完成一组${skillLabels[skill].zh}练习`,
      minutes, status: "todo", source: "rule",
      rationale: priorities.includes(skill as Skill) ? "近期表现提示需要增加练习" : "依据每周可学习时间安排",
      material_id: null, created_at: new Date().toISOString(),
    });
    remaining -= minutes;
  }
  return [...preserved, ...newTasks];
}

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(`${date}T12:00:00`).getTime();
  const current = new Date(`${localDate()}T12:00:00`).getTime();
  return Math.max(0, Math.ceil((target - current) / 86400000));
}

export function normaliseAnswer(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}
