"use client";
import { useState } from "react";
import { ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, Sparkles } from "lucide-react";
import { answeredCount } from "@/lib/practice-sessions";
import { daysUntil, dueWords, localDate, skillLabels, skills, startOfWeek } from "@/lib/study";
import type { StudyTask, WorkspaceData } from "@/lib/types";
import type { ViewActions } from "./views";
import { t } from "./workspace";

export function TodayView({ data, actions }: { data: WorkspaceData; actions: ViewActions }) {
  const { profile, tasks, attempts, words } = data, lang = profile.language;
  const today = localDate(new Date(), profile.timezone);
  const [showAll, setShowAll] = useState(false);
  const [savingTask, setSavingTask] = useState<string | null>(null);
  const pending = tasks.filter((task) => task.owner_id === profile.id && task.planned_date === today && task.status === "todo").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const backlog = tasks.filter((task) => task.owner_id === profile.id && task.planned_date < today && task.status === "todo").sort((a, b) => b.planned_date.localeCompare(a.planned_date));
  const weekly = tasks.filter((task) => task.owner_id === profile.id && task.week_start === startOfWeek(new Date(), profile.timezone));
  const done = weekly.filter((task) => task.status === "done").length;
  const due = dueWords(words).length, days = daysUntil(profile.target_date, profile.timezone);
  const resume = profile.track === "academic" ? [...actions.sessions.sessions].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] : undefined;
  const material = resume && data.materials.find((m) => m.id === resume.material_id);
  const start = (task: StudyTask) => task.question_id && !task.review_attempt_id ? actions.notify(t(lang,"原练习已删除，无法继续此题复盘。", "Original attempt deleted; this review is unavailable.")) : task.review_attempt_id ? actions.openReview(task.review_attempt_id, task.question_id ?? undefined) : task.skill === "vocabulary" ? actions.setView("vocabulary") : actions.openPractice(task.material_id, task.skill);
  async function updateTask(task: StudyTask, patch: Partial<StudyTask>) {
    if (savingTask || task.status !== "todo") return;
    setSavingTask(task.id);
    try {
      const row = { ...task, ...patch };
      if (actions.client) {
        const { data: changed, error } = await actions.client.from("study_tasks").update(patch).eq("id", task.id).eq("owner_id", profile.id).eq("status", "todo").eq("planned_date", task.planned_date).select("id");
        if (error) throw error;
        await actions.refresh();
        if (!changed?.length) { actions.notify(t(lang, "任务已在其他页面变化，请查看最新状态。", "This task changed elsewhere. Check its latest status.")); return; }
      } else await actions.upsert("study_tasks", "tasks", row);
      actions.notify(t(lang, patch.status === "done" ? "任务已完成" : "任务已改期", patch.status === "done" ? "Task completed" : "Task rescheduled"));
    } catch (error) { actions.notify(error instanceof Error ? error.message : t(lang, "任务未保存，请重试", "Task was not saved. Retry.")); }
    finally { setSavingTask(null); }
  }
  function taskRow(task: StudyTask) {
    return <div className="task-row" key={task.id}>
      <button disabled={!!savingTask} className="check-button" aria-label={t(lang, `完成任务：${task.title}`, `Complete: ${task.title}`)} onClick={() => void updateTask(task, { status: "done" })}><Check size={16} /></button>
      <div className="task-copy"><div><span className={`skill-tag skill-${task.skill}`}>{t(lang, skillLabels[task.skill].zh, skillLabels[task.skill].en)}</span><span className="task-minutes"><Clock3 size={13} />{task.minutes} min</span></div><strong>{task.title}</strong><small>{task.planned_date < today ? `${t(lang, "原计划", "Originally")} ${task.planned_date}` : task.rationale}</small></div>
      <div className="today-task-actions"><button className="task-open" title={t(lang, "开始", "Start")} aria-label={t(lang, `开始：${task.title}`, `Start: ${task.title}`)} onClick={() => start(task)}><ArrowRight size={18} /></button><label className="task-reschedule">{t(lang, "改期", "Move")}<input type="date" aria-label={t(lang, `改期：${task.title}`, `Reschedule: ${task.title}`)} value={task.planned_date} disabled={!!savingTask} onChange={(e) => { if (e.target.value) void updateTask(task, { planned_date: e.target.value, week_start: startOfWeek(new Date(e.target.value + "T12:00:00")) }); }} /></label></div>
    </div>;
  }
  const primary = pending[0];
  return <div className="page-stack">
    <div className="welcome-row"><div><h2>{t(lang, `${profile.display_name}，今天从这里开始。`, `Welcome back, ${profile.display_name}.`)}</h2><p>{t(lang, "一次专注一件事，按自己的节奏完成。", "Focus on one thing at a time.")}</p></div><div className="date-stamp"><CalendarDays size={18} /><span>{today}</span></div></div>
    <section className="today-focus">
      <div><span className="focus-label">{resume && material ? t(lang, "继续上次", "Pick up where you left off") : primary ? t(lang, "今日主任务", "Today's focus") : t(lang, "下一步", "Your next step")}</span>
        <h3>{resume && material ? material.title : primary ? primary.title : due ? t(lang, `复习 ${due} 个到期词汇`, `Review ${due} due words`) : t(lang, "为今天选一组练习", "Choose a practice set")}</h3>
        <p>{resume && material ? `${t(lang, skillLabels[resume.skill].zh, skillLabels[resume.skill].en)} · ${answeredCount(resume)}/${resume.state.questionIds.length} ${t(lang, "已答", "answered")} · ${actions.sessions.status(resume.material_id) === "saved" ? t(lang, "已保存", "Saved") : actions.sessions.status(resume.material_id) === "conflict" ? t(lang, "有版本冲突，作答已保留", "Conflicting versions retained") : t(lang, "本机保存中或等待同步", "Saving locally or awaiting sync")}` : primary ? `${primary.minutes} min · ${primary.rationale}` : t(lang, "练习与复习都计入本周学习时间。", "Practice and review share your weekly time budget.")}</p>
      </div><button className="button primary" onClick={() => resume && material ? actions.openPractice(material.id, material.skill) : primary ? start(primary) : due ? actions.setView("vocabulary") : actions.setView("practice")}>{resume && material ? t(lang, "继续作答", "Resume practice") : t(lang, "开始", "Start")}<ArrowRight size={17} /></button>
    </section>
    <div className="dashboard-grid">
      <section className="card task-card"><div className="card-top"><h3>{t(lang, "今日任务", "Today's tasks")}</h3><span className="round-count">{pending.length}</span></div>
        {pending.length ? <><div className="task-list">{(showAll ? pending : pending.slice(0, 3)).map(taskRow)}</div>{pending.length > 3 && <button className="text-action" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? t(lang, "收起", "Show less") : t(lang, `查看全部 ${pending.length} 项`, `Show all ${pending.length} tasks`)}</button>}</> : <div className="empty-inline"><CheckCircle2 size={28} /><strong>{t(lang, weekly.length ? "今天没有待完成任务" : "先安排第一周的学习", weekly.length ? "No tasks due today" : "Plan your first study week")}</strong><p>{t(lang, "可以复习词汇，或选择一组练习。", "Review words or choose a practice set.")}</p></div>}
        {backlog.length > 0 && <details className="task-backlog"><summary>{t(lang, "积压任务", "Earlier tasks")} ({backlog.length})<span>{t(lang, "展开后可改期", "Expand to reschedule")}</span></summary><div className="task-list">{backlog.map(taskRow)}</div></details>}
        <button className="text-action" onClick={() => actions.setView("plan")}>{t(lang, "查看本周计划", "View weekly plan")}<ChevronRight size={16} /></button>
      </section>
      <div className="dashboard-side"><section className="card progress-card"><h3>{t(lang, "本周进度", "Weekly progress")}</h3><div className="progress-number">{done}<span> / {weekly.length || "—"}</span></div><div className="meter"><span style={{ width: `${weekly.length ? Math.round(done / weekly.length * 100) : 0}%` }} /></div><p>{t(lang, "已完成的计划任务", "planned tasks completed")}</p><p className="muted small">{weekly.reduce((sum, task) => sum + task.minutes, 0)} / {Math.round(profile.weekly_hours * 60)} min {t(lang, "已安排 / 周预算", "planned / weekly budget")}</p><button className="text-action" onClick={() => actions.setView("progress")}>{t(lang, "查看个人进度", "View progress")}<ChevronRight size={16} /></button></section>
        <section className="card quick-stats"><div><span className="stat-icon"><BookOpen size={19} /></span><div><strong>{due}</strong><button className="text-link" onClick={() => actions.setView("vocabulary")}>{t(lang, `复习 ${due} 个词`, `Review ${due} words`)}</button></div></div><div><span className="stat-icon"><CalendarDays size={19} /></span><div><strong>{days ?? "—"}</strong><small>{t(lang, "距离考试天数", "days to exam")}</small></div></div><div><span className="stat-icon"><Sparkles size={19} /></span><div><strong>{attempts.filter((a) => a.owner_id === profile.id).length}</strong><small>{t(lang, "累计练习记录", "practice sessions")}</small></div></div></section></div>
    </div>
    <section className="quick-start"><div><h3>{t(lang, "按科目练习", "Practise by skill")}</h3></div><div className="skill-tiles">{skills.map((skill) => <button key={skill} className={`skill-tile skill-${skill}`} onClick={() => actions.openPractice(null, skill)}><span>{t(lang, skillLabels[skill].zh, skillLabels[skill].en)}</span><ArrowRight size={18} /></button>)}</div></section>
  </div>;
}
