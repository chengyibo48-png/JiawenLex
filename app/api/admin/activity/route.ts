import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { activityModules, presenceState, type ActivityRecord } from "@/lib/member-activity";
interface ActivityDbRow {
  id?: string; event_id?: string; material_id?: string; word_id?: string; title?: string; unit_title?: string;
  submitted_at?: string; created_at?: string; purged_at?: string | null; status?: string; known?: boolean;
  correct_count?: number | null; correct?: number | null; question_count?: number | null; item_count?: number | null; total?: number | null; duration_seconds?: number | null;
  answer_body?: unknown; transcript?: unknown; unit_snapshot?: unknown; self_review?: unknown;
}
const querySchema = z.object({ member: z.string().uuid().optional(), module: z.enum(activityModules).default("reading"), page: z.coerce.number().int().min(1).max(100000).default(1), days: z.coerce.number().pipe(z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(90), z.literal(365)])).default(0), record: z.string().uuid().optional() });
export async function GET(request: Request) {
  try {
    const { profile, admin } = await requireUser(request);
    if (profile.role !== "admin") throw new HttpError(403, "Admin access required");
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const headers = { "Cache-Control": "no-store" };
    const { data: members, error: memberError } = await admin.from("profiles").select("id,display_name").eq("status", "active").order("display_name");
    if (memberError) throw memberError;
    if (!query.member) {
      const ids = (members ?? []).map(m => m.id);
      if (!ids.length) return NextResponse.json({ members: [], checkedAt: new Date().toISOString() }, { headers });
      const { data: rows, error } = await admin.from("member_presence").select("owner_id,session_id,module,visible,last_seen").in("owner_id", ids).order("last_seen", { ascending: false }).limit(500);
      if (error) throw error;
      // Revoked login sessions never count as online, including on another device.
      const validity = new Map<string, boolean>();
      const sessions = new Map<string, { owner_id: string; session_id: string }>();
      for (const row of rows ?? []) {
        const key = `${row.owner_id}:${row.session_id}`;
        if (presenceState(row.last_seen, row.visible) !== "offline" && !sessions.has(key)) sessions.set(key, row);
      }
      const recentSessions = [...sessions.entries()];
      for (let offset = 0; offset < recentSessions.length; offset += 8) {
        await Promise.all(recentSessions.slice(offset, offset + 8).map(async ([key, row]) => {
          const result = await admin.rpc("session_active", { member_id: row.owner_id, session_id: row.session_id });
          if (result.error) throw result.error;
          validity.set(key, !!result.data);
        }));
      }
      return NextResponse.json({ members: (members ?? []).map(m => {
        const own = (rows ?? []).filter(r => r.owner_id === m.id);
        const online = own.find(r => validity.get(`${r.owner_id}:${r.session_id}`) && presenceState(r.last_seen, r.visible) === "online");
        const valid = own.find(r => validity.get(`${r.owner_id}:${r.session_id}`));
        const row = online ?? valid ?? own[0];
        return { ...m, last_seen: row?.last_seen ?? null, module: row?.module ?? null, presence: online ? "online" : valid ? presenceState(valid.last_seen, valid.visible) : row ? "offline" : "unknown" };
      }), checkedAt: new Date().toISOString() }, { headers });
    }
    if (!members?.some(m => m.id === query.member)) throw new HttpError(404, "Active member unavailable");
    const objective = ["reading", "listening", "writing", "speaking"].includes(query.module);
    const table = objective ? "practice_attempts" : query.module === "micro" ? "micro_attempts" : query.module === "vocabulary" ? "vocabulary_review_events" : query.module === "spelling" ? "spelling_sessions" : "study_tasks";
    const time = objective || query.module === "micro" ? "submitted_at" : "created_at";
    const columns = objective ? "id,material_id,skill,mode,duration_seconds,correct_count,question_count,submitted_at,purged_at" : query.module === "micro" ? "id,unit_title,skill,kind,duration_seconds,correct_count,item_count,submitted_at,purged_at" : query.module === "vocabulary" ? "event_id,word_id,known,created_at" : query.module === "spelling" ? "id,total,correct,created_at" : "id,title,skill,status,minutes,planned_date,created_at";
    let recordsQuery = admin.from(table).select(query.record ? columns + (objective ? ",answer_body,transcript" : query.module === "micro" ? ",answer_body,unit_snapshot,self_review" : query.module === "spelling" ? ",wrong_word_ids" : "") : columns, { count: "exact" }).eq("owner_id", query.member);
    if (objective) recordsQuery = recordsQuery.eq("skill", query.module);
    if (!query.record && query.days) recordsQuery = recordsQuery.gte(time, new Date(Date.now() - query.days * 86400000).toISOString());
    if (query.record) recordsQuery = recordsQuery.eq(query.module === "vocabulary" ? "event_id" : "id", query.record);
    const { data: records, count, error } = await recordsQuery.order(time, { ascending: false }).order(query.module === "vocabulary" ? "event_id" : "id", { ascending: false }).range(query.record ? 0 : (query.page - 1) * 25, query.record ? 0 : query.page * 25 - 1).returns<ActivityDbRow[]>();
    if (error) throw error;
    if (query.record) {
      const record = records?.[0];
      if (!record) throw new HttpError(404, "Record unavailable");
      let questions: unknown[] = [];
      if (objective && !record.purged_at) {
        const result = await admin.from("attempt_reviews").select("snapshot").eq("id", query.record).eq("owner_id", query.member).maybeSingle();
        if (result.error) throw result.error;
        questions = result.data?.snapshot?.questions ?? [];
      }
      // The one-year purge remains authoritative; never restore deleted answer bodies.
      if (query.module === "micro" && !record.purged_at && record.unit_snapshot && typeof record.unit_snapshot === "object") {
        const snapshot = record.unit_snapshot as { items?: unknown[] };
        questions = Array.isArray(snapshot.items) ? snapshot.items : [];
      }
      if (record.purged_at) { delete record.answer_body; delete record.transcript; delete record.unit_snapshot; delete record.self_review; }
      let wrongWords: { id: string; term: string }[] = [];
      if (query.module === "spelling") {
        const ids = (record as ActivityDbRow & { wrong_word_ids?: string[] }).wrong_word_ids;
        if (Array.isArray(ids) && ids.length) {
          const result = await admin.from("vocabulary").select("id,term").eq("owner_id", query.member).in("id", ids);
          if (result.error) throw result.error;
          wrongWords = result.data ?? [];
        }
      }
      return NextResponse.json({ record, questions, wrongWords }, { headers });
    }
    const materialIds = [...new Set((records ?? []).map(r => r.material_id).filter(Boolean))];
    const wordIds = [...new Set((records ?? []).map(r => r.word_id).filter(Boolean))];
    const titles = new Map<string, string>();
    if (materialIds.length) { const result = await admin.from("materials").select("id,title").in("id", materialIds); if (result.error) throw result.error; for (const m of result.data ?? []) titles.set(m.id, m.title); }
    if (wordIds.length) { const result = await admin.from("vocabulary").select("id,term").eq("owner_id", query.member).in("id", wordIds); if (result.error) throw result.error; for (const w of result.data ?? []) titles.set(w.id, w.term); }
    return NextResponse.json({ total: count ?? 0, page: query.page, records: (records ?? []).map(r => ({ id: (r.id ?? r.event_id)!, at: (r.submitted_at ?? r.created_at)!, title: r.title ?? r.unit_title ?? titles.get(r.material_id ?? r.word_id ?? "") ?? (query.module === "spelling" ? "拼写测验" : "历史练习"), status: r.purged_at ? "原作答已到期删除" : query.module === "vocabulary" ? (r.known ? "认识" : "不认识") : query.module === "plan" ? (({ done: "完成", skipped: "跳过", todo: "待完成" } as Record<string, string>)[r.status ?? ""] ?? r.status ?? "未知") : "已提交", correct: r.correct_count ?? r.correct ?? null, total: r.question_count ?? r.item_count ?? r.total ?? null, seconds: r.duration_seconds ?? null } satisfies ActivityRecord)) }, { headers });
  } catch (error) { return apiError(error); }
}
