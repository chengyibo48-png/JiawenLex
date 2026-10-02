"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  Mic,
  Play,
  Save,
  Send,
  Sparkles,
  Square,
} from "lucide-react";
import { MicroTrainingView } from "./micro-training-view";
import { ResponsePrompt } from "./response-prompt";
import { IntensiveListening } from "./intensive-listening";
import { PracticeCatalog } from "./practice-catalog";
import { QuestionPractice } from "./question-practice";
import { PracticeSessionPanel } from "./practice-session-panel";
import {
  hasListeningAudio,
  initialSessionState,
  materialStamp,
  practiceMaterials,
  type PracticeSessionState,
} from "@/lib/practice-sessions";
import { useWritingDraft } from "./use-writing-draft";
import { AnnotatedResponse } from "./annotated-response";
import { apiFetch, demoMode } from "@/lib/supabase";
import { snapshotMaterial } from "@/lib/review";
import { isCorrectAnswer, isGradableQuestion, skillLabels } from "@/lib/study";
import type {
  Attempt,
  Feedback,
  Material,
  Question,
  Skill,
  WorkspaceData,
} from "@/lib/types";
import { t } from "./workspace";
import type { ViewActions } from "./views";

interface Props {
  data: WorkspaceData;
  actions: ViewActions;
  initialMaterialId: string | null;
  initialSkill: Skill;
  onInitialConsumed: () => void;
}

