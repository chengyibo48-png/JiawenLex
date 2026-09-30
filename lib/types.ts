export type Skill = "reading" | "listening" | "writing" | "speaking";
export type Track = "academic" | "general";
export type Language = "zh" | "en";
export type View =
  | "today"
  | "practice"
  | "vocabulary"
  | "plan"
  | "library"
  | "methods"
  | "progress"
  | "settings"
  | "admin";

export interface Profile {
  id: string;
  display_name: string;
  role: "admin" | "member";
  status: "active" | "removed";
  onboarded: boolean;
  track: Track;
  goal_overall: number | null;
  goal_listening: number | null;
  goal_reading: number | null;
  goal_writing: number | null;
  goal_speaking: number | null;
  target_date: string | null;
  weekly_hours: number;
  language: Language;
  theme: "light" | "dark";
  reminder_on: boolean;
  reminder_time: string;
  timezone: string;
  ai_enabled: boolean;
  monthly_budget_cny: number | null;
}

export interface StudyTask {
  review_attempt_id?: string | null;
  question_id?: string | null;
  id: string;
  owner_id: string;
  week_start: string;
  planned_date: string;
  skill: Skill | "vocabulary";
  title: string;
  minutes: number;
  status: "todo" | "done" | "skipped";
  source: "rule" | "manual" | "ai";
  rationale: string;
  material_id: string | null;
  created_at: string;
}

export interface Question {
  origin_kind?: "source" | "adapted";
  answer_mode?: "text" | "single_choice" | "multi_choice" | "open";
  source_refs?: { document_id: string; physical_page: number; role: "question" | "passage" | "answer" | "figure" }[];
  reference_answers?: string[];
  choices?: string[];
  checklist?: string[];
  evidence?: import("./review").Evidence;
  source_document_id?: string;
  source_physical_page?: number;
  source_printed_page?: string;
  verified?: boolean;
  id: string;
  type: string;
  prompt: string;
  answers: string[];
  explanation: string;
  word_limit?: number;
}

export interface Material {
  origin_kind?: "source" | "adapted" | "mixed";
  revision?: number;
  updated_at?: string;
  collection_title?: string;
  set_title?: string;
  part_title?: string;
  sort_order?: number;
  training_kind?: import("./micro-training").TrainingKind;
  training_minutes?: number;
  training_topics?: string[];
  audio_segments?: import("./review").AudioSegment[];
  id: string;
  owner_id: string;
  visibility: "private" | "shared";
  approval: "pending" | "approved" | "rejected";
  title: string;
  skill: Skill;
  track: Track;
  question_type: string;
  prompt: string;
  passage: string;
  transcript: string;
  questions: Question[];
  tags: string[];
  source_title: string;
  source_url: string;
  license_name: string;
  file_path: string | null;
  file_name: string | null;
  file_kind: string | null;
  source_document_id?: string | null;
  source_physical_page?: number | null;
  source_printed_page?: string;
  created_at: string;
}

export interface Feedback {
  summary: string;
  strengths: string[];
  priorities: string[];
  annotations: { quote: string; comment: string }[];
  tags: string[];
}

export interface Attempt {
  material_revision?: number;
  learning_kind?: import("./review").LearningKind;
  answer_exposed?: boolean;
  id: string;
  owner_id: string;
  material_id: string | null;
  skill: Skill;
  mode: "practice" | "timed";
  duration_seconds: number;
  correct_count: number | null;
  question_count: number | null;
  answer_body: Record<string, string> | null;
  feedback: Feedback | null;
  feedback_tags?: string[];
  question_stats?: { type: string; count: number; correct: number }[];
  transcript: string | null;
  recording_path: string | null;
  saved_recording: boolean;
  submitted_at: string;
  purged_at: string | null;
}

export interface VocabularyWord {
  part_of_speech?: string;
  pronunciation?: string;
  pronunciation_uk?: string;
  pronunciation_us?: string;
  content_revision?: number;
  id: string;
  owner_id: string;
  term: string;
  definition: string;
  example: string;
  tags: string[];
  due_at: string;
  interval_days: number;
  streak: number;
  last_reviewed_at: string | null;
  created_at: string;
  source_document_id?: string | null;
  source_physical_page?: number | null;
  source_printed_page?: string;
  source_verified?: boolean;
}

export interface WritingDraft {
  material_revision?: number;
  id: string;
  owner_id: string;
  material_id: string;
  body: string;
  version: number;
  updated_at: string;
}

export interface ShareGrant {
  id: string;
  owner_id: string;
  recipient_id: string;
  target_type: "material" | "attempt";
  target_id: string;
  revoked_at: string | null;
  created_at: string;
}

export interface ShareComment {
  id: string;
  share_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface Member {
  id: string;
  display_name: string;
}

export interface UsageRecord {
  id: string;
  owner_id: string;
  provider: string;
  operation: string;
  estimated_cny: number;
  created_at: string;
}

export interface WorkspaceData {
  microDrafts?: WritingDraft[];
  microAttempts?: import("./micro-training").MicroAttempt[];
  materialVersions?: import("../components/material-organization").MaterialVersion[];
  attemptReviews?: import("./review").AttemptReview[];
  vocabularySources?: import("./review").VocabularySource[];
  spellingSessions?: import("./review").SpellingSession[];
  profile: Profile;
  tasks: StudyTask[];
  materials: Material[];
  words: VocabularyWord[];
  attempts: Attempt[];
  drafts: WritingDraft[];
  practiceSessions?: import("./practice-sessions").PracticeSession[];
  shares: ShareGrant[];
  comments: ShareComment[];
  members: Member[];
  usage: UsageRecord[];
}
