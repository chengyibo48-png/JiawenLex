"use client";
import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import type { Material, Language } from "@/lib/types";
import type { ViewActions } from "./views";
import { t } from "./workspace";
import { Modal } from "./modal";
import { apiFetch } from "@/lib/supabase";
export function ResponsePrompt({
  material,
  revision,
  actions,
  lang,
}: {
  material: Material;
  revision: number;
  actions: ViewActions;
  lang: Language;
}) {
  const [prompt, setPrompt] = useState<{ body: string; title: string } | null>(
      null,
    ),
    [error, setError] = useState(false),
    [reportOpen, setReportOpen] = useState(false),
    [reportKind, setReportKind] = useState("grammar"),
    [reportText, setReportText] = useState(""),
    [reportNote, setReportNote] = useState(""),
    [reportBusy, setReportBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setPrompt(null);
    setError(false);
    if (revision === (material.revision ?? 1)) {
      setPrompt({ body: material.prompt, title: material.title });
      return;
    }
    if (!actions.client) {
      setError(true);
      return;
    }
    void actions.client
      .from("material_versions")
      .select("snapshot")
      .eq("material_id", material.id)
      .eq("revision", revision)
      .single()
      .then((result) => {
        if (!active) return;
        if (result.error) setError(true);
        else
          setPrompt({
            body: result.data.snapshot.prompt,
            title: result.data.snapshot.title,
          });
      });
    return () => {
      active = false;
    };
  }, [material.id, material.revision, revision, actions.client]);
  async function submitPromptCorrection() {
    if (!actions.client || !prompt || reportBusy) return;
    const body: Record<string, unknown> = {
      materialId: material.id,
      questionId: "__material_prompt__",
      materialRevision: revision,
      expectedPrompt: prompt.body,
      expectedAnswers: [],
      expectedExplanation: "",
      errorKind: reportKind,
      comment: reportNote.trim(),
    };
    if (reportText.trim() && reportText.trim() !== prompt.body) body.suggestedPrompt = reportText.trim();
    if (!body.comment && body.suggestedPrompt === undefined) {
      actions.notify(t(lang, "请填写问题说明或修改后的题目。", "Add a note or a corrected prompt."));
      return;
    }
    setReportBusy(true);
    try {
      const result = await apiFetch(actions.client, "/api/question-reports", { method: "POST", body: JSON.stringify(body) }) as { directEdit: boolean };
      actions.notify(result.directEdit ? t(lang, "已直接修正并保存题目。", "The prompt correction was applied.") : t(lang, "反馈已送给题目作者审核。", "Correction sent to the prompt author for review."));
      if (result.directEdit) setPrompt((current) => current ? { ...current, body: reportText.trim() } : current);
      setReportOpen(false);
      await actions.refresh();
    } catch (cause) { actions.notify(cause instanceof Error ? cause.message : t(lang, "提交反馈失败。", "Could not submit the report.")); }
    finally { setReportBusy(false); }
  }
  return (
    <div>
      <span className="soft-tag">
        {t(lang, "本次题目版本", "Prompt version")} v{revision}
      </span>
      {revision !== (material.revision ?? 1) && (
        <p className="muted small">
          {t(
            lang,
            "当前资料已更新；本次继续使用草稿或开始时的题目版本。",
            "Material was updated; this attempt retains the draft's or starting prompt version.",
          )}
        </p>
      )}
      {prompt ? (
        <>
          <h4>{prompt.title}</h4>
          <p>{prompt.body}</p>
          <button className="question-report-button response-prompt-report" disabled={revision !== (material.revision ?? 1)} onClick={() => { setReportKind("grammar"); setReportText(prompt.body); setReportNote(""); setReportOpen(true); }}><CircleAlert size={16}/>{t(lang, "反馈 / 修改题目", "Report / edit prompt")}</button>
          {revision !== (material.revision ?? 1) && <p className="muted small">{t(lang, "当前查看的是历史题目版本，需打开当前版本后才能修改。", "This is an older prompt version. Open the current version to suggest a correction.")}</p>}
        </>
      ) : (
        <p role="status">
          {error
            ? t(
                lang,
                "旧题目版本暂时不可访问，原作答仍保留。",
                "Historical prompt is unavailable; your response is retained.",
              )
            : t(lang, "正在加载当时的题目…", "Loading the original prompt…")}
        </p>
      )}
      {reportOpen && prompt && <Modal label={t(lang, "反馈或修改题目", "Report or edit prompt")} busy={reportBusy} onClose={() => setReportOpen(false)}><div className="question-report-form"><h3>{t(lang, "反馈写作 / 口语题目", "Report a writing or speaking prompt")}</h3><label>{t(lang, "问题类型", "Issue type")}<select value={reportKind} onChange={(event) => setReportKind(event.target.value)}><option value="answer">{t(lang, "题意或要求有误", "Incorrect prompt")}</option><option value="spelling">{t(lang, "单词拼写", "Spelling")}</option><option value="grammar">{t(lang, "语法或句子错误", "Grammar or sentence")}</option><option value="missing">{t(lang, "题目内容缺漏", "Missing content")}</option><option value="other">{t(lang, "其他问题", "Other")}</option></select></label><label>{t(lang, "题目（可直接修改）", "Prompt (edit directly)")}<textarea rows={7} maxLength={4000} value={reportText} onChange={(event) => setReportText(event.target.value)}/></label><label>{t(lang, "问题说明", "Note")}<textarea rows={3} maxLength={2000} value={reportNote} onChange={(event) => setReportNote(event.target.value)} placeholder={t(lang, "说明错误位置或原因（可选）", "Describe the problem (optional)")}/></label><div className="button-row"><button className="button primary" data-modal-initial-focus disabled={reportBusy} onClick={() => void submitPromptCorrection()}>{reportBusy ? t(lang, "提交中…", "Submitting…") : t(lang, "提交修正", "Submit correction")}</button><button className="button secondary" disabled={reportBusy} onClick={() => setReportOpen(false)}>{t(lang, "取消", "Cancel")}</button></div></div></Modal>}
    </div>
  );
}
