import type { Material, Language, Skill, WritingDraft } from "./types";
import { normalizeTerm } from "./review";
export type TrainingKind = "none" | "paraphrase" | "rewrite" | "speaking_part1";
export interface MicroItem {
  id: string;
  prompt: string;
  context: string;
  choices: string[];
  answers: string[];
  explanation: string;
  checklist: string[];
}
export interface MicroUnit {
  key: string;
  stamp: string;
  materialId: string | null;
  kind: Exclude<TrainingKind, "none">;
  skill: Skill;
  title: string;
  description: string;
  minutes: number;
  topics: string[];
  source: string;
  permission: string;
  items: MicroItem[];
}
export interface MicroState {
  stamp: string;
  runId: string;
  answers: Record<string, string>;
  checks: Record<string, Record<string, boolean>>;
  revealed: string[];
  index: number;
  elapsedSeconds: number;
  completed: boolean;
}
export interface MicroAttempt {
  id: string;
  owner_id: string;
  unit_key: string;
  unit_title?: string;
  unit_stamp?: string;
  criteria_total?: number;
  criteria_passed?: number;
  kind: Exclude<TrainingKind, "none">;
  skill: Skill;
  duration_seconds: number;
  item_count: number;
  correct_count: number | null;
  answer_body: Record<string, string> | null;
  self_review: MicroState["checks"] | null;
  unit_snapshot: MicroUnit | null;
  submitted_at: string;
  purged_at: string | null;
}
export const trainingNames: Record<TrainingKind, [string, string]> = {
  none: ["普通题组", "Question set"],
  paraphrase: ["同义替换识别", "Contextual paraphrase"],
  rewrite: ["句子改写", "Sentence rewrite"],
  speaking_part1: ["Part 1 短答", "Part 1 short answers"],
};
export function completionRule(kind: TrainingKind, lang: Language) {
  const rules = {
    none: ["完成题组", "Finish a set"],
    paraphrase: [
      "完成每道语境选择题并核对解释",
      "Answer each context question and review its explanation",
    ],
    rewrite: [
      "改写每个句子，阅读参考表达，并逐项自评",
      "Rewrite each sentence, read its reference, and self-check each criterion",
    ],
    speaking_part1: [
      "逐题练习短答，记录回答或笔记，并逐项自评",
      "Practise each short answer, write an answer or notes, and self-check each criterion",
    ],
  };
  return rules[kind][lang === "zh" ? 0 : 1];
}
const permission =
  "JiawenLex 项目自编示例，供项目用户学习、修改和使用；非官方题库 / Original JiawenLex examples for project users to study, adapt and use; not official exam questions";
