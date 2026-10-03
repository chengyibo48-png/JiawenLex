"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiFetch } from "@/lib/supabase";
import { activityModules, moduleNames, type ActivityModule, type ActivityMember, type ActivityPage } from "@/lib/member-activity";
import { Modal } from "./modal";
const statusLabels = { online: "在线", recent: "最近活跃", offline: "离线", unknown: "暂无活动记录" };
function date(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未记录"; }
export function AdminActivity({ client }: { client: SupabaseClient | null }) {
  const [members, setMembers] = useState<ActivityMember[]>([]);
  const [selected, setSelected] = useState("");
  const [module, setModule] = useState<ActivityModule>("reading");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ActivityPage | null>(null);
  const [error, setError] = useState("");
  const [overviewError, setOverviewError] = useState("");
  const [revision, setRevision] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ record: Record<string, unknown>; questions: { id: string; prompt: string; answers?: string[]; reference_answers?: string[] }[] } | null>(null);
  const [detailError, setDetailError] = useState("");
  useEffect(() => {
    if (!client) return;
    let stopped = false;
    let busy = false;
    const controller = new AbortController();
    async function refresh() {
      if (stopped || busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const response = await apiFetch(client, "/api/admin/activity", { signal: controller.signal }) as { members: ActivityMember[] };
        if (!stopped) { setMembers(response.members); setOverviewError(""); setSelected(current => response.members.some(m => m.id === current) ? current : response.members[0]?.id ?? ""); }
      } catch (e) { if (!stopped) { setOverviewError(e instanceof Error ? e.message : "无法读取成员状态"); setMembers(current => current.map(member => ({ ...member, presence: "unknown" }))); } }
      finally { busy = false; }
    }
    const update = () => { void refresh(); };
    void refresh();
    const timer = window.setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [client, revision]);
  useEffect(() => {
    if (!client || !selected) return;
    const controller = new AbortController(); let active = true;
    setResult(null); setError("");
    void apiFetch(client, `/api/admin/activity?member=${selected}&module=${module}&page=${page}`, { signal: controller.signal }).then(value => { if (active) setResult(value as ActivityPage); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "读取失败"); });
    return () => { active = false; controller.abort(); };
  }, [client, selected, module, page, revision]);
  useEffect(() => {
    setDetail(null); setDetailError("");
    if (!client || !selected || !detailId) return;
    const controller = new AbortController(); let active = true;
    void apiFetch(client, `/api/admin/activity?member=${selected}&module=${module}&record=${detailId}`, { signal: controller.signal }).then(value => { if (active) setDetail(value as typeof detail); }).catch(e => { if (active) setDetailError(e instanceof Error ? e.message : "读取失败"); });
    return () => { active = false; controller.abort(); };
  }, [client, selected, module, detailId]);
  const answers = (detail?.record.answer_body ?? {}) as Record<string, unknown>;
  return <section className="card admin-activity">
    <div className="activity-heading"><div><span className="eyebrow">MEMBER ACTIVITY</span><h3>成员活动与答题记录</h3></div><button className="button secondary" onClick={() => setRevision(v => v + 1)}>刷新记录</button></div>
    <p className="muted small">仅管理员可查看。在线状态每 30 秒更新，90 秒未收到心跳会变为最近活跃，5 分钟后显示离线；不代表本人一直在屏幕前。离线作答同步后才会显示。</p>
    {!client ? <p className="empty-text">演示模式不读取成员真实记录。</p> : <>
      {overviewError && <p role="alert">{overviewError}；请重试，无法确认当前在线情况。</p>}
      <div className="activity-members">{members.map(m => <button key={m.id} className={`activity-member ${selected === m.id ? "selected" : ""}`} aria-pressed={selected === m.id} onClick={() => { setSelected(m.id); setPage(1); setDetailId(null); }}><strong>{m.display_name}</strong><span className={`presence-${m.presence}`}>{statusLabels[m.presence]}</span><span className="muted small">{moduleNames[m.module ?? ""] ?? "暂无模块"} · {date(m.last_seen)}</span></button>)}</div>
      <div className="activity-filters"><label>学习模块<select value={module} onChange={e => { setModule(e.target.value as ActivityModule); setPage(1); setDetailId(null); }}>{activityModules.map(m => <option key={m} value={m}>{moduleNames[m]}</option>)}</select></label><p className="muted small">显示已提交记录；词卡“认识”是自评，不作为正确率。</p></div>
      {error ? <p role="alert">{error}</p> : selected && !result ? <p role="status">正在读取记录…</p> : result && <>
        <p className="muted small">共 {result.total} 条记录 · 第 {page} 页</p>
        {result.records.length ? <div className="activity-records">{result.records.map(r => <article key={r.id}><div><strong>{r.title}</strong><p className="muted small">{date(r.at)} · {r.status}{r.total !== null ? ` · ${r.correct === null ? "未判分" : r.correct} / ${r.total}` : ""}{r.seconds !== null ? ` · ${Math.floor(r.seconds / 60)} 分钟` : ""}</p></div><button className="button secondary" onClick={() => setDetailId(r.id)}>查看记录</button></article>)}</div> : <p className="empty-text">该模块暂无已提交记录。</p>}
        <div className="button-row"><button className="button secondary" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>上一页</button><button className="button secondary" disabled={page * 25 >= result.total} onClick={() => setPage(v => v + 1)}>下一页</button></div>
      </>}
    </>}
    {detailId && <Modal label="成员作答记录（只读）" onClose={() => setDetailId(null)}>
      {detailError ? <p role="alert">{detailError}</p> : !detail ? <p role="status">正在读取详情…</p> : <div className="activity-detail">
        <div className="activity-heading"><h3>成员作答记录</h3><button className="button secondary" onClick={() => setDetailId(null)} aria-label="关闭作答详情">关闭</button></div>
        <strong>{result?.records.find(r => r.id === detailId)?.title ?? "历史记录"}</strong>
        <p className="muted small">{result?.records.find(r => r.id === detailId)?.status} · {date(result?.records.find(r => r.id === detailId)?.at ?? null)}</p>
        {detail.record.purged_at ? <p>原始作答已按保留期限删除，仅保留统计摘要。</p> : <>
          {detail.questions.length > 0 ? detail.questions.map(q => <article key={q.id}><strong>{q.prompt}</strong><p>成员作答：{String(answers[q.id] ?? "未作答")}</p><p className="muted small">参考答案：{[...(q.answers ?? []), ...(q.reference_answers ?? [])].join(" / ") || "无标准答案 / 开放回答"}</p></article>) : Object.entries(answers).map(([key, value]) => <article key={key}><strong>{key}</strong><p>{typeof value === "string" ? value : JSON.stringify(value)}</p></article>)}
          {typeof detail.record.transcript === "string" && <p>{detail.record.transcript}</p>}
        </>}
        {!Object.keys(answers).length && !detail.questions.length && !detail.record.transcript && <p className="muted">该记录仅包含学习状态与统计，不包含逐题作答。</p>}
      </div>}
    </Modal>}
  </section>;
}
