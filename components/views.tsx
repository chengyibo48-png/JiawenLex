"use client";
import { canonicalAttachmentMime } from "@/lib/file-mime";

import { AdminActivity } from "./admin-activity";
import { VocabularyCollections } from "./vocabulary-collections";
import { APP_VERSION } from "@/lib/release";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileAudio,
  FileText,
  LibraryBig,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { apiFetch, demoMode } from "@/lib/supabase";
import {
  daysUntil,
  dueWords,
  generateWeeklyTasks,
  groupAttemptHistory,
  localDate,
  skillLabels,
  skills,
  startOfWeek,
} from "@/lib/study";
import type {
  Attempt,
  Language,
  Material,
  Member,
  Profile,
  Question,
  ShareComment,
  ShareGrant,
  Skill,
  StudyTask,
  View,
  VocabularyWord,
  WorkspaceData,
  WritingDraft,
} from "@/lib/types";
import { t } from "./workspace";
import {
  MaterialOrganizationEditor,
  MicroQuestionFields,
  MaterialGroups,
  MaterialHistory,
  materialPath,
  materialIssues,
} from "./material-organization";
import { materialUnit } from "@/lib/micro-training";
import { SpellingPractice } from "./spelling-practice";
import { AttemptReviewPanel } from "./attempt-review";
import { LearningInsights } from "./learning-insights";
import { MaterialAnnotations, annotationError } from "./material-annotations";
import { normalizeTerm, kindLabel } from "@/lib/review";
import { Modal } from "./modal";
import { mergeProfileDraft } from "@/lib/profile-draft";
import type { ServiceStatus } from "@/lib/service-status";
import { clearUserDrafts } from "@/lib/offline-drafts";
import { AiSettings } from "./ai-settings";
import { SourceLibraryPanel } from "./source-library";
import { QuestionCorrections } from "./question-corrections";

export interface ViewActions {
  microTarget?: { topic?: string; unitKey?: string; requestId: string } | null;
  openMicroTraining: (topic?: string, unitKey?: string) => void;
  clearMicroTarget: () => void;
  acceptMicroDraft: (draft: WritingDraft) => void;
  client: SupabaseClient | null;
  sessions: import("./use-practice-sessions").PracticeSessionManager;
  upsert: <K extends keyof WorkspaceData, R extends { id: string }>(
    table: string,
    key: K,
    row: R,
  ) => Promise<void>;
  remove: <K extends keyof WorkspaceData>(
    table: string,
    key: K,
    id: string,
  ) => Promise<void>;
  updateProfile: (profile: Profile) => Promise<void>;
  replacePlan: (tasks: StudyTask[]) => Promise<void>;
  notify: (message: string) => void;
  refresh: () => Promise<void>;
  reviewTarget?: { attemptId: string; questionId?: string } | null;
  openReview: (attemptId: string, questionId?: string) => void;
  clearReviewTarget: () => void;
  openPractice: (materialId?: string | null, skill?: Skill) => void;
  setView: (view: View) => void;
  registerPracticeGuard: (
    guard: ((reason?: "navigate" | "logout") => Promise<boolean>) | null,
    materialId?: string | null,
  ) => void;
  acceptDraft: (draft: WritingDraft) => void;
  acceptWord?: (word: VocabularyWord) => void;
  acceptTask?: (task: StudyTask) => void;
}

type Props = { data: WorkspaceData; actions: ViewActions };

