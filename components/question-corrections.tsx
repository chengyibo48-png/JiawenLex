"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Check, RefreshCw, X } from "lucide-react";
import { apiFetch } from "@/lib/supabase";
import type { Language } from "@/lib/types";
import { t } from "./workspace";

type Report = {
  id: string;
  material_id: string;
  question_id: string;
  error_kind: "answer" | "spelling" | "grammar" | "missing" | "other";
  comment: string;
  original_question: { prompt?: string; answers?: string[]; explanation?: string };
  suggested_prompt: string | null;
  suggested_answers: string[] | null;
  suggested_explanation: string | null;
  material_title: string;
  current_prompt: string | null;
  created_at: string;
};

const labels = {
  answer: ["答案有误", "Incorrect answer"],
  spelling: ["单词拼写", "Spelling"],
  grammar: ["语法或句子错误", "Grammar or sentence"],
  missing: ["题干或内容缺漏", "Missing content"],
  other: ["其他问题", "Other issue"],
} as const;
const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

export function QuestionCorrections({ client, lang, notify }: { client: SupabaseClient | null; lang: Language; notify: (message: string) => void }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [answers, setAnswers] = useState("");
  const [explanation, setExplanation] = useState("");
  const [initial, setInitial] = useState({ prompt: "", answers: "", explanation: "" });
  const [removeAnswers, setRemoveAnswers] = useState(false);
  const selected = reports.find((report) => report.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError("");
    try {
      const result = await apiFetch(client, "/api/question-reports?status=open") as { reports: Report[] };
      setReports(result.reports ?? []);
      if (selectedId && !result.reports.some((report) => report.id === selectedId)) setSelectedId(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取题目纠错"); }
    finally { setLoading(false); }
  }, [client, selectedId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    const next = {
      prompt: selected.suggested_prompt ?? "",
      answers: selected.suggested_answers?.join("\n") ?? "",
      explanation: selected.suggested_explanation ?? "",
    };
    setPrompt(next.prompt); setAnswers(next.answers); setExplanation(next.explanation);
    setInitial(next); setRemoveAnswers(false);
  }, [selected?.id]);

  async function act(action: "apply" | "reject") {
    if (!client || !selected || busy) return;
    const answerList = lines(answers);
    const answerChanged = JSON.stringify(answerList) !== JSON.stringify(lines(initial.answers));
    const payload: Record<string, unknown> = { reportId: selected.id, action };
    if (action === "apply") {
      if (prompt.trim() !== initial.prompt.trim()) payload.suggestedPrompt = prompt.trim();
      if (removeAnswers) payload.suggestedAnswers = [];
      else if (answerChanged) payload.suggestedAnswers = answerList;
      if (explanation !== initial.explanation) payload.suggestedExplanation = explanation;
      const hasExisting = selected.suggested_prompt !== null || selected.suggested_answers !== null || selected.suggested_explanation !== null;
      if (!hasExisting && Object.keys(payload).length === 2) {
        notify(t(lang, "请先填写要应用的修正。", "Add a correction before applying this report."));
        return;
      }
    }
    setBusy(true);
    try {
      await apiFetch(client, "/api/question-reports", { method: "PATCH", body: JSON.stringify(payload) });
      notify(action === "apply" ? t(lang, "修正已应用，题目版本已更新。", "Correction applied and the exercise version updated.") : t(lang, "已关闭这条反馈。", "Report closed."));
      await refresh();
    } catch (cause) { notify(cause instanceof Error ? cause.message : t(lang, "操作失败。", "Action failed.")); }
    finally { setBusy(false); }
  }

  if (!client) return <section className="card"><p>{t(lang, "请登录后查看题目纠错。", "Sign in to review question corrections.")}</p></section>;
  return <div className="question-correction-layout">
    <section className="card">
      <div className="card-top"><div><h3>{t(lang, "待处理反馈", "Open reports")}</h3><p className="muted small">{t(lang, "其他成员可以指出答案、拼写、语法、题干或内容缺漏，并提交可编辑的改正。", "Members can report answer, spelling, grammar, prompt or missing-content issues with editable corrections.")}</p></div><div className="question-correction-actions"><span className="soft-tag">{reports.length}</span><button className="icon-button" aria-label={t(lang, "刷新反馈", "Refresh reports")} onClick={() => void refresh()}><RefreshCw size={16}/></button></div></div>
      {error && <div className="notice info">{error}</div>}
      {loading ? <p className="muted">{t(lang, "正在读取…", "Loading…")}</p> : reports.length ? <div className="source-review-list">{reports.map((report) => <button type="button" className={`source-review-item ${selectedId === report.id ? "selected" : ""}`} key={report.id} onClick={() => setSelectedId(report.id)}><span className="source-review-kind">{labels[report.error_kind][lang === "zh" ? 0 : 1]}</span><strong>{report.material_title}</strong><span>{t(lang, "原题", "Question")}: {report.current_prompt ?? report.original_question.prompt ?? t(lang, "题目已删除", "Question removed")}</span><small>{report.comment || report.suggested_prompt || report.suggested_answers?.join(" / ") || t(lang, "已提交修改建议", "Correction suggested")}</small></button>)}</div> : <div className="empty-inline"><Check size={28}/><strong>{t(lang, "没有待处理的题目反馈", "No open corrections")}</strong><p>{t(lang, "练习者提交的题目修改建议会显示在这里。", "Question corrections submitted during practice will appear here.")}</p></div>}
    </section>
    {selected && <section className="card question-correction-detail"><div className="card-top"><div><span className="eyebrow">{labels[selected.error_kind][lang === "zh" ? 0 : 1]}</span><h3>{selected.material_title}</h3><p className="muted small">{t(lang, "题目", "Question")}: {selected.current_prompt ?? selected.original_question.prompt ?? "—"}</p></div><button className="icon-button" aria-label={t(lang, "关闭", "Close")} onClick={() => setSelectedId(null)}><X size={17}/></button></div>
      {selected.comment && <div className="notice info"><strong>{t(lang, "反馈说明", "Report note")}</strong><p>{selected.comment}</p></div>}
      {selected.current_prompt === null && <div className="notice warning">{t(lang, "题目已删除或无法定位。请关闭此反馈。", "The question was removed or cannot be located. Close this report.")}</div>}
      <div className="question-correction-form"><label>{t(lang, "题干修正", "Corrected prompt")}<textarea rows={4} maxLength={4000} value={prompt} placeholder={selected.original_question.prompt} onChange={(event) => setPrompt(event.target.value)}/></label><label>{t(lang, "可接受答案（每行一条）", "Accepted answers (one per line)")}<textarea rows={4} maxLength={40000} value={answers} placeholder={selected.original_question.answers?.join("\n")} onChange={(event) => { setAnswers(event.target.value); setRemoveAnswers(false); }}/></label><label className="question-report-check"><input type="checkbox" checked={removeAnswers} onChange={(event) => setRemoveAnswers(event.target.checked)}/>{t(lang, "移除所有答案，设为未自动判分", "Remove answer key and disable automatic scoring")}</label><label>{t(lang, "解析修正", "Corrected explanation")}<textarea rows={4} maxLength={4000} value={explanation} placeholder={selected.original_question.explanation} onChange={(event) => setExplanation(event.target.value)}/></label></div>
      <div className="button-row"><button className="button primary" disabled={busy || selected.current_prompt === null} onClick={() => void act("apply")}><Check size={16}/>{t(lang, "应用修改", "Apply correction")}</button><button className="button danger-outline" disabled={busy} onClick={() => void act("reject")}><X size={16}/>{t(lang, "忽略反馈", "Dismiss report")}</button></div>
    </section>}
  </div>;
}
