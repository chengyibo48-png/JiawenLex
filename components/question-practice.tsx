"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, CircleAlert, FileAudio, Flag, Send } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCorrectAnswer, isGradableQuestion } from "@/lib/study";
import type { Language, Material, Question } from "@/lib/types";
import { sessionHasStarted, type PracticeSessionState } from "@/lib/practice-sessions";
import { apiFetch } from "@/lib/supabase";
import { QuestionNavigation } from "./question-navigation";
import { Modal } from "./modal";
import { t } from "./workspace";

export function QuestionPractice({ material, lang, state, answers, revealed, finished, busy, locked, ready,
  mobilePane, audioUrl, figureUrl, transcriptOpen, expired, client, notify, onPane, onTranscript, onAnswer, onState, onReveal, onSubmit }: {
  material: Material; lang: Language; state: PracticeSessionState; answers: Record<string, string>;
  revealed: string[]; finished: boolean; busy: boolean; locked: boolean; ready: boolean;
  mobilePane: "passage" | "questions"; audioUrl: string | null; figureUrl: string | null; transcriptOpen: boolean; expired: boolean;
  client: SupabaseClient | null; notify: (message: string) => void;
  onPane: (pane: "passage" | "questions") => void; onTranscript: () => void;
  onAnswer: (id: string, answer: string) => void; onState: (patch: Partial<PracticeSessionState>) => void;
  onReveal: (id: string) => void; onSubmit: () => void;
}) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [reportQuestion, setReportQuestion] = useState<Question | null>(null);
  const [reportKind, setReportKind] = useState("answer");
  const [reportComment, setReportComment] = useState("");
  const [reportPrompt, setReportPrompt] = useState("");
  const [reportAnswers, setReportAnswers] = useState("");
  const [reportExplanation, setReportExplanation] = useState("");
  const [removeAnswers, setRemoveAnswers] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  useEffect(() => {
    if (!ready || mobilePane !== "questions") return;
    const frame = requestAnimationFrame(() => {
      if (state.currentQuestionId) refs.current.get(state.currentQuestionId)?.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, material.id]);
  const questions = material.questions, missing = questions.filter((q) => {
    const answer = answers[q.id]?.trim();
    if (!answer) return true;
    if (q.answer_mode !== "multi_choice") return false;
    try { return !(JSON.parse(answer) as unknown[]).length; } catch { return true; }
  });
  const jump = (id: string) => {
    onPane("questions"); onState({ currentQuestionId: id, mobilePane: "questions" });
    requestAnimationFrame(() => {
      const row = refs.current.get(id);
      row?.scrollIntoView({ block: "nearest", behavior: "instant" });
      row?.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
    });
  };
  const cannotEdit = busy || locked || !ready || expired || (state.mode === "timed" && !state.startedAt);
  function openReport(question: Question) {
    setReportQuestion(question);
    setReportKind("answer");
    setReportComment("");
    setReportPrompt(question.prompt);
    setReportAnswers(question.answers.join("\n"));
    setReportExplanation(question.explanation);
    setRemoveAnswers(false);
  }
  async function submitReport() {
    if (!client || !reportQuestion || reportBusy) return;
    const answersList = reportAnswers.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const answersChanged = JSON.stringify(answersList) !== JSON.stringify(reportQuestion.answers);
    const body: Record<string, unknown> = {
      materialId: material.id,
      questionId: reportQuestion.id,
      expectedPrompt: reportQuestion.prompt,
      expectedAnswers: reportQuestion.answers,
      expectedExplanation: reportQuestion.explanation ?? "",
      errorKind: reportKind,
      comment: reportComment.trim(),
    };
    if (reportPrompt.trim() && reportPrompt.trim() !== reportQuestion.prompt) body.suggestedPrompt = reportPrompt.trim();
    if (removeAnswers) body.suggestedAnswers = [];
    else if (answersChanged) body.suggestedAnswers = answersList;
    if (reportExplanation !== reportQuestion.explanation) body.suggestedExplanation = reportExplanation;
    if (!body.comment && body.suggestedPrompt === undefined && body.suggestedAnswers === undefined && body.suggestedExplanation === undefined) {
      notify(t(lang, "请填写问题说明或至少一项修改内容。", "Add a note or change at least one field."));
      return;
    }
    setReportBusy(true);
    try {
      const result = await apiFetch(client, "/api/question-reports", { method: "POST", body: JSON.stringify(body) }) as { directEdit: boolean };
      notify(result.directEdit
        ? t(lang, "已直接修正并保存这道题。", "The correction was applied to this question.")
        : t(lang, "反馈已送给题目作者，可在资料库的“题目纠错”中审核。", "Correction sent to the author for review in Library → Question corrections."));
      setReportQuestion(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : t(lang, "提交反馈失败。", "Could not submit the report."));
    } finally { setReportBusy(false); }
  }
  return <>
    <QuestionNavigation questions={questions} answers={answers} flagged={state.flagged} current={state.currentQuestionId} lang={lang} onJump={jump} />
    <div className="mobile-pane-tabs"><button className={mobilePane === "passage" ? "active" : ""} onClick={() => onPane("passage")}>{t(lang, material.skill === "reading" ? "文章" : "音频与文字稿", material.skill === "reading" ? "Passage" : "Audio & transcript")}</button><button className={mobilePane === "questions" ? "active" : ""} onClick={() => onPane("questions")}>{t(lang, "题目", "Questions")}</button></div>
    <div className="reading-grid">
      <section className={`card passage-pane mobile-${mobilePane}`} aria-label={t(lang, "阅读材料或听力文字稿", "Passage or transcript")}>
        {material.skill === "listening" && !material.tags.includes("listening-text") && <>{audioUrl ? <audio controls src={audioUrl} className="audio-player" /> : <div className="audio-empty"><FileAudio size={20} />{t(lang, "这组听力还没有音频附件", "This set has no audio attachment")}</div>}<button className="text-action" disabled={state.mode === "timed" && !finished} onClick={onTranscript}>{transcriptOpen ? t(lang, "隐藏文字稿", "Hide transcript") : t(lang, "显示文字稿", "Show transcript")}<ChevronRight size={16} /></button>{state.mode === "timed" && !finished && <p className="muted small">{t(lang, "计时练习提交后开放文字稿。", "The transcript unlocks after timed practice is submitted.")}</p>}</>}
        {material.tags.includes("listening-text") && <p className="notice info">{t(lang, "听力词汇文本训练 · 无配套音频，不是完整听力测试，成绩不计入听力正确率趋势。", "Listening vocabulary text practice · no audio. This is not a full listening test and does not affect listening accuracy trends.")}</p>}
        {(material.skill === "reading" || transcriptOpen || material.tags.includes("listening-text")) && <div className="passage-text">{(material.skill === "reading" ? material.passage : material.transcript).split("\n").map((p, i) => <p key={i}>{p}</p>)}</div>}
        {figureUrl && <img className="question-figure" src={figureUrl} alt={t(lang, "练习辅助图表", "Supporting figure for this exercise")} />}
      </section>
      <section className={`card questions-pane mobile-${mobilePane}`}>
        <div className="card-top"><h3>{t(lang, "题目", "Questions")}</h3><span className="muted small">{material.origin_kind && <span className="source-origin">{material.origin_kind === "source" ? t(lang, "资料原题", "Source question") : material.origin_kind === "adapted" ? t(lang, "改编练习", "Adapted exercise") : t(lang, "原题与改编", "Source and adapted")}</span>} {questions.length} {t(lang, "题", "questions")}</span></div>
        {questions.length ? questions.map((q, i) => {
          const shown = finished || (state.mode === "practice" && revealed.includes(q.id));
          const marked = state.flagged.includes(q.id);
          const origin = q.origin_kind ?? material.origin_kind;
          return <div className={`answer-question ${state.currentQuestionId === q.id ? "question-focused" : ""}`} key={q.id} ref={(element) => { if (element) refs.current.set(q.id, element); else refs.current.delete(q.id); }}>
            <span className="question-number">{i + 1}</span><div>
              <div className="question-heading"><div>{origin && <span className="source-origin">{origin === "source" ? t(lang, "资料原题", "Source question") : origin === "adapted" ? t(lang, "改编练习", "Adapted exercise") : t(lang, "来源待核对", "Source needs review")}</span>} <strong>{q.prompt}</strong>{q.source_physical_page && <small className="muted"> · {t(lang, `原件第 ${q.source_physical_page} 页`, `PDF page ${q.source_physical_page}`)}</small>}</div><div className="question-heading-actions"><button className="question-report-button" aria-label={t(lang, `反馈第${i + 1}题的错误`, `Report an error in question ${i + 1}`)} onClick={() => openReport(q)}><CircleAlert size={16}/><span>{t(lang, "报错 / 修改", "Report / edit")}</span></button><button className={`flag-question ${marked ? "active" : ""}`} aria-pressed={marked} aria-label={t(lang, `第${i + 1}题：${marked ? "取消稍后标记" : "标记稍后"}`, `Question ${i + 1}: ${marked ? "unflag" : "flag for later"}`)} disabled={busy || locked || !ready || finished} onClick={() => onState({ flagged: marked ? state.flagged.filter((id) => id !== q.id) : [...state.flagged, q.id] })}><Flag size={15} /><span>{marked ? t(lang, "已标记", "Flagged") : t(lang, "稍后", "Later")}</span></button></div></div>
              {q.word_limit && <p className="muted small">{t(lang, `最多 ${q.word_limit} 个词`, `No more than ${q.word_limit} words`)}</p>}
              {q.answer_mode === "open" ? <textarea rows={6} maxLength={2000} disabled={shown || cannotEdit} value={answers[q.id] ?? ""} onFocus={() => onState({ currentQuestionId: q.id })} onChange={(e) => onAnswer(q.id, e.target.value)} aria-label={t(lang, `第 ${i + 1} 题回答`, `Question ${i + 1} response`)} /> : q.answer_mode === "multi_choice" ? <fieldset className="question-options" disabled={shown || cannotEdit}><legend>{t(lang, "选择所有正确选项", "Select all correct options")}</legend>{(q.choices ?? []).map((choice) => { let selected: string[] = []; try { const parsed = JSON.parse(answers[q.id] ?? "[]"); if (Array.isArray(parsed)) selected = parsed; } catch {} return <label key={choice}><input type="checkbox" checked={selected.includes(choice)} onChange={(event) => onAnswer(q.id, JSON.stringify(event.target.checked ? [...selected, choice] : selected.filter((item) => item !== choice)))} />{choice}</label>; })}</fieldset> : q.answer_mode === "single_choice" ? <fieldset className="question-options" disabled={shown || cannotEdit}><legend>{t(lang, "选择一项", "Select one")}</legend>{(q.choices ?? []).map((choice) => <label key={choice}><input type="radio" name={`question-${q.id}`} checked={answers[q.id] === choice} onChange={() => onAnswer(q.id, choice)} />{choice}</label>)}</fieldset> : <input maxLength={2000} disabled={shown || cannotEdit} value={answers[q.id] ?? ""} onFocus={() => { if (!finished) onState({ currentQuestionId: q.id }); }} onChange={(e) => onAnswer(q.id, e.target.value)} placeholder={t(lang, "输入答案", "Type your answer")} aria-label={t(lang, `第 ${i + 1} 题答案`, `Question ${i + 1} answer`)} />}
              {state.mode === "practice" && !shown && <button className="text-link" disabled={cannotEdit} onClick={() => onReveal(q.id)}>{t(lang, "查看答案与解析", "Check answer")}</button>}
              {shown && <div className={`answer-feedback ${isGradableQuestion(q) ? isCorrectAnswer(q, answers[q.id] ?? "") ? "correct" : "incorrect" : ""}`}><strong>{!isGradableQuestion(q) ? t(lang, "本题暂不自动判分", "This question is not automatically scored") : isCorrectAnswer(q, answers[q.id] ?? "") ? t(lang, "答对了", "Correct") : `${t(lang, "参考答案", "Accepted answer")}: ${q.answer_mode === "multi_choice" ? q.answers.join(" + ") : q.answers.join(" / ")}`}</strong>{q.reference_answers?.length ? <p>{t(lang, "参考回答", "Sample response")}: {q.reference_answers.join(" / ")}</p> : null}<p>{q.explanation || (!isGradableQuestion(q) ? t(lang, "请对照原文和参考资料自行核验。", "Compare your answer with the source and review it yourself.") : "")}</p></div>}
            </div>
          </div>;
        }) : <p className="empty-text">{t(lang, "该题组还没有题目。", "No questions in this set yet.")}</p>}
        {questions.length > 0 && <div className="practice-submit"><button className="button primary" disabled={busy || locked || !ready || finished || !sessionHasStarted(state)} onClick={() => missing.length ? setConfirmSubmit(true) : onSubmit()}><Send size={16} />{busy ? t(lang, "提交中…", "Submitting…") : t(lang, "提交本次练习", "Submit practice")}</button>{finished && <strong>{questions.some(isGradableQuestion) ? `${questions.filter((q) => isCorrectAnswer(q, answers[q.id] ?? "")).length}/${questions.filter(isGradableQuestion).length}` : t(lang, "未自动判分", "Not automatically scored")}</strong>}</div>}
      </section>
    </div>
    {confirmSubmit && <Modal label={t(lang, "还有题目未完成", "Unanswered questions")} busy={busy} onClose={() => setConfirmSubmit(false)}><h3>{t(lang, `还有 ${missing.length} 题未答`, `${missing.length} unanswered questions`)}</h3><p>{t(lang, "可以定位未答题继续作答，也可以确认提交当前答案。", "Return to an unanswered question or submit your current answers.")}</p><div className="button-row"><button className="button primary" data-modal-initial-focus disabled={busy} onClick={() => { setConfirmSubmit(false); if (missing[0]) jump(missing[0].id); }}>{t(lang, "定位未答题", "Go to unanswered")}</button><button className="button secondary" disabled={busy} onClick={() => { setConfirmSubmit(false); onSubmit(); }}>{t(lang, "仍然提交", "Submit anyway")}</button><button className="button secondary" disabled={busy} onClick={() => setConfirmSubmit(false)}>{t(lang, "继续作答", "Keep working")}</button></div></Modal>}
    {reportQuestion && <Modal label={t(lang, "反馈或修改题目", "Report or edit question")} busy={reportBusy} onClose={() => setReportQuestion(null)}><div className="question-report-form"><span className="eyebrow">{t(lang, `第 ${questions.findIndex((q) => q.id === reportQuestion.id) + 1} 题`, `Question ${questions.findIndex((q) => q.id === reportQuestion.id) + 1}`)}</span><h3>{t(lang, "反馈题目错误并填写修正", "Report an error and enter a correction")}</h3><p className="muted small">{t(lang, "你可以改写题干、答案或解析。题目作者会审核其他成员的修改建议。", "Edit the prompt, accepted answers or explanation. The author reviews corrections from other members.")}</p><label>{t(lang, "问题类型", "Issue type")}<select value={reportKind} onChange={(event) => setReportKind(event.target.value)}><option value="answer">{t(lang, "答案有误", "Incorrect answer")}</option><option value="spelling">{t(lang, "单词拼写", "Spelling")}</option><option value="grammar">{t(lang, "语法或句子错误", "Grammar or sentence")}</option><option value="missing">{t(lang, "题干或内容缺漏", "Missing or incomplete content")}</option><option value="other">{t(lang, "其他问题", "Other")}</option></select></label><label>{t(lang, "题干（可直接修改）", "Question prompt (edit directly)")}<textarea rows={4} value={reportPrompt} onChange={(event) => setReportPrompt(event.target.value)} maxLength={4000}/></label><label>{t(lang, "可接受答案（每行一条）", "Accepted answers (one per line)")}<textarea rows={4} value={reportAnswers} onChange={(event) => { setReportAnswers(event.target.value); setRemoveAnswers(false); }} maxLength={40000}/></label><label className="question-report-check"><input type="checkbox" checked={removeAnswers} onChange={(event) => setRemoveAnswers(event.target.checked)}/>{t(lang, "移除现有答案，标记为暂不自动判分", "Remove the answer key and mark this question as not automatically scored")}</label><label>{t(lang, "解析（可直接修改）", "Explanation (edit directly)")}<textarea rows={3} value={reportExplanation} onChange={(event) => setReportExplanation(event.target.value)} maxLength={4000}/></label><label>{t(lang, "问题说明", "Note")}<textarea rows={2} value={reportComment} onChange={(event) => setReportComment(event.target.value)} maxLength={2000} placeholder={t(lang, "说明错误位置或原因（可选）", "Describe where the error is (optional)")}/></label><div className="button-row"><button className="button primary" data-modal-initial-focus disabled={reportBusy} onClick={() => void submitReport()}>{reportBusy ? t(lang, "提交中…", "Submitting…") : t(lang, "提交修正", "Submit correction")}</button><button className="button secondary" disabled={reportBusy} onClick={() => setReportQuestion(null)}>{t(lang, "取消", "Cancel")}</button></div></div></Modal>}
  </>;
}
