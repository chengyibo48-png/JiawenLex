"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, demoMode } from "@/lib/supabase";
import { practiceMaterials } from "@/lib/practice-sessions";
import {
  archiveLocalDraft,
  conflictCopies,
  saveLocalDraft,
  type LocalDraft,
} from "@/lib/offline-drafts";
import {
  completionRule,
  materialUnit,
  microComplete,
  newMicroState,
  originalUnits,
  parseMicroState,
  topicMatches,
  trainingNames,
  type MicroState,
  type MicroUnit,
  type TrainingKind,
} from "@/lib/micro-training";
import { normalizeTerm } from "@/lib/review";
import type { WorkspaceData } from "@/lib/types";
import type { ViewActions } from "./views";
import { useWritingDraft } from "./use-writing-draft";
import { t } from "./workspace";
export function MicroTrainingView({
  data,
  actions,
  onGuard,
}: {
  data: WorkspaceData;
  actions: ViewActions;
  onGuard: (guard: (() => Promise<boolean>) | null, materialId?: string | null) => void;
}) {
  const lang = data.profile.language;
  const units = [
    ...originalUnits,
    ...practiceMaterials(data)
      .map(materialUnit)
      .filter((unit): unit is MicroUnit => unit !== null),
  ];
  const [topic, setTopic] = useState(actions.microTarget?.topic ?? ""),
    [key, setKey] = useState(actions.microTarget?.unitKey ?? null);
  const [search,setSearch]=useState(""),[page,setPage]=useState(1);
  const [kind, setKind] = useState<TrainingKind>("none");
  const guard = useRef<(() => Promise<boolean>) | null>(null);
  useEffect(() => {
    if (actions.microTarget) {
      setTopic(actions.microTarget.topic ?? "");
      setKey(actions.microTarget.unitKey ?? null);
    }
  }, [actions.microTarget?.requestId]);
  const selected = units.find((unit) => unit.key === key);
  const list = units.filter(
    (unit) =>
      (kind === "none" || unit.kind === kind) && topicMatches(unit, topic)&&[unit.title,unit.source,...unit.items.map(i=>i.prompt)].join(" ").toLowerCase().includes(search.trim().toLowerCase()),
  );
  useEffect(()=>setPage(1),[kind,topic,search]);
  const currentPage=Math.min(page,Math.max(1,Math.ceil(list.length/36)));
  const visible=list.slice((currentPage-1)*36,currentPage*36);
  const history = (data.microAttempts ?? [])
    .filter((a) => a.owner_id === data.profile.id)
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  async function choose(unit: MicroUnit) {
    if (guard.current && !(await guard.current())) return;
    setKey(unit.key);
  }
  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <h2>{t(lang, "练一个具体能力", "Practise one specific skill")}</h2>
          <p>
            {t(
              lang,
              "先做一个短任务，再核对表达或自评。已发布的口语 Part 1 和翻译资料可以直接做短训练；原题保留来源，自编内容明确标注。",
              "Complete a short task, then review its expression or self-check. Published Part 1 and translation materials are available as short exercises with clear sources.",
            )}
          </p>
        </div>
      </div>
      {selected ? (
        <>
          <button
            className="back-link"
            onClick={() =>
              void (async () => {
                if (guard.current && !(await guard.current())) return;
                setKey(null);
              })()
            }
          >
            {t(lang, "返回微训练", "Back to micro training")}
          </button>
          <MicroTrainer
            key={selected.key}
            unit={selected}
            data={data}
            actions={actions}
            onGuard={(callback) => {
              guard.current = callback;
              onGuard(callback, callback ? `micro:${selected.key}` : null);
            }}
          />
        </>
      ) : (
        <>
          <div className="micro-filter"><label>{t(lang,"搜索题目与来源","Search questions and sources")}<input maxLength={100} value={search} onChange={e=>setSearch(e.target.value)}/></label>
            <label>
              {t(lang, "训练类型", "Training type")}
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as TrainingKind)}
              >
                <option value="none">{t(lang, "全部类型", "All types")}</option>
                {(
                  ["paraphrase", "rewrite", "speaking_part1"] as TrainingKind[]
                ).map((value) => (
                  <option key={value} value={value}>
                    {trainingNames[value][lang === "zh" ? 0 : 1]}
                  </option>
                ))}
              </select>
            </label>
            {topic && (
              <div className="topic-filter">
                <span>
                  {t(lang, "反馈主题：", "Feedback theme: ")}
                  {topic}
                </span>
                <button className="text-link" onClick={() => setTopic("")}>
                  {t(lang, "清除主题", "Clear theme")}
                </button>
              </div>
            )}
          </div>
          <div className="micro-grid">
            {visible.map((unit) => {
              const draft = data.microDrafts?.find(
                  (d) => d.material_id === `micro:${unit.key}`,
                ),
                state = draft ? parseMicroState(draft.body, unit) : null,
                last = history.find((a) => a.unit_key === unit.key);
              return (
                <article className="card micro-unit" key={unit.key}>
                  <span className="soft-tag">
                    {trainingNames[unit.kind][lang === "zh" ? 0 : 1]} ·{" "}
                    {unit.minutes} min
                  </span>
                  <h3>{unit.title}</h3><span className="source-origin">{unit.origin==="source"?t(lang,"资料原题","Source question"):unit.origin==="mixed"?t(lang,"原题与改编","Mixed origins"):t(lang,"自编 / 改编练习","Original / adapted exercise")}</span>{unit.origin&&unit.sourceVerified===false&&<p className="muted small">{t(lang,"管理员批准发布 · 原页待核验","Administrator approved · Source verification pending")}</p>}
                  <p>{unit.description}</p>
                  <p className="muted small">
                    {unit.items.length} {t(lang, "项训练", "items")} ·{" "}
                    {completionRule(unit.kind, lang)}
                  </p>
                  <details>
                    <summary>
                      {t(lang, "来源与使用许可", "Source and permission")}
                    </summary>
                    <p className="small">
                      {unit.source}
                      <br />
                      {unit.permission}
                    </p>
                  </details>
                  {last && (
                    <small>
                      {t(lang, "最近完成：", "Last completed: ")}
                      {new Date(last.submitted_at).toLocaleDateString(
                        lang === "zh" ? "zh-CN" : "en-US",
                        { timeZone: data.profile.timezone },
                      )}
                    </small>
                  )}
                  <button
                    className="button primary"
                    onClick={() => void choose(unit)}
                  >
                    {state && !state.completed
                      ? t(lang, "继续训练", "Resume training")
                      : t(lang, "开始训练", "Start training")}
                  </button>
                </article>
              );
            })}
          </div>
          <div className="button-row"><span>{list.length} {t(lang,"组微练习","micro sets")} · {currentPage} / {Math.max(1,Math.ceil(list.length/36))}</span><button className="button secondary" disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}>{t(lang,"上一页","Previous")}</button><button className="button secondary" disabled={currentPage*36>=list.length} onClick={()=>setPage(currentPage+1)}>{t(lang,"下一页","Next")}</button></div>
          {!list.length && (
            <section className="card empty-inline">
              <strong>
                {t(
                  lang,
                  "没有与该主题关联的完整训练",
                  "No complete training for this theme",
                )}
              </strong>
              <p>
                {t(
                  lang,
                  "主题关联根据明确标签；可清除主题，或在资料库添加有授权内容和完成标准的练习。",
                  "Themes use explicit tags. Clear the theme or add authorised content and completion criteria in the library.",
                )}
              </p>
              <button className="button secondary" onClick={() => {setTopic("");setKind("none");setSearch("");}}>
                {t(lang, "查看全部训练", "View all training")}
              </button>
            </section>
          )}
          <section className="card">
            <h3>
              {t(
                lang,
                "练习个人词表的场景拼写",
                "Practise spelling from your word list",
              )}
            </h3>
            <p className="muted">
              {t(
                lang,
                "词汇页已有场景筛选、拼写反馈和错词总结，沿用个人复习进度。",
                "Vocabulary has tag filters, spelling feedback and incorrect-word summaries using your own word list.",
              )}
            </p>
            <button
              className="button secondary"
              onClick={() => actions.setView("vocabulary")}
            >
              {t(lang, "打开词汇拼写", "Open vocabulary spelling")}
            </button>
          </section>
        </>
      )}
      <MicroHistory data={data} actions={actions} />
    </div>
  );
}
function MicroTrainer({
  unit,
  data,
  actions,
  onGuard,
}: {
  unit: MicroUnit;
  data: WorkspaceData;
  actions: ViewActions;
  onGuard: (guard: (() => Promise<boolean>) | null, materialId?: string | null) => void;
}) {
  const lang = data.profile.language,
    slot = `micro:${unit.key}`,
    remote = data.microDrafts?.find((d) => d.material_id === slot);
  const fresh = useMemo(() => newMicroState(unit), [unit.key, unit.stamp]);
  const draft = useWritingDraft({
    userId: data.profile.id,
    materialId: slot,
    remote,
    client: actions.client,
    table: "micro_sessions",
    endpoint: "/api/micro-sessions",
    saveDemo: (row) => actions.upsert("micro_sessions", "microDrafts", row),
    onCloudSaved: actions.acceptMicroDraft,
  });
  const state = useMemo(
    () => (draft.body ? parseMicroState(draft.body, unit) : fresh),
    [draft.body, unit.stamp],
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const [seconds, setSeconds] = useState(state?.elapsedSeconds ?? 0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [copies, setCopies] = useState<LocalDraft[]>([]);
  const lock = useRef(false),
    elapsed = useRef(state?.elapsedSeconds ?? 0);
  const changed = !state || state.stamp !== unit.stamp,
    completed = state?.completed ?? false;
  function edit(patch: Partial<MicroState>) {
    if (!draft.ready || !stateRef.current || changed || completed) return;
    const next = {
      ...stateRef.current,
      ...patch,
      elapsedSeconds: Math.max(
        elapsed.current,
        stateRef.current.elapsedSeconds,
      ),
    };
    stateRef.current = next;
    draft.edit(JSON.stringify(next));
  }
  const editRef = useRef(edit);
  editRef.current = edit;
  useEffect(() => {
    if (!draft.ready || !draft.body || changed || completed) {
      elapsed.current = state?.elapsedSeconds ?? 0;
      setSeconds(elapsed.current);
      return;
    }
    let base = state?.elapsedSeconds ?? 0,
      start = document.visibilityState === "hidden" ? null : Date.now();
    const tick = () => {
      elapsed.current =
        base + (start === null ? 0 : Math.floor((Date.now() - start) / 1000));
      setSeconds(elapsed.current);
    };
    const checkpoint = () => {
      tick();
      editRef.current({ elapsedSeconds: elapsed.current });
    };
    const visibility = () => {
      checkpoint();
      base = elapsed.current;
      start = document.visibilityState === "hidden" ? null : Date.now();
    };
    const clock = setInterval(tick, 1000),
      save = setInterval(checkpoint, 15000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", checkpoint);
    return () => {
      clearInterval(clock);
      clearInterval(save);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", checkpoint);
    };
  }, [draft.ready, !!draft.body, state?.runId, changed, completed]);
  const canLeave = async () => {
    if (lock.current) {
      actions.notify(
        t(
          lang,
          "请等待本轮保存或副本恢复完成",
          "Wait for saving or restoring the copy",
        ),
      );
      return false;
    }
    if (state && !changed && !completed && draft.body)
      edit({ elapsedSeconds: elapsed.current });
    return draft.canLeave(
      t(
        lang,
        "微训练有未同步内容，已加密暂存。继续离开？",
        "Micro training has unsynced content saved encrypted on this device. Leave?",
      ),
      t(
        lang,
        "本机保存失败，请复制回答后再离开。仍然离开？",
        "Local saving failed. Copy your answer before leaving. Leave anyway?",
      ),
    );
  };
  useEffect(() => {
    onGuard(canLeave);
    return () => onGuard(null);
  });
  const item = state
    ? unit.items[Math.min(unit.items.length - 1, state.index)]
    : null;
  async function restart() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (draft.conflict && !(await draft.useCloud()))
        throw new Error(
          t(
            lang,
            "副本保存失败，当前内容已保留",
            "Copy could not be saved; current content retained",
          ),
        );
      else if (draft.body) {
        await saveLocalDraft(
          data.profile.id,
          slot,
          draft.body,
          remote?.version ?? 0,
        );
        await archiveLocalDraft(data.profile.id, slot);
      }
      setCopies(await conflictCopies(data.profile.id, slot));
      const next = newMicroState(unit);
      elapsed.current = 0;
      setSeconds(0);
      draft.edit(JSON.stringify(next));
      setMessage("");
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "保留副本失败 / Could not retain a copy",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function restore(copy: LocalDraft) {
    const saved = parseMicroState(copy.body, unit);
    if (!saved || saved.stamp !== unit.stamp) return;
    if (
      !window.confirm(
        t(
          lang,
          "保留当前内容副本，并恢复这份训练进度？",
          "Keep a copy of current progress and restore this copy?",
        ),
      )
    )
      return;
    setBusy(true);
    try {
      if (draft.conflict && !(await draft.useCloud()))
        throw new Error(
          t(
            lang,
            "副本保存失败，当前内容已保留",
            "Copy could not be saved; current content retained",
          ),
        );
      if (draft.body) {
        await saveLocalDraft(
          data.profile.id,
          slot,
          draft.body,
          remote?.version ?? 0,
        );
        await archiveLocalDraft(data.profile.id, slot);
      }
      elapsed.current = saved.elapsedSeconds;
      setSeconds(saved.elapsedSeconds);
      draft.edit(copy.body);
      setCopies(await conflictCopies(data.profile.id, slot));
    } catch {
      setMessage(
        t(lang, "恢复失败，副本仍保留", "Restore failed; copy retained"),
      );
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    if (
      lock.current ||
      !state ||
      !microComplete(unit, state) ||
      changed ||
      completed ||
      draft.conflict
    )
      return;
    lock.current = true;
    setBusy(true);
    try {
      const final = {
        ...state,
        elapsedSeconds: Math.max(elapsed.current, state.elapsedSeconds),
      };
      if (demoMode) {
        await actions.upsert("micro_attempts", "microAttempts", {
          id: state.runId,
          owner_id: data.profile.id,
          unit_key: unit.key,
          unit_title: unit.title,
          unit_stamp: unit.stamp,
          kind: unit.kind,
          skill: unit.skill,
          duration_seconds: final.elapsedSeconds,
          item_count: unit.items.length,
          correct_count:
            unit.kind === "paraphrase"
              ? unit.items.filter((i) =>
                  i.answers.some(
                    (a) =>
                      normalizeTerm(a) === normalizeTerm(state.answers[i.id]),
                  ),
                ).length
              : null,
          answer_body: final.answers,
          self_review: final.checks,
          criteria_total: unit.items.reduce(
            (n, i) => n + i.checklist.length,
            0,
          ),
          criteria_passed: unit.items.reduce(
            (n, i) =>
              n +
              i.checklist.filter(
                (_, c) => final.checks[i.id]?.[String(c)] === true,
              ).length,
            0,
          ),
          unit_snapshot: unit,
          submitted_at: new Date().toISOString(),
          purged_at: null,
        });
      } else
        await apiFetch(actions.client, "/api/micro-attempts", {
          method: "POST",
          body: JSON.stringify({ key: unit.key, state: final }),
        });
      draft.edit(JSON.stringify({ ...final, completed: true }));
      setMessage(
        t(
          lang,
          "本轮训练已存入个人记录",
          "Training saved to your personal history",
        ),
      );
      await actions.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败 / Save failed");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const statuses = {
    saved: ["已同步", "Synced"],
    saving: ["保存中", "Saving"],
    local: ["本机加密暂存，待同步", "Encrypted locally; awaiting sync"],
    conflict: [
      "有版本冲突，当前内容保留",
      "Version conflict; current content retained",
    ],
    error: [
      "本机保存失败，请复制回答",
      "Local saving failed; copy your answers",
    ],
  };
  return (
    <section className="card micro-trainer">
      <div className="card-top">
        <div>
          <h3>{unit.title}</h3><span className="source-origin">{unit.origin==="source"?t(lang,"资料原题","Source question"):unit.origin==="mixed"?t(lang,"原题与改编","Mixed origins"):t(lang,"自编 / 改编练习","Original / adapted exercise")}</span>{unit.origin&&unit.sourceVerified===false&&<p className="muted small">{t(lang,"管理员批准发布 · 原页待核验","Administrator approved · Source verification pending")}</p>}
          <p className="muted small">{completionRule(unit.kind, lang)}</p>
        </div>
        <span className="timer-pill">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      </div>
      <p className="save-status" role="status">
        {statuses[draft.status][lang === "zh" ? 0 : 1]}
      </p>
      {changed && (
        <div className="conflict-box">
          <strong>
            {t(
              lang,
              "训练版本已改变或草稿格式不可识别",
              "Training changed or draft format is unreadable",
            )}
          </strong>
          <p>
            {t(
              lang,
              "当前回答保留。先存冲突副本，再开始新版本。",
              "Current answers are retained. Archive a copy before starting the new version.",
            )}
          </p>
        </div>
      )}
      {draft.conflict && (
        <div className="conflict-box">
          <p>
            {t(
              lang,
              "另一设备的训练进度已变化。加载云端前会保留本机副本。",
              "Another device changed the progress. Loading cloud retains a local copy.",
            )}
          </p>
          <button
            className="button secondary small"
            disabled={busy}
            onClick={() => void draft.useCloud()}
          >
            {t(lang, "保留副本并加载云端", "Keep a copy and load cloud")}
          </button>
        </div>
      )}
      {item && state && (
        <>
          <div
            className="micro-stepper"
            aria-label={t(lang, "训练进度", "Training progress")}
          >
            {unit.items.map((i, n) => (
              <button
                key={i.id}
                aria-current={state.index === n ? "step" : undefined}
                className={state.index === n ? "active" : ""}
                disabled={!draft.ready || changed || completed || busy}
                onClick={() => edit({ index: n })}
              >
                {n + 1}
                {state.revealed.includes(i.id) ? " ✓" : ""}
              </button>
            ))}
          </div>
          {item.sourcePage&&<p className="muted small">{item.origin==="adapted"?t(lang,"改编练习","Adapted exercise"):t(lang,"资料原题","Source question")} · {t(lang,`PDF 第 ${item.sourcePage} 页`,`PDF page ${item.sourcePage}`)}</p>}
          <div className="micro-context">{item.context}</div>
          <h4>{item.prompt}</h4>
          {unit.kind === "paraphrase" ? (
            <fieldset className="micro-choices">
              <legend>
                {t(
                  lang,
                  "选择符合此处语境的表达",
                  "Choose the phrase that fits this context",
                )}
              </legend>
              {item.choices.map((choice) => (
                <label key={choice}>
                  <input
                    type="radio"
                    name={`${unit.key}-${item.id}`}
                    checked={state.answers[item.id] === choice}
                    disabled={
                      !draft.ready ||
                      busy ||
                      changed ||
                      completed ||
                      state.revealed.includes(item.id)
                    }
                    onChange={() =>
                      edit({ answers: { ...state.answers, [item.id]: choice } })
                    }
                  />
                  <span>{choice}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <label>
              {unit.kind === "rewrite"
                ? t(lang, "你的改写", "Your rewrite")
                : t(
                    lang,
                    "请先口头练习，再记录回答或关键笔记",
                    "Practise aloud, then write your answer or key notes",
                  )}
              <textarea
                rows={4}
                maxLength={4000}
                disabled={!draft.ready || busy || changed || completed}
                value={state.answers[item.id] ?? ""}
                onChange={(e) =>
                  edit({
                    answers: { ...state.answers, [item.id]: e.target.value },
                  })
                }
              />
            </label>
          )}
          {!state.revealed.includes(item.id) ? (
            <button
              className="button secondary"
              disabled={
                !draft.ready ||
                busy ||
                changed ||
                completed ||
                !state.answers[item.id]?.trim()
              }
              onClick={() => edit({ revealed: [...state.revealed, item.id] })}
            >
              {t(lang, item.answers.length?"核对参考与解释":"查看自评标准", item.answers.length?"Review reference and explanation":"Review self-check criteria")}
            </button>
          ) : (
            <div className="micro-reference">
              <strong>
                {unit.kind === "paraphrase"
                  ? t(lang, "语境答案", "Context answer")
                  : t(
                      lang,
                      item.answers.length?"参考表达（不是唯一答案）":"自评标准（无唯一参考答案）",
                      item.answers.length?"Reference expression (not the only answer)":"Self-check criteria (no unique reference answer)",
                    )}
              </strong>
              {item.answers.map((answer) => (
                <p key={answer}>{answer}</p>
              ))}
              <p className="muted">{item.explanation}</p>
              {unit.kind !== "paraphrase" && (
                <fieldset className="micro-checklist">
                  <legend>
                    {t(
                      lang,
                      "逐项自评；“需改进”也可以完成训练",
                      "Self-check; choosing Needs work still completes the training",
                    )}
                  </legend>
                  {item.checklist.map((criterion, n) => (
                    <div key={n}>
                      <span>{criterion}</span>
                      {[true, false].map((value) => (
                        <label key={String(value)}>
                          <input
                            type="radio"
                            name={`${unit.key}-${item.id}-${n}`}
                            disabled={busy || changed || completed}
                            checked={
                              state.checks[item.id]?.[String(n)] === value
                            }
                            onChange={() =>
                              edit({
                                checks: {
                                  ...state.checks,
                                  [item.id]: {
                                    ...state.checks[item.id],
                                    [String(n)]: value,
                                  },
                                },
                              })
                            }
                          />
                          {value
                            ? t(lang, "已做到", "Met")
                            : t(lang, "需改进", "Needs work")}
                        </label>
                      ))}
                    </div>
                  ))}
                </fieldset>
              )}
            </div>
          )}
          <div className="button-row">
            <button
              className="button secondary"
              disabled={state.index <= 0 || busy || changed || completed}
              onClick={() => edit({ index: state.index - 1 })}
            >
              {t(lang, "上一项", "Previous")}
            </button>
            <button
              className="button secondary"
              disabled={
                state.index >= unit.items.length - 1 ||
                busy ||
                changed ||
                completed
              }
              onClick={() => edit({ index: state.index + 1 })}
            >
              {t(lang, "下一项", "Next")}
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                changed ||
                completed ||
                !draft.ready ||
                !!draft.conflict ||
                !microComplete(unit, state)
              }
              onClick={() => void finish()}
            >
              {completed
                ? t(lang, "本轮已记录", "Saved")
                : busy
                  ? t(lang, "保存中…", "Saving…")
                  : t(lang, "记录本轮完成", "Save completion")}
            </button>
          </div>
        </>
      )}
      {(changed || completed) && (
        <button
          className="button secondary"
          disabled={busy || !draft.ready}
          onClick={() => void restart()}
        >
          {t(lang, "保留副本并开始新一轮", "Keep a copy and start a new round")}
        </button>
      )}
      {message && (
        <p className="review-message" role="status">
          {message}
        </p>
      )}
      <details>
        <summary>{t(lang, "来源与许可", "Source and permission")}</summary>
        <p>
          {unit.source}
          <br />
          {unit.permission}
        </p>
      </details>
      {[...draft.copies, ...copies].length > 0 && (
        <details className="conflict-box">
          <summary>
            {t(lang, "本机冲突 / 历史副本", "Local conflict / previous copies")}
          </summary>
          {[
            ...new Map(
              [...draft.copies, ...copies].map((copy) => [copy.revision, copy]),
            ).values(),
          ].map((copy) => (
            <div key={copy.revision}>
              <small>{new Date(copy.updatedAt).toLocaleString()}</small>
              <pre className="draft-copy">{copy.body}</pre>
              {parseMicroState(copy.body, unit)?.stamp === unit.stamp && (
                <button
                  className="button secondary small"
                  disabled={busy || !draft.ready}
                  onClick={() => void restore(copy)}
                >
                  {t(lang, "恢复这个副本", "Restore this copy")}
                </button>
              )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
function MicroHistory({
  data,
  actions,
}: {
  data: WorkspaceData;
  actions: ViewActions;
}) {
  const [limit, setLimit] = useState(20);
  const lang = data.profile.language,
    history = (data.microAttempts ?? [])
      .filter((row) => row.owner_id === data.profile.id)
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  return (
    <section className="card">
      <h3>{t(lang, "个人微训练记录", "Your micro training history")}</h3>
      <p className="muted small">
        {t(
          lang,
          "微训练独立于四科题组成绩；改写和短答不生成分数。",
          "Micro training is separate from four-skill set scores. Rewrites and short answers receive no score.",
        )}
      </p>
      {history.length ? (
        history.slice(0, limit).map((row) => (
          <details className="micro-history" key={row.id}>
            <summary>
              {row.unit_title ||
                row.unit_snapshot?.title ||
                trainingNames[row.kind][lang === "zh" ? 0 : 1]}{" "}
              ·{" "}
              {new Date(row.submitted_at).toLocaleDateString(
                lang === "zh" ? "zh-CN" : "en-US",
                { timeZone: data.profile.timezone },
              )}{" "}
              ·{" "}
              {row.correct_count !== null
                ? `${row.correct_count}/${row.item_count}`
                : t(lang, "已完成自评", "Self-review completed")}
            </summary>
            <p className="muted small">
              {row.unit_stamp ?? row.unit_snapshot?.stamp} ·{" "}
              {Math.ceil(row.duration_seconds / 60)} min
            </p>
            {row.purged_at ? (
              <p>
                {t(
                  lang,
                  "一年期原始内容已清理，统计保留。",
                  "Original content was removed after one year; summaries remain.",
                )}
              </p>
            ) : (
              row.unit_snapshot?.items.map((item) => (
                <div key={item.id}>
                  <strong>{item.prompt}</strong>
                  <p>{row.answer_body?.[item.id]}</p>
                  <p className="muted small">{item.explanation}</p>
                  {item.checklist.map((criterion, n) => (
                    <p className="small" key={n}>
                      {criterion} ·{" "}
                      {row.self_review?.[item.id]?.[String(n)] === true
                        ? t(lang, "已做到", "Met")
                        : t(lang, "需改进", "Needs work")}
                    </p>
                  ))}
                </div>
              ))
            )}
            <button
              className="text-link danger-text"
              onClick={() => {
                if (
                  window.confirm(
                    t(
                      lang,
                      "删除这条微训练记录？",
                      "Delete this micro training record?",
                    ),
                  )
                )
                  void actions
                    .remove("micro_attempts", "microAttempts", row.id)
                    .catch(() => undefined);
              }}
            >
              {t(lang, "删除记录", "Delete record")}
            </button>
          </details>
        ))
      ) : (
        <p className="empty-text">
          {t(
            lang,
            "完成一轮训练后，记录会出现在这里。",
            "Complete a round to see your history here.",
          )}
        </p>
      )}
      {history.length > limit && (
        <button
          className="button secondary small"
          onClick={() => setLimit(limit + 20)}
        >
          {t(lang, "加载更早记录", "Load earlier records")}
        </button>
      )}
    </section>
  );
}
