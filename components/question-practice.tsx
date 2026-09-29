"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileAudio, Flag, Send } from "lucide-react";
import { isCorrectAnswer } from "@/lib/study";
import type { Language, Material } from "@/lib/types";
import { sessionHasStarted, type PracticeSessionState } from "@/lib/practice-sessions";
import { QuestionNavigation } from "./question-navigation";
import { Modal } from "./modal";
import { t } from "./workspace";

export function QuestionPractice({ material, lang, state, answers, revealed, finished, busy, locked, ready,
  mobilePane, audioUrl, transcriptOpen, expired, onPane, onTranscript, onAnswer, onState, onReveal, onSubmit }: {
  material: Material; lang: Language; state: PracticeSessionState; answers: Record<string, string>;
  revealed: string[]; finished: boolean; busy: boolean; locked: boolean; ready: boolean;
  mobilePane: "passage" | "questions"; audioUrl: string | null; transcriptOpen: boolean; expired: boolean;
  onPane: (pane: "passage" | "questions") => void; onTranscript: () => void;
  onAnswer: (id: string, answer: string) => void; onState: (patch: Partial<PracticeSessionState>) => void;
  onReveal: (id: string) => void; onSubmit: () => void;
}) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  useEffect(() => {
    if (!ready || mobilePane !== "questions") return;
    const frame = requestAnimationFrame(() => {
      if (state.currentQuestionId) refs.current.get(state.currentQuestionId)?.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, material.id]);
  const questions = material.questions, missing = questions.filter((q) => !answers[q.id]?.trim());
  const jump = (id: string) => {
    onPane("questions"); onState({ currentQuestionId: id, mobilePane: "questions" });
    requestAnimationFrame(() => {
      const row = refs.current.get(id);
      row?.scrollIntoView({ block: "nearest", behavior: "instant" });
      row?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    });
  };
  const cannotEdit = busy || locked || !ready || expired || (state.mode === "timed" && !state.startedAt);
  return <>
    <QuestionNavigation questions={questions} answers={answers} flagged={state.flagged} current={state.currentQuestionId} lang={lang} onJump={jump} />
    <div className="mobile-pane-tabs"><button className={mobilePane === "passage" ? "active" : ""} onClick={() => onPane("passage")}>{t(lang, material.skill === "reading" ? "文章" : "音频与文字稿", material.skill === "reading" ? "Passage" : "Audio & transcript")}</button><button className={mobilePane === "questions" ? "active" : ""} onClick={() => onPane("questions")}>{t(lang, "题目", "Questions")}</button></div>
    <div className="reading-grid">
      <section className={`card passage-pane mobile-${mobilePane}`} aria-label={t(lang, "阅读材料或听力文字稿", "Passage or transcript")}>
        {material.skill === "listening" && <>{audioUrl ? <audio controls src={audioUrl} className="audio-player" /> : <div className="audio-empty"><FileAudio size={20} />{t(lang, "这组听力还没有音频附件", "This set has no audio attachment")}</div>}<button className="text-action" disabled={state.mode === "timed" && !finished} onClick={onTranscript}>{transcriptOpen ? t(lang, "隐藏文字稿", "Hide transcript") : t(lang, "显示文字稿", "Show transcript")}<ChevronRight size={16} /></button>{state.mode === "timed" && !finished && <p className="muted small">{t(lang, "计时练习提交后开放文字稿。", "The transcript unlocks after timed practice is submitted.")}</p>}</>}
        {(material.skill === "reading" || transcriptOpen) && <div className="passage-text">{(material.skill === "reading" ? material.passage : material.transcript).split("\n").map((p, i) => <p key={i}>{p}</p>)}</div>}
      </section>
      <section className={`card questions-pane mobile-${mobilePane}`}>
        <div className="card-top"><h3>{t(lang, "题目", "Questions")}</h3><span className="muted small">{questions.length} {t(lang, "题", "questions")}</span></div>
        {questions.length ? questions.map((q, i) => {
          const shown = finished || (state.mode === "practice" && revealed.includes(q.id));
          const marked = state.flagged.includes(q.id);
          return <div className={`answer-question ${state.currentQuestionId === q.id ? "question-focused" : ""}`} key={q.id} ref={(element) => { if (element) refs.current.set(q.id, element); else refs.current.delete(q.id); }}>
            <span className="question-number">{i + 1}</span><div>
              <div className="question-heading"><strong>{q.prompt}</strong><button className={`flag-question ${marked ? "active" : ""}`} aria-pressed={marked} aria-label={t(lang, `第${i + 1}题：${marked ? "取消稍后标记" : "标记稍后"}`, `Question ${i + 1}: ${marked ? "unflag" : "flag for later"}`)} disabled={busy || locked || !ready || finished} onClick={() => onState({ flagged: marked ? state.flagged.filter((id) => id !== q.id) : [...state.flagged, q.id] })}><Flag size={15} /><span>{marked ? t(lang, "已标记", "Flagged") : t(lang, "稍后", "Later")}</span></button></div>
              {q.word_limit && <p className="muted small">{t(lang, `最多 ${q.word_limit} 个词`, `No more than ${q.word_limit} words`)}</p>}
              <input maxLength={2000} disabled={shown || cannotEdit} value={answers[q.id] ?? ""} onFocus={() => { if (!finished) onState({ currentQuestionId: q.id }); }} onChange={(e) => onAnswer(q.id, e.target.value)} placeholder={t(lang, "输入答案", "Type your answer")} aria-label={t(lang, `第 ${i + 1} 题答案`, `Question ${i + 1} answer`)} />
              {state.mode === "practice" && !shown && <button className="text-link" disabled={cannotEdit} onClick={() => onReveal(q.id)}>{t(lang, "查看答案与解析", "Check answer")}</button>}
              {shown && <div className={`answer-feedback ${isCorrectAnswer(q, answers[q.id] ?? "") ? "correct" : "incorrect"}`}><strong>{isCorrectAnswer(q, answers[q.id] ?? "") ? t(lang, "答对了", "Correct") : `${t(lang, "参考答案", "Accepted answer")}: ${q.answers.join(" / ")}`}</strong><p>{q.explanation}</p></div>}
            </div>
          </div>;
        }) : <p className="empty-text">{t(lang, "该题组还没有题目。", "No questions in this set yet.")}</p>}
        {questions.length > 0 && <div className="practice-submit"><button className="button primary" disabled={busy || locked || !ready || finished || !sessionHasStarted(state)} onClick={() => missing.length ? setConfirmSubmit(true) : onSubmit()}><Send size={16} />{busy ? t(lang, "提交中…", "Submitting…") : t(lang, "提交本次练习", "Submit practice")}</button>{finished && <strong>{questions.filter((q) => isCorrectAnswer(q, answers[q.id] ?? "")).length}/{questions.length}</strong>}</div>}
      </section>
    </div>
    {confirmSubmit && <Modal label={t(lang, "还有题目未完成", "Unanswered questions")} busy={busy} onClose={() => setConfirmSubmit(false)}><h3>{t(lang, `还有 ${missing.length} 题未答`, `${missing.length} unanswered questions`)}</h3><p>{t(lang, "可以定位未答题继续作答，也可以确认提交当前答案。", "Return to an unanswered question or submit your current answers.")}</p><div className="button-row"><button className="button primary" data-modal-initial-focus disabled={busy} onClick={() => { setConfirmSubmit(false); if (missing[0]) jump(missing[0].id); }}>{t(lang, "定位未答题", "Go to unanswered")}</button><button className="button secondary" disabled={busy} onClick={() => { setConfirmSubmit(false); onSubmit(); }}>{t(lang, "仍然提交", "Submit anyway")}</button><button className="button secondary" disabled={busy} onClick={() => setConfirmSubmit(false)}>{t(lang, "继续作答", "Keep working")}</button></div></Modal>}
  </>;
}
