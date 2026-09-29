import type { Material, Question, Skill } from "./types";
export type LearningKind =
  | "legacy"
  | "first"
  | "repeat"
  | "review"
  | "intensive";
export interface AudioSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}
export interface Evidence {
  quote?: string;
  paragraph?: number;
  start?: number;
  end?: number;
}
export type MaterialSnapshot = Pick<
  Material,
  | "id"
  | "title"
  | "skill"
  | "passage"
  | "transcript"
  | "questions"
  | "question_type"
  | "source_title"
  | "license_name"
> & {
  prompt?: string;
  revision?: number;
  audio_segments: AudioSegment[];
  audio_path: string | null;
};
export interface ReviewNote {
  reason: string;
  note: string;
}
export interface AttemptReview {
  id: string;
  owner_id: string;
  snapshot: MaterialSnapshot;
  flagged: string[];
  notes: Record<string, ReviewNote>;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface VocabularySource {
  id: string;
  owner_id: string;
  word_id: string;
  attempt_id: string;
  question_id: string;
  context: string;
  created_at: string;
}
export interface SpellingSession {
  id: string;
  owner_id: string;
  total: number;
  correct: number;
  wrong_word_ids: string[];
  created_at: string;
}
export function snapshotMaterial(m: Material): MaterialSnapshot {
  return {
    id: m.id,
    prompt: m.prompt,
    revision: m.revision ?? 1,
    title: m.title,
    skill: m.skill,
    passage: m.passage,
    transcript: m.transcript,
    questions: m.questions,
    question_type: m.question_type,
    audio_segments: m.audio_segments ?? [],
    audio_path: m.file_path,
    source_title: m.source_title,
    license_name: m.license_name,
  };
}
export const normalizeTerm = (term: string) =>
  term.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
export const kindLabel = (kind: LearningKind | undefined, lang: "zh" | "en") =>
  ({
    legacy: ["历史记录（模式未知）", "Legacy (unknown exposure)"],
    first: ["首次作答", "First attempt"],
    repeat: ["重复练习", "Repeat attempt"],
    review: ["看过答案后的复习", "After answer exposure"],
    intensive: ["精听练习", "Intensive listening"],
  })[kind ?? "legacy"][lang === "zh" ? 0 : 1];
export function validSegments(
  segments: AudioSegment[],
  duration: number,
): AudioSegment[] {
  return segments
    .filter(
      (s) =>
        Number.isFinite(s.start) &&
        Number.isFinite(s.end) &&
        s.start >= 0 &&
        s.end > s.start &&
        s.end <= duration,
    )
    .sort((a, b) => a.start - b.start);
}
export function evidenceText(
  question: Question,
  snapshot: MaterialSnapshot,
): string | null {
  const e = question.evidence;
  if (!e) return null;
  const original =
    snapshot.skill === "reading" ? snapshot.passage : snapshot.transcript;
  if (e.quote && original.includes(e.quote)) return e.quote;
  if (snapshot.skill === "reading" && e.paragraph && e.paragraph > 0)
    return original.split("\n")[e.paragraph - 1] || null;
  return null;
}
