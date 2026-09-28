"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3,
  FileAudio, FileText, LibraryBig, Plus, Search, Sparkles, Trash2, Upload, Users, X,
} from "lucide-react";
import { apiFetch, demoMode } from "@/lib/supabase";
import { daysUntil, dueWords, generateWeeklyTasks, groupAttemptHistory, localDate, reviewWord, skillLabels, skills, startOfWeek } from "@/lib/study";
import type { Attempt, Language, Material, Member, Profile, Question, ShareComment, ShareGrant, Skill, StudyTask, View, VocabularyWord, WorkspaceData, WritingDraft } from "@/lib/types";
import { t } from "./workspace";
import { VocabularyQuiz } from "./vocabulary-quiz";

export interface ViewActions {
  client: SupabaseClient | null;
  upsert: <K extends keyof WorkspaceData, R extends { id: string }>(table: string, key: K, row: R) => Promise<void>;
  remove: <K extends keyof WorkspaceData>(table: string, key: K, id: string) => Promise<void>;
  updateProfile: (profile: Profile) => Promise<void>;
  replacePlan: (tasks: StudyTask[]) => Promise<void>;
  notify: (message: string) => void;
  refresh: () => Promise<void>;
  openPractice: (materialId?: string | null, skill?: Skill) => void;
  setView: (view: View) => void;
  registerPracticeGuard: (guard: (() => Promise<boolean>) | null, materialId?: string | null) => void;
  acceptDraft: (draft: WritingDraft) => void;
}

type Props = { data: WorkspaceData; actions: ViewActions };

function heading(lang: Language, zh: string, en: string, description?: string) {
  return <div className="section-heading"><div><h2>{t(lang, zh, en)}</h2>{description && <p>{description}</p>}</div></div>;
}

function SkillTag({ skill, lang }: { skill: Skill | "vocabulary"; lang: Language }) {
  return <span className={`skill-tag skill-${skill}`}>{t(lang, skillLabels[skill].zh, skillLabels[skill].en)}</span>;
}

