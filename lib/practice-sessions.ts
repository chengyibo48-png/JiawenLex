import { hasQuestionAnswer } from "./question-progress";
import type { Material, WorkspaceData } from "./types";

export interface PracticeSessionState {
  answerExposed?: boolean;
  runId: string;
  phase: "active" | "completed";
  materialStamp: string;
  questionIds: string[];
  answers: Record<string, string>;
  flagged: string[];
  revealed: string[];
  currentQuestionId: string | null;
  mobilePane: "passage" | "questions";
  mode: "practice" | "timed";
  durationMinutes: number;
  startedAt: number | null;
  deadline: number | null;
  elapsedSeconds: number;
}
export interface PracticeSession {
  id: string;
  owner_id: string;
  material_id: string;
  skill: "reading" | "listening";
  state: PracticeSessionState;
  version: number;
  answer_seen?: boolean;
  updated_at: string;
}
export const sessionLocalId = (materialId: string) => `practice:${materialId}`;
export function practiceMaterials(data: WorkspaceData): Material[] {
  return data.materials.filter((m) => m.track === "academic" && (
    m.owner_id === data.profile.id || (m.visibility === "shared" && m.approval === "approved") ||
    data.shares.some((g) => g.target_type === "material" && g.target_id === m.id && g.recipient_id === data.profile.id && !g.revoked_at)
  ));
}
export function materialStamp(material: Material): string {
  // Include the immutable revision and displayed/audio content: otherwise a prompt
  // or recording edit could silently submit an old session against a new version.
  const text = JSON.stringify([material.revision ?? 1, material.title, material.prompt,
    material.passage, material.transcript, material.questions, material.file_path,
    material.audio_segments ?? [], material.source_title, material.license_name]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
export function initialSessionState(material: Material): PracticeSessionState {
  return { runId: crypto.randomUUID(), phase: "active", materialStamp: materialStamp(material),
    questionIds: material.questions.map((q) => q.id), answers: {}, flagged: [], revealed: [],
    currentQuestionId: material.questions[0]?.id ?? null, mobilePane: "questions",
    mode: "practice", durationMinutes: 40, startedAt: null, deadline: null, elapsedSeconds: 0 };
}
export function answeredCount(session: PracticeSession, material?: Material): number {
  const questions = new Map(material?.questions.map(q => [q.id, q]));
  return session.state.questionIds.filter((id) => hasQuestionAnswer(session.state.answers[id], questions.get(id))).length;
}
export function estimateMinutes(material: Material): number {
  if (material.skill === "writing") return 40;
  if (material.skill === "speaking") return 10;
  return Math.max(5, Math.ceil(material.questions.length * (material.skill === "reading" ? 1.5 : 1)));
}


export function sameSessionState(a: PracticeSessionState, b: PracticeSessionState): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function sessionHasStarted(state: PracticeSessionState): boolean {
  return state.mode !== "timed" || state.startedAt !== null;
}