export function PracticeView({
  data,
  actions,
  initialMaterialId,
  initialSkill,
  onInitialConsumed,
}: Props) {
  const lang = data.profile.language;
  const [area, setArea] = useState<"sets" | "micro">(
    actions.microTarget ? "micro" : "sets",
  );
  const microGuard = useRef<(() => Promise<boolean>) | null>(null);
  const microSlot = useRef<string | null>(null);
  useEffect(() => {
    if (actions.microTarget) {
      setArea("micro");
      setSelectedId(null);
    }
  }, [actions.microTarget?.requestId]);
  const [intensive, setIntensive] = useState(false);
  const intensiveGuard = useRef<(() => Promise<boolean>) | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const elapsedRef = useRef(0);
  const activeAt = useRef<number | null>(null);
  const elapsedBase = useRef(0);
  const sessionActions = useRef(actions);
  sessionActions.current = actions;
  const [skill, setSkill] = useState<Skill>(initialSkill);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"practice" | "timed">("practice");
  const [mobilePane, setMobilePane] = useState<"passage" | "questions">(
    "questions",
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioReady,setAudioReady]=useState(false),[audioError,setAudioError]=useState(false),[audioReload,setAudioReload]=useState(0);
  const [figureUrl, setFigureUrl] = useState<string | null>(null);
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [selectedId]);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [saveRecording, setSaveRecording] = useState(false);
  const [manualTranscript, setManualTranscript] = useState("");
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [pendingAudioPath, setPendingAudioPath] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [submittedText, setSubmittedText] = useState("");
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const recordingStartedAt = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(40);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const lastWarning = useRef<number | null>(null);
  const submissionLock = useRef(false);
  const attemptId = useRef<string | null>(null);
  const questionSubmissionKey = useRef<string | null>(null);
  const feedbackCache = useRef<{ key: string; feedback: Feedback } | null>(
    null,
  );
  const mounted = useRef(false);

  useEffect(() => {
    if (initialMaterialId) {
      const material = practiceMaterials(data).find(
        (item) => item.id === initialMaterialId,
      );
      if (material && (material.skill!=="listening" || hasListeningAudio(material))) {
        setArea("sets");
        setSkill(material.skill);
        responseVersion.current = null;
        setSelectedId(material.id);
      }
      onInitialConsumed();
    }
  }, [initialMaterialId, data.materials, onInitialConsumed]);

  const selected =
    practiceMaterials(data).find((material) => material.id === selectedId) ??
    null;
  const responseVersion = useRef<{ id: string; revision: number } | null>(null);
  if (selected && responseVersion.current?.id !== selected.id)
    responseVersion.current = {
      id: selected.id,
      revision:
        data.drafts.find((d) => d.material_id === selected.id)
          ?.material_revision ??
        selected.revision ??
        1,
    };
  let responseRevision = responseVersion.current?.revision ?? 1;
  async function responseSource(): Promise<Material> {
    if (!selected) throw new Error("Material unavailable");
    if (!actions.client) return selected;
    const result = await actions.client
      .from("material_versions")
      .select("snapshot")
      .eq("material_id", selected.id)
      .eq("revision", responseRevision)
      .single();
    if (result.error) throw result.error;
    return { ...result.data.snapshot, owner_id: selected.owner_id } as Material;
  }
  const resumable =
    selected?.skill === "reading" || selected?.skill === "listening";
  const freshState = useMemo(
    () => (selected ? initialSessionState(selected) : null),
    [selected?.id],
  );
  const savedSession = selected ? actions.sessions.get(selected.id) : undefined;
  const questionState =
    savedSession && (savedSession.state.phase === "active" || finished)
      ? savedSession.state
      : freshState;
  const sessionConflict = selected
    ? actions.sessions.conflict(selected.id)
    : undefined;
  const materialChanged =
    resumable &&
    savedSession?.state.phase === "active" &&
    savedSession.state.materialStamp !== materialStamp(selected!);
  function restoreQuestions(state?: PracticeSessionState) {
    if (!selected || !resumable) return;
    const value = state ?? freshState!;
    setMode(value.mode);
    setDurationMinutes(value.durationMinutes);
    setAnswers(value.answers);
    setRevealed(value.revealed);
    setMobilePane(value.mobilePane);
    setTranscriptOpen(false);
    const restoredElapsed =
      value.mode === "timed" && value.startedAt !== null
        ? Math.max(0, Math.floor((Date.now() - value.startedAt) / 1000))
        : value.elapsedSeconds;
    elapsedRef.current = restoredElapsed;
    elapsedBase.current = restoredElapsed;
    setElapsed(restoredElapsed);
    setStartedAt(
      value.startedAt === null
        ? null
        : value.mode === "timed"
          ? value.startedAt
          : Date.now(),
    );
    setFinished(false);
    attemptId.current = null;
    setSessionReady(true);
  }
  useEffect(() => {
    setSessionReady(false);
    if (!selected) return;
    if (!resumable) {
      setSessionReady(true);
      return;
    }
    if (!actions.sessions.ready) return;
    const row = actions.sessions.get(selected.id);
    restoreQuestions(row?.state.phase === "active" ? row.state : undefined);
  }, [selected?.id, actions.sessions.ready]);
  function updateSession(patch: Partial<PracticeSessionState>) {
    if (!selected || !resumable || finished) return;
    const row = actions.sessions.get(selected.id);
    actions.sessions.update(
      selected,
      row?.state.phase === "active" ? patch : { ...freshState!, ...patch },
    );
  }
  function currentElapsed() {
    if (!startedAt) return elapsedRef.current;
    if (mode === "timed")
      return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    return (
      elapsedBase.current +
      (activeAt.current
        ? Math.max(0, Math.floor((Date.now() - activeAt.current) / 1000))
        : 0)
    );
  }

  const draft = useWritingDraft({
    userId: data.profile.id,
    materialId: selected?.skill === "writing" ? selected.id : null,
    remote: data.drafts.find((row) => row.material_id === selected?.id),
    client: actions.client,
    saveDemo: (row) => actions.upsert("writing_drafts", "drafts", row),
    onCloudSaved: actions.acceptDraft,
    sourceRevision: responseRevision,
  });
  if (selected?.skill === "writing" && draft.sourceRevision)
    responseRevision = draft.sourceRevision;
  const writingText = draft.body,
    draftStatus = draft.status;
  const leaveMessage = t(
    lang,
    "草稿尚未同步，文字已加密保存在本机。确定离开？",
    "Your unsynced draft is encrypted on this device. Leave?",
  );
  const failureMessage = t(
    lang,
    "本机保存失败，离开可能丢失文字。仍要离开？",
    "Local saving failed. Leaving may lose text. Leave anyway?",
  );
  async function canLeavePractice(reason: "navigate" | "logout" = "navigate") {
    if (area === "micro" && microGuard.current) return microGuard.current();
    if (busy || recording) {
      actions.notify(
        t(
          lang,
          "请先停止录音或等待提交完成。",
          "Stop recording or wait for submission to finish.",
        ),
      );
      return false;
    }
    if (
      !finished &&
      selected?.skill === "speaking" &&
      (recordedBlob || manualTranscript.trim() || pendingTaskId)
    ) {
      if (
        !window.confirm(
          t(
            lang,
            "这次录音和转写尚未存入练习记录。离开会丢失当前内容，确定继续？",
            "This recording and transcript are not in your history. Leaving loses this response. Continue?",
          ),
        )
      )
        return false;
    }
    if (
      intensive &&
      intensiveGuard.current &&
      !(await intensiveGuard.current())
    )
      return false;
    if (
      !finished &&
      selected &&
      resumable &&
      actions.sessions.get(selected.id)?.state.phase === "active"
    ) {
      updateSession({ elapsedSeconds: currentElapsed() });
      if (!(await actions.sessions.canLeave(selected.id))) {
        actions.notify(
          t(
            lang,
            "答题进度未能保存，请保留当前页面并重试同步。",
            "Progress could not be saved. Keep this page open and retry syncing.",
          ),
        );
        return false;
      }
    }
    return draft.canLeave(leaveMessage, failureMessage, reason !== "logout");
  }
  useEffect(() => {
    actions.registerPracticeGuard(canLeavePractice, area === "micro" ? microSlot.current : selected?.id ?? null);
    return () => actions.registerPracticeGuard(null);
  });

  useEffect(() => {
    if (!startedAt || finished || !selected || intensive) return;
    activeAt.current =
      document.visibilityState === "hidden" ? null : Date.now();
    elapsedBase.current = elapsedRef.current;
    const tick = () => {
      const value =
        mode === "timed" || selected.skill === "speaking"
          ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
          : elapsedBase.current +
            (activeAt.current
              ? Math.max(0, Math.floor((Date.now() - activeAt.current) / 1000))
              : 0);
      elapsedRef.current = value;
      setElapsed(value);
      if (mode === "timed" && selected.skill === "writing") {
        const remaining = durationMinutes * 60 - value;
        const threshold = remaining <= 60 ? 60 : remaining <= 300 ? 300 : null;
        if (remaining > 0 && threshold && lastWarning.current !== threshold) {
          lastWarning.current = threshold;
          sessionActions.current.notify(
            t(
              lang,
              "还剩 " + Math.ceil(remaining / 60) + " 分钟，草稿会继续保存。",
              Math.ceil(remaining / 60) +
                " minute(s) left. Your draft keeps saving.",
            ),
          );
        }
      }
    };
    const checkpoint = () => {
      if (
        resumable &&
        sessionActions.current.sessions.get(selected.id)?.state.phase ===
          "active"
      )
        sessionActions.current.sessions.update(selected, {
          elapsedSeconds: elapsedRef.current,
        });
    };
    const visibility = () => {
      tick();
      if (document.visibilityState === "hidden") {
        elapsedBase.current = elapsedRef.current;
        activeAt.current = null;
        checkpoint();
      } else {
        elapsedBase.current = elapsedRef.current;
        activeAt.current = Date.now();
      }
    };
    tick();
    const interval = setInterval(tick, 1000),
      saveInterval = setInterval(checkpoint, 15000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", checkpoint);
    return () => {
      clearInterval(interval);
      clearInterval(saveInterval);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", checkpoint);
    };
  }, [
    startedAt,
    finished,
    selected?.id,
    mode,
    durationMinutes,
    lang,
    intensive,
  ]);

  useEffect(() => {
    setAudioUrl(null);setAudioReady(false);setAudioError(false);
    if (
      !selected?.file_path ||
      !selected.file_kind?.startsWith("audio") ||
      !actions.client
    ) {
      setAudioUrl(null);
      return;
    }
    let active = true;
    void apiFetch(
      actions.client,
      `/api/files/url?materialId=${encodeURIComponent(selected.id)}`,
    )
      .then((value) => {
        if (active) setAudioUrl((value as { url: string }).url);
      })
      .catch(() => {if(active){setAudioUrl(null);setAudioError(true);}});
    return () => {
      active = false;
    };
  }, [selected?.id, selected?.file_path, selected?.file_kind, actions.client,audioReload]);

  useEffect(() => {
    if (!selected?.file_path || !selected.file_kind?.startsWith("image/") || !actions.client) { setFigureUrl(null); return; }
    let active = true;
    void apiFetch(actions.client, `/api/files/url?materialId=${encodeURIComponent(selected.id)}`)
      .then((value) => { if (active) setFigureUrl((value as { url: string }).url); })
      .catch(() => { if (active) setFigureUrl(null); });
    return () => { active = false; };
  }, [selected?.id, selected?.file_path, selected?.file_kind, actions.client,audioReload]);

  useEffect(
    () => () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    },
    [recordedUrl],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function selectMaterial(material: Material) {
    if(material.skill==="listening"&&!hasListeningAudio(material)){actions.notify(t(lang,"这份资料没有配套录音，请在资料库查看。","This material has no recording. Open it in the library."));return;}
    if (!(await canLeavePractice())) return;
    attemptId.current = null;
    feedbackCache.current = null;
    setIntensive(false);
    setSessionReady(false);
    setSelectedId(material.id);
    setFeedbackNotice(null);
    setSkill(material.skill);
    setMode("practice");
    setAnswers({});
    setRevealed([]);
    setFinished(false);
    setFeedback(null);
    setSubmittedText("");
    setStartedAt(null);
    setElapsed(0);
    setTranscriptOpen(false);
    setManualTranscript("");
    setRecordedBlob(null);
    setRecordedSeconds(0);
    recordingStartedAt.current = null;
    setRecordedUrl(null);
    setSaveRecording(false);
    setPendingTaskId(null);
    setPendingAudioPath(null);
    setMobilePane(material.skill === "listening" ? "passage" : "questions");
  }

  function begin() {
    if(selected?.skill==="listening"&&(!hasListeningAudio(selected)||!audioReady)){actions.notify(t(lang,"录音尚未就绪，请等待加载或重试。","Wait for the recording to load or retry."));return;}
    const now = Date.now();
    setStartedAt(now);
    setElapsed(0);
    elapsedRef.current = 0;
    elapsedBase.current = 0;
    activeAt.current = now;
    setFinished(false);
    lastWarning.current = null;
    updateSession({
      mode,
      durationMinutes,
      startedAt: now,
      deadline: mode === "timed" ? now + durationMinutes * 60000 : null,
      elapsedSeconds: 0,
    });
  }
  function answerQuestion(id: string, value: string) {
    if (!startedAt) begin();
    const next = { ...answers, [id]: value };
    setAnswers(next);
    updateSession({ answers: next, currentQuestionId: id });
  }
  function changePane(pane: "passage" | "questions") {
    setMobilePane(pane);
    updateSession({ mobilePane: pane });
  }
  function revealQuestion(id: string) {
    const next = [...revealed, id];
    setRevealed(next);
    updateSession({ revealed: next });
  }
  async function restartQuestions() {
    if (!selected) return;
    try {
      await actions.sessions.restart(selected);
      restoreQuestions(actions.sessions.get(selected.id)?.state);
    } catch (error) {
      actions.notify(
        error instanceof Error
          ? error.message
          : "无法保留副本 / Could not archive copy",
      );
    }
  }

  function scoreQuestions(questions: Question[]) {
    return questions.filter(isGradableQuestion).filter((question) =>
      isCorrectAnswer(question, answers[question.id] ?? ""),
    ).length;
  }

  async function saveAttempt(attempt: Attempt) {
    if (
      (attempt.skill === "reading" || attempt.skill === "listening") &&
      actions.client &&
      selected
    ) {
      await apiFetch(actions.client, "/api/learning", {
        method: "POST",
        body: JSON.stringify({
          id: attempt.id,
          materialId: selected.id,
          materialStamp:
            questionState?.materialStamp ?? materialStamp(selected),
          mode: attempt.mode,
          durationSeconds: attempt.duration_seconds,
          answers: attempt.answer_body ?? {},
          flagged: questionState?.flagged ?? [],
          answerExposed: revealed.length > 0 || !!questionState?.answerExposed,
        }),
      });
    } else {
      const objective = selected && ["reading", "listening"].includes(attempt.skill);
      const exposed = revealed.length > 0 || !!questionState?.answerExposed ||
        data.attempts.some(row => row.material_id === selected?.id && row.learning_kind !== "intensive");
      await actions.upsert("practice_attempts", "attempts", {
        ...attempt,
        ...(selected ? { material_revision: attempt.material_revision ?? selected.revision ?? 1 } : {}),
        ...(objective ? { learning_kind: exposed ? "review" : "first", answer_exposed: exposed } : {}),
      });
      // Production response submission creates its immutable review atomically.
      // Members cannot write this protected table directly.
      if (selected && !actions.client) {
        const now = new Date().toISOString();
        await actions.upsert("attempt_reviews", "attemptReviews", {
          id: attempt.id, owner_id: data.profile.id, snapshot: snapshotMaterial(selected),
          flagged: questionState?.flagged ?? [], notes: {}, version: 1,
          created_at: now, updated_at: now,
        });
      }
    }
    await actions.refresh();
    setFinished(true);
    actions.notify(
      t(lang, "练习已保存到个人记录", "Practice saved to your history"),
    );
  }

  async function finishQuestions() {
    if (!selected || submissionLock.current || finished) return;
    const key = JSON.stringify([
      selected.id,
      questionState?.runId,
      mode,
      answers,
    ]);
    if (questionSubmissionKey.current !== key) {
      attemptId.current = null;
      questionSubmissionKey.current = key;
    }
    submissionLock.current = true;
    setBusy(true);
    try {
      const gradedQuestions = selected.questions.filter(isGradableQuestion);
      const count = gradedQuestions.length;
      const questionType = (question: Question) => selected.tags.includes("listening-text") ? "listening_text" : question.type || selected.question_type || "Other";
      const attempt: Attempt = {
        id: (attemptId.current ??= crypto.randomUUID()),
        owner_id: data.profile.id,
        material_id: selected.id,
        skill: selected.skill,
        mode,
        duration_seconds: currentElapsed(),
        correct_count: count ? scoreQuestions(gradedQuestions) : null,
        question_count: count || null,
        answer_body: { ...answers },
        feedback: null,
        transcript: null,
        recording_path: null,
        saved_recording: false,
        question_stats: [
          ...new Set(
            gradedQuestions.map(questionType),
          ),
        ].map((type) => {
          const questions = gradedQuestions.filter(
            (q) => questionType(q) === type,
          );
          return {
            type,
            count: questions.length,
            correct: scoreQuestions(questions),
          };
        }),
        submitted_at: new Date().toISOString(),
        purged_at: null,
      };
      await saveAttempt(attempt);
      await actions.sessions
        .complete(selected)
        .catch(() =>
          actions.notify(
            t(
              lang,
              "练习记录已保存，答题会话等待同步。",
              "Attempt saved; the session awaits sync.",
            ),
          ),
        );
      setRevealed(selected.questions.map((question) => question.id));
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : "提交失败");
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  }

  function notifyFeedbackFailure(error: unknown) {
    const message = error instanceof Error ? error.message : t(lang, "AI 反馈暂时不可用。", "AI feedback is unavailable.");
    const notice = message + " " + t(lang, "原始作答仍保留。", "Your original answer is retained.");
    setFeedbackNotice(notice);
    actions.notify(notice);
  }
  async function requestFeedback(text: string, material: Material, kind: "writing" | "speaking"): Promise<Feedback | null> {
    setFeedbackNotice(null);
    if (!data.profile.ai_enabled || !actions.client) return null;
    let config: { text: boolean; provider: "deepseek" | "qwen"; workspaceId: string; textUpdatedAt: string };
    try {
      config = await apiFetch(actions.client, "/api/ai/config") as typeof config;
      if (!config.text) throw new Error(t(lang, "请先在设置中保存文本服务密钥。", "Save a text provider key in settings first."));
    } catch (error) { notifyFeedbackFailure(error); return null; }
    const expectedConfig = { provider: config.provider, workspaceId: config.workspaceId, updatedAt: config.textUpdatedAt };
    const cacheKey = JSON.stringify([material.id, material.revision, material.prompt, kind, text, expectedConfig, lang]);
    if (feedbackCache.current?.key === cacheKey) return feedbackCache.current.feedback;
    const provider = config.provider === "qwen" ? t(lang, "阿里云百炼 Qwen", "Alibaba Cloud Model Studio Qwen") : "DeepSeek";
    if (!window.confirm(t(lang, "题目和你的作答将发送给 " + provider + "，可能产生费用。继续？", "The prompt and your answer will be sent to " + provider + " and may incur a charge. Continue?"))) return null;
    const payload = { skill: kind, prompt: material.prompt, answer: text, overrideBudget: false, expectedConfig };
    const send = async (overrideBudget: boolean) => {
      const response = await apiFetch(actions.client, "/api/ai/feedback", { method: "POST", body: JSON.stringify({ ...payload, overrideBudget }) }) as { feedback: Feedback; budgetNearlyUsed?: boolean };
      if (response.budgetNearlyUsed) actions.notify(t(lang, "本月 AI 费用估算已接近预算", "This month's AI estimate is near your budget"));
      feedbackCache.current = { key: cacheKey, feedback: response.feedback };
      return response.feedback;
    };
    try { return await send(false); }
    catch (error) {
      if (error instanceof Error && error.message === "budget_confirmation_required") {
        if (!window.confirm(t(lang, "本月 AI 用量已达到预算。仍要进行这一次调用？", "Your monthly AI estimate reached the budget. Continue with this call?"))) return null;
        try { return await send(true); } catch (retryError) { notifyFeedbackFailure(retryError); return null; }
      }
      notifyFeedbackFailure(error); return null;
    }
  }
  async function finishWriting() {
    if (!selected || !writingText.trim() || submissionLock.current || finished)
      return;
    if (!navigator.onLine && !demoMode) {
      actions.notify(
        t(
          lang,
          "当前离线，草稿已在本机暂存；连接恢复后再提交。",
          "Offline draft saved on this device. Submit after reconnecting.",
        ),
      );
      return;
    }
    submissionLock.current = true;
    setBusy(true);
    try {
      const source = await responseSource();
      const result = await requestFeedback(writingText, source, "writing");
      setFeedback(result);
      setSubmittedText(writingText);
      const attempt: Attempt = {
        id: (attemptId.current ??= crypto.randomUUID()),
        owner_id: data.profile.id,
        material_id: selected.id,
        material_revision: responseRevision,
        skill: "writing",
        mode,
        duration_seconds: elapsed,
        correct_count: null,
        question_count: null,
        answer_body: { essay: writingText },
        feedback: result,
        transcript: null,
        recording_path: null,
        saved_recording: false,
        submitted_at: new Date().toISOString(),
        purged_at: null,
      };
      await saveAttempt(attempt);
      setFeedback(result);
      setSubmittedText(attempt.answer_body?.essay ?? "");
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : "提交失败");
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  }

  async function startRecording() {
    if (busy || recording || pendingTaskId || submissionLock.current) return;
    submissionLock.current = true;
    setBusy(true);
    try {
      if (pendingAudioPath && actions.client) {
        const { error } = await actions.client.storage.from("study-audio").remove([pendingAudioPath]);
        if (error) throw error;
        setPendingAudioPath(null);
      }
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      if (!mounted.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      const preferred = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
      ].find((mime) => MediaRecorder.isTypeSupported(mime));
      const instance = new MediaRecorder(
        media,
        preferred ? { mimeType: preferred } : undefined,
      );
      chunks.current = [];
      stream.current = media;
      instance.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      instance.onstop = () => {
        const duration = recordingStartedAt.current === null ? 0 : Math.max(1, Math.ceil((performance.now() - recordingStartedAt.current) / 1000));
        recordingStartedAt.current = null;
        media.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        setRecordedSeconds(duration);
        const blob = new Blob(chunks.current, {
          type: instance.mimeType || "audio/webm",
        });
        setRecordedBlob(blob);
        setRecordedUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setRecording(false);
      };
      instance.onerror = () => {
        media.getTracks().forEach((track) => track.stop());
        if (mounted.current) {
          setRecording(false);
          actions.notify(t(lang, "录音中断，请检查设备后重新录制，或手动填写转写。", "Recording interrupted. Check your device and record again, or type a transcript."));
        }
      };
      recorder.current = instance;
      instance.start(1000);
      setFeedbackNotice(null);
      setPendingAudioPath(null);
      setPendingTaskId(null);
      setFinished(false);
      setFeedback(null);
      setManualTranscript("");
      attemptId.current = null;
      feedbackCache.current = null;
      setRecordedBlob(null);
      setRecordedUrl(null);
      recordingStartedAt.current = performance.now();
      setRecordedSeconds(0);
      setRecording(true);
      begin();
    } catch (error) {
      stream.current?.getTracks().forEach((track) => track.stop());
      actions.notify(
        t(
          lang,
          "无法访问麦克风。你仍可手动输入转写文字。",
          "Microphone unavailable. You can type a transcript instead.",
        ),
      );
    } finally {
      submissionLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  useEffect(() => {
    if (!recording) return;
    const tick = () => {
      if (recordingStartedAt.current === null) return;
      const seconds = Math.floor((performance.now() - recordingStartedAt.current) / 1000);
      setRecordedSeconds(seconds);
      if (seconds >= 3600 && recorder.current?.state === "recording") {
        recorder.current.stop();
        actions.notify(t(lang, "录音已达到一小时，已自动停止。", "Recording reached one hour and has stopped automatically."));
      }
    };
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [recording, lang]);

  async function finishSpeaking() {
    if (
      !selected ||
      submissionLock.current ||
      finished ||
      (!recordedBlob && !manualTranscript.trim())
    )
      return;
    if (
      recordedBlob &&
      !manualTranscript.trim() &&
      !data.profile.ai_enabled &&
      !saveRecording
    ) {
      actions.notify(
        t(
          lang,
          "请填写转写文字或勾选保存录音，再提交这次练习。",
          "Add a transcript or choose to keep the recording before submitting.",
        ),
      );
      return;
    }
    if (!navigator.onLine && !demoMode) {
      actions.notify(
        t(
          lang,
          "网络恢复后再提交录音。",
          "Submit the recording after reconnecting.",
        ),
      );
      return;
    }
    submissionLock.current = true;
    setBusy(true);
    let path: string | null = pendingAudioPath;
    let transcript = manualTranscript.trim();
    let result: Feedback | null = null;
    try {
      let transcribe = !!pendingTaskId;
      let expectedConfig: { provider: "qwen-asr"; workspaceId: string; updatedAt: string } | undefined;
      if (data.profile.ai_enabled && recordedBlob && !transcript && !pendingTaskId) {
        const config = await apiFetch(actions.client, "/api/ai/config") as { asr: boolean; asrWorkspaceId: string; asrUpdatedAt: string };
        if (!config.asr) throw new Error(t(lang, "请先在设置中保存百炼录音转写密钥。", "Save a Model Studio speech key in settings first."));
        expectedConfig = { provider: "qwen-asr", workspaceId: config.asrWorkspaceId, updatedAt: config.asrUpdatedAt };
        transcribe = window.confirm(t(lang, "录音将发送给阿里云百炼进行转写，可能产生费用。继续？", "Recording will be sent to Alibaba Cloud Model Studio for transcription and may incur a charge. Continue?"));
        if (!transcribe && !saveRecording) return;
      }
      if (
        recordedBlob &&
        actions.client &&
        (transcribe || saveRecording) &&
        !pendingTaskId &&
        !path
      ) {
        const extension = recordedBlob.type.includes("mp4") ? "m4a" : "webm";
        path = `${data.profile.id}/${crypto.randomUUID()}.${extension}`;
        const { error } = await actions.client.storage
          .from("study-audio")
          .upload(path, recordedBlob, {
            contentType: recordedBlob.type,
            upsert: false,
          });
        if (error) throw error;
        setPendingAudioPath(path);
      }
      if (data.profile.ai_enabled && (path || pendingTaskId) && !transcript) {
        if (transcribe) {
          let taskId = pendingTaskId;
          if (!taskId) {
            const payload = {
              path,
              saved: saveRecording,
              durationSeconds: Math.min(3600, Math.max(1, recordedSeconds)),
              expectedConfig,
              overrideBudget: false,
            };
            try {
              const response = (await apiFetch(
                actions.client,
                "/api/ai/transcribe",
                { method: "POST", body: JSON.stringify(payload) },
              )) as { taskId: string; budgetNearlyUsed?: boolean };
              taskId = response.taskId;
              if (response.budgetNearlyUsed)
                actions.notify(
                  t(
                    lang,
                    "本月 AI 费用估算已接近预算",
                    "This month's AI estimate is near your budget",
                  ),
                );
            } catch (error) {
              if (
                !(error instanceof Error) ||
                error.message !== "budget_confirmation_required" ||
                !window.confirm(
                  t(
                    lang,
                    "转写费用估算已达到月度预算，仍要继续？",
                    "Transcription would reach your monthly budget. Continue?",
                  ),
                )
              )
                throw error;
              taskId = (
                (await apiFetch(actions.client, "/api/ai/transcribe", {
                  method: "POST",
                  body: JSON.stringify({ ...payload, overrideBudget: true }),
                })) as { taskId: string }
              ).taskId;
            }
          }
          setPendingTaskId(taskId);
          for (let i = 0; i < 25; i++) {
            await new Promise((resolve) => window.setTimeout(resolve, 2500));
            const polled = (await apiFetch(
              actions.client,
              `/api/ai/transcribe?taskId=${encodeURIComponent(taskId)}`,
            )) as { status: string; transcript?: string };
            if (polled.status === "SUCCEEDED") {
              transcript = polled.transcript ?? "";
              setManualTranscript(transcript);
              setPendingTaskId(null);
              if (!saveRecording) {
                path = null;
                setPendingAudioPath(null);
              }
              break;
            }
            if (polled.status === "FAILED") {
              setPendingTaskId(null);
              if (!saveRecording) setPendingAudioPath(null);
              throw new Error(
                t(
                  lang,
                  "转写失败，录音仍保留在当前页面。可再次提交重试。",
                  "Transcription failed. The recording remains on this page. Submit again to retry.",
                ),
              );
            }
          }
          if (!transcript) {
            actions.notify(
              t(
                lang,
                "转写仍在处理，可稍后点击提交继续查询。",
                "Transcription is still processing. Submit again to check its progress.",
              ),
            );
            return;
          }
        }
      }
      if (!transcript && !saveRecording) {
        actions.notify(
          t(
            lang,
            "尚无可保存的文字或录音，请补充转写文字。",
            "There is no transcript or recording to save yet. Add a transcript.",
          ),
        );
        return;
      }
      const source = await responseSource();
      if (transcript && data.profile.ai_enabled)
        result = await requestFeedback(transcript, source, "speaking");
      setFeedback(result);
      setManualTranscript(transcript);
      const attempt: Attempt = {
        id: (attemptId.current ??= crypto.randomUUID()),
        owner_id: data.profile.id,
        material_id: selected.id,
        material_revision: responseRevision,
        skill: "speaking",
        mode,
        duration_seconds: elapsed,
        correct_count: null,
        question_count: null,
        answer_body: transcript ? { transcript } : null,
        feedback: result,
        transcript,
        recording_path: saveRecording ? path : null,
        saved_recording: saveRecording && !!path,
        submitted_at: new Date().toISOString(),
        purged_at: null,
      };
      await saveAttempt(attempt);
      setFeedback(result);
      setManualTranscript(transcript);
      if (path && !saveRecording && actions.client)
        await actions.client.storage.from("study-audio").remove([path]);
      setPendingAudioPath(null);
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : "提交失败");
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  }

  const remaining =
    mode === "timed" ? Math.max(0, durationMinutes * 60 - elapsed) : null;
  const formatTime = (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  if (data.profile.track === "general")
    return (
      <div className="page-stack">
        <div className="page-intro">
          <div>
            <span className="eyebrow">GENERAL TRAINING</span>
            <h2>
              {t(lang, "GT 专项练习后续开放", "GT practice is coming later")}
            </h2>
            <p>
              {t(
                lang,
                "词汇、学习计划和资料管理现在已经可以使用。",
                "Vocabulary, planning and your library are available now.",
              )}
            </p>
          </div>
        </div>
        <div className="card empty-inline">
          <BookOpenIcon />
          <strong>
            {t(lang, "这部分正在准备", "This area is being prepared")}
          </strong>
          <button
            className="button primary"
            onClick={() => actions.setView("vocabulary")}
          >
            {t(lang, "先复习词汇", "Review vocabulary")}
          </button>
        </div>
      </div>
    );

  return (
    <div className="page-stack practice-page">
      {!selected && (
        <div className="segmented">
          <button
            className={area === "sets" ? "active" : ""}
            onClick={() =>
              void (async () => {
                if (!(await canLeavePractice())) return;
                actions.clearMicroTarget();
                setArea("sets");
              })()
            }
          >
            {t(lang, "题组练习", "Question sets")}
          </button>
          <button
            className={area === "micro" ? "active" : ""}
            onClick={() => setArea("micro")}
          >
            {t(lang, "微训练", "Micro training")}
          </button>
        </div>
      )}
      {!selected && area === "micro" && (
        <MicroTrainingView
          data={data}
          actions={actions}
          onGuard={(guard, slot) => {
            microGuard.current = guard;
            microSlot.current = slot ?? null;
            actions.registerPracticeGuard(canLeavePractice, slot ?? null);
          }}
        />
      )}
      {!selected && area === "sets" && (
        <PracticeCatalog
          data={data}
          actions={actions}
          skill={skill}
          onSkill={setSkill}
          onSelect={(material) => void selectMaterial(material)}
        />
      )}
      {selected && (
        <>
          <div className="practice-heading">
            <button
              className="back-link"
              onClick={() =>
                void (async () => {
                  if (!(await canLeavePractice())) return;
                  setSelectedId(null);
                  setFinished(false);
                })()
              }
            >
              <ArrowLeft size={17} />
              {t(lang, "返回题组", "Back to sets")}
            </button>
            <div>
              <span className="eyebrow">
                {t(
                  lang,
                  skillLabels[selected.skill].zh,
                  skillLabels[selected.skill].en,
                ).toUpperCase()}{" "}
                PRACTICE
              </span>
              <h2>{selected.title}</h2>
              {selected.origin_kind && <p className="muted small"><span className="source-origin">{selected.origin_kind === "source" ? t(lang, "资料原题", "Source question") : selected.origin_kind === "adapted" ? t(lang, "改编练习", "Adapted exercise") : t(lang, "原题与改编", "Source and adapted")}</span> {selected.source_title}{selected.source_physical_page ? ` · ${t(lang, "原件第", "PDF page")} ${selected.source_physical_page} ${t(lang, "页", "")}` : ""}</p>}
            </div>
            <div className="practice-heading-right">
              <span className="timer-pill">
                <Clock3 size={16} />
                {intensive
                  ? t(lang, "精听模式", "Intensive listening")
                  : remaining === null
                    ? formatTime(elapsed)
                    : formatTime(remaining)}
              </span>
            </div>
          </div>
          {selected.skill === "listening" && !selected.tags.includes("listening-text") && (
            <div className="segmented listening-mode">
              <button
                className={!intensive ? "active" : ""}
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    if (
                      intensiveGuard.current &&
                      !(await intensiveGuard.current())
                    )
                      return;
                    setIntensive(false);
                  })()
                }
              >
                {t(lang, "题目练习", "Question practice")}
              </button>
              <button
                className={intensive ? "active" : ""}
                disabled={
                  busy || (mode === "timed" && startedAt !== null && !finished)
                }
                onClick={() => {
                  const seconds = currentElapsed();
                  elapsedRef.current = seconds;
                  elapsedBase.current = seconds;
                  activeAt.current = null;
                  setElapsed(seconds);
                  if (!finished) updateSession({ elapsedSeconds: seconds });
                  setIntensive(true);
                }}
              >
                {t(lang, "精听练习", "Intensive listening")}
              </button>
            </div>
          )}
          {intensive && (
            <IntensiveListening
              key={selected.id}
              material={selected}
              url={audioUrl}
              data={data}
              actions={actions}
              onGuard={(guard) => {
                intensiveGuard.current = guard;
              }}
              onExpose={() => updateSession({ answerExposed: true })}
            />
          )}
          {!intensive && (
            <div className="practice-toolbar">
              <div className="segmented">
                <button
                  className={mode === "practice" ? "active" : ""}
                  disabled={
                    busy ||
                    recording ||
                    finished ||
                    revealed.length > 0 ||
                    startedAt !== null ||
                    !sessionReady ||
                    (selected.skill==="listening"&&!audioReady) ||
                    !!sessionConflict ||
                    !!materialChanged
                  }
                  onClick={() => {
                    setMode("practice");
                    updateSession({ mode: "practice", deadline: null });
                    setStartedAt(null);
                    setElapsed(0);
                  }}
                >
                  {t(lang, "自由练习", "Practice")}
                </button>
                <button
                  className={mode === "timed" ? "active" : ""}
                  disabled={
                    busy ||
                    selected.tags.includes("listening-text") ||
                    recording ||
                    finished ||
                    revealed.length > 0 ||
                    startedAt !== null ||
                    !sessionReady ||
                    (selected.skill==="listening"&&!audioReady) ||
                    !!sessionConflict ||
                    !!materialChanged
                  }
                  onClick={() => {
                    setMode("timed");
                    setTranscriptOpen(false);
                    updateSession({ mode: "timed", deadline: null });
                    setStartedAt(null);
                    setElapsed(0);
                  }}
                >
                  {t(lang, "计时练习", "Timed")}
                </button>
              </div>
              {mode === "timed" && (
                <select
                  value={durationMinutes}
                  onChange={(event) => {
                    setDurationMinutes(Number(event.target.value));
                    updateSession({
                      durationMinutes: Number(event.target.value),
                    });
                  }}
                  disabled={
                    busy ||
                    finished ||
                    startedAt !== null ||
                    !sessionReady ||
                    (selected.skill==="listening"&&!audioReady) ||
                    !!sessionConflict ||
                    !!materialChanged
                  }
                  aria-label={t(lang, "计时时长", "Time limit")}
                >
                  <option value="20">20 min</option>
                  <option value="40">40 min</option>
                  <option value="60">60 min</option>
                </select>
              )}
              {!startedAt && (
                <button
                  className="button secondary small"
                  disabled={
                    busy ||
                    finished ||
                    !sessionReady ||
                    (selected.skill==="listening"&&!audioReady) ||
                    !!sessionConflict ||
                    !!materialChanged
                  }
                  onClick={begin}
                >
                  <Play size={15} />
                  {t(lang, "开始计时", "Start timer")}
                </button>
              )}
              {remaining === 0 && mode === "timed" && (
                <span className="warning-pill">
                  {t(
                    lang,
                    "时间已到，作答仍保留",
                    "Time is up; your work is safe",
                  )}
                </span>
              )}
            </div>
          )}
          {!intensive && resumable && questionState && (
            <>
              <p className="muted small">
                {mode === "timed"
                  ? t(
                      lang,
                      "计时开始后，切换页面或断网仍继续倒计时；提交后统一查看解析。",
                      "The countdown continues across navigation and disconnection. Explanations unlock after submission.",
                    )
                  : t(
                      lang,
                      "自由练习可逐题查看解析；切换页面会保留答题进度。",
                      "Check answers one at a time. Your progress survives navigation.",
                    )}
              </p>
              <PracticeSessionPanel
                material={selected}
                manager={actions.sessions}
                lang={lang}
                notify={actions.notify}
                onReload={() =>
                  restoreQuestions(
                    actions.sessions.get(selected.id)?.state.phase === "active"
                      ? actions.sessions.get(selected.id)!.state
                      : undefined,
                  )
                }
                onRestart={() => void restartQuestions()}
                onRestore={(state) => {
                  void actions.sessions
                    .restore(selected, state)
                    .then(() => restoreQuestions(state))
                    .catch(() =>
                      actions.notify(
                        t(
                          lang,
                          "恢复失败，当前版本仍保留",
                          "Restore failed; current version retained",
                        ),
                      ),
                    );
                }}
              />
              {selected.skill==="listening"&&!audioReady&&<div className="notice info" role="status">{audioError?t(lang,"录音暂时无法加载，答题暂缓开放，已有答案保留。","Recording unavailable. Answers are preserved; retry to continue."):t(lang,"正在加载配套录音…","Loading the recording…")} <button className="button secondary small" onClick={()=>setAudioReload(v=>v+1)}>{t(lang,"重新加载录音","Reload recording")}</button></div>}
              <QuestionPractice
                material={selected}
                lang={lang}
                client={actions.client}
                notify={actions.notify}
                state={{ ...questionState, mode, durationMinutes, startedAt }}
                answers={answers}
                revealed={revealed}
                finished={finished}
                busy={busy}
                locked={!!sessionConflict || !!materialChanged}
                ready={sessionReady && (selected.skill!=="listening"||audioReady)}
                onAudioStatus={value=>{setAudioReady(value);if(!value)setAudioError(true);}}
                mobilePane={mobilePane}
                audioUrl={audioUrl}
                figureUrl={figureUrl}
                transcriptOpen={transcriptOpen}
                expired={mode === "timed" && remaining === 0}
                onPane={changePane}
                onTranscript={() => {
                  setTranscriptOpen(!transcriptOpen);
                  if (!transcriptOpen) updateSession({ answerExposed: true });
                }}
                onAnswer={answerQuestion}
                onState={updateSession}
                onReveal={revealQuestion}
                onSubmit={() => void finishQuestions()}
              />
            </>
          )}
          {selected.skill === "writing" && (
            <div className="writing-grid">
              <section className="card writing-prompt">
                <span className="eyebrow">WRITING PROMPT</span>
                <h3>{selected.title}</h3>
                <ResponsePrompt
                  material={selected}
                  revision={responseRevision}
                  actions={actions}
                  lang={lang}
                  finished={finished}
                  figureUrl={figureUrl}
                />
                <div className="muted small">
                  {t(
                    lang,
                    "你的草稿会自动保存。",
                    "Your draft saves automatically.",
                  )}
                </div>
              </section>
              <section className="card writing-editor">
                <div className="card-top">
                  <h3>{t(lang, "你的作答", "Your response")}</h3>
                  <span className={`save-status ${draftStatus}`}>
                    <Save size={15} />
                    {draftStatus === "saved"
                      ? t(lang, "已保存", "Saved")
                      : draftStatus === "saving"
                        ? t(lang, "保存中", "Saving")
                        : draftStatus === "local"
                          ? t(
                              lang,
                              "本机暂存 · 待同步",
                              "Saved here · awaiting sync",
                            )
                          : draftStatus === "error"
                            ? t(
                                lang,
                                "本机保存失败，请复制文字",
                                "Local saving failed; copy your text",
                              )
                            : t(lang, "发现编辑冲突", "Edit conflict")}
                  </span>
                </div>
                {draft.conflict && (
                  <div className="conflict-box">
                    <strong>
                      {t(
                        lang,
                        "云端版本已变化，已保留当前文字",
                        "The cloud version changed. Your text is retained.",
                      )}
                    </strong>
                    <p>
                      {t(
                        lang,
                        "加载云端版本前会存一份加密冲突副本，也可以把当前文字另存为练习。",
                        "Loading the cloud version archives an encrypted conflict copy. You can also save this text as a separate attempt.",
                      )}
                    </p>
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => void draft.useCloud()}
                    >
                      {t(
                        lang,
                        "保留副本并加载云端",
                        "Keep a copy and load cloud",
                      )}
                    </button>
                    <button
                      className="button secondary small"
                      disabled={busy || finished}
                      onClick={() => void finishWriting()}
                    >
                      {t(lang, "另存为练习", "Save as separate attempt")}
                    </button>
                  </div>
                )}
                {draft.copies.length > 0 && (
                  <details className="conflict-box">
                    <summary>
                      {t(lang, "本机冲突副本", "Local conflict copies")} (
                      {draft.copies.length})
                    </summary>
                    {draft.copies.map((copy) => (
                      <div key={copy.revision}>
                        <p className="small muted">
                          {new Date(copy.updatedAt).toLocaleString()}
                        </p>
                        <pre className="draft-copy">{copy.body}</pre>
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                t(
                                  lang,
                                  "用这份副本替换编辑器文字？",
                                  "Replace editor text with this copy?",
                                ),
                              )
                            )
                              draft.edit(copy.body);
                          }}
                        >
                          {t(lang, "恢复到编辑器", "Restore to editor")}
                        </button>
                      </div>
                    ))}
                  </details>
                )}
                <textarea
                  className="essay-input"
                  disabled={!draft.ready || busy || finished}
                  value={writingText}
                  onChange={(event) => draft.edit(event.target.value)}
                  placeholder={t(
                    lang,
                    "在这里开始写作…",
                    "Start writing here…",
                  )}
                  aria-label={t(lang, "写作草稿", "Writing draft")}
                />
                <div className="editor-footer">
                  <span>
                    {writingText.trim()
                      ? writingText.trim().split(/\s+/).length
                      : 0}{" "}
                    {t(lang, "词", "words")}
                  </span>
                  <button
                    className="button primary"
                    disabled={
                      busy || finished || !draft.ready || !writingText.trim()
                    }
                    onClick={() => void finishWriting()}
                  >
                    <Send size={16} />
                    {busy
                      ? t(lang, "提交中…", "Submitting…")
                      : t(lang, "提交作答", "Submit response")}
                  </button>
                </div>
              </section>
            </div>
          )}
          {selected.skill === "speaking" && (
            <div className="speaking-grid">
              <section className="card speaking-prompt">
                <span className="eyebrow">SPEAKING PROMPT</span>
                <h3>{selected.title}</h3>
                <ResponsePrompt
                  material={selected}
                  revision={responseRevision}
                  actions={actions}
                  lang={lang}
                  finished={finished}
                  figureUrl={figureUrl}
                />
              </section>
              <section className="card recording-card">
                <h3>{t(lang, "录下你的回答", "Record your answer")}</h3>
                <p className="muted">
                  {t(
                    lang,
                    "录完后再提交。默认不保存原始录音。",
                    "Submit after recording. The original audio is not saved by default.",
                  )}
                </p>
                <div className="record-stage">
                  <div
                    className={`record-disc ${recording ? "recording" : ""}`}
                  >
                    <Mic size={31} />
                  </div>
                  <strong>
                    {recording
                      ? formatTime(recordedSeconds)
                      : recordedBlob
                        ? t(lang, "录音已完成", "Recording ready")
                        : t(lang, "准备开始", "Ready when you are")}
                  </strong>
                  <div className="button-row">
                    {recording ? (
                      <button
                        className="button danger-outline"
                        onClick={stopRecording}
                      >
                        <Square size={16} />
                        {t(lang, "停止录音", "Stop recording")}
                      </button>
                    ) : (
                      <button
                        className="button primary"
                        disabled={busy || !!pendingTaskId}
                        onClick={() => void startRecording()}
                      >
                        <Mic size={16} />
                        {recordedBlob
                          ? t(lang, "重新录音", "Record again")
                          : t(lang, "开始录音", "Start recording")}
                      </button>
                    )}
                  </div>
                  {recordedUrl && (
                    <audio
                      controls
                      src={recordedUrl}
                      className="audio-player"
                    />
                  )}
                </div>
                <label className="switch-row">
                  <span>
                    {t(
                      lang,
                      "保存这次原始录音（一年后自动删除）",
                      "Keep this recording (deleted after one year)",
                    )}
                  </span>
                  <input
                    type="checkbox"
                    disabled={busy || !!pendingTaskId || finished}
                    checked={saveRecording}
                    onChange={(event) => setSaveRecording(event.target.checked)}
                  />
                </label>
                <label>
                  {t(
                    lang,
                    "转写文字（可手动输入或修改）",
                    "Transcript (type or edit manually)",
                  )}
                  <textarea
                    rows={4}
                    disabled={busy || finished}
                    value={manualTranscript}
                    onChange={(event) =>
                      setManualTranscript(event.target.value)
                    }
                    placeholder={t(
                      lang,
                      "未启用 AI 时，可在这里记录口语内容。",
                      "Record your spoken answer here if AI is off.",
                    )}
                  />
                </label>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    finished ||
                    recording ||
                    (!recordedBlob && !manualTranscript.trim())
                  }
                  onClick={() => void finishSpeaking()}
                >
                  <Send size={16} />
                  {busy
                    ? t(lang, "处理中…", "Processing…")
                    : t(lang, "提交口语练习", "Submit speaking")}
                </button>
              </section>
            </div>
          )}
          {!intensive && finished && (
            <section className="card result-card">
              <div className="result-icon">
                <CheckCircle2 size={25} />
              </div>
              <div>
                <span className="eyebrow">SESSION SAVED</span>
                <h3>
                  {t(
                    lang,
                    "这次练习已收进个人记录",
                    "This practice is in your history",
                  )}
                </h3>
                <p>
                  {t(
                    lang,
                    "可以查看反馈，或继续练下一组。",
                    "Review feedback or move to another set.",
                  )}
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() =>
                  attemptId.current
                    ? actions.openReview(attemptId.current)
                    : actions.setView("progress")
                }
              >
                {t(lang, "查看记录", "View history")}
                <ArrowRight size={16} />
              </button>
            </section>
          )}
          {feedbackNotice && <section className="card" role="status"><h3>{t(lang, "AI 反馈未生成", "AI feedback was not generated")}</h3><p>{feedbackNotice}</p><p className="muted small">{t(lang, "请按练习保存状态查看原始作答；在设置中处理服务配置或额度问题。", "Check the practice save status for your original answer. Resolve provider configuration or quota issues in settings.")}</p></section>}
          {feedback && (
            <section className="card ai-feedback">
              <div className="card-top">
                <div>
                  <span className="eyebrow">AI FEEDBACK</span>
                  <h3>{t(lang, "练习建议", "Practice feedback")}</h3>
                </div>
                <Sparkles size={19} />
              </div>
              <p>{feedback.summary}</p>
              <div className="feedback-columns">
                <div>
                  <h4>{t(lang, "做得好的地方", "Strengths")}</h4>
                  {feedback.strengths.map((point, index) => (
                    <p key={index}>• {point}</p>
                  ))}
                </div>
                <div>
                  <h4>{t(lang, "下一步优先改进", "Priorities")}</h4>
                  {feedback.priorities.map((point, index) => (
                    <p key={index}>• {point}</p>
                  ))}
                </div>
              </div>
              {selected.skill === "writing" &&
                feedback.annotations.length > 0 && (
                  <AnnotatedResponse
                    body={submittedText}
                    annotations={feedback.annotations}
                    lang={lang}
                  />
                )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function BookOpenIcon() {
  return <BookOpen size={25} />;
}
