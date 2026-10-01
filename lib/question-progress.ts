import type { Question } from "./types";

export function questionNumber(question: Pick<Question, "id">, index: number): string {
  return /^\d+(?:\s*[-–—]\s*\d+)?$/.test(question.id) ? question.id : String(index + 1);
}

export function hasQuestionAnswer(answer: string | undefined, question?: Pick<Question, "answer_mode" | "choices">): boolean {
  const text = answer?.trim();
  if (!text) return false;
  if (question?.answer_mode !== "multi_choice" && (question || !text.startsWith("["))) return true;
  try {
    const selected: unknown = JSON.parse(text);
    return Array.isArray(selected) && selected.length > 0 && selected.every(item =>
      typeof item === "string" && !!item.trim() && (!question?.choices || question.choices.includes(item)));
  } catch { return !question; }
}