export const originalUnits: MicroUnit[] = [
  {
    key: "builtin:paraphrase-context",
    stamp: "original-1",
    materialId: null,
    kind: "paraphrase",
    skill: "reading",
    title: "在语境中识别替换表达 / Paraphrases in context",
    description: "同义表达要放回原句判断，练习数量、变化与因果表达。",
    minutes: 4,
    topics: ["同义替换", "词汇", "paraphrase", "lexical resource"],
    source: "JiawenLex 自编训练 / Original JiawenLex practice",
    permission,
    items: [
      {
        id: "p1",
        context: "The number of visitors rose gradually during the spring.",
        prompt: "Which phrase preserves the meaning of “rose gradually” here?",
        choices: [
          "increased little by little",
          "fell sharply",
          "stayed unchanged",
        ],
        answers: ["increased little by little"],
        explanation:
          "“Gradually” describes a slow change over time. “Sharply” would change its rate, and “fell” reverses its direction.",
        checklist: [],
      },
      {
        id: "p2",
        context:
          "The proposal was rejected because its cost exceeded the available budget.",
        prompt: "Which replacement fits “exceeded the available budget”?",
        choices: [
          "was paid in advance",
          "was higher than the money available",
          "was equal to the money available",
        ],
        answers: ["was higher than the money available"],
        explanation:
          "“Exceed” means go beyond a limit. Paying in advance describes timing rather than the amount.",
        checklist: [],
      },
      {
        id: "p3",
        context:
          "Most residents preferred public transport to driving to the city centre.",
        prompt:
          "Which phrase can replace “Most residents” without changing the quantity?",
        choices: [
          "The majority of residents",
          "Every resident",
          "A few residents",
        ],
        answers: ["The majority of residents"],
        explanation:
          "“Most” and “the majority” indicate more than half. Neither means all, and “a few” describes a small number.",
        checklist: [],
      },
      {
        id: "p4",
        context:
          "Regular maintenance reduces the likelihood of equipment failure.",
        prompt:
          "Which phrase matches “reduces the likelihood” in this sentence?",
        choices: [
          "makes it less likely",
          "prevents every case",
          "makes it more expensive",
        ],
        answers: ["makes it less likely"],
        explanation:
          "Reducing a risk does not eliminate it. “Prevents every case” is a stronger claim than the original.",
        checklist: [],
      },
    ],
  },
  {
    key: "builtin:rewrite-clarity",
    stamp: "original-1",
    materialId: null,
    kind: "rewrite",
    skill: "writing",
    title: "保留原意，写得更清楚 / Rewrite with clarity",
    description:
      "短句改写：主谓一致、连接、比较与适度表述；参考答案不是唯一写法。",
    minutes: 6,
    topics: ["语法", "句式", "连贯", "grammar", "coherence", "改写"],
    source: "JiawenLex 自编训练 / Original JiawenLex practice",
    permission,
    items: [
      {
        id: "w1",
        prompt: "Correct the agreement error without changing the meaning.",
        context: "The number of students who cycle to school are increasing.",
        choices: [],
        answers: ["The number of students who cycle to school is increasing."],
        explanation:
          "The main subject is “The number”, so the verb is singular. “Students” belongs to the relative clause.",
        checklist: [
          "The original trend is preserved / 保留原有趋势",
          "The main subject and verb agree / 主谓一致",
        ],
      },
      {
        id: "w2",
        prompt:
          "Combine the ideas into one sentence while preserving the contrast.",
        context:
          "The buses are frequent. They are often crowded at peak times.",
        choices: [],
        answers: [
          "Although the buses are frequent, they are often crowded at peak times.",
        ],
        explanation:
          "“Although” introduces the contrast. Other accurate structures, such as “but”, are also possible.",
        checklist: [
          "Both original ideas remain / 两个原意都保留",
          "The contrast is clear / 对比关系清楚",
          "The sentence is complete / 句子完整",
        ],
      },
      {
        id: "w3",
        prompt: "Correct the comparative form.",
        context:
          "Travelling by train is more cheaper than travelling by car in this region.",
        choices: [],
        answers: [
          "Travelling by train is cheaper than travelling by car in this region.",
        ],
        explanation:
          "“Cheaper” already carries the comparative meaning; “more” is unnecessary here.",
        checklist: [
          "The comparison keeps the same direction / 比较方向不变",
          "Only one comparative form is used / 比较级形式正确",
        ],
      },
      {
        id: "w4",
        prompt:
          "Rewrite the claim to avoid asserting that it is true in every case.",
        context: "Working from home always improves productivity.",
        choices: [],
        answers: [
          "Working from home can improve productivity in some circumstances.",
        ],
        explanation:
          "A qualified claim is more careful when there is no evidence for “always”. This exercise practises wording; it does not establish the real effect of remote work.",
        checklist: [
          "The claim is appropriately qualified / 避免绝对化",
          "The statement remains grammatical / 语法正确",
          "No unsupported new facts are added / 不增加无依据事实",
        ],
      },
    ],
  },
  {
    key: "builtin:part1-everyday",
    stamp: "original-1",
    materialId: null,
    kind: "speaking_part1",
    skill: "speaking",
    title: "用理由和细节展开短答 / Extend a short answer",
    description:
      "每次只看一个日常提示，先给直接回答，再补一个理由或例子。可口头练习后记录笔记。",
    minutes: 6,
    topics: [
      "口语",
      "流利度",
      "展开表达",
      "fluency",
      "speaking",
      "development",
    ],
    source: "JiawenLex 自编训练 / Original JiawenLex practice",
    permission,
    items: [
      {
        id: "s1",
        prompt: "What do you enjoy doing after a busy day?",
        context:
          "Give a direct answer and one specific reason. Practise aloud before writing your answer or notes.",
        choices: [],
        answers: [
          "I enjoy taking a short walk because it helps me clear my head after studying.",
        ],
        explanation:
          "This is a structure example, not an answer to memorise. Use an activity and reason that are true for you.",
        checklist: [
          "I answered the question directly / 直接回答问题",
          "I added a relevant reason or detail / 补充相关理由或细节",
          "I practised aloud / 已开口练习",
        ],
      },
      {
        id: "s2",
        prompt: "Do you prefer studying alone or with other people?",
        context: "State your preference and explain it with a short example.",
        choices: [],
        answers: [
          "I usually prefer studying alone. For example, I can spend longer on difficult vocabulary without slowing anyone else down.",
        ],
        explanation:
          "A short example makes a preference concrete. Your own answer may express a different preference.",
        checklist: [
          "My preference is clear / 偏好清楚",
          "My example supports my answer / 例子与回答相关",
          "I practised aloud / 已开口练习",
        ],
      },
      {
        id: "s3",
        prompt: "Has your way of learning changed since you were younger?",
        context: "Contrast the past and the present in a brief answer.",
        choices: [],
        answers: [
          "Yes. I used to copy notes repeatedly, but now I test myself and review the words I forget.",
        ],
        explanation:
          "Past and present details help answer a question about change. No band score is assigned to this exercise.",
        checklist: [
          "I described a change or explained why not / 回应是否变化",
          "My time references are clear / 时间关系清楚",
          "I practised aloud / 已开口练习",
        ],
      },
      {
        id: "s4",
        prompt: "Is there a place near your home where you like to relax?",
        context:
          "Name a place and give one concrete detail. You do not need to provide your address.",
        choices: [],
        answers: [
          "There is a small park nearby. I like the quiet paths, especially in the early evening.",
        ],
        explanation:
          "A concrete detail supports a natural short answer. Keep location details general if you prefer.",
        checklist: [
          "I named a suitable place / 给出一个地点",
          "I included a relevant detail / 补充相关细节",
          "I practised aloud / 已开口练习",
        ],
      },
    ],
  },
];
export function materialUnit(m: Material): MicroUnit | null {
  if (
    !m.training_kind ||
    m.training_kind === "none" ||
    !m.source_title.trim() ||
    !m.license_name.trim() ||
    !m.questions?.length
  )
    return null;
  const kind = m.training_kind;
  if (
    (kind === "paraphrase" && m.skill !== "reading") ||
    (kind === "rewrite" && m.skill !== "writing") ||
    (kind === "speaking_part1" && m.skill !== "speaking")
  )
    return null;
  const items = m.questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    context: m.passage || m.prompt,
    choices: (q.choices ?? []).map((v) => v.trim()).filter(Boolean),
    answers: q.answers,
    explanation: q.explanation,
    checklist: (q.checklist ?? []).map((v) => v.trim()).filter(Boolean),
  }));
  if (
    items.length > 200 ||
    new Set(items.map((i) => i.id)).size !== items.length ||
    items.some(
      (i) =>
        !i.prompt.trim() ||
        !i.answers.some((a) => a.trim()) ||
        !i.explanation.trim() ||
        (kind === "paraphrase"
          ? i.choices.length < 2 ||
            !i.answers.some((a) => i.choices.includes(a))
          : !i.checklist.length),
    )
  )
    return null;
  return {
    key: `material:${m.id}`,
    stamp: `material-v${m.revision ?? 1}`,
    materialId: m.id,
    kind,
    skill: m.skill,
    title: m.title,
    description: m.prompt,
    minutes: m.training_minutes ?? 5,
    topics: m.training_topics ?? [],
    source: m.source_title,
    permission: m.license_name,
    items,
  };
}
const aliases: Record<string, string[]> = {
  grammar: [
    "grammar",
    "语法",
    "句式",
    "accuracy",
    "准确性",
    "语法准确性",
    "主谓一致",
  ],
  coherence: ["coherence", "cohesion", "连贯", "逻辑", "衔接"],
  paraphrase: [
    "paraphrase",
    "synonym",
    "同义替换",
    "词义",
    "词汇",
    "lexical resource",
    "词汇资源",
  ],
  fluency: [
    "fluency",
    "流利度",
    "口语",
    "speaking",
    "development",
    "展开表达",
    "表达展开",
  ],
};
export function topicMatches(unit: MicroUnit, topic: string): boolean {
  const key = normalizeTerm(topic.replace(/[_-]/g, " "));
  if (!key) return true;
  const expanded = Object.values(aliases).find((values) =>
    values.map(normalizeTerm).includes(key),
  ) ?? [key];
  return unit.topics.some((t) =>
    expanded.map(normalizeTerm).includes(normalizeTerm(t)),
  );
}
export function newMicroState(unit: MicroUnit): MicroState {
  return {
    stamp: unit.stamp,
    runId: crypto.randomUUID(),
    answers: {},
    checks: {},
    revealed: [],
    index: 0,
    elapsedSeconds: 0,
    completed: false,
  };
}
export function parseMicroState(
  body: string,
  unit: MicroUnit,
): MicroState | null {
  try {
    const state = JSON.parse(body) as MicroState;
    if (
      typeof state.stamp !== "string" ||
      typeof state.runId !== "string" ||
      typeof state.answers !== "object" ||
      !state.answers ||
      typeof state.checks !== "object" ||
      !state.checks ||
      !Array.isArray(state.revealed) ||
      !Number.isInteger(state.index) ||
      !Number.isFinite(state.elapsedSeconds)
    )
      return null;
    if (
      !/^[a-f0-9-]{36}$/i.test(state.runId) ||
      state.index < 0 ||
      state.index >= unit.items.length ||
      state.elapsedSeconds < 0 ||
      typeof state.completed !== "boolean" ||
      Object.values(state.answers).some((v) => typeof v !== "string") ||
      state.revealed.some((v) => typeof v !== "string") ||
      Object.values(state.checks).some(
        (v) =>
          !v ||
          typeof v !== "object" ||
          Object.values(v).some((b) => typeof b !== "boolean"),
      )
    )
      return null;
    return state;
  } catch {
    return null;
  }
}
export function microComplete(unit: MicroUnit, state: MicroState) {
  return unit.items.every(
    (i) =>
      !!state.answers[i.id]?.trim() &&
      state.revealed.includes(i.id) &&
      (unit.kind === "paraphrase" ||
        i.checklist.every(
          (_, n) => typeof state.checks[i.id]?.[String(n)] === "boolean",
        )),
  );
}
