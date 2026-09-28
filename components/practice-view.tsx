"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ChevronRight, Clock3, FileAudio, Headphones, Mic, Pause,
  Play, RotateCcw, Save, Send, Sparkles, Square, X,
} from "lucide-react";
import { clearLocalDraft, readLocalDraft, saveLocalDraft } from "@/lib/offline-drafts";
import { apiFetch, demoMode } from "@/lib/supabase";
import { normaliseAnswer, skillLabels, skills } from "@/lib/study";
import type { Attempt, Feedback, Material, Question, Skill, WritingDraft, WorkspaceData } from "@/lib/types";
import { t } from "./workspace";
import type { ViewActions } from "./views";

interface Props {
  data: WorkspaceData;
  actions: ViewActions;
  initialMaterialId: string | null;
  onInitialConsumed: () => void;
}

export function PracticeView({ data, actions, initialMaterialId, onInitialConsumed }: Props) {
  const lang = data.profile.language;
  const [skill, setSkill] = useState<Skill>("reading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"practice" | "timed">("practice");
  const [mobilePane, setMobilePane] = useState<"passage" | "questions">("questions");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [writingText, setWritingText] = useState("");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"saved" | "saving" | "local" | "conflict">("saved");
  const [serverConflict, setServerConflict] = useState<WritingDraft | null>(null);
  const [draftRetry, setDraftRetry] = useState(0);
  const draftVersion = useRef(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [saveRecording, setSaveRecording] = useState(false);
  const [manualTranscript, setManualTranscript] = useState("");
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [pendingAudioPath, setPendingAudioPath] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [textProvider, setTextProvider] = useState("AI");
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(40);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const lastWarning = useRef<number | null>(null);

  useEffect(() => {
    if (initialMaterialId) {
      const material = data.materials.find((item) => item.id === initialMaterialId);
      if (material) { setSkill(material.skill); setSelectedId(material.id); }
      onInitialConsumed();
    }
  }, [initialMaterialId, data.materials, onInitialConsumed]);

  const selected = data.materials.find((material) => material.id === selectedId) ?? null;
  const available = data.materials.filter((material) => material.skill === skill && material.track === "academic" && (material.visibility === "private" || material.approval === "approved" || material.owner_id === data.profile.id)).sort((a, b) => b.created_at.localeCompare(a.created_at));

  useEffect(() => {
    if (!selected || selected.skill !== "writing") { setDraftHydrated(false); return; }
    let current = true;
    const remote = data.drafts.find((draft) => draft.material_id === selected.id);
    draftVersion.current = remote?.version ?? 0;
    setWritingText(remote?.body ?? "");
    setDraftStatus("saved");
    setServerConflict(null);
    void readLocalDraft(data.profile.id, selected.id).then((local) => {
      if (!current) return;
      if (local && (!remote || local.updatedAt > remote.updated_at) && local.body !== remote?.body) {
        setWritingText(local.body); setDraftStatus("local");
      }
      setDraftHydrated(true);
    }).catch(() => setDraftHydrated(true));
    return () => { current = false; };
    // Loading only when opening a different writing set prevents a late refresh from replacing typed text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || selected.skill !== "writing" || !draftHydrated) return;
    const materialId = selected.id;
    setDraftStatus((status) => status === "conflict" ? status : "saving");
    const timer = window.setTimeout(async () => {
      try {
        await saveLocalDraft(data.profile.id, materialId, writingText);
        if (demoMode) {
          const draft: WritingDraft = { id: data.drafts.find((row) => row.material_id === materialId)?.id ?? crypto.randomUUID(), owner_id: data.profile.id, material_id: materialId, body: writingText, version: draftVersion.current + 1, updated_at: new Date().toISOString() };
          draftVersion.current = draft.version;
          await actions.upsert("writing_drafts", "drafts", draft);
          await clearLocalDraft(data.profile.id, materialId);
          setDraftStatus("saved");
          return;
        }
        if (!navigator.onLine) { setDraftStatus("local"); return; }
        if (serverConflict) { setDraftStatus("conflict"); return; }
        const { data: session } = await actions.client!.auth.getSession();
        const response = await fetch("/api/drafts", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token ?? ""}` },
          body: JSON.stringify({ materialId, body: writingText, version: draftVersion.current }),
        });
        const result = await response.json();
        if (response.status === 409) {
          setServerConflict(result.serverDraft as WritingDraft);
          setDraftStatus("conflict");
          return;
        }
        if (!response.ok) throw new Error(result.error ?? "草稿保存失败");
        draftVersion.current = (result.draft as WritingDraft).version;
        await clearLocalDraft(data.profile.id, materialId);
        setDraftStatus("saved");
      } catch {
        setDraftStatus("local");
      }
    }, 1200);
    return () => window.clearTimeout(timer);
    // The draft body is the only input to autosave; other values are stable for this selected set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingText, selected?.id, draftHydrated, serverConflict, draftRetry]);

  useEffect(() => {
    const retry = () => {
      if (draftStatus === "local" && selected?.skill === "writing") {
        setDraftRetry((attempt) => attempt + 1);
      }
    };
    window.addEventListener("online", retry);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (draftStatus === "local" || draftStatus === "saving" || draftStatus === "conflict") {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("online", retry); window.removeEventListener("beforeunload", beforeUnload); };
  }, [draftStatus, selected?.skill]);

  useEffect(() => {
    if (!startedAt || finished) return;
    const tick = () => {
      const value = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(value);
      if (mode === "timed" && selected?.skill === "writing") {
        const remaining = durationMinutes * 60 - value;
        const threshold = remaining <= 60 ? 60 : remaining <= 300 ? 300 : null;
        if (threshold && lastWarning.current !== threshold) {
          lastWarning.current = threshold;
          actions.notify(t(lang, `还剩 ${Math.ceil(remaining / 60)} 分钟，草稿会继续保存。`, `${Math.ceil(remaining / 60)} minute(s) left. Your draft keeps saving.`));
        }
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [startedAt, finished, mode, selected?.skill, durationMinutes, actions, lang]);

  useEffect(() => {
    if (!selected?.file_path || !selected.file_kind?.startsWith("audio") || !actions.client) { setAudioUrl(null); return; }
    let active = true;
    void apiFetch(actions.client, `/api/files/url?materialId=${encodeURIComponent(selected.id)}`).then((value) => {
      if (active) setAudioUrl((value as { url: string }).url);
    }).catch(() => setAudioUrl(null));
    return () => { active = false; };
  }, [selected?.id, selected?.file_path, selected?.file_kind, actions.client]);

  useEffect(() => {
    if (!actions.client) return;
    void apiFetch(actions.client, "/api/ai/config").then((value) => {
      setTextProvider((value as { provider?: string }).provider === "qwen" ? "阿里云百炼 Qwen" : "DeepSeek");
    }).catch(() => undefined);
  }, [actions.client]);

  useEffect(() => () => { if (recordedUrl) URL.revokeObjectURL(recordedUrl); stream.current?.getTracks().forEach((track) => track.stop()); }, [recordedUrl]);

  function selectMaterial(material: Material) {
    if (selected?.skill === "writing" && ["saving", "local", "conflict"].includes(draftStatus) && !window.confirm(t(lang, "草稿尚未同步到云端。切换后仍保存在本机，确定继续？", "The draft is not synced yet. It remains on this device. Continue?"))) return;
    setSelectedId(material.id); setSkill(material.skill); setMode("practice"); setAnswers({}); setRevealed([]); setFinished(false);
    setFeedback(null); setStartedAt(null); setElapsed(0); setTranscriptOpen(false); setManualTranscript("");
    setRecordedBlob(null); setSaveRecording(false); setPendingTaskId(null); setPendingAudioPath(null); setMobilePane("questions");
  }

  function begin() { setStartedAt(Date.now()); setElapsed(0); setFinished(false); lastWarning.current = null; }

  function scoreQuestions(questions: Question[]) {
    return questions.filter((question) => question.answers.some((accepted) => normaliseAnswer(accepted) === normaliseAnswer(answers[question.id] ?? ""))).length;
  }

  async function saveAttempt(attempt: Attempt) {
    await actions.upsert("practice_attempts", "attempts", attempt);
    await actions.refresh();
    setFinished(true);
    actions.notify(t(lang, "练习已保存到个人记录", "Practice saved to your history"));
  }

  async function finishQuestions() {
    if (!selected) return;
    const count = selected.questions.length;
    const attempt: Attempt = {
      id: crypto.randomUUID(), owner_id: data.profile.id, material_id: selected.id, skill: selected.skill,
      mode, duration_seconds: elapsed, correct_count: scoreQuestions(selected.questions), question_count: count,
      answer_body: answers, feedback: null, transcript: null, recording_path: null, saved_recording: false,
      submitted_at: new Date().toISOString(), purged_at: null,
    };
    await saveAttempt(attempt);
    setRevealed(selected.questions.map((question) => question.id));
  }

  async function requestFeedback(text: string, material: Material, kind: "writing" | "speaking"): Promise<Feedback | null> {
    if (!data.profile.ai_enabled || !actions.client) return null;
    if (!window.confirm(t(lang, `题目和你的作答将发送给 ${textProvider}，可能产生费用。继续？`, `The prompt and your answer will be sent to ${textProvider} and may incur a charge. Continue?`))) return null;
    const payload = { skill: kind, prompt: material.prompt, answer: text, overrideBudget: false };
    try {
      const response = await apiFetch(actions.client, "/api/ai/feedback", { method: "POST", body: JSON.stringify(payload) }) as { feedback: Feedback; budgetNearlyUsed?: boolean };
      if (response.budgetNearlyUsed) actions.notify(t(lang, "本月 AI 费用估算已接近预算", "This month's AI estimate is near your budget"));
      return response.feedback;
    } catch (error) {
      if (error instanceof Error && error.message === "budget_confirmation_required") {
        if (window.confirm(t(lang, "本月 AI 用量已达到预算。仍要进行这一次调用？", "Your monthly AI estimate reached the budget. Continue with this call?"))) {
          try { return (await apiFetch(actions.client, "/api/ai/feedback", { method: "POST", body: JSON.stringify({ ...payload, overrideBudget: true }) }) as { feedback: Feedback }).feedback; }
          catch { actions.notify(t(lang, "AI 反馈暂时不可用，作答仍会保存。", "AI feedback is unavailable; your answer will still be saved.")); return null; }
        }
        return null;
      }
      actions.notify(t(lang, "AI 反馈暂时不可用，作答仍会保存。", "AI feedback is unavailable; your answer will still be saved."));
      return null;
    }
  }

  async function finishWriting() {
    if (!selected || !writingText.trim()) return;
    if (!navigator.onLine && !demoMode) { actions.notify(t(lang, "当前离线，草稿已在本机暂存；连接恢复后再提交。", "Offline draft saved on this device. Submit after reconnecting.")); return; }
    setBusy(true);
    try {
      const result = await requestFeedback(writingText, selected, "writing");
      const attempt: Attempt = {
        id: crypto.randomUUID(), owner_id: data.profile.id, material_id: selected.id, skill: "writing",
        mode, duration_seconds: elapsed, correct_count: null, question_count: null,
        answer_body: { essay: writingText }, feedback: result, transcript: null,
        recording_path: null, saved_recording: false, submitted_at: new Date().toISOString(), purged_at: null,
      };
      await saveAttempt(attempt);
      setFeedback(result);
    } catch (error) { actions.notify(error instanceof Error ? error.message : "提交失败"); }
    finally { setBusy(false); }
  }

  async function startRecording() {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((mime) => MediaRecorder.isTypeSupported(mime));
      const instance = new MediaRecorder(media, preferred ? { mimeType: preferred } : undefined);
      chunks.current = [];
      stream.current = media;
      instance.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      instance.onstop = () => {
        const blob = new Blob(chunks.current, { type: instance.mimeType || "audio/webm" });
        setRecordedBlob(blob);
        setRecordedUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
        media.getTracks().forEach((track) => track.stop());
        setRecording(false);
      };
      recorder.current = instance;
      instance.start();
      setRecording(true);
      begin();
    } catch { actions.notify(t(lang, "无法访问麦克风。你仍可手动输入转写文字。", "Microphone unavailable. You can type a transcript instead.")); }
  }

  function stopRecording() { recorder.current?.stop(); }

  async function finishSpeaking() {
    if (!selected || (!recordedBlob && !manualTranscript.trim())) return;
    if (!navigator.onLine && !demoMode) { actions.notify(t(lang, "网络恢复后再提交录音。", "Submit the recording after reconnecting.")); return; }
    setBusy(true);
    let path: string | null = pendingAudioPath;
    let transcript = manualTranscript.trim();
    let result: Feedback | null = null;
    try {
      if (recordedBlob && actions.client && (data.profile.ai_enabled || saveRecording) && !pendingTaskId && !path) {
        const extension = recordedBlob.type.includes("mp4") ? "m4a" : "webm";
        path = `${data.profile.id}/${crypto.randomUUID()}.${extension}`;
        const { error } = await actions.client.storage.from("study-audio").upload(path, recordedBlob, { contentType: recordedBlob.type, upsert: false });
        if (error) throw error;
        setPendingAudioPath(path);
      }
      if (data.profile.ai_enabled && (path || pendingTaskId) && !transcript) {
        if (window.confirm(t(lang, "录音将发送给所选转写服务商并可能产生费用。继续？", "Recording will be sent to your speech provider and may incur a charge. Continue?"))) {
          let taskId = pendingTaskId;
          if (!taskId) {
            const payload = { path, saved: saveRecording, durationSeconds: elapsed, overrideBudget: false };
            try {
              const response = await apiFetch(actions.client, "/api/ai/transcribe", { method: "POST", body: JSON.stringify(payload) }) as { taskId: string; budgetNearlyUsed?: boolean };
              taskId = response.taskId;
              if (response.budgetNearlyUsed) actions.notify(t(lang, "本月 AI 费用估算已接近预算", "This month's AI estimate is near your budget"));
            }
            catch (error) {
              if (!(error instanceof Error) || error.message !== "budget_confirmation_required" || !window.confirm(t(lang, "转写费用估算已达到月度预算，仍要继续？", "Transcription would reach your monthly budget. Continue?"))) throw error;
              taskId = (await apiFetch(actions.client, "/api/ai/transcribe", { method: "POST", body: JSON.stringify({ ...payload, overrideBudget: true }) }) as { taskId: string }).taskId;
            }
          }
          setPendingTaskId(taskId);
          for (let i = 0; i < 25; i++) {
            await new Promise((resolve) => window.setTimeout(resolve, 2500));
            const polled = await apiFetch(actions.client, `/api/ai/transcribe?taskId=${encodeURIComponent(taskId)}`) as { status: string; transcript?: string };
            if (polled.status === "SUCCEEDED") { transcript = polled.transcript ?? ""; setPendingTaskId(null); break; }
            if (polled.status === "FAILED") {
              setPendingTaskId(null);
              if (!saveRecording) setPendingAudioPath(null);
              throw new Error(t(lang, "转写失败，录音仍保留在当前页面。可再次提交重试。", "Transcription failed. The recording remains on this page. Submit again to retry."));
            }
          }
          if (!transcript) { actions.notify(t(lang, "转写仍在处理，可稍后点击提交继续查询。", "Transcription is still processing. Submit again to check its progress.")); return; }
        }
      }
      if (transcript && data.profile.ai_enabled) result = await requestFeedback(transcript, selected, "speaking");
      const attempt: Attempt = {
        id: crypto.randomUUID(), owner_id: data.profile.id, material_id: selected.id, skill: "speaking",
        mode, duration_seconds: elapsed, correct_count: null, question_count: null,
        answer_body: transcript ? { transcript } : null, feedback: result, transcript,
        recording_path: saveRecording ? path : null, saved_recording: saveRecording && !!path,
        submitted_at: new Date().toISOString(), purged_at: null,
      };
      await saveAttempt(attempt); setFeedback(result); setManualTranscript(transcript);
      if (path && !saveRecording && actions.client) await actions.client.storage.from("study-audio").remove([path]);
      setPendingAudioPath(null);
    } catch (error) { actions.notify(error instanceof Error ? error.message : "提交失败"); }
    finally { setBusy(false); }
  }

  const remaining = mode === "timed" ? Math.max(0, durationMinutes * 60 - elapsed) : null;
  const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const questionScore = selected && finished && (selected.skill === "reading" || selected.skill === "listening") ? scoreQuestions(selected.questions) : null;

  if (data.profile.track === "general") return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">GENERAL TRAINING</span><h2>{t(lang, "GT 专项练习后续开放", "GT practice is coming later")}</h2><p>{t(lang, "词汇、学习计划和资料管理现在已经可以使用。", "Vocabulary, planning and your library are available now.")}</p></div></div><div className="card empty-inline"><BookOpenIcon /><strong>{t(lang, "这部分正在准备", "This area is being prepared")}</strong><button className="button primary" onClick={() => actions.setView("vocabulary")}>{t(lang, "先复习词汇", "Review vocabulary")}</button></div></div>;

  return <div className="page-stack practice-page">
    {!selected && <><div className="page-intro"><div><span className="eyebrow">SKILL PRACTICE</span><h2>{t(lang, "选择今天要练的一科", "Choose a skill to practise")}</h2><p>{t(lang, "题组来自自创示例或已获授权的共享资料。", "Sets come from original examples or authorised shared material.")}</p></div></div><div className="skill-tabs">{skills.map((item) => <button className={skill === item ? "active" : ""} key={item} onClick={() => setSkill(item)}>{t(lang, skillLabels[item].zh, skillLabels[item].en)}</button>)}</div><div className="practice-list">{available.length ? available.map((material) => <button className="practice-set card" key={material.id} onClick={() => selectMaterial(material)}><span className={`practice-set-icon skill-${material.skill}`}>{material.skill === "listening" ? <Headphones size={22} /> : material.skill === "speaking" ? <Mic size={22} /> : <BookOpenIcon />}</span><span><strong>{material.title}</strong><small>{material.question_type || t(lang, "单项练习", "Skill practice")} · {material.questions.length ? `${material.questions.length} ${t(lang, "题", "questions")}` : t(lang, "开放作答", "Open response")}</small></span><ArrowRight size={18} /></button>) : <div className="card empty-inline"><BookOpenIcon /><strong>{t(lang, "还没有这科的题组", "No sets for this skill yet")}</strong><p>{t(lang, "到资料库添加有授权的练习资料。", "Add authorised material in the library.")}</p><button className="button secondary" onClick={() => actions.setView("library")}>{t(lang, "打开资料库", "Open library")}</button></div>}</div></>}
    {selected && <><div className="practice-heading"><button className="back-link" onClick={() => { if (selected.skill === "writing" && ["local", "saving", "conflict"].includes(draftStatus) && !window.confirm(t(lang, "草稿未同步到云端。仍要返回？", "Draft not synced. Go back anyway?"))) return; setSelectedId(null); setFinished(false); }}><ArrowLeft size={17} />{t(lang, "返回题组", "Back to sets")}</button><div><span className="eyebrow">{t(lang, skillLabels[selected.skill].zh, skillLabels[selected.skill].en).toUpperCase()} PRACTICE</span><h2>{selected.title}</h2></div><div className="practice-heading-right"><span className="timer-pill"><Clock3 size={16} />{remaining === null ? formatTime(elapsed) : formatTime(remaining)}</span></div></div>
      <div className="practice-toolbar"><div className="segmented"><button className={mode === "practice" ? "active" : ""} onClick={() => { setMode("practice"); setStartedAt(null); }}>{t(lang, "自由练习", "Practice")}</button><button className={mode === "timed" ? "active" : ""} onClick={() => { setMode("timed"); setStartedAt(null); }}>{t(lang, "计时练习", "Timed")}</button></div>{mode === "timed" && <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} aria-label={t(lang, "计时时长", "Time limit")}><option value="20">20 min</option><option value="40">40 min</option><option value="60">60 min</option></select>}{!startedAt && <button className="button secondary small" onClick={begin}><Play size={15} />{t(lang, "开始计时", "Start timer")}</button>}{remaining === 0 && mode === "timed" && <span className="warning-pill">{t(lang, "时间已到，作答仍保留", "Time is up; your work is safe")}</span>}</div>
      {(selected.skill === "reading" || selected.skill === "listening") && <><div className="mobile-pane-tabs"><button className={mobilePane === "passage" ? "active" : ""} onClick={() => setMobilePane("passage")}>{t(lang, selected.skill === "reading" ? "文章" : "音频与文字稿", selected.skill === "reading" ? "Passage" : "Audio & transcript")}</button><button className={mobilePane === "questions" ? "active" : ""} onClick={() => setMobilePane("questions")}>{t(lang, "题目", "Questions")}</button></div><div className="reading-grid"><section className={`card passage-pane mobile-${mobilePane}`}><span className="eyebrow">{selected.skill === "reading" ? "PASSAGE" : "LISTENING"}</span>{selected.skill === "listening" && <>{audioUrl ? <audio controls src={audioUrl} className="audio-player" /> : <div className="audio-empty"><FileAudio size={20} />{t(lang, "这组听力还没有音频附件", "This set has no audio attachment")}</div>}<button className="text-action" onClick={() => setTranscriptOpen(!transcriptOpen)}>{transcriptOpen ? t(lang, "隐藏文字稿", "Hide transcript") : t(lang, "显示文字稿", "Show transcript")} <ChevronRight size={16} /></button></>}{(selected.skill === "reading" || transcriptOpen) && <div className="passage-text">{(selected.skill === "reading" ? selected.passage : selected.transcript).split("\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>}</section><section className={`card questions-pane mobile-${mobilePane}`}><div className="card-top"><h3>{t(lang, "题目", "Questions")}</h3><span className="muted small">{selected.questions.length} {t(lang, "题", "questions")}</span></div>{selected.questions.length ? selected.questions.map((question, index) => { const isRevealed = revealed.includes(question.id) || finished; const correct = question.answers.some((value) => normaliseAnswer(value) === normaliseAnswer(answers[question.id] ?? "")); return <div className="answer-question" key={question.id}><span className="question-number">{index + 1}</span><div><strong>{question.prompt}</strong><input disabled={finished} value={answers[question.id] ?? ""} onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))} placeholder={t(lang, "输入答案", "Type your answer")} aria-label={`${t(lang, "第", "Question ")}${index + 1}${t(lang, "题答案", " answer")}`} />{mode === "practice" && !isRevealed && <button className="text-link" onClick={() => setRevealed((previous) => [...previous, question.id])}>{t(lang, "查看答案与解析", "Check answer")}</button>}{isRevealed && <div className={`answer-feedback ${correct ? "correct" : "incorrect"}`}><strong>{correct ? t(lang, "答对了", "Correct") : `${t(lang, "参考答案", "Accepted answer")}: ${question.answers.join(" / ")}`}</strong><p>{question.explanation}</p></div>}</div></div>; }) : <p className="empty-text">{t(lang, "该题组还没有题目。", "No questions in this set yet.")}</p>}{selected.questions.length > 0 && <div className="practice-submit"><button className="button primary" disabled={finished} onClick={() => void finishQuestions()}><Send size={16} />{t(lang, "提交本次练习", "Submit practice")}</button>{questionScore !== null && <strong>{questionScore} / {selected.questions.length}</strong>}</div>}</section></div></>}
      {selected.skill === "writing" && <div className="writing-grid"><section className="card writing-prompt"><span className="eyebrow">WRITING PROMPT</span><h3>{selected.title}</h3><p>{selected.prompt}</p><div className="muted small">{t(lang, "你的草稿会自动保存。", "Your draft saves automatically.")}</div></section><section className="card writing-editor"><div className="card-top"><h3>{t(lang, "你的作答", "Your response")}</h3><span className={`save-status ${draftStatus}`}><Save size={15} />{draftStatus === "saved" ? t(lang, "已保存", "Saved") : draftStatus === "saving" ? t(lang, "保存中", "Saving") : draftStatus === "local" ? t(lang, "本机暂存 · 待同步", "Saved here · awaiting sync") : t(lang, "发现编辑冲突", "Edit conflict")}</span></div>{serverConflict && <div className="conflict-box"><strong>{t(lang, "另一台设备也修改了这篇草稿", "This draft changed on another device")}</strong><p>{t(lang, "当前文字仍保存在本机。可以加载云端版本，或继续保留本机文字并另存为练习。", "Your current text stays on this device. Load the cloud version or submit this as a separate attempt.")}</p><button className="button secondary small" onClick={() => { setWritingText(serverConflict.body); draftVersion.current = serverConflict.version; setServerConflict(null); }}>{t(lang, "加载云端版本", "Load cloud version")}</button><button className="button secondary small" onClick={() => void finishWriting()}>{t(lang, "另存为练习", "Save as separate attempt")}</button></div>}<textarea className="essay-input" value={writingText} onChange={(event) => setWritingText(event.target.value)} placeholder={t(lang, "在这里开始写作…", "Start writing here…")} aria-label={t(lang, "写作草稿", "Writing draft")} /><div className="editor-footer"><span>{writingText.trim() ? writingText.trim().split(/\s+/).length : 0} {t(lang, "词", "words")}</span><button className="button primary" disabled={busy || !writingText.trim()} onClick={() => void finishWriting()}><Send size={16} />{busy ? t(lang, "提交中…", "Submitting…") : t(lang, "提交作答", "Submit response")}</button></div></section></div>}
      {selected.skill === "speaking" && <div className="speaking-grid"><section className="card speaking-prompt"><span className="eyebrow">SPEAKING PROMPT</span><h3>{selected.title}</h3><p>{selected.prompt}</p></section><section className="card recording-card"><h3>{t(lang, "录下你的回答", "Record your answer")}</h3><p className="muted">{t(lang, "录完后再提交。默认不保存原始录音。", "Submit after recording. The original audio is not saved by default.")}</p><div className="record-stage"><div className={`record-disc ${recording ? "recording" : ""}`}><Mic size={31} /></div><strong>{recording ? formatTime(elapsed) : recordedBlob ? t(lang, "录音已完成", "Recording ready") : t(lang, "准备开始", "Ready when you are")}</strong><div className="button-row">{recording ? <button className="button danger-outline" onClick={stopRecording}><Square size={16} />{t(lang, "停止录音", "Stop recording")}</button> : <button className="button primary" onClick={() => void startRecording()}><Mic size={16} />{recordedBlob ? t(lang, "重新录音", "Record again") : t(lang, "开始录音", "Start recording")}</button>}</div>{recordedUrl && <audio controls src={recordedUrl} className="audio-player" />}</div><label className="switch-row"><span>{t(lang, "保存这次原始录音（一年后自动删除）", "Keep this recording (deleted after one year)")}</span><input type="checkbox" checked={saveRecording} onChange={(event) => setSaveRecording(event.target.checked)} /></label><label>{t(lang, "转写文字（可手动输入或修改）", "Transcript (type or edit manually)")}<textarea rows={4} value={manualTranscript} onChange={(event) => setManualTranscript(event.target.value)} placeholder={t(lang, "未启用 AI 时，可在这里记录口语内容。", "Record your spoken answer here if AI is off.")} /></label><button className="button primary" disabled={busy || recording || (!recordedBlob && !manualTranscript.trim())} onClick={() => void finishSpeaking()}><Send size={16} />{busy ? t(lang, "处理中…", "Processing…") : t(lang, "提交口语练习", "Submit speaking")}</button></section></div>}
      {finished && <section className="card result-card"><div className="result-icon"><CheckCircle2 size={25} /></div><div><span className="eyebrow">SESSION SAVED</span><h3>{t(lang, "这次练习已收进个人记录", "This practice is in your history")}</h3><p>{t(lang, "可以查看反馈，或继续练下一组。", "Review feedback or move to another set.")}</p></div><button className="button secondary" onClick={() => actions.setView("progress")}>{t(lang, "查看记录", "View history")}<ArrowRight size={16} /></button></section>}
      {feedback && <section className="card ai-feedback"><div className="card-top"><div><span className="eyebrow">AI FEEDBACK</span><h3>{t(lang, "练习建议", "Practice feedback")}</h3></div><Sparkles size={19} /></div><p>{feedback.summary}</p><div className="feedback-columns"><div><h4>{t(lang, "做得好的地方", "Strengths")}</h4>{feedback.strengths.map((point, index) => <p key={index}>• {point}</p>)}</div><div><h4>{t(lang, "下一步优先改进", "Priorities")}</h4>{feedback.priorities.map((point, index) => <p key={index}>• {point}</p>)}</div></div>{selected.skill === "writing" && feedback.annotations.length > 0 && <div className="annotations"><h4>{t(lang, "文内批注", "Inline notes")}</h4>{feedback.annotations.map((item, index) => <div className="annotation-row" key={index}><blockquote>{item.quote}</blockquote><p>{item.comment}</p></div>)}</div>}</section>}
    </>}
  </div>;
}

function BookOpenIcon() { return <BookOpen size={25} />; }

