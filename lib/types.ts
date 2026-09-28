export type Skill = "reading" | "listening" | "writing" | "speaking";
export type Track = "academic" | "general";
export type Language = "zh" | "en";
export type View = "today" | "practice" | "vocabulary" | "plan" | "library" | "progress" | "settings" | "admin";

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
  id: string;
  type: string;
  prompt: string;
  answers: string[];
  explanation: string;
  word_limit?: number;
}

export interface Material {
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
}

export interface WritingDraft {
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
  profile: Profile;
  tasks: StudyTask[];
  materials: Material[];
  words: VocabularyWord[];
  attempts: Attempt[];
  drafts: WritingDraft[];
  shares: ShareGrant[];
  comments: ShareComment[];
  members: Member[];
  usage: UsageRecord[];
}
