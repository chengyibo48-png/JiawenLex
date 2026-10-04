"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiFetch } from "@/lib/supabase";
import { activityModules, moduleNames, type ActivityModule, type ActivityMember, type ActivityPage, type ActivityRecord } from "@/lib/member-activity";
import { Modal } from "./modal";
const statusLabels = { online: "在线", recent: "最近活跃", offline: "离线", unknown: "暂无活动记录" };
function date(value: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未记录"; }
function answerText(value: unknown): string { return value == null || value === "" ? "未作答" : Array.isArray(value) ? value.map(answerText).join("、") : typeof value === "object" ? JSON.stringify(value) : String(value); }
export function AdminActivity({ client }: { client: SupabaseClient | null }) {
  const [members, setMembers] = useState<ActivityMember[]>([]);
  const [selected, setSelected] = useState("");
  const [module, setModule] = useState<ActivityModule>("reading");
  const [days, setDays] = useState(0);
  const [memberSearch, setMemberSearch] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ActivityPage | null>(null);
  const [error, setError] = useState("");
  const [overviewError, setOverviewError] = useState("");
  const [revision, setRevision] = useState(0);
  const [detailSummary, setDetailSummary] = useState<ActivityRecord | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ record: Record<string, unknown>; questions: { id: string; prompt: string; answers?: string[]; reference_answers?: string[]; checklist?: string[] }[]; wrongWords?: { id: string; term: string }[] } | null>(null);
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
        const response = await apiFetch(client, "/api/admin/activity", { signal: controller.signal }) as { members: ActivityMember[]; checkedAt: string };
        if (!stopped) { setMembers(response.members); setCheckedAt(response.checkedAt); setOverviewError(""); setSelected(current => response.members.some(m => m.id === current) ? current : response.members[0]?.id ?? ""); }
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
    if (!client || !selected) { setResult(null); setDetailId(null); return; }
    const controller = new AbortController(); let active = true;
    setResult(null); setError("");
    void apiFetch(client, `/api/admin/activity?member=${selected}&module=${module}&days=${days}&page=${page}`, { signal: controller.signal }).then(value => { if (active) setResult(value as ActivityPage); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "读取失败"); });
    return () => { active = false; controller.abort(); };
  }, [client, selected, module, page, days, revision]);
  useEffect(() => {
    setDetail(null); setDetailError("");
    if (!client || !selected || !detailId) return;
    const controller = new AbortController(); let active = true;
    void apiFetch(client, `/api/admin/activity?member=${selected}&module=${module}&record=${detailId}`, { signal: controller.signal }).then(value => { if (active) setDetail(value as typeof detail); }).catch(e => { if (active) setDetailError(e instanceof Error ? e.message : "读取失败"); });
    return () => { active = false; controller.abort(); };
  }, [client, selected, module, detailId, revision]);
  const answers = (detail?.record.answer_body ?? {}) as Record<string, unknown>;
  return <section className="card admin-activity">
    <div className="activity-heading"><div><h3>成员活动与答题记录</h3></div><button className="button secondary" onClick={() => setRevision(v => v + 1)}>刷新记录</button></div>
    <p className="muted small">仅管理员可查看。在线状态每 30 秒更新，90 秒未收到心跳会变为最近活跃，5 分钟后显示离线；不代表本人一直在屏幕前。离线作答同步后才会显示。</p>
    {!client ? <p className="empty-text">演示模式不读取成员真实记录。</p> : <>
      {overviewError && <p role="alert">{overviewError}；请重试，无法确认当前在线情况。</p>}
      <div className="activity-toolbar"><label>查找成员<input type="search" value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="输入成员名字" /></label><p className="muted small" role="status">共 {members.length} 位有效成员，{members.filter(m => m.presence === "online").length} 位在线<br />状态更新：{date(checkedAt)}</p></div>
      <div className="activity-members">{members.filter(m => m.display_name.toLowerCase().includes(memberSearch.trim().toLowerCase())).map(m => <button key={m.id} className={`activity-member ${selected === m.id ? "selected" : ""}`} aria-pressed={selected === m.id} onClick={() => { setSelected(m.id); setPage(1); setDetailId(null); }}><strong>{m.display_name}</strong><span className={`presence-${m.presence}`}>{statusLabels[m.presence]}</span><span className="muted small">{moduleNames[m.module ?? ""] ?? "暂无模块"} · {date(m.last_seen)}</span></button>)}</div>
      {!members.length && !overviewError && checkedAt && <p className="empty-text">暂无有效成员。</p>}
      {members.length > 0 && !members.some(m => m.display_name.toLowerCase().includes(memberSearch.trim().toLowerCase())) && <p className="empty-text">未找到匹配成员，请调整搜索词。</p>}
      <div className="activity-filters"><label>学习模块<select value={module} onChange={e => { setModule(e.target.value as ActivityModule); setPage(1); setDetailId(null); }}>{activityModules.map(m => <option key={m} value={m}>{moduleNames[m]}</option>)}</select></label><label>记录时间<select value={days} onChange={e => { setDays(Number(e.target.value)); setPage(1); setDetailId(null); }}>{[0, 7, 30, 90, 365].map(n => <option key={n} value={n}>{n ? "最近 " + n + " 天" : "全部时间"}</option>)}</select></label><p className="muted small">{module === "plan" ? "计划按创建时间筛选，包含待完成和跳过的任务。" : "显示已提交记录；"}词卡“认识”是自评，不作为正确率。</p></div>
      {error ? <p role="alert">{error}</p> : selected && !result ? <p role="status">正在读取记录…</p> : result && <>
        <p className="muted small">共 {result.total} 条记录 · 第 {page} 页</p>
        {result.records.length ? <div className="activity-records">{result.records.map(r => <article key={r.id}><div><strong>{r.title}</strong><p className="muted small">{date(r.at)} · {r.status}{r.total !== null ? ` · ${r.correct === null ? "未判分，共 " + r.total + " 题" : r.correct + " / " + r.total}` : ""}{r.seconds !== null ? ` · ${Math.floor(r.seconds / 60)} 分 ${r.seconds % 60} 秒` : ""}</p></div><button className="button secondary" onClick={() => { setDetailSummary(r); setDetailId(r.id); }}>查看记录</button></article>)}</div> : <p className="empty-text">所选时间内暂无记录，可调整时间或切换模块。</p>}
        <div className="button-row"><button className="button secondary" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>上一页</button><button className="button secondary" disabled={page * 25 >= result.total} onClick={() => setPage(v => v + 1)}>下一页</button></div>
      </>}
    </>}
    {detailId && <Modal label="成员作答记录（只读）" onClose={() => setDetailId(null)}>
      {detailError ? <p role="alert">{detailError}</p> : !detail ? <p role="status">正在读取详情…</p> : <div className="activity-detail">
        <div className="activity-heading"><h3>成员作答记录</h3><button className="button secondary" onClick={() => setDetailId(null)} aria-label="关闭作答详情">关闭</button></div>
        <strong>{detailSummary?.title ?? "历史记录"}</strong>
        <p className="muted small">{detailSummary?.status} · {date(detailSummary?.at ?? null)}</p>
        {typeof detail.record.status === "string" && <p>任务状态：{({ done: "完成", skipped: "跳过", todo: "待完成" } as Record<string, string>)[String(detail.record.status)] ?? String(detail.record.status)}</p>}
        {detail.record.total !== undefined && <p>拼写结果：{answerText(detail.record.correct)} / {answerText(detail.record.total)}</p>}
        {detail.record.purged_at ? <p>原始作答已按保留期限删除，仅保留统计摘要。</p> : <>
          {detail.questions.length > 0 ? detail.questions.map(q => <article key={q.id}><strong>{q.prompt}</strong><p>成员作答：{answerText(answers[q.id])}</p><p className="muted small">参考答案：{[...(q.answers ?? []), ...(q.reference_answers ?? [])].join(" / ") || "无标准答案 / 开放回答"}</p>{q.checklist?.length ? <ul className="activity-checks">{q.checklist.map((text, index) => { const checks = detail.record.self_review as Record<string, Record<string, boolean>> | undefined; const value = checks?.[q.id]?.[String(index)]; return <li key={index}>{value === true ? "✓" : value === false ? "✕" : "—"} {text}（{value === true ? "自评达到" : value === false ? "自评未达到" : "未自评"}）</li>; })}</ul> : null}</article>) : Object.entries(answers).map(([key, value]) => <article key={key}><strong>{key}</strong><p>{typeof value === "string" ? value : JSON.stringify(value)}</p></article>)}
          {detail.record.known !== undefined && <p>词卡自评：{detail.record.known ? "认识" : "不认识"}</p>}
          {typeof detail.record.planned_date === "string" && <p>计划日期：{detail.record.planned_date} · 计划时长：{answerText(detail.record.minutes)} 分钟</p>}
          {detail.wrongWords?.length ? <p>拼写错词：{detail.wrongWords.map(w => w.term).join("、")}</p> : null}
          {typeof detail.record.transcript === "string" && <><h4>成员提交文本</h4><p>{detail.record.transcript}</p></>}
        </>}
        {!Object.keys(answers).length && !detail.questions.length && !detail.record.transcript && <p className="muted">该记录仅包含学习状态与统计，不包含逐题作答。</p>}
      </div>}
    </Modal>}
  </section>;
}
