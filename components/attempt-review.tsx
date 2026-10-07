"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/supabase";
import { nextCalendarDate } from "@/lib/learning-flow";
import {
  evidenceText,
  kindLabel,
  normalizeTerm,
  type AttemptReview,
} from "@/lib/review";
import { isCorrectAnswer, isGradableQuestion, localDate, startOfWeek } from "@/lib/study";
import type { Attempt, Question, WorkspaceData, VocabularyWord, StudyTask } from "@/lib/types";
import type { VocabularySource, ReviewNote } from "@/lib/review";
import type { ViewActions } from "./views";
import { InlineMessage } from "./learning-ui";
import { t } from "./workspace";
export function AttemptReviewPanel({
  attempt,
  data,
  actions,
  focusQuestionId,
  onDirty,
}: {
  attempt: Attempt;
  data: WorkspaceData;
  actions: ViewActions;
  focusQuestionId?: string;
  onDirty?: (dirty: boolean) => void;
}) {
  const lang = data.profile.language,
    review = data.attemptReviews?.find((r) => r.id === attempt.id);
  const [resetTick, setResetTick] = useState(0);
  const [filter, setFilter] = useState<"priority" | "all">("priority");
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  useEffect(() => {
    onDirty?.(dirtyIds.length > 0);
  }, [dirtyIds, onDirty]);
  useEffect(() => {
    if (!dirtyIds.length) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyIds.length]);
  useEffect(() => {
    if (focusQuestionId) {
      setFilter("all");
      requestAnimationFrame(() =>
        document
          .getElementById(`review-${attempt.id}-${focusQuestionId}`)
          ?.scrollIntoView({ block: "nearest" }),
      );
    }
  }, [attempt.id, focusQuestionId]);
  if (attempt.owner_id !== data.profile.id || attempt.purged_at) return null;
  if (!review)
    return (
      <p className="muted small">
        {t(
          lang,
          "这条历史记录没有当时的题目快照，无法可靠复盘。新提交的练习会保留快照。",
          "This legacy record has no question snapshot. New submissions retain one.",
        )}
      </p>
    );
  const wrong = review.snapshot.questions.filter(
    (q) => isGradableQuestion(q) && !isCorrectAnswer(q, attempt.answer_body?.[q.id] ?? ""),
  );
  const questions = review.snapshot.questions.filter(
    (q) =>
      filter === "all" || wrong.includes(q) || review.flagged.includes(q.id) || !isGradableQuestion(q),
  );
  return (
    <section className="review-workbench">
      <div className="card-top">
        <div>
          <h3>{t(lang, "本次复盘", "Review this attempt")}</h3>
          <p className="muted small">
            {kindLabel(attempt.learning_kind, lang)} ·{" "}
            {Math.ceil(attempt.duration_seconds / 60)} min · {wrong.length}{" "}
            {t(lang, "道错题", "incorrect")}
            {review.snapshot.questions.some(q=>!isGradableQuestion(q)) && <> · {review.snapshot.questions.filter(q=>!isGradableQuestion(q)).length} {t(lang,"题未判分或待核验","unscored or pending verification")}</>}
          </p>
        </div>
        <div className="segmented">
          <button
            className={filter === "priority" ? "active" : ""}
            onClick={() => {
              if (
                dirtyIds.length &&
                !window.confirm(
                  t(
                    lang,
                    "复盘备注尚未保存，放弃修改并切换？",
                    "Discard unsaved notes and change filter?",
                  ),
                )
              )
                return;
              if (dirtyIds.length) {
                setResetTick((tick) => tick + 1);
                setDirtyIds([]);
              }
              setFilter("priority");
            }}
          >
            {t(lang, "错题与标记", "Errors & flags")}
          </button>
          <button
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            {t(lang, "全部题目", "All questions")}
          </button>
        </div>
      </div>
      <p className="muted small">
        {t(
          lang,
          "按提交时的题目版本复盘；错因由你判断。复盘不会改变原始成绩。",
          "Review the version you submitted. Choose your own error reason; the original score stays unchanged.",
        )}
      </p>
      {questions.length ? (
        questions.map((q) => (
          <QuestionReview
            key={`${resetTick}:${q.id}`}
            q={q}
            review={review}
            attempt={attempt}
            data={data}
            actions={actions}
            onDirty={(dirty) =>
              setDirtyIds((ids) =>
                dirty
                  ? [...new Set([...ids, q.id])]
                  : ids.filter((id) => id !== q.id),
              )
            }
          />
        ))
      ) : (
        <p className="empty-text">
          {t(
            lang,
            "没有错题或标记题，可以切换到全部题目查看。",
            "No errors or flagged questions. View all questions to review.",
          )}
        </p>
      )}
    </section>
  );
}
function QuestionReview({
  q,
  review,
  attempt,
  data,
  actions,
  onDirty,
}: {
  q: Question;
  review: AttemptReview;
  attempt: Attempt;
  data: WorkspaceData;
  actions: ViewActions;
  onDirty: (dirty: boolean) => void;
}) {
  const lang = data.profile.language;
  const saved = review.notes[q.id];
  const [reason, setReason] = useState(saved?.reason ?? ""),
    [note, setNote] = useState(saved?.note ?? "");
  const [baseline, setBaseline] = useState<ReviewNote>({ reason: saved?.reason ?? "", note: saved?.note ?? "" });
  const [conflict, setConflict] = useState<AttemptReview | null>(null);
  const [term, setTerm] = useState(""),
    [definition, setDefinition] = useState(""),
    [mergeId, setMergeId] = useState("");
  const [remoteWords, setRemoteWords] = useState<VocabularyWord[]>([]);
  const [savedWord, setSavedWord] = useState("");
  const [date, setDate] = useState(
      nextCalendarDate(localDate(new Date(), data.profile.timezone)),
    ),
    [minutes, setMinutes] = useState(10);
  const [scheduleBaseline, setScheduleBaseline] = useState({ date, minutes });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const lock = useRef(false);
  const [audio, setAudio] = useState<string | null>(null);
  const dirty =
    reason !== baseline.reason || note !== baseline.note;
  useEffect(() => {
    const latest = { reason: saved?.reason ?? "", note: saved?.note ?? "" };
    if (latest.reason === baseline.reason && latest.note === baseline.note) return;
    if (dirty) setConflict(review);
    else { setReason(latest.reason); setNote(latest.note); setBaseline(latest); }
  }, [saved?.reason, saved?.note, review, baseline, dirty]);
  const dirtyCallback = useRef(onDirty);
  dirtyCallback.current = onDirty;
  useEffect(() => {
    dirtyCallback.current(dirty || !!term || !!definition || date !== scheduleBaseline.date || minutes !== scheduleBaseline.minutes);
  }, [dirty, term, definition, date, minutes, scheduleBaseline]);
  const context = evidenceText(q, review.snapshot),
    position =
      review.snapshot.questions.findIndex((item) => item.id === q.id) + 1;
  const duplicates = [...new Map([...data.words, ...remoteWords].map(word => [word.id, word])).values()].filter(
    (w) => normalizeTerm(w.term) === normalizeTerm(term),
  );
  const source = data.materials.find((m) => m.id === review.snapshot.id);
  const audioAvailable =
    source?.file_path && source.file_path === review.snapshot.audio_path;
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    setMessageError(false);
    try {
      await action();
    } catch (e) {
      setMessageError(true);
      setMessage(e instanceof Error ? e.message : "保存失败 / Save failed");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveNote(version = review.version) {
    const submitted = { reason, note };
    let authoritative: AttemptReview;
    if (!actions.client) {
      authoritative = {
        ...review, notes: {...review.notes, [q.id]: {reason, note}},
        version: review.version + 1, updated_at: new Date().toISOString(),
      };
      await actions.upsert("attempt_reviews", "attemptReviews", authoritative);
    } else {
      try {
        const response = await apiFetch(actions.client, "/api/reviews", {
      method: "POST",
      body: JSON.stringify({
        action: "note",
        id: review.id,
        questionId: q.id,
        version,
        reason,
        note,
      }),
        }) as { review: AttemptReview };
        authoritative = response.review;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const latest = error.body.review as AttemptReview | undefined;
          if (latest?.id === review.id && latest.owner_id === data.profile.id) setConflict(latest);
        }
        throw error;
      }
    }
    setBaseline(submitted);
    setConflict(null);
    actions.acceptReview?.(authoritative);
    setMessage(t(lang, "错因与备注已保存", "Reason and note saved"));
  }
  async function addWord() {
    if (actions.client && !mergeId) {
      const result = await apiFetch(actions.client, `/api/reviews?term=${encodeURIComponent(term.trim())}`) as { words: VocabularyWord[] };
      if (result.words.length) {
        setRemoteWords(result.words);
        setMessage(t(lang, "词表中已有同名词，请选择合并词条后再次保存。", "Matching words exist. Choose an entry to merge, then save again."));
        return;
      }
    }
    if (duplicates.length && !mergeId) {
      setMessage(
        t(
          lang,
          "词表中已有同名词，请选择要合并的词条。复习间隔保持原值。",
          "Choose an existing entry to merge into. Its review schedule is preserved.",
        ),
      );
      return;
    }
    if (
      duplicates.length &&
      !window.confirm(
        t(
          lang,
          "将这道题的上下文合并到已有词条？释义和复习进度保持原值。",
          "Merge this context into the existing entry? Keep its meaning and review progress.",
        ),
      )
    )
      return;
    if (!actions.client) {
      const now = new Date().toISOString();
      const wordId = duplicates.length ? mergeId : crypto.randomUUID();
      if (!duplicates.length) await actions.upsert("vocabulary", "words", {
        id: wordId, owner_id: data.profile.id, term: term.trim().replace(/\s+/g, " "),
        definition: definition.trim(), example: "", tags: [attempt.skill, "错题复盘"],
        due_at: now, interval_days: 0, streak: 0, last_reviewed_at: null, created_at: now,
      });
      if (!(data.vocabularySources ?? []).some(row => row.word_id === wordId && row.attempt_id === review.id && row.question_id === q.id))
        await actions.upsert("vocabulary_sources", "vocabularySources", {
          id: crypto.randomUUID(), owner_id: data.profile.id, word_id: wordId,
          attempt_id: review.id, question_id: q.id, context: context || q.prompt, created_at: now,
        });
    } else {
      const response = await apiFetch(actions.client, "/api/reviews", {
      method: "POST",
      body: JSON.stringify({
        action: "word",
        id: review.id,
        questionId: q.id,
        term,
        definition,
        mergeId: duplicates.length ? mergeId : null,
      }),
      }) as { word?: VocabularyWord; source?: VocabularySource; added?: boolean; refreshRequired?: boolean };
      if (response.word) actions.acceptWord?.(response.word, { newlyAdded: response.added });
      if (response.source) actions.acceptVocabularySource?.(response.source);
      if (response.refreshRequired) {
        setMessage(t(lang, "词汇已保存，详情暂未加载，请刷新词表确认。不要重复添加。", "Word saved; details unavailable. Refresh your word list rather than adding again."));
        return;
      }
    }
    setSavedWord(term.trim());
    setTerm("");
    setDefinition("");
    setMergeId("");
    setMessage(
      t(lang, "词汇与原题上下文已保存", "Word and question context saved"),
    );
  }
  async function schedule() {
    if (!actions.client) {
      const planned = new Date(date + "T12:00:00Z");
      if (!Number.isFinite(planned.getTime()) || planned.toISOString().slice(0,10) !== date) throw new Error("Invalid date");
      const existing = data.tasks.find(task => task.review_attempt_id === review.id && task.question_id === q.id && task.status === "todo");
      if (!existing) {
        const week = startOfWeek(planned, "UTC");
        const used = data.tasks.filter(task => task.week_start === week && task.status !== "skipped").reduce((total,task)=>total+task.minutes,0);
        if (used + minutes > data.profile.weekly_hours * 60) throw new Error(t(lang,"这一周已达到学习时长预算，请改期或调整任务","Weekly budget reached; reschedule or adjust tasks"));
        await actions.upsert("study_tasks", "tasks", {
          id: crypto.randomUUID(), owner_id: data.profile.id, week_start: week, planned_date: date,
          skill: attempt.skill, title: "复盘 / Review: " + review.snapshot.title, minutes,
          status: "todo", source: "manual", rationale: "复盘作答与错因 / Review answers and error reasons",
          material_id: source?.id ?? null, review_attempt_id: review.id, question_id: q.id,
          created_at: new Date().toISOString(),
        });
      }
    } else {
      const response = await apiFetch(actions.client, "/api/reviews", {
      method: "POST",
      body: JSON.stringify({
        action: "schedule",
        id: review.id,
        questionId: q.id,
        date,
        minutes,
      }),
      }) as { task?: StudyTask; refreshRequired?: boolean };
      if (response.task) actions.acceptTask?.(response.task);
      if (response.refreshRequired) {
        setMessage(t(lang, "任务已保存，详情暂未加载，请到计划查看。", "Task saved; check Plan for its details."));
        return;
      }
    }
    setScheduleBaseline({ date, minutes });
    setMessage(
      t(
        lang,
        "已安排复盘任务，可从今日或计划回到此题",
        "Review scheduled. Return to this question from Today or Plan",
      ),
    );
  }
  async function replay() {
    if (!audioAvailable) return;
    const response = (await apiFetch(
      actions.client,
      `/api/files/url?materialId=${encodeURIComponent(review.snapshot.id)}`,
    )) as { url: string };
    setAudio(response.url);
  }
  const reasons = [
    ["locating", "没定位", "Locating"],
    ["paraphrase", "同义替换", "Paraphrase"],
    ["meaning", "词义", "Meaning"],
    ["spelling", "拼写", "Spelling"],
    ["word_limit", "字数限制", "Word limit"],
    ["unanswered", "漏答", "Unanswered"],
    ["other", "其他", "Other"],
  ];
  const scheduled = data.tasks.find(task => task.owner_id === data.profile.id && task.review_attempt_id === review.id && task.question_id === q.id && task.status === "todo");
  return (
    <article className="question-review" id={`review-${attempt.id}-${q.id}`}>
      <div className="card-top">
        <strong>
          {position}. {q.prompt}
        </strong>
        <span className="soft-tag">
          {!isGradableQuestion(q)
            ? t(lang, "不自动判分", "Not automatically scored")
            : isCorrectAnswer(q, attempt.answer_body?.[q.id] ?? "")
            ? t(lang, "正确", "Correct")
            : t(lang, "待复盘", "Review")}
          {review.flagged.includes(q.id)
            ? t(lang, " · 已标记", " · Flagged")
            : ""}
        </span>
      </div>
      <p>
        {q.explanation ||
          t(lang, "这道题尚未填写解析", "No explanation supplied")}
      </p>
      {q.word_limit && (
        <p className="muted small">
          {t(lang, `词数上限：${q.word_limit}`, `Word limit: ${q.word_limit}`)}
        </p>
      )}
      {context ? (
        <blockquote className="evidence-quote">
          <span>
            {t(lang, "原文证据", "Source evidence")}
            {q.evidence?.paragraph ? ` · ${q.evidence.paragraph}` : ""}
          </span>
          {context}
        </blockquote>
      ) : (
        <p className="muted small">
          {t(
            lang,
            "未标注可核对的原文证据，可在下面展开原文自行定位。",
            "No verified evidence annotation. Expand the original below to locate it.",
          )}
        </p>
      )}
      <details>
        <summary>
          {t(lang, "查看当时的原文 / 文字稿", "Original passage / transcript")}
        </summary>
        {savedWord && <p role="status">✓ {savedWord} · {t(lang,"已关联此题原文证据","Linked to this question's evidence")} <button className="text-link" onClick={()=> (actions.openVocabularyReview ?? (()=>actions.setView("vocabulary")))()}>{t(lang,"查看词卡","View word cards")}</button></p>}
        <div className="snapshot-original">
          {(review.snapshot.skill === "reading"
            ? review.snapshot.passage
            : review.snapshot.transcript
          )
            .split("\n")
            .map((p, i) => (
              <p key={i}>
                {context && p.includes(context) ? (
                  <>
                    {p.slice(0, p.indexOf(context))}
                    <mark>{context}</mark>
                    {p.slice(p.indexOf(context) + context.length)}
                  </>
                ) : (
                  p
                )}
              </p>
            ))}
        </div>
      </details>
      {review.snapshot.skill === "listening" &&
        q.evidence?.start !== undefined &&
        q.evidence.end !== undefined && (
          <div>
            {audioAvailable ? (
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => void run(replay)}
              >
                {t(lang, "回放证据片段", "Replay evidence segment")}
              </button>
            ) : (
              <p className="muted small">
                {t(
                  lang,
                  "原音频已更换或无访问权限，保留文字证据。",
                  "Original audio changed or is inaccessible; text evidence is retained.",
                )}
              </p>
            )}
            {audio && (
              <EvidenceAudio
                key={audio}
                src={audio}
                start={q.evidence.start}
                end={q.evidence.end}
                lang={lang}
              />
            )}
          </div>
        )}
      <dl className="review-answers">
        <div>
          <dt>{t(lang, "你的答案", "Your answer")}</dt>
          <dd>
            {attempt.answer_body?.[q.id] || t(lang, "未作答", "Unanswered")}
          </dd>
        </div>
        <div>
          <dt>{t(lang, "可接受答案", "Accepted answers")}</dt>
          <dd>{q.answers.join(" / ") || t(lang,"尚无参考答案，请先核对原题证据","No reference answer yet; check the source evidence")}</dd>
        </div>
      </dl>

      <div className="form-grid review-note">
        <label>
          {t(lang, "我认为的错因", "My error reason")}
          <select
            disabled={busy}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">{t(lang, "暂不判断", "Undecided")}</option>
            {reasons.map(([value, zh, en]) => (
              <option key={value} value={value}>
                {t(lang, zh, en)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t(lang, "复盘备注", "Review note")}
          <textarea
            disabled={busy}
            maxLength={2000}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="button-row">
        <button
          className="button secondary small"
          disabled={busy || !dirty || !!conflict}
          onClick={() => void run(() => saveNote())}
        >
          {t(lang, "保存错因与备注", "Save reason & note")}
        </button>
        {dirty && (
          <span className="warning-pill">
            {t(lang, "备注未保存", "Unsaved note")}
          </span>
        )}
        <button
          className="text-link"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await actions.refresh();
              setMessage(
                t(
                  lang,
                  "已加载云端；当前输入保留，可再次保存。",
                  "Cloud loaded. Current input retained; save again.",
                ),
              );
            })
          }
        >
          {t(lang, "刷新云端版本", "Refresh cloud version")}
        </button>
      </div>
      {conflict && <section className="inline-conflict" role="alert">
        <strong>{t(lang, "另一页面已修改这道题，当前输入已保留", "This question changed elsewhere. Your input is retained")}</strong>
        <p>{t(lang, "最新备注", "Latest note")}: {conflict.notes[q.id]?.note || t(lang, "空", "Empty")}</p>
        <p>{t(lang, "最新错因", "Latest reason")}: {conflict.notes[q.id]?.reason || "—"}</p>
        <div className="button-row">
          <button className="button secondary" disabled={busy} onClick={() => {
            const latest = conflict.notes[q.id] ?? { reason: "", note: "" };
            setReason(latest.reason); setNote(latest.note); setBaseline(latest);
            actions.acceptReview?.(conflict); setConflict(null);
          }}>{t(lang, "采用最新内容", "Use latest content")}</button>
          <button className="button primary" disabled={busy} onClick={() => {
            if (window.confirm(t(lang, "确认用当前输入替换这道题的最新备注？", "Replace the latest note for this question with your input?"))) void run(() => saveNote(conflict.version));
          }}>{t(lang, "保留我的输入并保存", "Save my input")}</button>
        </div>
      </section>}
      <details className="review-next">
        <summary>
          {t(lang, "下一步：词汇与复习", "Next: vocabulary & review")}
        </summary>
        {scheduled && <p role="status">{t(lang, "✓ 已安排复习", "✓ Review scheduled")} · {scheduled.planned_date} <button className="text-link" onClick={() => actions.setView("plan")}>{t(lang, "查看计划或改期", "View Plan or reschedule")}</button></p>}
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(addWord);
          }}
        >
          <div className="form-grid">
            <label>
              {t(lang, "加入词表", "Add a word")}
              <input
                required
                maxLength={160}
                disabled={busy}
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setMergeId("");
                }}
                placeholder={t(
                  lang,
                  "输入需要复习的词或短语",
                  "Word or phrase to review",
                )}
              />
            </label>
            <label>
              {t(lang, "释义", "Meaning")}
              <input
                required
                disabled={busy}
                maxLength={2000}
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
              />
            </label>
          </div>
          {duplicates.length > 0 && (
            <label>
              {t(
                lang,
                "重复词：选择合并词条",
                "Duplicate: choose entry to merge",
              )}
              <select
                required
                value={mergeId}
                onChange={(e) => setMergeId(e.target.value)}
              >
                <option value="">{t(lang, "请选择", "Choose entry")}</option>
                {duplicates.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.term} — {w.definition}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="muted small">
            {t(
              lang,
              "保存原题和证据上下文，不修改既有词汇的熟悉度。",
              "Keep the original question and evidence context without changing familiarity.",
            )}
          </p>
          <button
            type="submit"
            className="button secondary small"
            disabled={busy}
          >
            {t(lang, "保存到词表", "Save to vocabulary")}
          </button>
        </form>
        {source && (
          <div className="button-row">
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => actions.openPractice(source.id, source.skill)}
            >
              {t(lang, "重练当前题组", "Practise this set again")}
            </button>
            <small className="muted">
              {t(
                lang,
                "重练使用当前资料版本；已有答题会话会继续保留。",
                "Retry uses the current material version and retains any active answer session.",
              )}
            </small>
          </div>
        )}
        <div className="inline-form review-schedule">
          <label>
            {t(lang, "复盘日期", "Review date")}
            <input
              type="date"
              value={date}
              disabled={busy}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            {t(lang, "分钟", "Minutes")}
            <input
              type="number"
              min={5}
              max={60}
              disabled={busy}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
          <button
            className="button secondary small"
            disabled={busy || !date || !!scheduled}
            onClick={() => void run(schedule)}
          >
            {t(lang, "安排此题复盘", "Schedule this question")}
          </button>
        </div>
      </details>
      {message && <InlineMessage error={messageError}>{message}</InlineMessage>}
    </article>
  );
}
function EvidenceAudio({
  src,
  start,
  end,
  lang,
}: {
  src: string;
  start: number;
  end: number;
  lang: "zh" | "en";
}) {
  const [valid, setValid] = useState<boolean | null>(null);
  return (
    <>
      {valid === false && (
        <p role="status">
          {t(
            lang,
            "时间戳超出原音频范围，已禁用片段回放。",
            "Timestamp outside audio duration; segment replay disabled.",
          )}
        </p>
      )}
      <audio
        controls
        src={src}
        className="audio-player"
        onLoadedMetadata={(e) => {
          const a = e.currentTarget,
            ok =
              Number.isFinite(start) &&
              Number.isFinite(end) &&
              start >= 0 &&
              end > start &&
              end <= a.duration;
          setValid(ok);
          if (ok) a.currentTime = start;
        }}
        onPlay={(e) => {
          if (!valid) e.currentTarget.pause();
          else if (
            e.currentTarget.currentTime < start ||
            e.currentTarget.currentTime >= end
          )
            e.currentTarget.currentTime = start;
        }}
        onTimeUpdate={(e) => {
          if (valid && e.currentTarget.currentTime >= end)
            e.currentTarget.pause();
        }}
      />
    </>
  );
}
