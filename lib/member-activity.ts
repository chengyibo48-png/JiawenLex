export const activityModules = ["reading", "listening", "writing", "speaking", "micro", "vocabulary", "spelling", "plan"] as const;
export type ActivityModule = typeof activityModules[number];
export const moduleNames: Record<string, string> = { today: "今日", reading: "阅读", listening: "听力", writing: "写作", speaking: "口语", practice: "练习", micro: "微练习", vocabulary: "词汇", spelling: "拼写", plan: "计划", library: "资料库", methods: "备考方法", progress: "进度", settings: "设置", admin: "管理" };
export function presenceState(lastSeen: string | null, visible: boolean, now = Date.now()): "online" | "recent" | "offline" | "unknown" {
  if (!lastSeen) return "unknown";
  const age = now - Date.parse(lastSeen);
  if (!Number.isFinite(age) || age < -5000) return "unknown";
  if (visible && age <= 90000) return "online";
  return age <= 300000 ? "recent" : "offline";
}
export interface ActivityMember { id: string; display_name: string; last_seen: string | null; module: string | null; presence: ReturnType<typeof presenceState>; }
export interface ActivityRecord { id: string; at: string; title: string; status: string; correct: number | null; total: number | null; seconds: number | null; }
export interface ActivityPage { records: ActivityRecord[]; total: number; page: number; }
