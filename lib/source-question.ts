import { z } from "zod";

const uuid = z.string().uuid();
/** Instructions alone cannot identify a question: many essays use the same rubric. */
export function sourceExerciseIdentity(input: Record<string, unknown>) {
  const normalise = (value: unknown): string => typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase() : "";
  const questions = Array.isArray(input.questions) ? input.questions : [];
  if (!questions.length || questions.some(q=>!q || typeof q!=="object" || Array.isArray(q))) return "";
  return JSON.stringify([input.skill,input.track ?? "academic",normalise(input.passage),normalise(input.transcript),input.figureFilePath??"",input.audioFilePath??"",questions.map((q: Record<string,unknown>)=>[normalise(q.prompt),q.answer_mode,q.word_limit??null,q.requires_figure??false,Array.isArray(q.choices)?q.choices.map(normalise):[],normalise(q.answer_limit_text)])]);
}
export function canRevisePublishedQuestion(status: string, kind: string, action: string, hasPayload: boolean, expectedRevision?: number) {
  return status === "published" && kind === "question" && action === "publish_question" && hasPayload && Number.isInteger(expectedRevision) && Number(expectedRevision) > 0;
}
const sourceRef = z.object({
  document_id: uuid,
  physical_page: z.number().int().positive(),
  role: z.enum(["question", "passage", "answer", "figure"]),
});
const question = z.object({
  id: z.string().trim().min(1).max(100),
  type: z.string().max(100).default(""),
  prompt: z.string().trim().min(1).max(4000),
  origin_kind: z.enum(["source", "adapted"]),
  answer_mode: z.enum(["text", "single_choice", "multi_choice", "open"]),
  choices: z.array(z.string().trim().min(1).max(1000)).max(30).optional(),
  answers: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
  reference_answers: z.array(z.string().trim().min(1).max(4000)).max(10).optional(),
  explanation: z.string().max(4000).default(""),
  word_limit: z.number().int().positive().max(1000).optional(),
  source_refs: z.array(sourceRef).min(1).max(20),
  source_document_id: uuid,
  source_physical_page: z.number().int().positive(),
  source_printed_page: z.string().max(100).default(""),
  verified: z.boolean(),
  verification_level: z.enum(["source_verified", "administrator_approved"]).optional(),
  requires_figure: z.boolean().default(false),
});
export const sourceQuestionPayload = z.object({
  title: z.string().trim().min(1).max(240),
  prompt: z.string().trim().min(1).max(20000),
  skill: z.enum(["reading", "listening", "writing", "speaking"]),
  track: z.enum(["academic", "general"]).default("academic"),
  origin_kind: z.enum(["source", "adapted", "mixed"]),
  questionType: z.string().max(240).default(""),
  passage: z.string().max(50000).default(""),
  transcript: z.string().max(50000).default(""),
  audioFilePath: z.string().max(1000).optional(),
  figureFilePath: z.string().max(1000).optional(),
  listening_text_training: z.boolean().default(false),
  tags: z.array(z.string().max(80)).max(50).default([]),
  questions: z.array(question).min(1).max(200),
  source_refs: z.array(sourceRef).min(1).max(30),
  reviewed_against_pdf: z.literal(true),
  answer_alignment_checked: z.literal(true),
  extraction_issues: z.array(z.string()).max(0, "题目仍有识别疑点，请先完成核验").default([]),
});

export function validateSourceQuestion(input: unknown, documentId: string, administratorApproval = false) {
  const value = administratorApproval
    ? sourceQuestionPayload.extend({ reviewed_against_pdf: z.boolean(), answer_alignment_checked: z.boolean() }).parse(input)
    : sourceQuestionPayload.parse(input);
  if (value.track !== "academic") throw new Error("GT 专项练习尚未开放发布");
  if (value.audioFilePath && value.figureFilePath) throw new Error("当前题组仅支持一个辅助附件；同时需要图表和音频的题组暂留待处理");
  if ((value.questions.some((q) => q.requires_figure || q.source_refs.some((ref) => ref.role === "figure")) || value.source_refs.some((ref) => ref.role === "figure")) && !value.figureFilePath) throw new Error("图表题缺少独立图表附件，不能发布");
  if (value.skill === "listening" && !value.audioFilePath && (!value.listening_text_training || value.origin_kind !== "adapted" || !value.transcript.trim())) throw new Error("缺少音频，不能发布完整听力题；可改为明确标注的听力文本训练");
  if (value.listening_text_training && (value.skill !== "listening" || value.questions.some((item) => item.origin_kind !== "adapted"))) throw new Error("听力文本训练须为改编练习");
  if (value.skill === "reading" && !value.passage.trim()) throw new Error("阅读题缺少文章");
  if (["writing", "speaking"].includes(value.skill) && value.questions.some((q) => q.answer_mode !== "open")) throw new Error("写作和口语题必须使用开放回答，不能按唯一答案判分");
  const ids = new Set<string>();
  for (const item of value.questions) {
    if (ids.has(item.id)) throw new Error(`题号重复：${item.id}`);
    ids.add(item.id);
    if (!item.verified && !administratorApproval) throw new Error(`题目 ${item.id} 尚未对照原页核验`);
    if (administratorApproval) item.verification_level = "administrator_approved";
    if (item.source_document_id !== documentId && !item.source_refs.some((ref) => ref.document_id === documentId)) throw new Error(`题目 ${item.id} 缺少主文件来源`);
    if (!item.source_refs.some((ref) => ref.role === "question" && ref.document_id === item.source_document_id && ref.physical_page === item.source_physical_page)) throw new Error(`题目 ${item.id} 的原题页码不一致`);
    if (["single_choice", "multi_choice"].includes(item.answer_mode) && (!item.choices?.length || new Set(item.choices).size !== item.choices.length)) throw new Error(`题目 ${item.id} 选项不完整或重复`);
    if (item.answers.length && item.answer_mode === "single_choice" && (item.answers.length !== 1 || !item.choices?.includes(item.answers[0]))) throw new Error(`题目 ${item.id} 单选答案与选项不匹配`);
    if (item.answers.length && item.answer_mode === "multi_choice" && item.answers.some((answer) => !item.choices?.includes(answer))) throw new Error(`题目 ${item.id} 多选答案与选项不匹配`);
    if (item.answer_mode === "multi_choice" && new Set(item.answers).size !== item.answers.length) throw new Error(`题目 ${item.id} 多选答案重复`);
    if (item.answer_mode === "open" && item.answers.length) throw new Error(`开放回答 ${item.id} 不应设置唯一正确答案`);
    if (item.answers.length && !item.source_refs.some((ref) => ref.role === "answer") && item.origin_kind === "source") throw new Error(`题目 ${item.id} 缺少答案来源页`);
  }
  const kinds = new Set(value.questions.map((item) => item.origin_kind));
  if (value.origin_kind !== (kinds.size > 1 ? "mixed" : [...kinds][0])) throw new Error("题组来源标识与逐题标识不一致");
  return value;
}