function heading(lang: Language, zh: string, en: string, description?: string) {
  return (
    <div className="section-heading">
      <div>
        <h2>{t(lang, zh, en)}</h2>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}

function SkillTag({
  skill,
  lang,
}: {
  skill: Skill | "vocabulary";
  lang: Language;
}) {
  return (
    <span className={`skill-tag skill-${skill}`}>
      {t(lang, skillLabels[skill].zh, skillLabels[skill].en)}
    </span>
  );
}

export { TodayView } from "./today-view";

export function VocabularyView(props: Props) {
  return <VocabularyCollections {...props} manager={(data,actions) => <VocabularyManagerView data={data} actions={actions}/>} />;
}

function VocabularyManagerView({ data, actions }: Props) {
  const lang = data.profile.language;
  const [term, setTerm] = useState("");
  const [definition, setDefinition] = useState("");
  const [example, setExample] = useState("");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [wordTags, setWordTags] = useState("");
  const [wordBusy, setWordBusy] = useState(false);
  const wordLock = useRef(false);
  const [wordPage, setWordPage] = useState(1);
  useEffect(() => setWordPage(1), [search, tagFilter]);
  const wordScope = useMemo(() => data.words.filter(
    (word) => !tagFilter || word.tags.includes(tagFilter),
  ), [data.words, tagFilter]);
  const tags = useMemo(() => [...new Set(data.words.flatMap((word) => word.tags))].sort(), [data.words]);
  const due = dueWords(wordScope);
  const filtered = useMemo(() => wordScope
    .filter((word) =>
      (word.term + word.definition)
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) => a.term.localeCompare(b.term)), [wordScope, search]);
  const currentWordPage = Math.min(wordPage, Math.max(1, Math.ceil(filtered.length / 50)));

  async function addWord(event: React.FormEvent) {
    event.preventDefault();
    if (!term.trim() || !definition.trim() || wordLock.current) return;
    const duplicate = data.words.find(
      (word) => normalizeTerm(word.term) === normalizeTerm(term) && word.definition.trim() === definition.trim(),
    );
    if (duplicate) {
      actions.notify(
        t(
          lang,
          "词表已有同名词，请在搜索中查看已有词条。",
          "This word already exists. Find its entry using search.",
        ),
      );
      setSearch(duplicate.term);
      return;
    }
    wordLock.current = true;
    setWordBusy(true);
    try {
      const word: VocabularyWord = {
        id: crypto.randomUUID(),
        owner_id: data.profile.id,
        term: term.trim().replace(/\s+/g, " "),
        definition: definition.trim(),
        example: example.trim(),
        tags: [
          ...new Set(
            wordTags
              .split(/[,，]/)
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        ],
        due_at: new Date().toISOString(),
        interval_days: 0,
        streak: 0,
        last_reviewed_at: null,
        created_at: new Date().toISOString(),
      };
      await actions.upsert("vocabulary", "words", word);
      setTerm("");
      setDefinition("");
      setExample("");
      setWordTags("");
      actions.notify(t(lang, "已加入词表", "Word added"));
    } catch {
      /* Workspace displays errors. */
    } finally {
      wordLock.current = false;
      setWordBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            {t(lang, "SPACED REVIEW", "SPACED REVIEW")}
          </span>
          <h2>{t(lang, "词汇复习", "Vocabulary")}</h2>
          <p>
            {t(
              lang,
              "认识的词逐步拉长间隔；忘记的词明天再见。",
              "Known words get a longer interval. Forgotten words return tomorrow.",
            )}
          </p>
        </div>
        <div className="metric-badge">
          <strong>{due.length}</strong>
          <span>{t(lang, "今日待复习", "due today")}</span>
        </div>
      </div>
      <label className="vocabulary-filter">
        {t(lang, "场景 / 标签", "Scene / tag")}
        <select
          value={tagFilter}
          onChange={(event) => {
            setTagFilter(event.target.value);
          }}
        >
          <option value="">{t(lang, "全部词汇", "All words")}</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </label>
      <div className="two-column">
        <section className="card">
          <h3>{t(lang, "加入新词", "Add a word")}</h3>
          <form
            className="form-stack"
            onSubmit={(event) => void addWord(event)}
          >
            <label>
              {t(lang, "单词或短语", "Word or phrase")}
              <input
                required
                maxLength={160}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="e.g. coherent"
              />
            </label>
            <label>
              {t(lang, "释义", "Meaning")}
              <input
                required
                value={definition}
                onChange={(event) => setDefinition(event.target.value)}
              />
            </label>
            <label>
              {t(lang, "例句（可选）", "Example (optional)")}
              <input
                value={example}
                onChange={(event) => setExample(event.target.value)}
              />
            </label>
            <label>
              {t(
                lang,
                "场景 / 标签（逗号分隔）",
                "Scene / tags (comma separated)",
              )}
              <input
                value={wordTags}
                onChange={(event) => setWordTags(event.target.value)}
              />
            </label>
            <button
              className="button primary"
              disabled={wordBusy}
              type="submit"
            >
              <Plus size={16} />
              {t(lang, "加入词表", "Add to list")}
            </button>
          </form>
        </section>
      </div>
      <SpellingPractice words={filtered} data={data} actions={actions} />
      <section className="card">
        <div className="card-top">
          <div>
            <h3>{t(lang, "我的词表", "My words")}</h3>
            <p className="muted small">
              {data.words.length} {t(lang, "个词", "words")}
            </p>
          </div>
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label={t(lang, "搜索词汇", "Search words")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t(lang, "搜索词汇", "Search words")}
            />
          </div>
        </div>
        {filtered.length ? (
          <div className="word-list">
            {filtered.slice((currentWordPage - 1) * 50, currentWordPage * 50).map((word) => (
              <div className="word-row" key={word.id}>
                <div>
                  <strong>{word.term}</strong>
                  <span>{word.definition}</span>
                  {word.tags.length > 0 && (
                    <small>{word.tags.join(" · ")}</small>
                  )}
                  {data.vocabularySources?.some(
                    (source) => source.word_id === word.id,
                  ) && (
                    <details className="word-context">
                      <summary>
                        {t(lang, "原题上下文", "Question context")}
                      </summary>
                      {data.vocabularySources
                        .filter((source) => source.word_id === word.id)
                        .map((source) => (
                          <div key={source.id}>
                            <p>{source.context}</p>
                            <button
                              className="text-link"
                              onClick={() =>
                                actions.openReview(
                                  source.attempt_id,
                                  source.question_id,
                                )
                              }
                            >
                              {t(
                                lang,
                                "返回原题复盘",
                                "Review original question",
                              )}
                            </button>
                          </div>
                        ))}
                    </details>
                  )}
                </div>
                <small>
                  {new Date(word.due_at).toLocaleDateString(
                    lang === "zh" ? "zh-CN" : "en-US",
                  )}
                </small>
                <button
                  className="icon-button subtle"
                  title={t(lang, "删除", "Delete")}
                  onClick={() =>
                    void actions
                      .remove("vocabulary", "words", word.id)
                      .catch(() => undefined)
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-text">
            {t(lang, "还没有匹配的词汇。", "No matching words yet.")}
          </p>
        )}
        {filtered.length > 50 && <div className="button-row">
          <button className="button secondary" disabled={currentWordPage === 1} onClick={() => setWordPage(currentWordPage - 1)}>{t(lang,"上一页","Previous")}</button>
          <span>{currentWordPage} / {Math.ceil(filtered.length / 50)} · {filtered.length} {t(lang,"个词","words")}</span>
          <button className="button secondary" disabled={currentWordPage * 50 >= filtered.length} onClick={() => setWordPage(currentWordPage + 1)}>{t(lang,"下一页","Next")}</button>
        </div>}
      </section>
    </div>
  );
}

export function PlanView({ data, actions }: Props) {
  const lang = data.profile.language;
  const week = startOfWeek(new Date(), data.profile.timezone);
  const current = data.tasks
    .filter((task) => task.owner_id === data.profile.id && task.week_start === week)
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date));
  const [title, setTitle] = useState("");
  const [skill, setSkill] = useState<Skill | "vocabulary">("reading");
  const [minutes, setMinutes] = useState(30);
  const [plannedDate, setPlannedDate] = useState(localDate(new Date(), data.profile.timezone));
  const [planBusy, setPlanBusy] = useState(false);
  const [savingTask, setSavingTask] = useState<string | null>(null);
  const taskLock = useRef(false);

  async function updateTask(task: StudyTask, patch: Partial<StudyTask>) {
    if (taskLock.current || task.status === "done") return;
    taskLock.current = true;
    setSavingTask(task.id);
    try {
      if (actions.client) {
        const result = await actions.client.from("study_tasks").update(patch).eq("id", task.id).eq("owner_id", data.profile.id).eq("status", task.status).eq("planned_date", task.planned_date).select("*");
        if (result.error) throw result.error;
        if (result.data?.[0] && actions.acceptTask) actions.acceptTask(result.data[0] as StudyTask);
        else {
          await actions.refresh();
          if (!result.data?.length) actions.notify(t(lang, "任务已在其他页面变化，请查看最新状态。", "This task changed elsewhere. Check its latest status."));
        }
      } else await actions.upsert("study_tasks", "tasks", { ...task, ...patch });
    } catch (error) { actions.notify(error instanceof Error ? error.message : t(lang, "任务未保存，请重试。", "Task was not saved. Retry.")); }
    finally { taskLock.current = false; setSavingTask(null); }
  }

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || taskLock.current || planBusy) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate) || !Number.isFinite(new Date(plannedDate + "T12:00:00").getTime()) || !Number.isInteger(minutes) || minutes < 10 || minutes > 300) {
      actions.notify(t(lang, "请填写有效日期和 10–300 的整数分钟数。", "Enter a valid date and a whole number of minutes from 10 to 300."));
      return;
    }
    taskLock.current = true;
    setSavingTask("new");
    const task: StudyTask = {
      id: crypto.randomUUID(),
      owner_id: data.profile.id,
      week_start: startOfWeek(new Date(plannedDate + "T12:00:00")),
      planned_date: plannedDate,
      skill,
      title: title.trim(),
      minutes,
      status: "todo",
      source: "manual",
      rationale: t(lang, "手动添加", "Added manually"),
      material_id: null,
      created_at: new Date().toISOString(),
    };
    try {
      await actions.upsert("study_tasks", "tasks", task);
      setTitle((current) => current.trim() === task.title ? "" : current);
    } catch {
      /* Workspace displays errors. */
    } finally { taskLock.current = false; setSavingTask(null); }
  }

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <span className="eyebrow">WEEKLY PLAN</span>
          <h2>{t(lang, "这一周，稳步向前", "Your week at a glance")}</h2>
          <p>
            {t(
              lang,
              `按每周 ${data.profile.weekly_hours} 小时的目标安排。你可以随时调整。`,
              `Built around ${data.profile.weekly_hours} study hours per week. Adjust at any time.`,
            )}
          </p>
        </div>
        <button
          className="button secondary"
          disabled={planBusy || !!savingTask}
          onClick={() => {
            setPlanBusy(true);
            void actions
              .replacePlan(
                generateWeeklyTasks(
                  data.profile,
                  data.attempts.filter(
                    (attempt) => attempt.owner_id === data.profile.id,
                  ),
                  data.tasks,
                ),
              )
              .finally(() => setPlanBusy(false));
          }}
        >
          <Sparkles size={16} />
          {t(lang, "按当前表现重新安排", "Rebalance this week")}
        </button>
      </div>
      <section className="card">
        <div className="card-top">
          <h3>{t(lang, "本周任务", "This week's tasks")}</h3>
          <span className="muted small">
            {current.reduce((sum, task) => sum + (task.status === "skipped" ? 0 : task.minutes), 0)} min
          </span>
        </div>
        {current.length ? (
          <div className="plan-list">
            {current.map((task) => (
              <div className="plan-row" key={task.id}>
                <div className={`plan-status ${task.status}`}>
                  {task.status === "done" ? (
                    <Check size={16} />
                  ) : task.status === "skipped" ? (
                    <X size={16} />
                  ) : (
                    <Clock3 size={16} />
                  )}
                </div>
                <div className="plan-copy">
                  <div>
                    <SkillTag skill={task.skill} lang={lang} />
                    <span className="muted small">{task.minutes} min</span>
                  </div>
                  <strong>{task.title}</strong>
                  <small>{task.rationale}</small>
                </div>
                <div className="plan-controls">
                  <input
                    type="date"
                    aria-label={t(lang, "调整日期", "Reschedule")}
                    value={task.planned_date}
                    disabled={task.status === "done" || !!savingTask || planBusy}
                    onChange={(event) => {
                      if (event.target.value) void updateTask(task, { planned_date: event.target.value, week_start: startOfWeek(new Date(event.target.value + "T12:00:00")) });
                    }}
                  />
                  <select
                    aria-label={t(lang, "任务状态", "Task status")}
                    value={task.status}
                    disabled={task.status === "done" || !!savingTask || planBusy}
                    onChange={(event) => void updateTask(task, { status: event.target.value as StudyTask["status"] })}
                  >
                    <option value="todo">{t(lang, "待完成", "To do")}</option>
                    <option value="done">{t(lang, "完成", "Done")}</option>
                    <option value="skipped">{t(lang, "跳过", "Skip")}</option>
                  </select>
                  {task.status === "todo" && (
                    <button
                      className="icon-button subtle"
                      title={t(lang, "开始", "Start")}
                      onClick={() =>
                        task.question_id && !task.review_attempt_id
                          ? actions.notify(
                              t(
                                lang,
                                "原练习已删除，无法继续此题复盘。",
                                "Original attempt deleted; this review is unavailable.",
                              ),
                            )
                          : task.review_attempt_id
                            ? actions.openReview(
                                task.review_attempt_id,
                                task.question_id ?? undefined,
                              )
                            : task.skill === "vocabulary"
                              ? actions.setView("vocabulary")
                              : actions.openPractice(
                                  task.material_id,
                                  task.skill,
                                )
                      }
                    >
                      <ArrowRight size={18} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-inline">
            <CalendarDays size={26} />
            <strong>
              {t(lang, "还没有本周计划", "No plan for this week")}
            </strong>
            <p>
              {t(
                lang,
                "点击“按当前表现重新安排”生成任务。",
                "Use Rebalance to generate your tasks.",
              )}
            </p>
          </div>
        )}
      </section>
      <section className="card">
        <h3>{t(lang, "添加自己的任务", "Add your own task")}</h3>
        <form className="inline-form" onSubmit={(event) => void addTask(event)}>
          <label>
            {t(lang, "任务", "Task")}
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t(
                lang,
                "例如：精读一篇文章",
                "e.g. Read one article closely",
              )}
            />
          </label>
          <label>
            {t(lang, "科目", "Skill")}
            <select
              value={skill}
              onChange={(event) => setSkill(event.target.value as typeof skill)}
            >
              {Object.entries(skillLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {t(lang, label.zh, label.en)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(lang, "分钟", "Minutes")}
            <input
              type="number"
              min="10"
              max="300"
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
          <label>
            {t(lang, "日期", "Date")}
            <input
              type="date"
              required
              value={plannedDate}
              onChange={(event) => setPlannedDate(event.target.value)}
            />
          </label>
          <button className="button primary" type="submit" disabled={!!savingTask || planBusy}>
            <Plus size={16} />
            {t(lang, "添加", "Add")}
          </button>
        </form>
      </section>
    </div>
  );
}

export function LibraryView({ data, actions }: Props) {
  const lang = data.profile.language;
  const [libraryTab, setLibraryTab] = useState<"practice" | "originals" | "review" | "corrections">("practice");
  const [search, setSearch] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [collection, setCollection] = useState("");
  const [skillFilter, setSkillFilter] = useState<Skill | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newMaterial, setNewMaterial] = useState<Partial<Material>>({
    skill: "reading",
    track: "academic",
    visibility: "private",
    questions: [],
    tags: [],
  });
  const [file, setFile] = useState<File | null>(null);
  const [materialBusy, setMaterialBusy] = useState(false);
  const materialLock = useRef(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [comment, setComment] = useState("");
  const [materialPage, setMaterialPage] = useState(1);
  useEffect(() => setMaterialPage(1), [search, collection, skillFilter]);
  const filtered = useMemo(() => data.materials
    .filter(
      (material) =>
        (!collection || material.collection_title === collection) &&
        (skillFilter === "all" || material.skill === skillFilter) &&
        [
          material.title,
          materialPath(material),
          material.prompt,
          material.question_type,
          material.tags.join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at)), [data.materials, collection, skillFilter, search]);
  const currentMaterialPage = Math.min(materialPage, Math.max(1, Math.ceil(filtered.length / 50)));
  const materialPageRows = filtered.slice((currentMaterialPage - 1) * 50, currentMaterialPage * 50);
  const selected =
    data.materials.find((material) => material.id === selectedId) ?? null;
  const threads = selected
    ? data.shares.filter(
        (row) =>
          row.target_type === "material" &&
          row.target_id === selected.id &&
          !row.revoked_at &&
          (row.owner_id === data.profile.id ||
            row.recipient_id === data.profile.id),
      )
    : [];
  const share = threads.find((row) => row.id === threadId) ?? threads[0];
  const relevantComments = share
    ? data.comments
        .filter((row) => row.share_id === share.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    : [];
  const otherMembers = data.members.filter(
    (member) => member.id !== data.profile.id,
  );

  function update<K extends keyof Material>(key: K, value: Material[K]) {
    setNewMaterial((previous) => ({ ...previous, [key]: value }));
  }

  async function saveMaterial(event: React.FormEvent) {
    event.preventDefault();
    if (
      !newMaterial.title?.trim() ||
      !newMaterial.prompt?.trim() ||
      materialLock.current
    )
      return;
    const questions = (newMaterial.questions ?? [])
      .filter((question) => question.prompt.trim())
      .map((question) => ({
        ...question,
        choices: question.choices?.map((v) => v.trim()).filter(Boolean),
        checklist: question.checklist?.map((v) => v.trim()).filter(Boolean),
        answers: question.answers
          .map((answer) => answer.trim())
          .filter(Boolean),
      }));
    if (
      newMaterial.visibility === "shared" &&
      (!newMaterial.source_title?.trim() || !newMaterial.license_name?.trim())
    ) {
      actions.notify(
        t(
          lang,
          "共享资料必须填写来源与许可",
          "Shared material needs a source and licence",
        ),
      );
      return;
    }
    if (
      (newMaterial.set_title?.trim() &&
        !newMaterial.collection_title?.trim()) ||
      (newMaterial.part_title?.trim() && !newMaterial.set_title?.trim())
    ) {
      actions.notify(
        t(
          lang,
          "请补齐合集与题组归属",
          "Complete collection and set hierarchy",
        ),
      );
      return;
    }
    if (
      newMaterial.training_kind &&
      newMaterial.training_kind !== "none" &&
      !materialUnit({ ...newMaterial, questions } as Material)
    ) {
      actions.notify(
        t(
          lang,
          "微训练需要完整内容、来源许可和完成标准",
          "Complete micro training content, permission and criteria",
        ),
      );
      return;
    }
    const evidenceError = annotationError(newMaterial);
    if (evidenceError) {
      actions.notify(evidenceError);
      return;
    }
    materialLock.current = true;
    setMaterialBusy(true);
    const id = newMaterial.id ?? crypto.randomUUID();
    let filePath: string | null = newMaterial.file_path ?? null;
    let uploadedPath: string | null = null;
    try {
      if (file && actions.client) {
        if (file.size > 25 * 1024 * 1024) {
          actions.notify(
            t(lang, "附件不能超过 25 MB", "Files must be under 25 MB"),
          );
          return;
        }
        filePath = `${data.profile.id}/${id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
        const { error } = await actions.client.storage
          .from("study-files")
          .upload(filePath, file, { upsert: false, contentType: canonicalAttachmentMime(file.type, file.name) || undefined });
        if (!error) uploadedPath = filePath;
        if (error) {
          actions.notify(error.message);
          return;
        }
      }
      const material: Material = {
        id,
        owner_id: data.profile.id,
        visibility: newMaterial.visibility ?? "private",
        approval: newMaterial.visibility === "shared" ? "pending" : "approved",
        title: newMaterial.title.trim(),
        skill: newMaterial.skill ?? "reading",
        track: newMaterial.track ?? data.profile.track,
        question_type: newMaterial.question_type?.trim() ?? "",
        prompt: newMaterial.prompt.trim(),
        passage: newMaterial.passage?.trim() ?? "",
        transcript: newMaterial.transcript?.trim() ?? "",
        revision: newMaterial.revision ?? 0,
        collection_title: newMaterial.collection_title?.trim() ?? "",
        set_title: newMaterial.set_title?.trim() ?? "",
        part_title: newMaterial.part_title?.trim() ?? "",
        sort_order: newMaterial.sort_order ?? 0,
        training_kind: newMaterial.training_kind ?? "none",
        training_minutes: newMaterial.training_minutes ?? 5,
        training_topics: newMaterial.training_topics ?? [],
        questions,
        audio_segments: newMaterial.audio_segments ?? [],
        tags: [
          ...new Set(
            (newMaterial.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
          ),
        ],
        source_title: newMaterial.source_title?.trim() ?? "",
        source_url: newMaterial.source_url?.trim() ?? "",
        license_name: newMaterial.license_name?.trim() ?? "",
        file_path: filePath,
        file_name: file?.name ?? newMaterial.file_name ?? null,
        file_kind: file ? canonicalAttachmentMime(file.type, file.name) : newMaterial.file_kind ?? null,
        created_at: newMaterial.created_at ?? new Date().toISOString(),
      };
      await actions.upsert("materials", "materials", material);
      setCreating(false);
      setNewMaterial({
        skill: "reading",
        track: "academic",
        visibility: "private",
        questions: [],
        tags: [],
      });
      setFile(null);
      setSelectedId(id);
      actions.notify(
        material.visibility === "shared"
          ? t(lang, "已提交管理员审核", "Submitted for review")
          : t(lang, "资料已保存", "Material saved"),
      );
    } catch {
      if (uploadedPath && actions.client)
        await actions.client.storage.from("study-files").remove([uploadedPath]);
    } finally {
      materialLock.current = false;
      setMaterialBusy(false);
    }
  }

  async function openFile(material: Material) {
    if (!material.file_path) return;
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      actions.notify(
        t(
          lang,
          "请允许本站弹出窗口后重试。",
          "Allow popups for this site and retry.",
        ),
      );
      return;
    }
    tab.opener = null;
    try {
      const result = (await apiFetch(
        actions.client,
        `/api/files/url?materialId=${encodeURIComponent(material.id)}`,
      )) as { url: string };
      tab.location.replace(result.url);
    } catch (error) {
      tab.close();
      actions.notify(error instanceof Error ? error.message : "文件打开失败");
    }
  }

  async function addShare() {
    try {
      if (!selected || !recipient) return;
      if (
        data.shares.some(
          (row) =>
            row.target_id === selected.id &&
            row.recipient_id === recipient &&
            !row.revoked_at,
        )
      ) {
        actions.notify(
          t(lang, "已经分享给该伙伴。", "Already shared with this partner."),
        );
        return;
      }
      const grant: ShareGrant = {
        id: crypto.randomUUID(),
        owner_id: data.profile.id,
        recipient_id: recipient,
        target_type: "material",
        target_id: selected.id,
        revoked_at: null,
        created_at: new Date().toISOString(),
      };
      await actions.upsert("share_grants", "shares", grant);
      setRecipient("");
      actions.notify(t(lang, "已分享给学习伙伴", "Shared with your partner"));
    } catch {
      /* Workspace displays errors. */
    }
  }

  async function postComment() {
    try {
      if (!share || !comment.trim()) return;
      const row: ShareComment = {
        id: crypto.randomUUID(),
        share_id: share.id,
        author_id: data.profile.id,
        body: comment.trim(),
        created_at: new Date().toISOString(),
      };
      await actions.upsert("share_comments", "comments", row);
      setComment("");
    } catch {
      /* Workspace displays errors. */
    }
  }

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <span className="eyebrow">STUDY LIBRARY</span>
          <h2>{t(lang, "资料库", "Study library")}</h2>
          <p>
            {t(
              lang,
              "把有授权的资料整理成可练习的题组。",
              "Organise authorised materials into practice sets.",
            )}
          </p>
        </div>
        {libraryTab === "practice" && <button
          className="button primary"
          disabled={materialBusy}
          onClick={() => {
            setNewMaterial({
              skill: "reading",
              track: data.profile.track,
              visibility: "private",
              questions: [],
              tags: [],
            });
            setFile(null);
            setCreating(!creating);
            setSelectedId(null);
          }}
        >
          <Plus size={17} />
          {t(lang, "添加资料", "Add material")}
        </button>}
      </div>
      <div className="library-tabs" role="tablist" aria-label={t(lang, "资料库分类", "Library sections")}>
        {(["practice", "originals", "review", "corrections"] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={libraryTab === tab} className={`library-tab ${libraryTab === tab ? "active" : ""}`} onClick={() => { setLibraryTab(tab); setCreating(false); setSelectedId(null); }}>
          {tab === "practice" ? t(lang, "练习题库", "Practice bank") : tab === "originals" ? t(lang, "原始资料", "Original archive") : tab === "review" ? t(lang, "识别审核", "Recognition review") : t(lang, "题目纠错", "Question corrections")}
        </button>)}
      </div>
      {libraryTab === "originals" && <SourceLibraryPanel mode="originals" client={actions.client} lang={lang} notify={actions.notify} />}
      {libraryTab === "review" && <SourceLibraryPanel mode="review" isAdmin={data.profile.role === "admin"} client={actions.client} lang={lang} notify={actions.notify} />}
      {libraryTab === "corrections" && <QuestionCorrections client={actions.client} lang={lang} notify={actions.notify} />}
      {libraryTab === "practice" && creating && (
        <section className="card editor-card">
          <div className="card-top">
            <h3>
              {t(
                lang,
                newMaterial.id ? "编辑资料" : "新建资料",
                newMaterial.id ? "Edit material" : "New material",
              )}
            </h3>
            <button
              className="icon-button"
              disabled={materialBusy}
              aria-label={t(lang, "关闭编辑", "Close editor")}
              onClick={() => setCreating(false)}
            >
              <X size={18} />
            </button>
          </div>
          <form
            className="form-stack"
            onSubmit={(event) => void saveMaterial(event)}
          >
            <div className="form-grid">
              <label>
                {t(lang, "标题", "Title")}
                <input
                  required
                  maxLength={240}
                  value={newMaterial.title ?? ""}
                  onChange={(event) => update("title", event.target.value)}
                />
              </label>
              <label>
                {t(lang, "科目", "Skill")}
                <select
                  value={newMaterial.skill}
                  onChange={(event) =>
                    update("skill", event.target.value as Skill)
                  }
                >
                  {skills.map((skill) => (
                    <option value={skill} key={skill}>
                      {t(lang, skillLabels[skill].zh, skillLabels[skill].en)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t(lang, "考试类型", "Track")}
                <select
                  value={newMaterial.track}
                  onChange={(event) =>
                    update("track", event.target.value as Material["track"])
                  }
                >
                  <option value="academic">Academic</option>
                  <option value="general">General Training</option>
                </select>
              </label>
              <label>
                {t(lang, "可见范围", "Visibility")}
                <select
                  value={newMaterial.visibility}
                  onChange={(event) =>
                    update(
                      "visibility",
                      event.target.value as Material["visibility"],
                    )
                  }
                >
                  <option value="private">
                    {t(lang, "仅自己", "Private")}
                  </option>
                  <option value="shared">
                    {t(lang, "申请小组共享", "Request group sharing")}
                  </option>
                </select>
              </label>
            </div>
            <label>
              {t(lang, "练习说明或题目", "Instructions or prompt")}
              <textarea
                required
                rows={3}
                value={newMaterial.prompt ?? ""}
                onChange={(event) => update("prompt", event.target.value)}
              />
            </label>
            <MaterialOrganizationEditor
              material={newMaterial}
              lang={lang}
              onChange={update}
            />
            {(newMaterial.skill === "reading" ||
              newMaterial.skill === "listening" ||
              (newMaterial.training_kind &&
                newMaterial.training_kind !== "none")) && (
              <>
                <label>
                  {t(
                    lang,
                    newMaterial.skill === "reading" ? "阅读文章" : "听力文字稿",
                    newMaterial.skill === "reading"
                      ? "Reading passage"
                      : "Transcript",
                  )}
                  <textarea
                    rows={7}
                    value={
                      (newMaterial.skill === "reading"
                        ? newMaterial.passage
                        : newMaterial.transcript) ?? ""
                    }
                    onChange={(event) =>
                      update(
                        newMaterial.skill === "reading"
                          ? "passage"
                          : "transcript",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <div className="question-editor">
                  <div className="card-top">
                    <strong>
                      {t(lang, "题目与答案", "Questions and answers")}
                    </strong>
                    <button
                      type="button"
                      className="button small secondary"
                      onClick={() =>
                        update("questions", [
                          ...(newMaterial.questions ?? []),
                          {
                            id: crypto.randomUUID(),
                            type: "short",
                            prompt: "",
                            answers: [""],
                            explanation: "",
                          },
                        ])
                      }
                    >
                      <Plus size={15} />
                      {t(lang, "添加题目", "Add question")}
                    </button>
                  </div>
                  {(newMaterial.questions ?? []).map((question, index) => (
                    <div className="question-edit-row" key={question.id}>
                      <span className="question-number">{index + 1}</span>
                      <div className="form-stack">
                        <input
                          aria-label={t(lang, "题目", "Question")}
                          placeholder={t(lang, "题目", "Question")}
                          value={question.prompt}
                          onChange={(event) =>
                            update(
                              "questions",
                              (newMaterial.questions ?? []).map((item) =>
                                item.id === question.id
                                  ? { ...item, prompt: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                        <textarea
                          rows={2}
                          aria-label={t(lang, "正确答案", "Accepted answers")}
                          placeholder={t(
                            lang,
                            "每行一个可接受答案；尚未核实答案时留空并标记为不自动判分",
                            "One accepted answer per line; leave blank when the answer is not verified",
                          )}
                          value={question.answers.join("\n")}
                          onChange={(event) =>
                            update(
                              "questions",
                              (newMaterial.questions ?? []).map((item) =>
                                item.id === question.id
                                  ? {
                                      ...item,
                                      answers: event.target.value.split("\n"),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        <div className="form-grid">
                          <label>
                            {t(lang, "本题题型", "Question type")}
                            <input
                              value={question.type}
                              onChange={(event) =>
                                update(
                                  "questions",
                                  (newMaterial.questions ?? []).map((item) =>
                                    item.id === question.id
                                      ? { ...item, type: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                          <label>
                            {t(
                              lang,
                              "答案词数上限（可选）",
                              "Word limit (optional)",
                            )}
                            <input
                              type="number"
                              min="1"
                              max="30"
                              value={question.word_limit ?? ""}
                              onChange={(event) =>
                                update(
                                  "questions",
                                  (newMaterial.questions ?? []).map((item) =>
                                    item.id === question.id
                                      ? {
                                          ...item,
                                          word_limit: event.target.value
                                            ? Number(event.target.value)
                                            : undefined,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                        </div>
                        <input
                          aria-label={t(lang, "解析", "Explanation")}
                          placeholder={t(lang, "解析", "Explanation")}
                          value={question.explanation}
                          onChange={(event) =>
                            update(
                              "questions",
                              (newMaterial.questions ?? []).map((item) =>
                                item.id === question.id
                                  ? { ...item, explanation: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                        <MicroQuestionFields
                          material={newMaterial}
                          questionId={question.id}
                          lang={lang}
                          onChange={update}
                        />
                      </div>
                      <button
                        className="icon-button subtle"
                        aria-label={t(lang, "删除题目", "Delete question")}
                        type="button"
                        onClick={() =>
                          update(
                            "questions",
                            (newMaterial.questions ?? []).filter(
                              (item) => item.id !== question.id,
                            ),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {(newMaterial.skill === "reading" ||
              newMaterial.skill === "listening") && (
              <MaterialAnnotations
                material={newMaterial}
                lang={lang}
                onQuestions={(questions) => update("questions", questions)}
                onSegments={(segments) => update("audio_segments", segments)}
              />
            )}
            <div className="form-grid">
              <label>
                {t(lang, "题型", "Question type")}
                <input
                  value={newMaterial.question_type ?? ""}
                  onChange={(event) =>
                    update("question_type", event.target.value)
                  }
                  placeholder={t(
                    lang,
                    "例如：信息定位",
                    "e.g. matching information",
                  )}
                />
              </label>
              <label>
                {t(lang, "标签，逗号分隔", "Tags, separated by commas")}
                <input
                  value={(newMaterial.tags ?? []).join(",")}
                  onChange={(event) =>
                    update("tags", event.target.value.split(","))
                  }
                />
              </label>
              <label>
                {t(lang, "来源名称", "Source name")}
                <input
                  value={newMaterial.source_title ?? ""}
                  onChange={(event) =>
                    update("source_title", event.target.value)
                  }
                />
              </label>
              <label>
                {t(lang, "使用许可", "Licence or permission")}
                <input
                  value={newMaterial.license_name ?? ""}
                  onChange={(event) =>
                    update("license_name", event.target.value)
                  }
                  placeholder={t(
                    lang,
                    "例如：作者授权",
                    "e.g. author permission",
                  )}
                />
              </label>
              <label>
                {t(lang, "来源链接（可选）", "Source URL (optional)")}
                <input
                  type="url"
                  value={newMaterial.source_url ?? ""}
                  onChange={(event) => update("source_url", event.target.value)}
                />
              </label>
              <label>
                {t(lang, "附件（最大 25 MB）", "Attachment (max 25 MB)")}
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.mp3,.m4a,.wav,audio/*,image/*"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <button
              className="button primary"
              disabled={materialBusy}
              type="submit"
            >
              <Upload size={16} />
              {t(lang, "保存资料", "Save material")}
            </button>
          </form>
        </section>
      )}
      {libraryTab === "practice" && <section className="card">
        <div className="library-toolbar">
          <label>
            {t(lang, "合集", "Collection")}
            <select
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
            >
              <option value="">{t(lang, "全部合集", "All collections")}</option>
              {[
                ...new Set(
                  data.materials.map((m) => m.collection_title).filter(Boolean),
                ),
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <button
            className="button secondary small"
            aria-pressed={grouped}
            onClick={() => setGrouped(!grouped)}
          >
            {grouped
              ? t(lang, "切换列表", "Use list")
              : t(lang, "按合集浏览", "Browse collections")}
          </button>
          <div className="search-field">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t(
                lang,
                "搜索标题、题目或标签",
                "Search title, prompt or tags",
              )}
              aria-label={t(lang, "搜索资料", "Search materials")}
            />
          </div>
          <select
            value={skillFilter}
            aria-label={t(lang, "筛选科目", "Filter skill")}
            onChange={(event) =>
              setSkillFilter(event.target.value as typeof skillFilter)
            }
          >
            <option value="all">{t(lang, "全部科目", "All skills")}</option>
            {skills.map((skill) => (
              <option value={skill} key={skill}>
                {t(lang, skillLabels[skill].zh, skillLabels[skill].en)}
              </option>
            ))}
          </select>
        </div>
        {filtered.length ? (
          <div className="material-list">
            {grouped ? (
              <MaterialGroups
                materials={materialPageRows}
                lang={lang}
                render={(material) => (
                  <button
                    className={`material-row ${selectedId === material.id ? "selected" : ""}`}
                    key={material.id}
                    disabled={materialBusy}
                    onClick={() => {
                      setSelectedId(material.id);
                      setCreating(false);
                      setThreadId(null);
                      setComment("");
                    }}
                  >
                    <span className="material-icon">
                      {material.file_kind?.startsWith("audio") ? (
                        <FileAudio size={20} />
                      ) : (
                        <FileText size={20} />
                      )}
                    </span>
                    <span className="material-copy">
                      <strong>{material.title}</strong>
                      <small>
                        {material.question_type ||
                          skillLabels[material.skill].zh}{" "}
                        ·{" "}
                        {material.source_title ||
                          t(lang, "私人资料", "Private material")}
                      </small>
                    </span>
                    <SkillTag skill={material.skill} lang={lang} />
                    <span className="approval-pill">
                      {material.visibility === "private"
                        ? t(lang, "私人", "Private")
                        : material.approval === "approved"
                          ? t(lang, "小组共享", "Shared")
                          : t(lang, "待审核", "Pending")}
                    </span>
                    <ChevronRight size={17} />
                  </button>
                )}
              />
            ) : (
              materialPageRows.map((material) => (
                <button
                  className={`material-row ${selectedId === material.id ? "selected" : ""}`}
                  key={material.id}
                  disabled={materialBusy}
                  onClick={() => {
                    setSelectedId(material.id);
                    setCreating(false);
                    setThreadId(null);
                    setComment("");
                  }}
                >
                  <span className="material-icon">
                    {material.file_kind?.startsWith("audio") ? (
                      <FileAudio size={20} />
                    ) : (
                      <FileText size={20} />
                    )}
                  </span>
                  <span className="material-copy">
                    <strong>{material.title}</strong>
                    <small>
                      {material.question_type || skillLabels[material.skill].zh}{" "}
                      ·{" "}
                      {material.source_title ||
                        t(lang, "私人资料", "Private material")}
                    </small>
                  </span>
                  <SkillTag skill={material.skill} lang={lang} />
                  <span className="approval-pill">
                    {material.visibility === "private"
                      ? t(lang, "私人", "Private")
                      : material.approval === "approved"
                        ? t(lang, "小组共享", "Shared")
                        : t(lang, "待审核", "Pending")}
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="empty-inline">
            <LibraryBigIcon />
            <strong>{t(lang, "暂无匹配资料", "No matching materials")}</strong>
            <p>
              {t(
                lang,
                "可添加自己的授权资料，或调整筛选条件。",
                "Add authorised material or change the filters.",
              )}
            </p>
          </div>
        )}
        {filtered.length > 50 && <div className="button-row">
          <button className="button secondary" disabled={currentMaterialPage === 1} onClick={() => setMaterialPage(currentMaterialPage - 1)}>{t(lang,"上一页","Previous")}</button>
          <span>{currentMaterialPage} / {Math.ceil(filtered.length / 50)} · {filtered.length} {t(lang,"组资料","materials")}</span>
          <button className="button secondary" disabled={currentMaterialPage * 50 >= filtered.length} onClick={() => setMaterialPage(currentMaterialPage + 1)}>{t(lang,"下一页","Next")}</button>
        </div>}
      </section>}
      {libraryTab === "practice" && selected && (
        <section className="card detail-card">
          <div className="card-top">
            <div>
              <SkillTag skill={selected.skill} lang={lang} />
              <h3>{selected.title}</h3>
              <p className="muted small">
                {selected.source_title}{" "}
                {selected.license_name && `· ${selected.license_name}`}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label={t(lang, "关闭详情", "Close detail")}
              onClick={() => setSelectedId(null)}
            >
              <X size={18} />
            </button>
          </div>
          <p className="muted small">
            {materialPath(selected)} · v{selected.revision ?? 1}
          </p>
          <div className="tag-list">
            {materialIssues(selected, lang).map((issue) => (
              <span className="soft-tag" key={issue}>
                {issue}
              </span>
            ))}
          </div>
          <p className="prompt-preview">{selected.prompt}</p>
          {selected.file_path && (
            <button
              className="button secondary"
              onClick={() => void openFile(selected)}
            >
              <FileText size={16} />
              {t(lang, "打开附件", "Open attachment")}
            </button>
          )}
          <div className="button-row">
            <button
              className="button primary"
              onClick={() => actions.openPractice(selected.id)}
            >
              <BookOpen size={16} />
              {t(lang, "开始练习", "Start practice")}
            </button>
            {selected.owner_id === data.profile.id && (
              <button
                className="button secondary"
                onClick={() => {
                  setNewMaterial({ ...selected });
                  setFile(null);
                  setCreating(true);
                }}
              >
                {t(lang, "编辑资料", "Edit material")}
              </button>
            )}
            {selected.owner_id === data.profile.id && (
              <button
                className="button danger-outline"
                onClick={() => {
                  if (
                    window.confirm(
                      t(lang, "确认删除这份资料？", "Delete this material?"),
                    )
                  )
                    void actions
                      .remove("materials", "materials", selected.id)
                      .then(() => setSelectedId(null))
                      .catch(() => undefined);
                }}
              >
                <Trash2 size={16} />
                {t(lang, "删除", "Delete")}
              </button>
            )}
          </div>
          <MaterialHistory
            key={selected.id}
            material={selected}
            data={data}
            actions={actions}
            onCopy={(copy) => {
              setNewMaterial(copy);
              setFile(null);
              setCreating(true);
              setSelectedId(null);
            }}
          />
          {selected.owner_id === data.profile.id && otherMembers.length > 0 && (
            <div className="share-box">
              <strong>{t(lang, "单独分享", "Share privately")}</strong>
              <div className="button-row">
                <select
                  aria-label={t(lang, "分享接收者", "Share recipient")}
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                >
                  <option value="">
                    {t(lang, "选择学习伙伴", "Choose a partner")}
                  </option>
                  {otherMembers.map((member) => (
                    <option value={member.id} key={member.id}>
                      {member.display_name}
                    </option>
                  ))}
                </select>
                <button
                  className="button secondary"
                  disabled={!recipient}
                  onClick={() => void addShare()}
                >
                  {t(lang, "分享", "Share")}
                </button>
              </div>
              {data.shares
                .filter(
                  (row) =>
                    row.target_type === "material" &&
                    row.target_id === selected.id &&
                    !row.revoked_at,
                )
                .map((row) => (
                  <div className="share-row" key={row.id}>
                    <span>
                      {data.members.find(
                        (member) => member.id === row.recipient_id,
                      )?.display_name ?? t(lang, "学习伙伴", "Partner")}
                    </span>
                    <button
                      className="text-link"
                      onClick={() =>
                        void actions
                          .upsert("share_grants", "shares", {
                            ...row,
                            revoked_at: new Date().toISOString(),
                          })
                          .catch(() => undefined)
                      }
                    >
                      {t(lang, "撤销", "Revoke")}
                    </button>
                  </div>
                ))}
            </div>
          )}
          {share && (
            <div className="comments-box">
              <h4>{t(lang, "讨论", "Comments")}</h4>
              {threads.length > 1 && (
                <select
                  aria-label={t(lang, "讨论对象", "Comment thread")}
                  value={share.id}
                  onChange={(event) => {
                    setThreadId(event.target.value);
                    setComment("");
                  }}
                >
                  {threads.map((thread) => (
                    <option key={thread.id} value={thread.id}>
                      {data.members.find(
                        (member) => member.id === thread.recipient_id,
                      )?.display_name ?? "—"}
                    </option>
                  ))}
                </select>
              )}
              {relevantComments.map((row) => (
                <p key={row.id}>
                  <strong>
                    {data.members.find((member) => member.id === row.author_id)
                      ?.display_name ?? "—"}
                  </strong>{" "}
                  {row.body}
                </p>
              ))}
              <div className="button-row">
                <input
                  maxLength={2000}
                  aria-label={t(lang, "评论", "Comment")}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder={t(lang, "写一条评论", "Write a comment")}
                />
                <button
                  className="button secondary"
                  onClick={() => void postComment()}
                >
                  {t(lang, "发送", "Send")}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function LibraryBigIcon() {
  return <LibraryBig size={27} />;
}

export function ProgressView({ data, actions }: Props) {
  const lang = data.profile.language;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    data.attempts.find((attempt) => attempt.id === selectedId) ?? null;
  const [reviewDirty, setReviewDirty] = useState(false);
  const reviewDirtyRef = useRef(false);
  reviewDirtyRef.current = reviewDirty;
  const closeDetail = () => {
    if (
      reviewDirty &&
      !window.confirm(
        t(
          lang,
          "复盘备注尚未保存，放弃修改？",
          "Discard unsaved review notes?",
        ),
      )
    )
      return;
    setSelectedId(null);
    setReviewDirty(false);
    actions.clearReviewTarget();
  };
  useEffect(() => {
    if (actions.reviewTarget) {
      const row = data.attempts.find(
        (a) =>
          a.id === actions.reviewTarget!.attemptId &&
          a.owner_id === data.profile.id,
      );
      if (row) {
        setSelectedId(row.id);
        setReviewDirty(false);
      } else
        actions.notify(
          t(
            lang,
            "这条复盘记录已删除或不可访问",
            "Review record deleted or inaccessible",
          ),
        );
    }
  }, [actions.reviewTarget?.attemptId, actions.reviewTarget?.questionId]);
  useEffect(() => {
    actions.registerPracticeGuard(
      async () =>
        !reviewDirtyRef.current ||
        window.confirm(
          t(
            lang,
            "复盘备注尚未保存，放弃修改？",
            "Discard unsaved review notes?",
          ),
        ),
    );
    return () => actions.registerPracticeGuard(null);
  }, [lang]);
  const setSelected = (attempt: Attempt | null) => {
    if (
      reviewDirty &&
      !window.confirm(
        t(
          lang,
          "复盘备注尚未保存，放弃修改？",
          "Discard unsaved review notes?",
        ),
      )
    )
      return;
    setSelectedId(attempt?.id ?? null);
    setReviewDirty(false);
  };
  const [recipient, setRecipient] = useState("");
  const [attemptComment, setAttemptComment] = useState("");
  const activeShare = selected
    ? data.shares.find(
        (share) =>
          share.target_type === "attempt" &&
          share.target_id === selected.id &&
          !share.revoked_at &&
          (share.recipient_id === data.profile.id ||
            selected.owner_id === data.profile.id),
      )
    : null;
  const sorted = data.attempts
    .filter((attempt) => attempt.owner_id === data.profile.id)
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  const sharedAttempts = data.attempts.filter(
    (attempt) =>
      attempt.owner_id !== data.profile.id &&
      data.shares.some(
        (share) =>
          share.target_type === "attempt" &&
          share.target_id === attempt.id &&
          share.recipient_id === data.profile.id &&
          !share.revoked_at,
      ),
  );
  const { recent: visible, archived } = groupAttemptHistory(sorted);
  const members = data.members.filter(
    (member) => member.id !== data.profile.id,
  );
  const feedbackRows = sorted.filter(
    (attempt) =>
      (attempt.skill === "writing" || attempt.skill === "speaking") &&
      (attempt.feedback || attempt.feedback_tags?.length),
  );
  const tags = feedbackRows.flatMap((attempt) => [
    ...new Set(attempt.feedback?.tags ?? attempt.feedback_tags ?? []),
  ]);
  const repeated =
    feedbackRows.length >= 3
      ? [...new Set(tags)].filter(
          (tag) => tags.filter((value) => value === tag).length >= 2,
        )
      : [];

  async function shareAttempt() {
    try {
      if (!selected || !recipient) return;
      const row: ShareGrant = {
        id: crypto.randomUUID(),
        owner_id: data.profile.id,
        recipient_id: recipient,
        target_type: "attempt",
        target_id: selected.id,
        revoked_at: null,
        created_at: new Date().toISOString(),
      };
      await actions.upsert("share_grants", "shares", row);
      setRecipient("");
      actions.notify(t(lang, "已分享练习记录", "Practice record shared"));
    } catch {
      /* Workspace displays errors. */
    }
  }

  async function postAttemptComment() {
    try {
      if (!activeShare || !attemptComment.trim()) return;
      const row: ShareComment = {
        id: crypto.randomUUID(),
        share_id: activeShare.id,
        author_id: data.profile.id,
        body: attemptComment.trim(),
        created_at: new Date().toISOString(),
      };
      await actions.upsert("share_comments", "comments", row);
      setAttemptComment("");
    } catch {
      /* Workspace displays errors. */
    }
  }

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <span className="eyebrow">PERSONAL INSIGHTS</span>
          <h2>{t(lang, "看见自己的进步", "See your progress")}</h2>
          <p>
            {t(
              lang,
              "只根据你的练习记录显示趋势；数据少时先不下结论。",
              "Trends use your own practice only. Small samples stay unlabelled.",
            )}
          </p>
        </div>
      </div>
      <LearningInsights data={data} />
      <section className="card">
        <div className="card-top">
          <h3>{t(lang, "值得关注的主题", "Themes to work on")}</h3>
          <span className="muted small">
            {t(
              lang,
              `来自 ${feedbackRows.length} 次写作 / 口语反馈`,
              `From ${feedbackRows.length} writing / speaking feedback samples`,
            )}
          </span>
        </div>
        {repeated.length ? (
          <div className="tag-list">
            {repeated.map((tag) => (
              <button
                className="theme-training-link"
                key={tag}
                onClick={() => actions.openMicroTraining(tag)}
              >
                {tag} · {tags.filter((value) => value === tag).length}/
                {feedbackRows.length} →{" "}
                {t(lang, "练习这个主题", "Practise this theme")}
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-text">
            {t(
              lang,
              "继续练习后，这里会显示反复出现的建议。",
              "Recurring suggestions will appear after more practice.",
            )}
          </p>
        )}
      </section>
      {sharedAttempts.length > 0 && (
        <section className="card">
          <h3>{t(lang, "伙伴分享的练习", "Shared by partners")}</h3>
          <div className="attempt-list">
            {sharedAttempts.map((attempt) => (
              <button
                className="attempt-row"
                key={attempt.id}
                onClick={() => setSelected(attempt)}
              >
                <SkillTag skill={attempt.skill} lang={lang} />
                <span>
                  <strong>
                    {data.members.find(
                      (member) => member.id === attempt.owner_id,
                    )?.display_name ?? t(lang, "学习伙伴", "Partner")}
                  </strong>
                  <small>
                    {new Date(attempt.submitted_at).toLocaleDateString(
                      lang === "zh" ? "zh-CN" : "en-US",
                    )}
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="card">
        <div className="card-top">
          <h3>{t(lang, "最近练习", "Recent practice")}</h3>
          <span className="muted small">
            {t(lang, "每题最近 5 次", "Latest 5 per set")}
          </span>
        </div>
        {visible.length ? (
          <div className="attempt-list">
            {visible.map((attempt) => (
              <button
                className="attempt-row"
                key={attempt.id}
                onClick={() => setSelected(attempt)}
              >
                <SkillTag skill={attempt.skill} lang={lang} />
                <span>
                  <strong>
                    {data.materials.find(
                      (material) => material.id === attempt.material_id,
                    )?.title ?? t(lang, "自由练习", "Free practice")}
                  </strong>
                  <small>
                    {new Date(attempt.submitted_at).toLocaleString(
                      lang === "zh" ? "zh-CN" : "en-US",
                    )}
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-text">
            {t(lang, "还没有练习记录。", "No practice records yet.")}
          </p>
        )}
      </section>
      {archived.length > 0 && (
        <details className="card archive-card">
          <summary>
            {t(lang, "个人归档", "Personal archive")} · {archived.length}
          </summary>
          <div className="attempt-list">
            {archived.map((attempt) => (
              <button
                className="attempt-row"
                key={attempt.id}
                onClick={() => setSelected(attempt)}
              >
                <SkillTag skill={attempt.skill} lang={lang} />
                <span>
                  <strong>
                    {data.materials.find(
                      (material) => material.id === attempt.material_id,
                    )?.title ?? t(lang, "自由练习", "Free practice")}
                  </strong>
                  <small>
                    {new Date(attempt.submitted_at).toLocaleDateString(
                      lang === "zh" ? "zh-CN" : "en-US",
                    )}
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
          <button
            className="text-link danger-text"
            onClick={() => {
              if (
                window.confirm(
                  t(
                    lang,
                    "清空个人归档？此操作无法撤销。",
                    "Clear archived attempts? This cannot be undone.",
                  ),
                )
              )
                void Promise.allSettled(
                  archived.map((attempt) =>
                    actions.remove("practice_attempts", "attempts", attempt.id),
                  ),
                );
            }}
          >
            {t(lang, "清空归档", "Clear archive")}
          </button>
        </details>
      )}
      {selected && (
        <Modal
          label={t(lang, "练习详情", "Practice detail")}
          onClose={closeDetail}
        >
          <div className="card-top">
            <div>
              <SkillTag skill={selected.skill} lang={lang} />
              <h3>
                {data.attemptReviews?.find(
                  (review) => review.id === selected.id,
                )?.snapshot.title ??
                  data.materials.find(
                    (material) => material.id === selected.material_id,
                  )?.title ??
                  t(lang, "自由练习", "Free practice")}
              </h3>
            </div>
            <button
              className="icon-button"
              aria-label={t(lang, "关闭详情", "Close detail")}
              onClick={closeDetail}
            >
              <X size={18} />
            </button>
          </div>
          <p className="muted small">
            {selected.skill === "reading" || selected.skill === "listening"
              ? kindLabel(selected.learning_kind, lang) + " · "
              : ""}
            {new Date(selected.submitted_at).toLocaleString(
              lang === "zh" ? "zh-CN" : "en-US",
            )}
          </p>
          {selected.purged_at ? (
            <p>
              {t(
                lang,
                "原始内容已按一年保存期限清除，统计仍保留。",
                "Original content was removed after one year; statistics remain.",
              )}
            </p>
          ) : (
            <>
              <div className="detail-answer">
                {selected.answer_body &&
                  Object.entries(selected.answer_body).map(([key, value]) => (
                    <p key={key}>
                      <strong>{key}</strong> {value}
                    </p>
                  ))}
                {selected.transcript && <p>{selected.transcript}</p>}
              </div>
              {selected.feedback && (
                <div className="feedback-box">
                  <strong>{t(lang, "反馈", "Feedback")}</strong>
                  <p>{selected.feedback.summary}</p>
                  {selected.feedback.priorities.map((point, index) => (
                    <p key={index}>• {point}</p>
                  ))}
                </div>
              )}
            </>
          )}
          {selected.question_count !== null && (
            <p>
              {t(lang, "正确", "Correct")}: {selected.correct_count} /{" "}
              {selected.question_count}
            </p>
          )}
          {selected.owner_id === data.profile.id && !selected.purged_at && (
            <details className="material-history">
              <summary>
                {t(lang, "当时的题目与版本", "Original prompt and version")} ·{" "}
                {selected.material_revision
                  ? "v" + selected.material_revision
                  : t(lang, "版本号未记录", "Version not recorded")}
              </summary>
              {data.attemptReviews?.find((r) => r.id === selected.id) ? (
                <>
                  <p>
                    {
                      data.attemptReviews.find((r) => r.id === selected.id)!
                        .snapshot.prompt
                    }
                  </p>
                  <p className="muted small">
                    {
                      data.attemptReviews.find((r) => r.id === selected.id)!
                        .snapshot.source_title
                    }{" "}
                    ·{" "}
                    {
                      data.attemptReviews.find((r) => r.id === selected.id)!
                        .snapshot.license_name
                    }
                  </p>
                </>
              ) : (
                <p>
                  {t(
                    lang,
                    "该历史记录未保存原题快照，无法还原当时版本。",
                    "This historical attempt has no original prompt snapshot.",
                  )}
                </p>
              )}
            </details>
          )}
          {selected.owner_id === data.profile.id &&
            !selected.purged_at &&
            (selected.skill === "reading" || selected.skill === "listening") &&
            selected.learning_kind !== "intensive" && (
              <AttemptReviewPanel
                key={selected.id}
                attempt={selected}
                data={data}
                actions={actions}
                focusQuestionId={actions.reviewTarget?.questionId}
                onDirty={setReviewDirty}
              />
            )}
          {activeShare && (
            <div className="share-box">
              <strong>{t(lang, "练习评论", "Practice comments")}</strong>
              {data.comments
                .filter((item) => item.share_id === activeShare.id)
                .map((item) => (
                  <p key={item.id}>
                    <b>
                      {data.members.find(
                        (member) => member.id === item.author_id,
                      )?.display_name ?? t(lang, "学习伙伴", "Partner")}
                    </b>
                    ：{item.body}
                  </p>
                ))}
              <div className="button-row">
                <input
                  maxLength={2000}
                  aria-label={t(lang, "评论", "Comment")}
                  value={attemptComment}
                  onChange={(event) => setAttemptComment(event.target.value)}
                  placeholder={t(lang, "写下评论", "Write a comment")}
                />
                <button
                  className="button secondary"
                  disabled={!attemptComment.trim()}
                  onClick={() => void postAttemptComment()}
                >
                  {t(lang, "发送", "Post")}
                </button>
              </div>
            </div>
          )}
          {selected.owner_id === data.profile.id &&
            members.length > 0 &&
            !selected.purged_at && (
              <div className="share-box">
                <strong>{t(lang, "分享这次练习", "Share this attempt")}</strong>
                <div className="button-row">
                  <select
                    aria-label={t(lang, "分享接收者", "Share recipient")}
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                  >
                    <option value="">
                      {t(lang, "选择学习伙伴", "Choose a partner")}
                    </option>
                    {members.map((member) => (
                      <option value={member.id} key={member.id}>
                        {member.display_name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button secondary"
                    disabled={!recipient}
                    onClick={() => void shareAttempt()}
                  >
                    {t(lang, "分享", "Share")}
                  </button>
                </div>
                {data.shares
                  .filter(
                    (row) =>
                      row.target_type === "attempt" &&
                      row.target_id === selected.id &&
                      !row.revoked_at,
                  )
                  .map((row) => (
                    <div className="share-row" key={row.id}>
                      <span>
                        {
                          data.members.find(
                            (member) => member.id === row.recipient_id,
                          )?.display_name
                        }
                      </span>
                      <button
                        className="text-link"
                        onClick={() =>
                          void actions
                            .upsert("share_grants", "shares", {
                              ...row,
                              revoked_at: new Date().toISOString(),
                            })
                            .catch(() => undefined)
                        }
                      >
                        {t(lang, "撤销", "Revoke")}
                      </button>
                    </div>
                  ))}
              </div>
            )}
          {selected.owner_id === data.profile.id && (
            <button
              className="button danger-outline"
              onClick={() => {
                if (
                  window.confirm(
                    t(
                      lang,
                      "删除这条练习记录？",
                      "Delete this practice record?",
                    ),
                  )
                )
                  void actions
                    .remove("practice_attempts", "attempts", selected.id)
                    .then(() => {
                      setSelected(null);
                      setReviewDirty(false);
                      actions.clearReviewTarget();
                    })
                    .catch(() => undefined);
              }}
            >
              <Trash2 size={16} />
              {t(lang, "删除记录", "Delete record")}
            </button>
          )}
        </Modal>
      )}
    </div>
  );
}

export function SettingsView({
  data,
  actions,
  onLogout,
}: Props & { onLogout: (scope?: "local" | "global") => Promise<void> }) {
  const lang = data.profile.language;
  const [draft, setDraft] = useState(data.profile);
  const previousProfile = useRef(data.profile);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const settingsLock = useRef(false);
  useEffect(() => {
    const previous = previousProfile.current;
    setDraft((current) => mergeProfileDraft(current, previous, data.profile));
    previousProfile.current = data.profile;
  }, [data.profile]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (settingsLock.current) return;
    if (
      draft.ai_enabled &&
      (!draft.monthly_budget_cny || draft.monthly_budget_cny <= 0)
    ) {
      actions.notify(
        t(
          lang,
          "启用 AI 前请设置月度预算",
          "Set a monthly budget before enabling AI",
        ),
      );
      return;
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: draft.timezone }).format();
    } catch {
      actions.notify(
        t(
          lang,
          "请输入有效时区，例如 Asia/Shanghai。",
          "Enter a valid time zone, such as Asia/Shanghai.",
        ),
      );
      return;
    }
    settingsLock.current = true;
    setSettingsBusy(true);
    try {
      await actions.updateProfile({
        ...draft,
        display_name: draft.display_name.trim(),
        timezone: draft.timezone.trim(),
      });
    } catch {
      /* Workspace displays errors. */
    } finally {
      settingsLock.current = false;
      setSettingsBusy(false);
    }
  }

  async function saveAiPreference() {
    if (settingsLock.current) return;
    if (
      draft.ai_enabled &&
      (!draft.monthly_budget_cny || draft.monthly_budget_cny <= 0)
    ) {
      actions.notify(
        t(
          lang,
          "启用 AI 前请设置月度预算",
          "Set a monthly budget before enabling AI",
        ),
      );
      return;
    }
    settingsLock.current = true;
    setSettingsBusy(true);
    try {
      await actions.updateProfile({
        ...data.profile,
        ai_enabled: draft.ai_enabled,
        monthly_budget_cny: draft.monthly_budget_cny,
      });
    } catch {
      /* Workspace displays errors. */
    } finally {
      settingsLock.current = false;
      setSettingsBusy(false);
    }
  }

  async function deleteAccount() {
    if (demoMode) {
      actions.notify(
        t(lang, "演示模式没有云端账号", "No cloud account in demo mode"),
      );
      return;
    }
    if (
      !window.confirm(
        t(
          lang,
          "这会删除你的账号和私人学习记录。确定继续？",
          "This deletes your account and private study data. Continue?",
        ),
      )
    )
      return;
    try {
      await apiFetch(actions.client, "/api/account", { method: "DELETE" });
      await clearUserDrafts(data.profile.id);
      await onLogout("global");
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : "注销失败");
    }
  }

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <span className="eyebrow">JiawenLex v{APP_VERSION} · YOUR PREFERENCES</span>
          <h2>{t(lang, "个人设置", "Settings")}</h2>
          <p>
            {t(
              lang,
              "目标、学习节奏和提醒都可以调整。",
              "Adjust your goals, pace and reminders.",
            )}
          </p>
        </div>
      </div>
      <section className="card">
        <h3>{t(lang, "备考目标", "Study goals")}</h3>
        <form
          className="form-stack"
          onSubmit={(event) => void saveProfile(event)}
        >
          <div className="form-grid">
            <label>
              {t(lang, "昵称", "Nickname")}
              <input
                required
                maxLength={32}
                value={draft.display_name}
                onChange={(event) =>
                  setDraft({ ...draft, display_name: event.target.value })
                }
              />
            </label>
            <label>
              {t(lang, "考试类型", "Track")}
              <select
                value={draft.track}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    track: event.target.value as Profile["track"],
                  })
                }
              >
                <option value="academic">Academic</option>
                <option value="general">General Training</option>
              </select>
            </label>
            <label>
              {t(lang, "目标总分", "Overall target")}
              <input
                type="number"
                min="0"
                max="9"
                step="0.5"
                value={draft.goal_overall ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    goal_overall: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
              />
            </label>
            <label>
              {t(lang, "考试日期", "Exam date")}
              <input
                type="date"
                value={draft.target_date ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    target_date: event.target.value || null,
                  })
                }
              />
            </label>
            <label>
              {t(lang, "每周小时数", "Hours per week")}
              <input
                type="number"
                min="1"
                max="80"
                value={draft.weekly_hours}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    weekly_hours: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <div className="form-grid four">
            {(["listening", "reading", "writing", "speaking"] as const).map(
              (skill) => (
                <label key={skill}>
                  {t(lang, skillLabels[skill].zh, skillLabels[skill].en)}{" "}
                  {t(lang, "目标（可选）", "target (optional)")}
                  <input
                    type="number"
                    min="0"
                    max="9"
                    step="0.5"
                    value={draft[`goal_${skill}`] ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        [`goal_${skill}`]: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  />
                </label>
              ),
            )}
          </div>
          <h4>{t(lang, "邮件提醒", "Email reminder")}</h4>
          <label className="switch-row">
            <span>
              {t(
                lang,
                "每天提醒未完成任务和待复习词汇",
                "Daily reminder for tasks and due words",
              )}
            </span>
            <input
              type="checkbox"
              checked={draft.reminder_on}
              onChange={(event) =>
                setDraft({ ...draft, reminder_on: event.target.checked })
              }
            />
          </label>
          <div className="form-grid">
            <label>
              {t(lang, "提醒时间", "Reminder time")}
              <input
                type="time"
                value={draft.reminder_time.slice(0, 5)}
                onChange={(event) =>
                  setDraft({ ...draft, reminder_time: event.target.value })
                }
              />
            </label>
            <label>
              {t(lang, "时区", "Time zone")}
              <input
                value={draft.timezone}
                onChange={(event) =>
                  setDraft({ ...draft, timezone: event.target.value })
                }
              />
            </label>
          </div>
          <button
            className="button primary"
            type="submit"
            disabled={settingsBusy}
          >
            {settingsBusy
              ? t(lang, "保存中…", "Saving…")
              : t(lang, "保存设置", "Save settings")}
          </button>
        </form>
      </section>
      <AiSettings draft={draft} onChangeDraft={setDraft} saving={settingsBusy} onSavePreference={saveAiPreference} client={actions.client} notify={actions.notify} />
      <section className="card">
        <h3>{t(lang, "账号与会话", "Account and sessions")}</h3>
        <p className="muted small">{t(lang, "小组管理员可查看成员在线状态、当前模块及已提交的答题和学习记录；未提交草稿与 API 密钥不在该界面展示。", "Group administrators can view presence, current module and submitted study records. Unsubmitted drafts and API keys are excluded from that interface.")}</p>
        <div className="button-row">
          <button
            className="button secondary"
            onClick={() => void onLogout("local")}
          >
            {t(lang, "退出当前设备", "Sign out here")}
          </button>
          <button
            className="button secondary"
            onClick={() => void onLogout("global")}
          >
            {t(lang, "退出所有设备", "Sign out everywhere")}
          </button>
        </div>
        <div className="danger-zone">
          <p>
            {t(
              lang,
              "注销将删除私人资料与学习记录。加密备份最多保留四周，恢复时会重放删除记录。",
              "Deleting your account removes private data. Encrypted backups may remain for up to four weeks; deletion is replayed on restore.",
            )}
          </p>
          <button
            className="button danger-outline"
            onClick={() => void deleteAccount()}
          >
            {t(lang, "注销账号", "Delete account")}
          </button>
        </div>
      </section>
    </div>
  );
}

export function AdminView({ data, actions }: Props) {
  const lang = data.profile.language;
  const [code, setCode] = useState("");
  const [inviteActive, setInviteActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [services, setServices] = useState<ServiceStatus[] | null>(null);
  const [serviceError, setServiceError] = useState(false);
  const pending = data.materials.filter(
    (material) =>
      material.visibility === "shared" && material.approval === "pending",
  );
  const members = data.members.filter(
    (member) => member.id !== data.profile.id,
  );

  useEffect(() => {
    if (!actions.client) return;
    void apiFetch(actions.client, "/api/admin/invite")
      .then((value) => setInviteActive((value as { active: boolean }).active))
      .catch(() => undefined);
    void apiFetch(actions.client, "/api/admin/status")
      .then((value) =>
        setServices((value as { services: ServiceStatus[] }).services),
      )
      .catch(() => setServiceError(true));
  }, [actions.client]);

  async function invite(action: "rotate" | "toggle") {
    setBusy(true);
    try {
      const result = (await apiFetch(actions.client, "/api/admin/invite", {
        method: "POST",
        body: JSON.stringify({ action, active: !inviteActive }),
      })) as { code?: string; active: boolean };
      if (result.code) setCode(result.code);
      setInviteActive(result.active);
      actions.notify(
        t(lang, "邀请码设置已更新", "Invitation settings updated"),
      );
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: Member) {
    if (
      !window.confirm(
        t(
          lang,
          `移除 ${member.display_name}？其登录和数据访问会立即停用。`,
          `Remove ${member.display_name}? Their access will stop immediately.`,
        ),
      )
    )
      return;
    try {
      await apiFetch(actions.client, "/api/admin/members", {
        method: "POST",
        body: JSON.stringify({ memberId: member.id, action: "remove" }),
      });
      await actions.refresh();
      actions.notify(t(lang, "成员已移除", "Member removed"));
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <span className="eyebrow">GROUP ADMIN</span>
          <h2>{t(lang, "小组管理", "Group administration")}</h2>
          <p>
            {t(
              lang,
              "管理邀请、共享资料，以及成员在线情况与各模块已提交答题记录。",
              "Manage invitations, shared material, member presence and submitted study records.",
            )}
          </p>
        </div>
      </div>
      <AdminActivity client={actions.client} />
      <section className="card">
        <h3>{t(lang, "服务配置情况", "Service configuration")}</h3>
        <p className="muted small">
          {t(
            lang,
            "这里只检查设置是否齐全。真实发送、备份恢复和定时调度仍需实际验收。",
            "These checks confirm configuration presence. Delivery, recovery and scheduling still need live verification.",
          )}
        </p>
        {services ? (
          services.map((service) => (
            <div className="member-row" key={service.id}>
              <strong>
                {service.id === "website"
                  ? t(lang, "公开网站地址", "Public website")
                  : service.id === "smtp"
                    ? t(lang, "提醒邮件", "Reminder email")
                    : service.id === "backup"
                      ? t(lang, "独立加密备份", "Encrypted backup")
                      : service.id === "source"
                        ? t(lang, "原始 PDF 私有存储", "Private PDF archive")
                        : t(lang, "AI 密钥加密", "AI key encryption")}
              </strong>
              <span>
                {service.configured
                  ? t(lang, "配置已齐全", "Configuration present")
                  : t(lang, "待配置", "Setup required")}
              </span>
            </div>
          ))
        ) : (
          <p className="empty-text">
            {demoMode
              ? t(
                  lang,
                  "演示模式不检查真实服务。",
                  "Demo mode does not check live services.",
                )
              : serviceError
                ? t(
                    lang,
                    "暂时无法读取，请刷新页面重试。",
                    "Could not load status. Refresh to retry.",
                  )
                : t(lang, "正在读取…", "Loading…")}
          </p>
        )}
        <p className="muted small">
          {t(
            lang,
            "备份未配置时，删除和撤销会暂停，以确保恢复时能重放删除记录。AI 服务密钥请在个人设置中填写。",
            "Deletion and revocation pause until backup storage is configured. Set your own AI provider keys in Settings.",
          )}
        </p>
      </section>
      <div className="two-column">
        <section className="card">
          <h3>{t(lang, "邀请码", "Invitation code")}</h3>
          <p className="muted">
            {inviteActive
              ? t(
                  lang,
                  "当前允许凭邀请码注册。",
                  "Code registration is active.",
                )
              : t(
                  lang,
                  "当前已暂停邀请码注册。",
                  "Code registration is paused.",
                )}
          </p>
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void invite("rotate")}
            >
              {t(lang, "生成新邀请码", "Rotate code")}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void invite("toggle")}
            >
              {inviteActive
                ? t(lang, "停用", "Disable")
                : t(lang, "启用", "Enable")}
            </button>
          </div>
          {code && (
            <div className="code-reveal">
              <small>
                {t(
                  lang,
                  "新邀请码仅在此显示一次，请安全发给学习伙伴",
                  "This new code is shown once. Share it privately.",
                )}
              </small>
              <strong>{code}</strong>
              <button
                className="text-link"
                onClick={() => void navigator.clipboard.writeText(code)}
              >
                {t(lang, "复制", "Copy")}
              </button>
            </div>
          )}
        </section>
        <section className="card">
          <h3>{t(lang, "成员", "Members")}</h3>
          <p className="muted small">
            {data.members.length} / 5 {t(lang, "个活动账号", "active accounts")}
          </p>
          <div className="member-list">
            {members.map((member) => (
              <div className="member-row" key={member.id}>
                <span className="avatar small-avatar">
                  {member.display_name.slice(0, 1)}
                </span>
                <strong>{member.display_name}</strong>
                <button
                  className="text-link danger-text"
                  onClick={() => void removeMember(member)}
                >
                  {t(lang, "移除", "Remove")}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="card">
        <div className="card-top">
          <h3>{t(lang, "待审核共享资料", "Shared material to review")}</h3>
          <span className="round-count">{pending.length}</span>
        </div>
        {pending.length ? (
          <div className="material-list">
            {pending.map((material) => (
              <div className="approval-row" key={material.id}>
                <div>
                  <strong>{material.title}</strong>
                  <small>
                    {material.source_title} · {material.license_name}
                  </small>
                  <p>{material.prompt.slice(0, 180)}</p>
                </div>
                <div className="button-row">
                  <button
                    className="button small primary"
                    onClick={() =>
                      void actions
                        .upsert("materials", "materials", {
                          ...material,
                          approval: "approved",
                        })
                        .catch(() => undefined)
                    }
                  >
                    {t(lang, "通过", "Approve")}
                  </button>
                  <button
                    className="button small secondary"
                    onClick={() =>
                      void actions
                        .upsert("materials", "materials", {
                          ...material,
                          approval: "rejected",
                        })
                        .catch(() => undefined)
                    }
                  >
                    {t(lang, "退回", "Reject")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-text">
            {t(lang, "目前没有待审核资料。", "Nothing to review right now.")}
          </p>
        )}
      </section>
    </div>
  );
}
