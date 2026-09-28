import type { WorkspaceData } from "./types";

const now = new Date();
const iso = now.toISOString();
const today = iso.slice(0, 10);
const monday = new Date(now);
monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
const week = monday.toISOString().slice(0, 10);

export const DEMO_USER = "demo-user";

export function initialDemoData(): WorkspaceData {
  return {
    profile: {
      id: DEMO_USER, display_name: "嘉文", role: "admin", status: "active", onboarded: true, track: "academic",
      goal_overall: 7.5, goal_listening: null, goal_reading: null, goal_writing: null,
      goal_speaking: null, target_date: "2027-02-28", weekly_hours: 10,
      language: "zh", theme: "light", reminder_on: false, reminder_time: "20:00",
      timezone: "Asia/Shanghai", ai_enabled: false, monthly_budget_cny: null,
    },
    tasks: [
      { id: "task-1", owner_id: DEMO_USER, week_start: week, planned_date: today, skill: "reading", title: "完成一组阅读练习", minutes: 45, status: "todo", source: "rule", rationale: "本周保持阅读练习频率", material_id: "sample-reading", created_at: iso },
      { id: "task-2", owner_id: DEMO_USER, week_start: week, planned_date: today, skill: "vocabulary", title: "复习到期词汇", minutes: 20, status: "todo", source: "rule", rationale: "巩固间隔复习", material_id: null, created_at: iso },
      { id: "task-3", owner_id: DEMO_USER, week_start: week, planned_date: today, skill: "writing", title: "写一篇 Task 2 议论文", minutes: 50, status: "todo", source: "rule", rationale: "积累写作样本", material_id: "sample-writing", created_at: iso },
    ],
    materials: [
      {
        id: "sample-reading", owner_id: DEMO_USER, visibility: "shared", approval: "approved",
        title: "城市里的社区花园", skill: "reading", track: "academic", question_type: "信息定位",
        prompt: "Read the passage and answer the questions.", passage: "Community gardens are shared spaces where residents grow plants together. In many cities, unused plots of land have been turned into gardens. Volunteers usually organise planting schedules and maintain pathways. Some gardens donate part of their harvest to local food banks. Researchers have also observed that these spaces can help neighbours meet and exchange practical knowledge. However, access to water and long-term permission to use the land remain common challenges.",
        transcript: "", questions: [
          { id: "q1", type: "short", prompt: "Who usually organises planting schedules?", answers: ["volunteers"], explanation: "The passage states that volunteers usually organise planting schedules." },
          { id: "q2", type: "short", prompt: "Where is part of the harvest sometimes donated?", answers: ["local food banks", "food banks"], explanation: "Some gardens donate part of their harvest to local food banks." },
          { id: "q3", type: "short", prompt: "Name one common challenge mentioned.", answers: ["access to water", "water", "permission to use the land", "long-term permission to use the land"], explanation: "The final sentence names water access and long-term land permission." },
        ],
        tags: ["环境", "城市"], source_title: "JiawenLex 自创示例", source_url: "",
        license_name: "自创示例，仅供演示", file_path: null, file_name: null, file_kind: null, created_at: iso,
      },
      {
        id: "sample-writing", owner_id: DEMO_USER, visibility: "shared", approval: "approved",
        title: "Task 2 · 城市公共空间", skill: "writing", track: "academic", question_type: "议论文",
        prompt: "Some people believe that cities should spend more money on public parks than on shopping centres. To what extent do you agree or disagree?",
        passage: "", transcript: "", questions: [], tags: ["城市", "公共空间"],
        source_title: "JiawenLex 自创示例", source_url: "", license_name: "自创示例，仅供演示",
        file_path: null, file_name: null, file_kind: null, created_at: iso,
      },
      {
        id: "sample-speaking", owner_id: DEMO_USER, visibility: "shared", approval: "approved",
        title: "Speaking Part 2 · 一个让你放松的地方", skill: "speaking", track: "academic", question_type: "Part 2",
        prompt: "Describe a place where you like to relax. You should say where it is, when you go there, what you do there, and explain why it helps you relax.",
        passage: "", transcript: "", questions: [], tags: ["地点", "生活"],
        source_title: "JiawenLex 自创示例", source_url: "", license_name: "自创示例，仅供演示",
        file_path: null, file_name: null, file_kind: null, created_at: iso,
      },
    ],
    words: [
      { id: "word-1", owner_id: DEMO_USER, term: "allocate", definition: "分配（时间或资源）", example: "Allocate enough time for revision.", tags: ["学习"], due_at: iso, interval_days: 0, streak: 0, last_reviewed_at: null, created_at: iso },
      { id: "word-2", owner_id: DEMO_USER, term: "sustainable", definition: "可持续的", example: "The city needs sustainable transport.", tags: ["环境"], due_at: iso, interval_days: 0, streak: 0, last_reviewed_at: null, created_at: iso },
      { id: "word-3", owner_id: DEMO_USER, term: "coherent", definition: "连贯的；条理清楚的", example: "Write a coherent argument.", tags: ["写作"], due_at: iso, interval_days: 0, streak: 0, last_reviewed_at: null, created_at: iso },
    ],
    attempts: [], drafts: [], shares: [], comments: [],
    members: [{ id: DEMO_USER, display_name: "嘉文" }, { id: "demo-friend", display_name: "学习伙伴" }],
    usage: [],
  };
}