export function TodayView({ data, actions }: Props) {
  const { profile, tasks, attempts, words } = data;
  const lang = profile.language;
  const today = localDate();
  const pending = tasks.filter((task) => task.planned_date <= today && task.status === "todo").sort((a, b) => a.planned_date.localeCompare(b.planned_date));
  const done = tasks.filter((task) => task.week_start === startOfWeek() && task.status === "done").length;
  const weekly = tasks.filter((task) => task.week_start === startOfWeek());
  const due = dueWords(words).length;
  const days = daysUntil(profile.target_date);

  async function changeTask(task: StudyTask, status: StudyTask["status"]) {
    await actions.upsert("study_tasks", "tasks", { ...task, status }).catch(() => undefined);
  }

  return <div className="page-stack">
    <div className="welcome-row"><div><div className="eyebrow">{new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</div><h2>{t(lang, `${profile.display_name}，今天从这里开始。`, `Welcome back, ${profile.display_name}.`)}</h2><p>{t(lang, "按自己的节奏完成今天的任务。", "Take one task at a time.")}</p></div><div className="date-stamp"><CalendarDays size={18} /><span>{today}</span></div></div>
    <div className="dashboard-grid">
      <section className="card task-card"><div className="card-top"><div><span className="eyebrow">{t(lang, "TODAY'S FOCUS", "TODAY'S FOCUS")}</span><h3>{t(lang, "今日任务", "Today's tasks")}</h3></div><span className="round-count">{pending.length}</span></div>
        {pending.length ? <div className="task-list">{pending.map((task) => <div className="task-row" key={task.id}><button className="check-button" aria-label={t(lang, "完成任务", "Complete task")} onClick={() => void changeTask(task, "done")}><Check size={16} /></button><div className="task-copy"><div><SkillTag skill={task.skill} lang={lang} /><span className="task-minutes"><Clock3 size={13} />{task.minutes} min</span></div><strong>{task.title}</strong><small>{task.planned_date < today ? t(lang, "已过计划日期", "Overdue") : task.rationale}</small></div><button className="task-open" title={t(lang, "开始", "Start")} onClick={() => task.skill === "vocabulary" ? actions.setView("vocabulary") : actions.openPractice(task.material_id, task.skill)}><ArrowRight size={18} /></button></div>)}</div> : <div className="empty-inline"><CheckCircle2 size={28} /><strong>{t(lang, weekly.length ? "今天没有待完成任务" : "先安排第一周的学习", weekly.length ? "No tasks due today" : "Plan your first study week")}</strong><p>{t(lang, "可以复习词汇，或到资料库选择一组新练习。", "Review vocabulary or choose another practice set.")}</p></div>}
        <button className="text-action" onClick={() => actions.setView("plan")}>{t(lang, "查看本周计划", "View weekly plan")} <ChevronRight size={16} /></button>
      </section>
      <div className="dashboard-side">
        <section className="card progress-card"><span className="eyebrow">{t(lang, "AT A GLANCE", "AT A GLANCE")}</span><h3>{t(lang, "本周进度", "Weekly progress")}</h3><div className="progress-number">{done}<span> / {weekly.length || "—"}</span></div><div className="meter"><span style={{ width: `${weekly.length ? Math.round(done / weekly.length * 100) : 0}%` }} /></div><p>{t(lang, "已完成的计划任务", "planned tasks completed")}</p><button className="text-action" onClick={() => actions.setView("progress")}>{t(lang, "查看个人进度", "View your progress")} <ChevronRight size={16} /></button></section>
        <section className="card quick-stats"><div><span className="stat-icon"><BookOpen size={19} /></span><div><strong>{due}</strong><small>{t(lang, "待复习词汇", "words due")}</small></div></div><div><span className="stat-icon"><CalendarDays size={19} /></span><div><strong>{days ?? "—"}</strong><small>{t(lang, "距离考试天数", "days to exam")}</small></div></div><div><span className="stat-icon"><Sparkles size={19} /></span><div><strong>{attempts.length}</strong><small>{t(lang, "累计练习记录", "practice sessions")}</small></div></div></section>
      </div>
    </div>
    <section className="quick-start"><div><span className="eyebrow">{t(lang, "QUICK START", "QUICK START")}</span><h3>{t(lang, "继续练习", "Keep practising")}</h3></div><div className="skill-tiles">{skills.map((skill) => <button key={skill} className={`skill-tile skill-${skill}`} onClick={() => actions.openPractice(null, skill)}><span>{t(lang, skillLabels[skill].zh, skillLabels[skill].en)}</span><ArrowRight size={18} /></button>)}</div></section>
  </div>;
}

export function VocabularyView({ data, actions }: Props) {
  const lang = data.profile.language;
  const [term, setTerm] = useState("");
  const [definition, setDefinition] = useState("");
  const [example, setExample] = useState("");
  const [search, setSearch] = useState("");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [wordBusy, setWordBusy] = useState(false);
  const wordLock = useRef(false);
  const [revealed, setRevealed] = useState(false);
  const due = dueWords(data.words);
  const current = due[reviewIndex] ?? due[0];
  const filtered = data.words.filter((word) => (word.term + word.definition).toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.term.localeCompare(b.term));

  async function addWord(event: React.FormEvent) {
    event.preventDefault();
    if (!term.trim() || !definition.trim() || wordLock.current) return;
    wordLock.current = true; setWordBusy(true);
    try {
    const word: VocabularyWord = {
      id: crypto.randomUUID(), owner_id: data.profile.id, term: term.trim(), definition: definition.trim(),
      example: example.trim(), tags: [], due_at: new Date().toISOString(), interval_days: 0,
      streak: 0, last_reviewed_at: null, created_at: new Date().toISOString(),
    };
    await actions.upsert("vocabulary", "words", word);
    setTerm(""); setDefinition(""); setExample("");
    actions.notify(t(lang, "已加入词表", "Word added"));
    } catch { /* Workspace displays errors. */ } finally { wordLock.current = false; setWordBusy(false); }
  }

  async function review(known: boolean) {
    if (!current || wordLock.current) return;
    wordLock.current = true; setWordBusy(true);
    try {
    await actions.upsert("vocabulary", "words", reviewWord(current, known));
    setRevealed(false);
    setReviewIndex(0);
    } catch { /* Workspace displays errors. */ } finally { wordLock.current = false; setWordBusy(false); }
  }

  return <div className="page-stack">
    <div className="page-intro"><div><span className="eyebrow">{t(lang, "SPACED REVIEW", "SPACED REVIEW")}</span><h2>{t(lang, "词汇复习", "Vocabulary")}</h2><p>{t(lang, "认识的词逐步拉长间隔；忘记的词明天再见。", "Known words get a longer interval. Forgotten words return tomorrow.")}</p></div><div className="metric-badge"><strong>{due.length}</strong><span>{t(lang, "今日待复习", "due today")}</span></div></div>
    <div className="two-column">
      <section className="card review-card"><div className="card-top"><h3>{t(lang, "现在复习", "Review now")}</h3><span className="muted small">{due.length ? `1 / ${due.length}` : "0 / 0"}</span></div>
        {current ? <><div className="flashcard"><span className="eyebrow">WORD CARD</span><strong>{current.term}</strong>{revealed ? <div className="flashcard-answer"><p>{current.definition}</p>{current.example && <em>{current.example}</em>}</div> : <button className="button secondary" onClick={() => setRevealed(true)}>{t(lang, "显示释义", "Reveal meaning")}</button>}</div>{revealed && <div className="button-row"><button className="button secondary grow" disabled={wordBusy} onClick={() => void review(false)}>{t(lang, "不认识", "Not known")}</button><button className="button primary grow" disabled={wordBusy} onClick={() => void review(true)}>{t(lang, "认识", "Known")}</button></div>}</> : <div className="empty-inline"><CheckCircle2 size={27} /><strong>{t(lang, "今天的词汇已复习完", "No words due today")}</strong></div>}
      </section>
      <section className="card"><h3>{t(lang, "加入新词", "Add a word")}</h3><form className="form-stack" onSubmit={(event) => void addWord(event)}><label>{t(lang, "单词或短语", "Word or phrase")}<input required maxLength={160} value={term} onChange={(event) => setTerm(event.target.value)} placeholder="e.g. coherent" /></label><label>{t(lang, "释义", "Meaning")}<input required value={definition} onChange={(event) => setDefinition(event.target.value)} /></label><label>{t(lang, "例句（可选）", "Example (optional)")}<input value={example} onChange={(event) => setExample(event.target.value)} /></label><button className="button primary" disabled={wordBusy} type="submit"><Plus size={16} />{t(lang, "加入词表", "Add to list")}</button></form></section>
    </div>
    <VocabularyQuiz words={data.words} lang={lang} onReview={(word, known) => actions.upsert("vocabulary", "words", reviewWord(word, known))} />
    <section className="card"><div className="card-top"><div><h3>{t(lang, "我的词表", "My words")}</h3><p className="muted small">{data.words.length} {t(lang, "个词", "words")}</p></div><div className="search-field"><Search size={16} /><input aria-label={t(lang, "搜索词汇", "Search words")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t(lang, "搜索词汇", "Search words")} /></div></div>
      {filtered.length ? <div className="word-list">{filtered.map((word) => <div className="word-row" key={word.id}><div><strong>{word.term}</strong><span>{word.definition}</span></div><small>{new Date(word.due_at).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US")}</small><button className="icon-button subtle" title={t(lang, "删除", "Delete")} onClick={() => void actions.remove("vocabulary", "words", word.id).catch(() => undefined)}><Trash2 size={16} /></button></div>)}</div> : <p className="empty-text">{t(lang, "还没有匹配的词汇。", "No matching words yet.")}</p>}
    </section>
  </div>;
}

export function PlanView({ data, actions }: Props) {
  const lang = data.profile.language;
  const week = startOfWeek();
  const current = data.tasks.filter((task) => task.week_start === week).sort((a, b) => a.planned_date.localeCompare(b.planned_date));
  const [title, setTitle] = useState("");
  const [skill, setSkill] = useState<Skill | "vocabulary">("reading");
  const [minutes, setMinutes] = useState(30);
  const [plannedDate, setPlannedDate] = useState(localDate());
  const [planBusy, setPlanBusy] = useState(false);

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    const task: StudyTask = {
      id: crypto.randomUUID(), owner_id: data.profile.id, week_start: startOfWeek(new Date(plannedDate + "T12:00:00")), planned_date: plannedDate,
      skill, title: title.trim(), minutes, status: "todo", source: "manual", rationale: "手动添加",
      material_id: null, created_at: new Date().toISOString(),
    };
    try { await actions.upsert("study_tasks", "tasks", task); setTitle(""); } catch { /* Workspace displays errors. */ }
  }

  return <div className="page-stack">
    <div className="page-intro"><div><span className="eyebrow">WEEKLY PLAN</span><h2>{t(lang, "这一周，稳步向前", "Your week at a glance")}</h2><p>{t(lang, `按每周 ${data.profile.weekly_hours} 小时的目标安排。你可以随时调整。`, `Built around ${data.profile.weekly_hours} study hours per week. Adjust at any time.`)}</p></div><button className="button secondary" disabled={planBusy} onClick={() => { setPlanBusy(true); void actions.replacePlan(generateWeeklyTasks(data.profile, data.attempts.filter((attempt) => attempt.owner_id === data.profile.id), data.tasks)).finally(() => setPlanBusy(false)); }}><Sparkles size={16} />{t(lang, "按当前表现重新安排", "Rebalance this week")}</button></div>
    <section className="card"><div className="card-top"><h3>{t(lang, "本周任务", "This week's tasks")}</h3><span className="muted small">{current.reduce((sum, task) => sum + task.minutes, 0)} min</span></div>
      {current.length ? <div className="plan-list">{current.map((task) => <div className="plan-row" key={task.id}><div className={`plan-status ${task.status}`}>{task.status === "done" ? <Check size={16} /> : task.status === "skipped" ? <X size={16} /> : <Clock3 size={16} />}</div><div className="plan-copy"><div><SkillTag skill={task.skill} lang={lang} /><span className="muted small">{task.minutes} min</span></div><strong>{task.title}</strong><small>{task.rationale}</small></div><div className="plan-controls"><input type="date" aria-label={t(lang, "调整日期", "Reschedule")} value={task.planned_date} disabled={task.status === "done"} onChange={(event) => void actions.upsert("study_tasks", "tasks", { ...task, planned_date: event.target.value, week_start: startOfWeek(new Date(event.target.value + "T12:00:00")) }).catch(() => undefined)} /><select aria-label={t(lang, "任务状态", "Task status")} value={task.status} disabled={task.status === "done"} onChange={(event) => void actions.upsert("study_tasks", "tasks", { ...task, status: event.target.value as StudyTask["status"] }).catch(() => undefined)}><option value="todo">{t(lang, "待完成", "To do")}</option><option value="done">{t(lang, "完成", "Done")}</option><option value="skipped">{t(lang, "跳过", "Skip")}</option></select>{task.status === "todo" && <button className="icon-button subtle" title={t(lang, "开始", "Start")} onClick={() => task.skill === "vocabulary" ? actions.setView("vocabulary") : actions.openPractice(task.material_id, task.skill)}><ArrowRight size={18} /></button>}</div></div>)}</div> : <div className="empty-inline"><CalendarDays size={26} /><strong>{t(lang, "还没有本周计划", "No plan for this week")}</strong><p>{t(lang, "点击“按当前表现重新安排”生成任务。", "Use Rebalance to generate your tasks.")}</p></div>}
    </section>
    <section className="card"><h3>{t(lang, "添加自己的任务", "Add your own task")}</h3><form className="inline-form" onSubmit={(event) => void addTask(event)}><label>{t(lang, "任务", "Task")}<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t(lang, "例如：精读一篇文章", "e.g. Read one article closely")} /></label><label>{t(lang, "科目", "Skill")}<select value={skill} onChange={(event) => setSkill(event.target.value as typeof skill)}>{Object.entries(skillLabels).map(([value, label]) => <option value={value} key={value}>{t(lang, label.zh, label.en)}</option>)}</select></label><label>{t(lang, "分钟", "Minutes")}<input type="number" min="10" max="300" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label><label>{t(lang, "日期", "Date")}<input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></label><button className="button primary" type="submit"><Plus size={16} />{t(lang, "添加", "Add")}</button></form></section>
  </div>;
}

export function LibraryView({ data, actions }: Props) {
  const lang = data.profile.language;
  const [search, setSearch] = useState("");
  const [skillFilter, setSkillFilter] = useState<Skill | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newMaterial, setNewMaterial] = useState<Partial<Material>>({ skill: "reading", track: "academic", visibility: "private", questions: [], tags: [] });
  const [file, setFile] = useState<File | null>(null);
  const [materialBusy, setMaterialBusy] = useState(false);
  const materialLock = useRef(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [comment, setComment] = useState("");
  const filtered = data.materials.filter((material) => (skillFilter === "all" || material.skill === skillFilter) && [material.title, material.prompt, material.question_type, material.tags.join(" ")].join(" ").toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const selected = data.materials.find((material) => material.id === selectedId) ?? null;
  const threads = selected ? data.shares.filter((row) => row.target_type === "material" && row.target_id === selected.id && !row.revoked_at && (row.owner_id === data.profile.id || row.recipient_id === data.profile.id)) : [];
  const share = threads.find((row) => row.id === threadId) ?? threads[0];
  const relevantComments = share ? data.comments.filter((row) => row.share_id === share.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) : [];
  const otherMembers = data.members.filter((member) => member.id !== data.profile.id);

  function update<K extends keyof Material>(key: K, value: Material[K]) {
    setNewMaterial((previous) => ({ ...previous, [key]: value }));
  }

  async function saveMaterial(event: React.FormEvent) {
    event.preventDefault();
    if (!newMaterial.title?.trim() || !newMaterial.prompt?.trim() || materialLock.current) return;
    const questions = (newMaterial.questions ?? []).filter((question) => question.prompt.trim()).map((question) => ({ ...question, answers: question.answers.map((answer) => answer.trim()).filter(Boolean) }));
    if (questions.some((question) => !question.answers.length)) { actions.notify(t(lang, "每道题至少需要一个可接受答案。", "Each question needs at least one accepted answer.")); return; }
    if (newMaterial.visibility === "shared" && (!newMaterial.source_title?.trim() || !newMaterial.license_name?.trim())) {
      actions.notify(t(lang, "共享资料必须填写来源与许可", "Shared material needs a source and licence")); return;
    }
    materialLock.current = true; setMaterialBusy(true);
    const id = newMaterial.id ?? crypto.randomUUID();
    let filePath: string | null = newMaterial.file_path ?? null;
    let uploadedPath: string | null = null;
    try {
    if (file && actions.client) {
      if (file.size > 25 * 1024 * 1024) { actions.notify(t(lang, "附件不能超过 25 MB", "Files must be under 25 MB")); return; }
      filePath = `${data.profile.id}/${id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error } = await actions.client.storage.from("study-files").upload(filePath, file, { upsert: false });
      if (!error) uploadedPath = filePath;
      if (error) { actions.notify(error.message); return; }
    }
    const material: Material = {
      id, owner_id: data.profile.id, visibility: newMaterial.visibility ?? "private",
      approval: newMaterial.visibility === "shared" ? "pending" : "approved",
      title: newMaterial.title.trim(), skill: newMaterial.skill ?? "reading", track: newMaterial.track ?? data.profile.track,
      question_type: newMaterial.question_type?.trim() ?? "", prompt: newMaterial.prompt.trim(),
      passage: newMaterial.passage?.trim() ?? "", transcript: newMaterial.transcript?.trim() ?? "",
      questions,
      tags: [...new Set((newMaterial.tags ?? []).map((tag) => tag.trim()).filter(Boolean))], source_title: newMaterial.source_title?.trim() ?? "",
      source_url: newMaterial.source_url?.trim() ?? "", license_name: newMaterial.license_name?.trim() ?? "",
      file_path: filePath, file_name: file?.name ?? newMaterial.file_name ?? null, file_kind: file?.type ?? newMaterial.file_kind ?? null,
      created_at: newMaterial.created_at ?? new Date().toISOString(),
    };
      await actions.upsert("materials", "materials", material);
      setCreating(false); setNewMaterial({ skill: "reading", track: "academic", visibility: "private", questions: [], tags: [] }); setFile(null);
      setSelectedId(id);
      actions.notify(material.visibility === "shared" ? t(lang, "已提交管理员审核", "Submitted for review") : t(lang, "资料已保存", "Material saved"));
    } catch { if (uploadedPath && actions.client) await actions.client.storage.from("study-files").remove([uploadedPath]); }
    finally { materialLock.current = false; setMaterialBusy(false); }
  }

  async function openFile(material: Material) {
    if (!material.file_path) return;
    const tab = window.open("about:blank", "_blank");
    if (!tab) { actions.notify(t(lang, "请允许本站弹出窗口后重试。", "Allow popups for this site and retry.")); return; }
    tab.opener = null;
    try {
      const result = await apiFetch(actions.client, `/api/files/url?materialId=${encodeURIComponent(material.id)}`) as { url: string };
      tab.location.replace(result.url);
    } catch (error) { tab.close(); actions.notify(error instanceof Error ? error.message : "文件打开失败"); }
  }

  async function addShare() {
    try {
    if (!selected || !recipient) return;
    if (data.shares.some((row) => row.target_id === selected.id && row.recipient_id === recipient && !row.revoked_at)) { actions.notify(t(lang, "已经分享给该伙伴。", "Already shared with this partner.")); return; }
    const grant: ShareGrant = {
      id: crypto.randomUUID(), owner_id: data.profile.id, recipient_id: recipient,
      target_type: "material", target_id: selected.id, revoked_at: null, created_at: new Date().toISOString(),
    };
    await actions.upsert("share_grants", "shares", grant);
    setRecipient(""); actions.notify(t(lang, "已分享给学习伙伴", "Shared with your partner"));
    } catch { /* Workspace displays errors. */ }
  }

  async function postComment() {
    try {
    if (!share || !comment.trim()) return;
    const row: ShareComment = { id: crypto.randomUUID(), share_id: share.id, author_id: data.profile.id, body: comment.trim(), created_at: new Date().toISOString() };
    await actions.upsert("share_comments", "comments", row);
    setComment("");
    } catch { /* Workspace displays errors. */ }
  }

  return <div className="page-stack">
    <div className="page-intro"><div><span className="eyebrow">STUDY LIBRARY</span><h2>{t(lang, "资料库", "Study library")}</h2><p>{t(lang, "把有授权的资料整理成可练习的题组。", "Organise authorised materials into practice sets.")}</p></div><button className="button primary" disabled={materialBusy} onClick={() => { setNewMaterial({ skill: "reading", track: data.profile.track, visibility: "private", questions: [], tags: [] }); setFile(null); setCreating(!creating); setSelectedId(null); }}><Plus size={17} />{t(lang, "添加资料", "Add material")}</button></div>
    {creating && <section className="card editor-card"><div className="card-top"><h3>{t(lang, newMaterial.id ? "编辑资料" : "新建资料", newMaterial.id ? "Edit material" : "New material")}</h3><button className="icon-button" disabled={materialBusy} aria-label={t(lang, "关闭编辑", "Close editor")} onClick={() => setCreating(false)}><X size={18} /></button></div><form className="form-stack" onSubmit={(event) => void saveMaterial(event)}>
      <div className="form-grid"><label>{t(lang, "标题", "Title")}<input required maxLength={240} value={newMaterial.title ?? ""} onChange={(event) => update("title", event.target.value)} /></label><label>{t(lang, "科目", "Skill")}<select value={newMaterial.skill} onChange={(event) => update("skill", event.target.value as Skill)}>{skills.map((skill) => <option value={skill} key={skill}>{t(lang, skillLabels[skill].zh, skillLabels[skill].en)}</option>)}</select></label><label>{t(lang, "考试类型", "Track")}<select value={newMaterial.track} onChange={(event) => update("track", event.target.value as Material["track"])}><option value="academic">Academic</option><option value="general">General Training</option></select></label><label>{t(lang, "可见范围", "Visibility")}<select value={newMaterial.visibility} onChange={(event) => update("visibility", event.target.value as Material["visibility"])}><option value="private">{t(lang, "仅自己", "Private")}</option><option value="shared">{t(lang, "申请小组共享", "Request group sharing")}</option></select></label></div>
      <label>{t(lang, "练习说明或题目", "Instructions or prompt")}<textarea required rows={3} value={newMaterial.prompt ?? ""} onChange={(event) => update("prompt", event.target.value)} /></label>
      {(newMaterial.skill === "reading" || newMaterial.skill === "listening") && <><label>{t(lang, newMaterial.skill === "reading" ? "阅读文章" : "听力文字稿", newMaterial.skill === "reading" ? "Reading passage" : "Transcript")}<textarea rows={7} value={(newMaterial.skill === "reading" ? newMaterial.passage : newMaterial.transcript) ?? ""} onChange={(event) => update(newMaterial.skill === "reading" ? "passage" : "transcript", event.target.value)} /></label><div className="question-editor"><div className="card-top"><strong>{t(lang, "题目与答案", "Questions and answers")}</strong><button type="button" className="button small secondary" onClick={() => update("questions", [...(newMaterial.questions ?? []), { id: crypto.randomUUID(), type: "short", prompt: "", answers: [""], explanation: "" }])}><Plus size={15} />{t(lang, "添加题目", "Add question")}</button></div>{(newMaterial.questions ?? []).map((question, index) => <div className="question-edit-row" key={question.id}><span className="question-number">{index + 1}</span><div className="form-stack"><input aria-label={t(lang, "题目", "Question")} placeholder={t(lang, "题目", "Question")} value={question.prompt} onChange={(event) => update("questions", (newMaterial.questions ?? []).map((item) => item.id === question.id ? { ...item, prompt: event.target.value } : item))} /><textarea rows={2} aria-label={t(lang, "正确答案", "Accepted answers")} placeholder={t(lang, "每行一个可接受答案，支持逗号", "One accepted answer per line; commas are allowed")} value={question.answers.join("\n")} onChange={(event) => update("questions", (newMaterial.questions ?? []).map((item) => item.id === question.id ? { ...item, answers: event.target.value.split("\n") } : item))} /><div className="form-grid"><label>{t(lang, "本题题型", "Question type")}<input value={question.type} onChange={(event) => update("questions", (newMaterial.questions ?? []).map((item) => item.id === question.id ? { ...item, type: event.target.value } : item))} /></label><label>{t(lang, "答案词数上限（可选）", "Word limit (optional)")}<input type="number" min="1" max="30" value={question.word_limit ?? ""} onChange={(event) => update("questions", (newMaterial.questions ?? []).map((item) => item.id === question.id ? { ...item, word_limit: event.target.value ? Number(event.target.value) : undefined } : item))} /></label></div><input aria-label={t(lang, "解析", "Explanation")} placeholder={t(lang, "解析", "Explanation")} value={question.explanation} onChange={(event) => update("questions", (newMaterial.questions ?? []).map((item) => item.id === question.id ? { ...item, explanation: event.target.value } : item))} /></div><button className="icon-button subtle" aria-label={t(lang, "删除题目", "Delete question")} type="button" onClick={() => update("questions", (newMaterial.questions ?? []).filter((item) => item.id !== question.id))}><Trash2 size={16} /></button></div>)}</div></>}
      <div className="form-grid"><label>{t(lang, "题型", "Question type")}<input value={newMaterial.question_type ?? ""} onChange={(event) => update("question_type", event.target.value)} placeholder={t(lang, "例如：信息定位", "e.g. matching information")} /></label><label>{t(lang, "标签，逗号分隔", "Tags, separated by commas")}<input value={(newMaterial.tags ?? []).join(",")} onChange={(event) => update("tags", event.target.value.split(","))} /></label><label>{t(lang, "来源名称", "Source name")}<input value={newMaterial.source_title ?? ""} onChange={(event) => update("source_title", event.target.value)} /></label><label>{t(lang, "使用许可", "Licence or permission")}<input value={newMaterial.license_name ?? ""} onChange={(event) => update("license_name", event.target.value)} placeholder={t(lang, "例如：作者授权", "e.g. author permission")} /></label><label>{t(lang, "来源链接（可选）", "Source URL (optional)")}<input type="url" value={newMaterial.source_url ?? ""} onChange={(event) => update("source_url", event.target.value)} /></label><label>{t(lang, "附件（最大 25 MB）", "Attachment (max 25 MB)")}<input type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.mp3,.m4a,.wav,audio/*,image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label></div><button className="button primary" disabled={materialBusy} type="submit"><Upload size={16} />{t(lang, "保存资料", "Save material")}</button></form></section>}
    <section className="card"><div className="library-toolbar"><div className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t(lang, "搜索标题、题目或标签", "Search title, prompt or tags")} aria-label={t(lang, "搜索资料", "Search materials")} /></div><select value={skillFilter} aria-label={t(lang, "筛选科目", "Filter skill")} onChange={(event) => setSkillFilter(event.target.value as typeof skillFilter)}><option value="all">{t(lang, "全部科目", "All skills")}</option>{skills.map((skill) => <option value={skill} key={skill}>{t(lang, skillLabels[skill].zh, skillLabels[skill].en)}</option>)}</select></div>
      {filtered.length ? <div className="material-list">{filtered.map((material) => <button className={`material-row ${selectedId === material.id ? "selected" : ""}`} key={material.id} disabled={materialBusy} onClick={() => { setSelectedId(material.id); setCreating(false); setThreadId(null); setComment(""); }}><span className="material-icon">{material.file_kind?.startsWith("audio") ? <FileAudio size={20} /> : <FileText size={20} />}</span><span className="material-copy"><strong>{material.title}</strong><small>{material.question_type || skillLabels[material.skill].zh} · {material.source_title || t(lang, "私人资料", "Private material")}</small></span><SkillTag skill={material.skill} lang={lang} /><span className="approval-pill">{material.visibility === "private" ? t(lang, "私人", "Private") : material.approval === "approved" ? t(lang, "小组共享", "Shared") : t(lang, "待审核", "Pending")}</span><ChevronRight size={17} /></button>)}</div> : <div className="empty-inline"><LibraryBigIcon /><strong>{t(lang, "暂无匹配资料", "No matching materials")}</strong><p>{t(lang, "可添加自己的授权资料，或调整筛选条件。", "Add authorised material or change the filters.")}</p></div>}</section>
    {selected && <section className="card detail-card"><div className="card-top"><div><SkillTag skill={selected.skill} lang={lang} /><h3>{selected.title}</h3><p className="muted small">{selected.source_title} {selected.license_name && `· ${selected.license_name}`}</p></div><button className="icon-button" aria-label={t(lang, "关闭详情", "Close detail")} onClick={() => setSelectedId(null)}><X size={18} /></button></div><p className="prompt-preview">{selected.prompt}</p>{selected.file_path && <button className="button secondary" onClick={() => void openFile(selected)}><FileText size={16} />{t(lang, "打开附件", "Open attachment")}</button>}<div className="button-row"><button className="button primary" onClick={() => actions.openPractice(selected.id)}><BookOpen size={16} />{t(lang, "开始练习", "Start practice")}</button>{selected.owner_id === data.profile.id && <button className="button secondary" onClick={() => { setNewMaterial({ ...selected }); setFile(null); setCreating(true); }}>{t(lang, "编辑资料", "Edit material")}</button>}{selected.owner_id === data.profile.id && <button className="button danger-outline" onClick={() => { if (window.confirm(t(lang, "确认删除这份资料？", "Delete this material?"))) void actions.remove("materials", "materials", selected.id).then(() => setSelectedId(null)).catch(() => undefined); }}><Trash2 size={16} />{t(lang, "删除", "Delete")}</button>}</div>
      {selected.owner_id === data.profile.id && otherMembers.length > 0 && <div className="share-box"><strong>{t(lang, "单独分享", "Share privately")}</strong><div className="button-row"><select aria-label={t(lang, "分享接收者", "Share recipient")} value={recipient} onChange={(event) => setRecipient(event.target.value)}><option value="">{t(lang, "选择学习伙伴", "Choose a partner")}</option>{otherMembers.map((member) => <option value={member.id} key={member.id}>{member.display_name}</option>)}</select><button className="button secondary" disabled={!recipient} onClick={() => void addShare()}>{t(lang, "分享", "Share")}</button></div>{data.shares.filter((row) => row.target_type === "material" && row.target_id === selected.id && !row.revoked_at).map((row) => <div className="share-row" key={row.id}><span>{data.members.find((member) => member.id === row.recipient_id)?.display_name ?? t(lang, "学习伙伴", "Partner")}</span><button className="text-link" onClick={() => void actions.upsert("share_grants", "shares", { ...row, revoked_at: new Date().toISOString() }).catch(() => undefined)}>{t(lang, "撤销", "Revoke")}</button></div>)}</div>}
      {share && <div className="comments-box"><h4>{t(lang, "讨论", "Comments")}</h4>{threads.length > 1 && <select aria-label={t(lang, "讨论对象", "Comment thread")} value={share.id} onChange={(event) => { setThreadId(event.target.value); setComment(""); }}>{threads.map((thread) => <option key={thread.id} value={thread.id}>{data.members.find((member) => member.id === thread.recipient_id)?.display_name ?? "—"}</option>)}</select>}{relevantComments.map((row) => <p key={row.id}><strong>{data.members.find((member) => member.id === row.author_id)?.display_name ?? "—"}</strong> {row.body}</p>)}<div className="button-row"><input maxLength={2000} aria-label={t(lang, "评论", "Comment")} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t(lang, "写一条评论", "Write a comment")} /><button className="button secondary" onClick={() => void postComment()}>{t(lang, "发送", "Send")}</button></div></div>}
    </section>}
  </div>;
}

function LibraryBigIcon() { return <LibraryBig size={27} />; }

export function ProgressView({ data, actions }: Props) {
  const lang = data.profile.language;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.attempts.find((attempt) => attempt.id === selectedId) ?? null;
  const setSelected = (attempt: Attempt | null) => setSelectedId(attempt?.id ?? null);
  const [recipient, setRecipient] = useState("");
  const [attemptComment, setAttemptComment] = useState("");
  const activeShare = selected ? data.shares.find((share) => share.target_type === "attempt" && share.target_id === selected.id && !share.revoked_at && (share.recipient_id === data.profile.id || selected.owner_id === data.profile.id)) : null;
  const sorted = data.attempts.filter((attempt) => attempt.owner_id === data.profile.id).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  const sharedAttempts = data.attempts.filter((attempt) => attempt.owner_id !== data.profile.id && data.shares.some((share) => share.target_type === "attempt" && share.target_id === attempt.id && share.recipient_id === data.profile.id && !share.revoked_at));
  const bySkill = skills.map((skill) => {
    const list = sorted.filter((attempt) => attempt.skill === skill);
    const total = list.reduce((sum, attempt) => sum + (attempt.question_count ?? 0), 0);
    const correct = list.reduce((sum, attempt) => sum + (attempt.correct_count ?? 0), 0);
    return { skill, count: list.length, total, correct, rate: total ? Math.round(correct / total * 100) : null };
  });
  const { recent: visible, archived } = groupAttemptHistory(sorted);
  const members = data.members.filter((member) => member.id !== data.profile.id);
  const feedbackRows = sorted.filter((attempt) => attempt.feedback || attempt.feedback_tags?.length);
  const tags = feedbackRows.flatMap((attempt) => [...new Set(attempt.feedback?.tags ?? attempt.feedback_tags ?? [])]);
  const repeated = feedbackRows.length >= 3 ? [...new Set(tags)].filter((tag) => tags.filter((value) => value === tag).length >= 2) : [];
  const stats = new Map<string, { questionType: string; samples: number; questions: number; correct: number; seconds: number; minutes: number }>();
  for (const attempt of sorted.filter((row) => row.skill === "reading" || row.skill === "listening")) {
    const groups = attempt.question_stats?.length ? attempt.question_stats : [{ type: data.materials.find((material) => material.id === attempt.material_id)?.question_type || t(lang, "未标注题型", "Unspecified"), count: attempt.question_count ?? 0, correct: attempt.correct_count ?? 0 }];
    for (const group of groups) {
      const questionType = skillLabels[attempt.skill][lang] + " · " + group.type;
      const row = stats.get(questionType) ?? { questionType, samples: 0, questions: 0, correct: 0, seconds: 0, minutes: 0 };
      row.samples++; row.questions += group.count; row.correct += group.correct;
      row.seconds += attempt.duration_seconds * group.count / Math.max(1, attempt.question_count ?? group.count);
      row.minutes = Math.round(row.seconds / row.samples / 60); stats.set(questionType, row);
    }
  }
  const typeStats = [...stats.values()];

  async function shareAttempt() {
    try {
    if (!selected || !recipient) return;
    const row: ShareGrant = { id: crypto.randomUUID(), owner_id: data.profile.id, recipient_id: recipient, target_type: "attempt", target_id: selected.id, revoked_at: null, created_at: new Date().toISOString() };
    await actions.upsert("share_grants", "shares", row);
    setRecipient(""); actions.notify(t(lang, "已分享练习记录", "Practice record shared"));
    } catch { /* Workspace displays errors. */ }
  }

  async function postAttemptComment() {
    try {
    if (!activeShare || !attemptComment.trim()) return;
    const row: ShareComment = { id: crypto.randomUUID(), share_id: activeShare.id, author_id: data.profile.id, body: attemptComment.trim(), created_at: new Date().toISOString() };
    await actions.upsert("share_comments", "comments", row);
    setAttemptComment("");
    } catch { /* Workspace displays errors. */ }
  }

  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">PERSONAL INSIGHTS</span><h2>{t(lang, "看见自己的进步", "See your progress")}</h2><p>{t(lang, "只根据你的练习记录显示趋势；数据少时先不下结论。", "Trends use your own practice only. Small samples stay unlabelled.")}</p></div></div>
    <div className="insight-grid">{bySkill.map((entry) => <section className="card insight-card" key={entry.skill}><SkillTag skill={entry.skill} lang={lang} /><strong>{entry.count}</strong><span>{t(lang, "次练习", "sessions")}</span>{entry.rate !== null && <div className="rate-line"><span>{t(lang, "客观题正确率", "Answer accuracy")}</span><b>{entry.rate}%</b></div>}{entry.count < (entry.skill === "reading" || entry.skill === "listening" ? 2 : 3) && <small className="muted">{t(lang, "继续练习以积累数据", "More practice needed")}</small>}</section>)}</div>
    {typeStats.length > 0 && <section className="card"><h3>{t(lang, "阅读与听力题型", "Reading and listening question types")}</h3><div className="type-stats">{typeStats.map((item) => <div className="type-stat-row" key={item.questionType}><strong>{item.questionType}</strong><span>{item.samples >= 2 && item.questions >= 10 ? `${Math.round(item.correct / item.questions * 100)}% · ${item.minutes} ${t(lang, "分钟/次", "min/session")}` : t(lang, "继续练习以积累数据", "More practice needed")}</span></div>)}</div></section>}
    <section className="card"><div className="card-top"><h3>{t(lang, "值得关注的主题", "Themes to work on")}</h3><span className="muted small">{t(lang, "来自重复出现的反馈", "From repeated feedback")}</span></div>{repeated.length ? <div className="tag-list">{repeated.map((tag) => <span className="soft-tag" key={tag}>{tag}</span>)}</div> : <p className="empty-text">{t(lang, "继续练习后，这里会显示反复出现的建议。", "Recurring suggestions will appear after more practice.")}</p>}</section>
    {sharedAttempts.length > 0 && <section className="card"><h3>{t(lang, "伙伴分享的练习", "Shared by partners")}</h3><div className="attempt-list">{sharedAttempts.map((attempt) => <button className="attempt-row" key={attempt.id} onClick={() => setSelected(attempt)}><SkillTag skill={attempt.skill} lang={lang} /><span><strong>{data.members.find((member) => member.id === attempt.owner_id)?.display_name ?? t(lang, "学习伙伴", "Partner")}</strong><small>{new Date(attempt.submitted_at).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US")}</small></span><ChevronRight size={17} /></button>)}</div></section>}
    <section className="card"><div className="card-top"><h3>{t(lang, "最近练习", "Recent practice")}</h3><span className="muted small">{t(lang, "每题最近 5 次", "Latest 5 per set")}</span></div>{visible.length ? <div className="attempt-list">{visible.map((attempt) => <button className="attempt-row" key={attempt.id} onClick={() => setSelected(attempt)}><SkillTag skill={attempt.skill} lang={lang} /><span><strong>{data.materials.find((material) => material.id === attempt.material_id)?.title ?? t(lang, "自由练习", "Free practice")}</strong><small>{new Date(attempt.submitted_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</small></span><ChevronRight size={17} /></button>)}</div> : <p className="empty-text">{t(lang, "还没有练习记录。", "No practice records yet.")}</p>}</section>
    {archived.length > 0 && <details className="card archive-card"><summary>{t(lang, "个人归档", "Personal archive")} · {archived.length}</summary><div className="attempt-list">{archived.map((attempt) => <button className="attempt-row" key={attempt.id} onClick={() => setSelected(attempt)}><SkillTag skill={attempt.skill} lang={lang} /><span><strong>{data.materials.find((material) => material.id === attempt.material_id)?.title ?? t(lang, "自由练习", "Free practice")}</strong><small>{new Date(attempt.submitted_at).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US")}</small></span><ChevronRight size={17} /></button>)}</div><button className="text-link danger-text" onClick={() => { if (window.confirm(t(lang, "清空个人归档？此操作无法撤销。", "Clear archived attempts? This cannot be undone."))) void Promise.all(archived.map((attempt) => actions.remove("practice_attempts", "attempts", attempt.id))); }}>{t(lang, "清空归档", "Clear archive")}</button></details>}
    {selected && <div className="modal-backdrop" onMouseDown={() => setSelected(null)}><div className="modal-card" role="dialog" aria-modal="true" aria-label={t(lang, "练习详情", "Practice detail")} onMouseDown={(event) => event.stopPropagation()}><div className="card-top"><div><SkillTag skill={selected.skill} lang={lang} /><h3>{data.materials.find((material) => material.id === selected.material_id)?.title ?? t(lang, "自由练习", "Free practice")}</h3></div><button className="icon-button" aria-label={t(lang, "关闭详情", "Close detail")} onClick={() => setSelected(null)}><X size={18} /></button></div><p className="muted small">{new Date(selected.submitted_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</p>{selected.purged_at ? <p>{t(lang, "原始内容已按一年保存期限清除，统计仍保留。", "Original content was removed after one year; statistics remain.")}</p> : <><div className="detail-answer">{selected.answer_body && Object.entries(selected.answer_body).map(([key, value]) => <p key={key}><strong>{key}</strong> {value}</p>)}{selected.transcript && <p>{selected.transcript}</p>}</div>{selected.feedback && <div className="feedback-box"><strong>{t(lang, "反馈", "Feedback")}</strong><p>{selected.feedback.summary}</p>{selected.feedback.priorities.map((point, index) => <p key={index}>• {point}</p>)}</div>}</>}{selected.question_count !== null && <p>{t(lang, "正确", "Correct")}: {selected.correct_count} / {selected.question_count}</p>}
      {activeShare && <div className="share-box"><strong>{t(lang, "练习评论", "Practice comments")}</strong>{data.comments.filter((item) => item.share_id === activeShare.id).map((item) => <p key={item.id}><b>{data.members.find((member) => member.id === item.author_id)?.display_name ?? t(lang, "学习伙伴", "Partner")}</b>：{item.body}</p>)}<div className="button-row"><input maxLength={2000} aria-label={t(lang, "评论", "Comment")} value={attemptComment} onChange={(event) => setAttemptComment(event.target.value)} placeholder={t(lang, "写下评论", "Write a comment")} /><button className="button secondary" disabled={!attemptComment.trim()} onClick={() => void postAttemptComment()}>{t(lang, "发送", "Post")}</button></div></div>}{selected.owner_id === data.profile.id && members.length > 0 && !selected.purged_at && <div className="share-box"><strong>{t(lang, "分享这次练习", "Share this attempt")}</strong><div className="button-row"><select aria-label={t(lang, "分享接收者", "Share recipient")} value={recipient} onChange={(event) => setRecipient(event.target.value)}><option value="">{t(lang, "选择学习伙伴", "Choose a partner")}</option>{members.map((member) => <option value={member.id} key={member.id}>{member.display_name}</option>)}</select><button className="button secondary" disabled={!recipient} onClick={() => void shareAttempt()}>{t(lang, "分享", "Share")}</button></div>{data.shares.filter((row) => row.target_type === "attempt" && row.target_id === selected.id && !row.revoked_at).map((row) => <div className="share-row" key={row.id}><span>{data.members.find((member) => member.id === row.recipient_id)?.display_name}</span><button className="text-link" onClick={() => void actions.upsert("share_grants", "shares", { ...row, revoked_at: new Date().toISOString() }).catch(() => undefined)}>{t(lang, "撤销", "Revoke")}</button></div>)}</div>}
      {selected.owner_id === data.profile.id && <button className="button danger-outline" onClick={() => { if (window.confirm(t(lang, "删除这条练习记录？", "Delete this practice record?"))) void actions.remove("practice_attempts", "attempts", selected.id).then(() => setSelected(null)); }}><Trash2 size={16} />{t(lang, "删除记录", "Delete record")}</button>}</div></div>}
  </div>;
}

export function SettingsView({ data, actions, onLogout }: Props & { onLogout: (scope?: "local" | "global") => Promise<void> }) {
  const lang = data.profile.language;
  const [draft, setDraft] = useState(data.profile);
  const [provider, setProvider] = useState<"deepseek" | "qwen">("deepseek");
  const [textKey, setTextKey] = useState("");
  const [asrKey, setAsrKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [asrWorkspaceId, setAsrWorkspaceId] = useState("");
  const [keyStatus, setKeyStatus] = useState<{ text: boolean; asr: boolean } | null>(null);
  useEffect(() => { setDraft(data.profile); }, [data.profile]);
  useEffect(() => {
    if (!actions.client) return;
    void apiFetch(actions.client, "/api/ai/config").then((value) => {
      const config = value as { provider?: "deepseek" | "qwen"; text?: boolean; asr?: boolean; workspaceId?: string; asrWorkspaceId?: string };
      setProvider(config.provider ?? "deepseek"); setKeyStatus({ text: !!config.text, asr: !!config.asr }); setWorkspaceId(config.workspaceId ?? ""); setAsrWorkspaceId(config.asrWorkspaceId ?? "");
    }).catch(() => undefined);
  }, [actions.client]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (draft.ai_enabled && (!draft.monthly_budget_cny || draft.monthly_budget_cny <= 0)) { actions.notify(t(lang, "启用 AI 前请设置月度预算", "Set a monthly budget before enabling AI")); return; }
    try { new Intl.DateTimeFormat("en", { timeZone: draft.timezone }).format(); } catch { actions.notify(t(lang, "请输入有效时区，例如 Asia/Shanghai。", "Enter a valid time zone, such as Asia/Shanghai.")); return; }
    await actions.updateProfile(draft).catch(() => undefined);
  }

  async function saveKey(kind: "text" | "asr") {
    try {
      const key = kind === "text" ? textKey : asrKey;
      if (!key.trim()) return;
      await apiFetch(actions.client, "/api/ai/config", { method: "POST", body: JSON.stringify({ kind, provider: kind === "text" ? provider : "qwen-asr", key: key.trim(), workspaceId: kind === "asr" ? asrWorkspaceId.trim() : provider === "qwen" ? workspaceId.trim() : "" }) });
      setKeyStatus((previous) => ({ text: kind === "text" ? true : !!previous?.text, asr: kind === "asr" ? true : !!previous?.asr }));
      kind === "text" ? setTextKey("") : setAsrKey("");
      actions.notify(t(lang, "密钥已加密保存", "Key saved securely"));
    } catch (error) { actions.notify(error instanceof Error ? error.message : "保存失败"); }
  }

  async function deleteKey(kind: "text" | "asr") {
    if (!window.confirm(t(lang, "确定删除该服务密钥？", "Delete this provider key?"))) return;
    try {
      await apiFetch(actions.client, "/api/ai/config", { method: "DELETE", body: JSON.stringify({ kind }) });
      setKeyStatus((previous) => ({ text: kind === "text" ? false : !!previous?.text, asr: kind === "asr" ? false : !!previous?.asr }));
      actions.notify(t(lang, "密钥已删除", "Key deleted"));
    } catch (error) { actions.notify(error instanceof Error ? error.message : "删除失败"); }
  }

  async function deleteAccount() {
    if (demoMode) { actions.notify(t(lang, "演示模式没有云端账号", "No cloud account in demo mode")); return; }
    if (!window.confirm(t(lang, "这会删除你的账号和私人学习记录。确定继续？", "This deletes your account and private study data. Continue?"))) return;
    try {
      await apiFetch(actions.client, "/api/account", { method: "DELETE" });
      await onLogout("global");
    } catch (error) { actions.notify(error instanceof Error ? error.message : "注销失败"); }
  }

  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">YOUR PREFERENCES</span><h2>{t(lang, "个人设置", "Settings")}</h2><p>{t(lang, "目标、学习节奏和提醒都可以调整。", "Adjust your goals, pace and reminders.")}</p></div></div>
    <section className="card"><h3>{t(lang, "备考目标", "Study goals")}</h3><form className="form-stack" onSubmit={(event) => void saveProfile(event)}><div className="form-grid"><label>{t(lang, "昵称", "Nickname")}<input required maxLength={32} value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} /></label><label>{t(lang, "考试类型", "Track")}<select value={draft.track} onChange={(event) => setDraft({ ...draft, track: event.target.value as Profile["track"] })}><option value="academic">Academic</option><option value="general">General Training</option></select></label><label>{t(lang, "目标总分", "Overall target")}<input type="number" min="0" max="9" step="0.5" value={draft.goal_overall ?? ""} onChange={(event) => setDraft({ ...draft, goal_overall: event.target.value ? Number(event.target.value) : null })} /></label><label>{t(lang, "考试日期", "Exam date")}<input type="date" value={draft.target_date ?? ""} onChange={(event) => setDraft({ ...draft, target_date: event.target.value || null })} /></label><label>{t(lang, "每周小时数", "Hours per week")}<input type="number" min="1" max="80" value={draft.weekly_hours} onChange={(event) => setDraft({ ...draft, weekly_hours: Number(event.target.value) })} /></label></div><div className="form-grid four">{(["listening", "reading", "writing", "speaking"] as const).map((skill) => <label key={skill}>{t(lang, skillLabels[skill].zh, skillLabels[skill].en)} {t(lang, "目标（可选）", "target (optional)")}<input type="number" min="0" max="9" step="0.5" value={draft[`goal_${skill}`] ?? ""} onChange={(event) => setDraft({ ...draft, [`goal_${skill}`]: event.target.value ? Number(event.target.value) : null })} /></label>)}</div><h4>{t(lang, "邮件提醒", "Email reminder")}</h4><label className="switch-row"><span>{t(lang, "每天提醒未完成任务和待复习词汇", "Daily reminder for tasks and due words")}</span><input type="checkbox" checked={draft.reminder_on} onChange={(event) => setDraft({ ...draft, reminder_on: event.target.checked })} /></label><div className="form-grid"><label>{t(lang, "提醒时间", "Reminder time")}<input type="time" value={draft.reminder_time.slice(0, 5)} onChange={(event) => setDraft({ ...draft, reminder_time: event.target.value })} /></label><label>{t(lang, "时区", "Time zone")}<input value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} /></label></div><button className="button primary" type="submit">{t(lang, "保存设置", "Save settings")}</button></form></section>
    <section className="card"><div className="card-top"><div><h3>{t(lang, "AI 服务与预算", "AI providers and budget")}</h3><p className="muted small">{t(lang, "仅在你主动提交内容时发送到所选服务商。费用由你的服务商账号结算。", "Content is sent to your chosen provider only when you submit. Your provider bills your account.")}</p></div></div><label className="switch-row"><span>{t(lang, "启用 AI 反馈", "Enable AI feedback")}</span><input type="checkbox" checked={draft.ai_enabled} onChange={(event) => setDraft({ ...draft, ai_enabled: event.target.checked })} /></label><label>{t(lang, "月度预算（人民币，启用 AI 时必填）", "Monthly budget in CNY (required for AI)")}<input type="number" min="1" step="1" value={draft.monthly_budget_cny ?? ""} onChange={(event) => setDraft({ ...draft, monthly_budget_cny: event.target.value ? Number(event.target.value) : null })} /></label><button className="button secondary" onClick={() => { if (draft.ai_enabled && (!draft.monthly_budget_cny || draft.monthly_budget_cny <= 0)) { actions.notify(t(lang, "启用 AI 前请设置月度预算", "Set a monthly budget before enabling AI")); return; } void actions.updateProfile(draft).catch(() => undefined); }}>{t(lang, "保存 AI 开关与预算", "Save AI preference")}</button>
      <div className="provider-grid"><div className="provider-box"><strong>{t(lang, "文本反馈", "Text feedback")}</strong><p>{t(lang, "写作、口语建议与批注", "Writing and speaking feedback")}</p><label>{t(lang, "服务商", "Provider")}<select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="deepseek">DeepSeek</option><option value="qwen">阿里云百炼 Qwen</option></select></label>{provider === "qwen" && <label>Workspace ID<input value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} /></label>}<label>API Key<input type="password" autoComplete="off" value={textKey} onChange={(event) => setTextKey(event.target.value)} placeholder={keyStatus?.text ? "•••••• 已保存" : "sk-…"} /></label><div className="button-row"><button className="button secondary" onClick={() => void saveKey("text")}>{t(lang, "保存密钥", "Save key")}</button>{keyStatus?.text && <button className="text-link danger-text" onClick={() => void deleteKey("text")}>{t(lang, "删除", "Delete")}</button>}</div></div><div className="provider-box"><strong>{t(lang, "录音转写", "Speech transcription")}</strong><p>{t(lang, "阿里云百炼 Paraformer", "Alibaba Model Studio Paraformer")}</p><label>Workspace ID<input value={asrWorkspaceId} onChange={(event) => setAsrWorkspaceId(event.target.value)} /></label><label>API Key<input type="password" autoComplete="off" value={asrKey} onChange={(event) => setAsrKey(event.target.value)} placeholder={keyStatus?.asr ? "•••••• 已保存" : "sk-…"} /></label><div className="button-row"><button className="button secondary" onClick={() => void saveKey("asr")}>{t(lang, "保存密钥", "Save key")}</button>{keyStatus?.asr && <button className="text-link danger-text" onClick={() => void deleteKey("asr")}>{t(lang, "删除", "Delete")}</button>}</div></div></div></section>
    <section className="card"><h3>{t(lang, "账号与会话", "Account and sessions")}</h3><div className="button-row"><button className="button secondary" onClick={() => void onLogout("local")}>{t(lang, "退出当前设备", "Sign out here")}</button><button className="button secondary" onClick={() => void onLogout("global")}>{t(lang, "退出所有设备", "Sign out everywhere")}</button></div><div className="danger-zone"><p>{t(lang, "注销将删除私人资料与学习记录。加密备份最多保留四周，恢复时会重放删除记录。", "Deleting your account removes private data. Encrypted backups may remain for up to four weeks; deletion is replayed on restore.")}</p><button className="button danger-outline" onClick={() => void deleteAccount()}>{t(lang, "注销账号", "Delete account")}</button></div></section>
  </div>;
}

export function AdminView({ data, actions }: Props) {
  const lang = data.profile.language;
  const [code, setCode] = useState("");
  const [inviteActive, setInviteActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = data.materials.filter((material) => material.visibility === "shared" && material.approval === "pending");
  const members = data.members.filter((member) => member.id !== data.profile.id);

  useEffect(() => {
    if (!actions.client) return;
    void apiFetch(actions.client, "/api/admin/invite").then((value) => setInviteActive((value as { active: boolean }).active)).catch(() => undefined);
  }, [actions.client]);

  async function invite(action: "rotate" | "toggle") {
    setBusy(true);
    try {
      const result = await apiFetch(actions.client, "/api/admin/invite", { method: "POST", body: JSON.stringify({ action, active: !inviteActive }) }) as { code?: string; active: boolean };
      if (result.code) setCode(result.code);
      setInviteActive(result.active);
      actions.notify(t(lang, "邀请码设置已更新", "Invitation settings updated"));
    } catch (error) { actions.notify(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(t(lang, `移除 ${member.display_name}？其登录和数据访问会立即停用。`, `Remove ${member.display_name}? Their access will stop immediately.`))) return;
    try {
      await apiFetch(actions.client, "/api/admin/members", { method: "POST", body: JSON.stringify({ memberId: member.id, action: "remove" }) });
      await actions.refresh();
      actions.notify(t(lang, "成员已移除", "Member removed"));
    } catch (error) { actions.notify(error instanceof Error ? error.message : "操作失败"); }
  }

  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">GROUP ADMIN</span><h2>{t(lang, "小组管理", "Group administration")}</h2><p>{t(lang, "管理邀请与共享资料。成员私人学习记录不会出现在这里。", "Manage invitations and shared material. Private study records stay private.")}</p></div></div>
    <div className="two-column"><section className="card"><h3>{t(lang, "邀请码", "Invitation code")}</h3><p className="muted">{inviteActive ? t(lang, "当前允许凭邀请码注册。", "Code registration is active.") : t(lang, "当前已暂停邀请码注册。", "Code registration is paused.")}</p><div className="button-row"><button className="button primary" disabled={busy} onClick={() => void invite("rotate")}>{t(lang, "生成新邀请码", "Rotate code")}</button><button className="button secondary" disabled={busy} onClick={() => void invite("toggle")}>{inviteActive ? t(lang, "停用", "Disable") : t(lang, "启用", "Enable")}</button></div>{code && <div className="code-reveal"><small>{t(lang, "新邀请码仅在此显示一次，请安全发给学习伙伴", "This new code is shown once. Share it privately.")}</small><strong>{code}</strong><button className="text-link" onClick={() => void navigator.clipboard.writeText(code)}>{t(lang, "复制", "Copy")}</button></div>}</section>
    <section className="card"><h3>{t(lang, "成员", "Members")}</h3><p className="muted small">{data.members.length} / 5 {t(lang, "个活动账号", "active accounts")}</p><div className="member-list">{members.map((member) => <div className="member-row" key={member.id}><span className="avatar small-avatar">{member.display_name.slice(0, 1)}</span><strong>{member.display_name}</strong><button className="text-link danger-text" onClick={() => void removeMember(member)}>{t(lang, "移除", "Remove")}</button></div>)}</div></section></div>
    <section className="card"><div className="card-top"><h3>{t(lang, "待审核共享资料", "Shared material to review")}</h3><span className="round-count">{pending.length}</span></div>{pending.length ? <div className="material-list">{pending.map((material) => <div className="approval-row" key={material.id}><div><strong>{material.title}</strong><small>{material.source_title} · {material.license_name}</small><p>{material.prompt.slice(0, 180)}</p></div><div className="button-row"><button className="button small primary" onClick={() => void actions.upsert("materials", "materials", { ...material, approval: "approved" }).catch(() => undefined)}>{t(lang, "通过", "Approve")}</button><button className="button small secondary" onClick={() => void actions.upsert("materials", "materials", { ...material, approval: "rejected" }).catch(() => undefined)}>{t(lang, "退回", "Reject")}</button></div></div>)}</div> : <p className="empty-text">{t(lang, "目前没有待审核资料。", "Nothing to review right now.")}</p>}</section>
  </div>;
}





