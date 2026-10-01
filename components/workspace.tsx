"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { mergeConfirmedRows } from "@/lib/session-requests";
import { APP_VERSION } from "@/lib/release";
import { brandAssets } from "@/lib/brand";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  House,
  LibraryBig,
  LogOut,
  Moon,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Tags,
  X,
} from "lucide-react";
import { initialDemoData } from "@/lib/demo";
import {
  demoMode,
  deleteRow,
  getBrowserClient,
  loadWorkspace,
  saveRow,
} from "@/lib/supabase";
import type {
  Language,
  Profile,
  Skill,
  StudyTask,
  View,
  WorkspaceData,
  VocabularyWord,
} from "@/lib/types";
import { discardLocalDraft, localDraftIds } from "@/lib/offline-drafts";
import { syncPendingDrafts } from "@/lib/draft-sync";
import { countDueWords, localDate, startOfWeek } from "@/lib/study";
import { usePracticeSessions } from "./use-practice-sessions";
import { practiceMaterials } from "@/lib/practice-sessions";
import { Modal } from "./modal";
import { TodayView } from "./today-view";
import type { ViewActions } from "./views";

const loadingView = () => <p role="status">正在加载页面… / Loading…</p>;
const PracticeView = dynamic(() => import("./practice-view").then(m => m.PracticeView), { loading: loadingView });
const MethodsView = dynamic(() => import("./methods-view").then(m => m.MethodsView), { loading: loadingView });
const VocabularyView = dynamic(() => import("./views").then(m => m.VocabularyView), { loading: loadingView });
const LibraryView = dynamic(() => import("./views").then(m => m.LibraryView), { loading: loadingView });
const PlanView = dynamic(() => import("./views").then(m => m.PlanView), { loading: loadingView });
const ProgressView = dynamic(() => import("./views").then(m => m.ProgressView), { loading: loadingView });
const SettingsView = dynamic(() => import("./views").then(m => m.SettingsView), { loading: loadingView });
const AdminView = dynamic(() => import("./views").then(m => m.AdminView), { loading: loadingView });

const nav: { id: View; zh: string; en: string; icon: typeof House }[] = [
  { id: "today", zh: "今日", en: "Today", icon: House },
  { id: "practice", zh: "练习", en: "Practice", icon: BookOpen },
  { id: "vocabulary", zh: "词汇", en: "Vocabulary", icon: Tags },
  { id: "plan", zh: "计划", en: "Plan", icon: CalendarDays },
  { id: "library", zh: "资料库", en: "Library", icon: LibraryBig },
  { id: "methods", zh: "备考方法", en: "Study guides", icon: BookOpen },
  { id: "progress", zh: "进度", en: "Progress", icon: ChartNoAxesCombined },
  { id: "settings", zh: "设置", en: "Settings", icon: Settings2 },
];

export function t(lang: Language, zh: string, en: string) {
  return lang === "zh" ? zh : en;
}

export function Workspace() {
  const client = useMemo(() => getBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("today");
  const [microTarget, setMicroTarget] =
    useState<ViewActions["microTarget"]>(null);
  const [reviewTarget, setReviewTarget] = useState<{
    attemptId: string;
    questionId?: string;
  } | null>(null);
  const [practiceMaterialId, setPracticeMaterialId] = useState<string | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [resetFlow, setResetFlow] = useState(false);
  const [practiceSkill, setPracticeSkill] = useState<Skill>("reading");
  const leavePractice = useRef<
    ((reason?: "navigate" | "logout") => Promise<boolean>) | null
  >(null);
  const activeDraftMaterial = useRef<string | null>(null);
  const [logoutScope, setLogoutScope] = useState<"local" | "global" | null>(
    null,
  );
  const [logoutBusy, setLogoutBusy] = useState(false);
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [view]);
  const refreshRun = useRef<Promise<void> | null>(null);
  const refreshPending = useRef(false);
  const authGeneration = useRef(0);
  const wordEdits = useRef(new Map<string, VocabularyWord>());
  const taskEdits = useRef(new Map<string, StudyTask>());
  const demoQuotaWarned = useRef(false);
  const logoutChecking = useRef(false);
  const logoutSubmitting = useRef(false);

  const notify = useCallback((message: string) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => { setToast(null); toastTimer.current = null; }, 5000);
  }, []);

  useEffect(() => () => { if (toastTimer.current !== null) window.clearTimeout(toastTimer.current); }, []);

  const refresh = useCallback((): Promise<void> => {
    if (demoMode || !client) return Promise.resolve();
    refreshPending.current = true;
    if (refreshRun.current) return refreshRun.current;
    refreshRun.current = (async () => {
      do {
        refreshPending.current = false;
        const generation = authGeneration.current;
        const confirmedTasks = new Map<string, StudyTask>();
        taskEdits.current = confirmedTasks;
        try {
          const { data: auth, error: authError } = await client.auth.getUser();
          if (generation !== authGeneration.current) continue;
          if (authError && authError.status !== 401 && authError.status !== 403) throw authError;
          if (!auth.user) { wordEdits.current.clear(); setUser(null); setData(null); continue; }
          setUser(auth.user);
          const workspace = await loadWorkspace(client, auth.user.id, { includeWords: false });
          if (generation !== authGeneration.current) continue;
          workspace.tasks = mergeConfirmedRows(workspace.tasks, confirmedTasks, auth.user.id);
          setData(previous => previous?.profile.id === auth.user!.id
            ? { ...workspace, words: previous.words, wordsLoaded: previous.wordsLoaded }
            : workspace);
        } catch (error) {
          if (generation !== authGeneration.current) continue;
          if (error instanceof Error && error.message === "账号已停用或个人资料尚未建立") setData(null);
          notify(error instanceof Error ? error.message : "加载失败");
        } finally { setLoading(false); }
      } while (refreshPending.current);
    })().finally(() => { refreshRun.current = null; });
    return refreshRun.current;
  }, [client, notify]);

  useEffect(() => {
    if (demoMode) {
      try {
        const raw = localStorage.getItem("jiawenlex-demo-v1");
        setData(raw ? (JSON.parse(raw) as WorkspaceData) : initialDemoData());
      } catch {
        setData(initialDemoData());
      }
      setLoading(false);
      return;
    }
    if (!client) {
      setLoading(false);
      return;
    }
    void refresh();
    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setResetFlow(true);
      if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "PASSWORD_RECOVERY"
      )
        window.setTimeout(() => void refresh(), 0);
      if (event === "SIGNED_OUT") {
        authGeneration.current++;
        taskEdits.current.clear();
        wordEdits.current.clear();
        setUser(null);
        setData(null);
        setLoading(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [client, refresh]);

  useEffect(() => {
    if (demoMode) return;
    const reload = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const resume = () => { reload(); };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    const interval = window.setInterval(reload, 30000);
    return () => {
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    if (!client || !user?.id || demoMode) return;
    const sync = () => {
      void syncPendingDrafts(
        client,
        user.id,
        () => activeDraftMaterial.current,
      ).then((changed) => {
        if (changed) void refresh();
      });
    };
    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [client, user?.id, view, refresh]);

  useEffect(() => {
    if (demoMode && data) {
      try { localStorage.setItem("jiawenlex-demo-v1", JSON.stringify(data)); }
      catch {
        if (!demoQuotaWarned.current) {
          demoQuotaWarned.current = true;
          notify("演示数据超过浏览器保存额度，本次操作暂存内存；已有存档保留。 / Demo storage is full; changes remain in memory.");
        }
      }
    }
    if (data) document.documentElement.dataset.theme = data.profile.theme;
  }, [data, notify]);

  const upsert = useCallback(
    async <K extends keyof WorkspaceData, R extends { id: string }>(
      table: string,
      key: K,
      row: R,
    ) => {
      try {
        const saved = await saveRow(
          client,
          table,
          row as Record<string, unknown>,
        );
        const effective =
          saved ??
          (table === "materials"
            ? {
                ...row,
                revision:
                  ((row as unknown as { revision?: number }).revision ?? 0) + 1,
              }
            : row);
        setData((previous) => {
          if (!previous) return previous;
          const list = (previous[key] ?? []) as { id: string }[];
          return {
            ...previous,
            [key]: [...list.filter((item) => item.id !== row.id), effective],
            ...(demoMode && table === "materials"
              ? {
                  materialVersions: [
                    ...(previous.materialVersions ?? []),
                    {
                      id: crypto.randomUUID(),
                      material_id: row.id,
                      revision: (effective as unknown as { revision: number })
                        .revision,
                      snapshot:
                        effective as unknown as import("@/lib/types").Material,
                      created_at: new Date().toISOString(),
                    },
                  ],
                }
              : {}),
          };
        });
      } catch (error) {
        notify(error instanceof Error ? error.message : "保存失败");
        throw error;
      }
    },
    [client, notify],
  );

  const remove = useCallback(
    async <K extends keyof WorkspaceData>(
      table: string,
      key: K,
      id: string,
    ) => {
      try {
        await deleteRow(client, table, id);
        setData((previous) => {
          if (!previous) return previous;
          const list = previous[key] as { id: string }[];
          return {
            ...previous,
            [key]: list.filter((item) => item.id !== id),
            ...(table === "practice_attempts"
              ? {
                  attemptReviews: previous.attemptReviews?.filter(
                    (row) => row.id !== id,
                  ),
                  vocabularySources: previous.vocabularySources?.filter(
                    (row) => row.attempt_id !== id,
                  ),
                  tasks: previous.tasks.map((task) =>
                    task.review_attempt_id === id
                      ? { ...task, review_attempt_id: null }
                      : task,
                  ),
                }
              : {}),
            ...(table === "vocabulary"
              ? {
                  vocabularySources: previous.vocabularySources?.filter(
                    (row) => row.word_id !== id,
                  ),
                }
              : {}),
          };
        });
      } catch (error) {
        notify(error instanceof Error ? error.message : "删除失败");
        throw error;
      }
    },
    [client, notify],
  );

  const updateProfile = useCallback(
    async (profile: Profile) => {
      try {
        await saveRow(
          client,
          "profiles",
          profile as unknown as Record<string, unknown>,
        );
        setData((previous) => (previous ? { ...previous, profile } : previous));
        notify(profile.language === "zh" ? "设置已保存" : "Settings saved");
      } catch (error) {
        notify(error instanceof Error ? error.message : "保存失败");
        throw error;
      }
    },
    [client, notify],
  );

  const replacePlan = useCallback(
    async (tasks: StudyTask[]) => {
      if (!data) return;
      const week = startOfWeek(new Date(), data.profile.timezone);
      try {
        if (client) {
          const newRows = tasks.filter(
            (task) => !data.tasks.some((old) => old.id === task.id),
          );
          const expected = data.tasks
            .filter(
              (task) =>
                task.week_start === week &&
                task.status === "todo" &&
                task.source === "rule",
            )
            .map((task) => task.id);
          const { error } = await client.rpc("replace_weekly_plan", {
            plan_week: week,
            expected_ids: expected,
            new_tasks: newRows,
          });
          if (error) {
            if (error.code === "PGRST202")
              throw new Error(
                t(
                  data.profile.language,
                  "数据库更新尚未应用，当前计划已保留，暂不能重新安排。",
                  "The database update is pending. Your current plan is preserved; rebalance is temporarily unavailable.",
                ),
              );
            throw error;
          }
          await refresh();
        } else {
          setData((previous) =>
            previous
              ? {
                  ...previous,
                  tasks: [
                    ...previous.tasks.filter(
                      (task) => task.week_start !== week,
                    ),
                    ...tasks,
                  ],
                }
              : previous,
          );
        }
        notify(
          t(
            data.profile.language,
            "本周计划已更新",
            "This week's plan is updated",
          ),
        );
      } catch (error) {
        await refresh();
        notify(
          error instanceof Error &&
            error.message.includes("weekly_budget_exceeded")
            ? t(
                data.profile.language,
                "当前计划已达到周预算，请调整未完成任务后再安排。",
                "Weekly budget reached. Adjust pending tasks before replanning.",
              )
            : error instanceof Error
              ? error.message.includes("plan_conflict")
                ? t(
                    data.profile.language,
                    "任务已在其他页面修改，请根据最新记录重新安排。",
                    "Tasks changed elsewhere. Rebalance using the refreshed plan.",
                  )
                : error.message
              : "计划更新失败",
        );
      }
    },
    [client, data, notify, refresh],
  );

  function navigate(next: View, afterGuard?: () => void) {
    if (next === view && !afterGuard) return;
    void (async () => {
      if (
        (view === "practice" || view === "progress" || view === "vocabulary") &&
        leavePractice.current &&
        !(await leavePractice.current())
      )
        return;
      afterGuard?.();
      setView(next);
    })();
  }

  const sessions = usePracticeSessions({
    userId: data?.profile.id ?? null,
    client,
    remote: data?.practiceSessions ?? [],
    materials: data ? practiceMaterials(data) : [],
    activeMaterial: () => activeDraftMaterial.current,
    onSaved: (row) =>
      setData((previous) =>
        previous && previous.profile.id === row.owner_id
          ? {
              ...previous,
              practiceSessions: [
                ...(previous.practiceSessions ?? []).filter(
                  (item) => item.material_id !== row.material_id,
                ),
                row,
              ],
            }
          : previous,
      ),
  });

  const actions: ViewActions = {
    client,
    sessions,
    upsert,
    remove,
    updateProfile,
    replacePlan,
    notify,
    refresh: async () => { await refresh(); },
    acceptTask: (task) => {
      taskEdits.current.set(task.id, task);
      setData(previous => previous?.profile.id === task.owner_id ? {
        ...previous, tasks: previous.tasks.map(existing => existing.id === task.id ? task : existing),
      } : previous);
    },
    acceptWord: (word) => {
      wordEdits.current.set(word.id, word);
      setData(previous => previous?.profile.id === word.owner_id ? {
        ...previous, words: previous.words.map(existing => existing.id === word.id ? word : existing),
      } : previous);
    },
    microTarget,
    clearMicroTarget: () => setMicroTarget(null),
    openMicroTraining: (topic, unitKey) =>
      navigate("practice", () => {
        setPracticeMaterialId(null);
        setMicroTarget({ topic, unitKey, requestId: crypto.randomUUID() });
      }),
    acceptMicroDraft: (draft) =>
      setData((previous) =>
        previous && previous.profile.id === draft.owner_id
          ? {
              ...previous,
              microDrafts: [
                ...(previous.microDrafts ?? []).filter(
                  (row) => row.material_id !== draft.material_id,
                ),
                draft,
              ],
            }
          : previous,
      ),
    openPractice: (materialId?: string | null, skill?: Skill) =>
      navigate("practice", () => {
        const material = data?.materials.find((m) => m.id === materialId);
        if (material?.training_kind && material.training_kind !== "none") {
          setMicroTarget({
            unitKey: "material:" + material.id,
            requestId: crypto.randomUUID(),
          });
          setPracticeMaterialId(null);
        } else {
          setMicroTarget(null);
          setPracticeMaterialId(materialId ?? null);
        }
        setPracticeSkill(skill ?? "reading");
      }),
    reviewTarget,
    clearReviewTarget: () => setReviewTarget(null),
    openReview: (attemptId, questionId) =>
      navigate("progress", () => setReviewTarget({ attemptId, questionId })),
    setView: navigate,
    registerPracticeGuard: (guard, materialId) => {
      leavePractice.current = guard;
      activeDraftMaterial.current = materialId ?? null;
    },
    acceptDraft: (draft) => {
      setData((previous) =>
        previous && previous.profile.id === draft.owner_id
          ? {
              ...previous,
              drafts: [
                ...previous.drafts.filter(
                  (row) => row.material_id !== draft.material_id,
                ),
                draft,
              ],
            }
          : previous,
      );
    },
  };

  if (loading)
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>JiawenLex</p>
      </div>
    );
  if (!demoMode && !client) return <SetupScreen />;
  if (!data || resetFlow)
    return (
      <AuthScreen
        client={client}
        onSignedIn={refresh}
        resetFlow={resetFlow}
        setResetFlow={setResetFlow}
        notify={notify}
      />
    );
  if (!data.profile.onboarded)
    return <Onboarding profile={data.profile} onSave={updateProfile} />;

  const { profile } = data;
  const lang = profile.language;
  const due = data.wordsLoaded === false ? (data.wordDueCount ?? 0) : countDueWords(data.words);
  const todayTasks = data.tasks.filter(
    (task) =>
      task.planned_date === localDate(new Date(), profile.timezone) &&
      task.status === "todo",
  ).length;
  const currentView = nav.find((item) => item.id === view);

  async function logout(scope: "local" | "global" = "local") {
    if (logoutChecking.current || logoutSubmitting.current || logoutScope)
      return;
    logoutChecking.current = true;
    setLogoutBusy(true);
    try {
      if (
        (view === "practice" || view === "progress" || view === "vocabulary") &&
        leavePractice.current &&
        !(await leavePractice.current("logout"))
      )
        return;
      const pending = await localDraftIds(profile.id);
      if (pending.length) {
        setLogoutScope(scope);
        return;
      }
      await finishLogout(scope, false);
    } catch {
      notify(
        t(
          lang,
          "无法检查本机草稿，请稍后重试。",
          "Could not check local drafts. Please retry.",
        ),
      );
    } finally {
      logoutChecking.current = false;
      setLogoutBusy(false);
    }
  }
  async function finishLogout(scope: "local" | "global", discard: boolean) {
    if (logoutSubmitting.current) return;
    logoutSubmitting.current = true;
    setLogoutBusy(true);
    try {
      if (discard)
        for (const id of await localDraftIds(profile.id))
          await discardLocalDraft(profile.id, id);
      if (client) {
        const { error } = await client.auth.signOut({ scope });
        if (error) throw error;
      }
      if (demoMode) {
        localStorage.removeItem("jiawenlex-demo-v1");
        setData(initialDemoData());
      } else setData(null);
      setUser(null);
      setLogoutScope(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "退出失败");
    } finally {
      logoutSubmitting.current = false;
      setLogoutBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Image
            className="brand-mark"
            src={brandAssets.logo}
            alt="JiawenLex"
            width={42}
            height={42}
          />
          <div>
            <strong>JiawenLex</strong>
            <small>{t(lang, "雅思备考工作台", "IELTS workspace")}</small>
          </div>
        </div>
        <div className="sidebar-label">{t(lang, "工作区", "WORKSPACE")}</div>
        <nav
          className="side-nav"
          aria-label={t(lang, "主导航", "Main navigation")}
        >
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? "active" : ""}`}
                onClick={() => navigate(item.id)}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>{t(lang, item.zh, item.en)}</span>
                {item.id === "vocabulary" && due > 0 && (
                  <span className="nav-count">{due}</span>
                )}
              </button>
            );
          })}
          {profile.role === "admin" && (
            <button
              className={`nav-item ${view === "admin" ? "active" : ""}`}
              onClick={() => navigate("admin")}
            >
              <ShieldCheck size={19} strokeWidth={1.8} />
              <span>{t(lang, "管理", "Admin")}</span>
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <small className="muted">JiawenLex v{APP_VERSION}</small>
          <div className="goal-mini">
            <span className="goal-mini-icon">
              <Sparkles size={17} />
            </span>
            <div>
              <small>{t(lang, "目标分数", "Target band")}</small>
              <strong>{profile.goal_overall?.toFixed(1) ?? "—"}</strong>
            </div>
            <ChevronRight size={17} />
          </div>
          <div className="profile-chip">
            <span className="avatar">{profile.display_name.slice(0, 1)}</span>
            <div>
              <strong>{profile.display_name}</strong>
              <small>
                {profile.track === "academic" ? "Academic" : "General Training"}
              </small>
            </div>
            <button
              disabled={logoutBusy || !!logoutScope}
              title={t(lang, "退出", "Sign out")}
              onClick={() => void logout()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="topbar-title">
            <span className="eyebrow">
              {t(lang, "你的工作台", "YOUR WORKSPACE")}
            </span>
            <h1>
              {view === "admin"
                ? t(lang, "管理", "Admin")
                : t(
                    lang,
                    currentView?.zh ?? "今日",
                    currentView?.en ?? "Today",
                  )}
            </h1>
          </div>
          <div className="topbar-actions">
            {demoMode && (
              <span className="demo-pill">
                {t(lang, "本机演示", "Local demo")}
              </span>
            )}
            <button
              className="icon-button"
              title={t(lang, "切换语言", "Switch language")}
              onClick={() =>
                void updateProfile({
                  ...profile,
                  language: lang === "zh" ? "en" : "zh",
                }).catch(() => undefined)
              }
            >
              <span className="lang-button">{lang === "zh" ? "EN" : "中"}</span>
            </button>
            <button
              className="icon-button"
              title={t(lang, "切换主题", "Switch theme")}
              onClick={() =>
                void updateProfile({
                  ...profile,
                  theme: profile.theme === "light" ? "dark" : "light",
                }).catch(() => undefined)
              }
            >
              {profile.theme === "light" ? (
                <Moon size={19} />
              ) : (
                <Sun size={19} />
              )}
            </button>
          </div>
        </header>
        <main className="main-content">
          {sessions.loadError && (
            <div className="conflict-box" role="alert">
              {t(
                lang,
                "本机存档读取失败，答题进度尚未恢复。请刷新页面重试。",
                "Local progress could not be read. Reload to retry restoring your answers.",
              )}
            </div>
          )}
          {view === "today" && <TodayView data={data} actions={actions} />}
          {view === "practice" && (
            <PracticeView
              data={data}
              actions={actions}
              initialSkill={practiceSkill}
              initialMaterialId={practiceMaterialId}
              onInitialConsumed={() => setPracticeMaterialId(null)}
            />
          )}
          {view === "vocabulary" && <VocabularyView key={data.profile.id} data={data} actions={actions} />}
          {view === "plan" && <PlanView data={data} actions={actions} />}
          {view === "methods" && <MethodsView data={data} actions={actions} />}
          {view === "library" && <LibraryView data={data} actions={actions} />}
          {view === "progress" && (
            <ProgressView data={data} actions={actions} />
          )}
          {view === "settings" && (
            <SettingsView data={data} actions={actions} onLogout={logout} />
          )}
          {view === "admin" && profile.role === "admin" && (
            <AdminView data={data} actions={actions} />
          )}
        </main>
      </div>
      <nav
        className="mobile-nav"
        aria-label={t(lang, "手机导航", "Mobile navigation")}
      >
        {nav.slice(0, 4).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => {
                navigate(item.id);
                setMoreOpen(false);
              }}
            >
              <Icon size={20} />
              <span>{t(lang, item.zh, item.en)}</span>
            </button>
          );
        })}
        <button
          className={
            moreOpen ||
            ["library", "methods", "progress", "settings", "admin"].includes(view)
              ? "active"
              : ""
          }
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <Settings2 size={20} />
          <span>{t(lang, "更多", "More")}</span>
        </button>
      </nav>
      {moreOpen && (
        <div className="mobile-more">
          {nav
            .slice(4)
            .concat(
              profile.role === "admin"
                ? [{ id: "admin", zh: "管理", en: "Admin", icon: ShieldCheck }]
                : [],
            )
            .map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  navigate(item.id);
                  setMoreOpen(false);
                }}
              >
                {t(lang, item.zh, item.en)}
              </button>
            ))}
        </div>
      )}
      {logoutScope && (
        <Modal
          label={t(lang, "未同步的草稿和答题进度", "Unsynced drafts")}
          busy={logoutBusy}
          onClose={() => setLogoutScope(null)}
        >
          <h3>
            {t(
              lang,
              "本机仍有未同步草稿或答题进度",
              "Unsynced drafts remain on this device",
            )}
          </h3>
          <p>
            {t(
              lang,
              "保留后，下次用同一账号登录此浏览器可恢复。清理会删除尚未同步的文字和答案。",
              "Keep them to restore after signing in on this browser again. Discarding deletes unsynced text and answers.",
            )}
          </p>
          <div className="button-row">
            <button
              className="button primary"
              disabled={logoutBusy}
              onClick={() => void finishLogout(logoutScope, false)}
            >
              {t(lang, "保留并退出", "Keep and sign out")}
            </button>
            <button
              className="button danger-outline"
              disabled={logoutBusy}
              onClick={() => void finishLogout(logoutScope, true)}
            >
              {t(lang, "清理并退出", "Discard and sign out")}
            </button>
            <button
              className="button secondary"
              data-modal-initial-focus
              disabled={logoutBusy}
              onClick={() => setLogoutScope(null)}
            >
              {t(lang, "取消", "Cancel")}
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            onClick={() => setToast(null)}
            aria-label={t(lang, "关闭", "Close")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Onboarding({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (profile: Profile) => Promise<void>;
}) {
  const [draft, setDraft] = useState(profile);
  return (
    <div className="auth-screen">
      <div className="auth-card onboarding-card">
        <Image
          className="brand-mark"
          src={brandAssets.logo}
          alt="JiawenLex"
          width={42}
          height={42}
        />
        <span className="eyebrow">WELCOME TO JIAWENLEX</span>
        <h1>
          {t(draft.language, "先定下你的学习方向", "Set your study direction")}
        </h1>
        <p>
          {t(
            draft.language,
            "这些目标之后都可以在设置里调整。AI 密钥也可以稍后再配。",
            "You can change these goals later. AI setup is optional.",
          )}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSave({ ...draft, onboarded: true }).catch(() => undefined);
          }}
        >
          <label>
            {t(draft.language, "考试类型", "Exam track")}
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
            {t(draft.language, "目标总分", "Overall target")}
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
            {t(draft.language, "考试日期", "Exam date")}
            <input
              type="date"
              value={draft.target_date ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, target_date: event.target.value || null })
              }
            />
          </label>
          <label>
            {t(draft.language, "每周学习小时", "Study hours per week")}
            <input
              required
              type="number"
              min="1"
              max="80"
              value={draft.weekly_hours}
              onChange={(event) =>
                setDraft({ ...draft, weekly_hours: Number(event.target.value) })
              }
            />
          </label>
          <button className="button primary full" type="submit">
            {t(draft.language, "进入工作台", "Open workspace")}
          </button>
        </form>
      </div>
    </div>
  );
}

function SetupScreen() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <Image
          className="brand-mark"
          src={brandAssets.logo}
          alt="JiawenLex"
          width={42}
          height={42}
        />
        <h1>JiawenLex</h1>
        <p>
          请配置 Supabase 环境变量后启动。部署时须关闭演示模式；具体步骤见项目
          README。
        </p>
        <code>
          NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        </code>
      </div>
    </div>
  );
}

function AuthScreen({
  client,
  onSignedIn,
  resetFlow,
  setResetFlow,
  notify,
}: {
  client: SupabaseClient | null;
  onSignedIn: () => Promise<void>;
  resetFlow: boolean;
  setResetFlow: (value: boolean) => void;
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState<"login" | "register" | "forgot">(
    resetFlow ? "forgot" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setMessage("");
    try {
      if (resetFlow) {
        const { error } = await client.auth.updateUser({
          password: newPassword,
        });
        if (error) throw error;
        setResetFlow(false);
        setMessage("密码已更新，请登录。");
        await client.auth.signOut();
        setTab("login");
      } else if (tab === "login") {
        const { error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        await onSignedIn();
      } else if (tab === "register") {
        const { error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: nickname.trim(),
              invite_code: inviteCode.trim(),
            },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        setMessage("请打开验证邮件并点击其中的链接，然后返回这里登录。");
      } else {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setMessage("如果该邮箱已注册，你将收到密码重设邮件。");
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "操作失败";
      setMessage(text);
      notify(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-panel">
        <div className="auth-intro">
          <div className="brand">
            <Image
              className="brand-mark"
              src={brandAssets.logo}
              alt="JiawenLex"
              width={42}
              height={42}
            />
            <strong>JiawenLex</strong>
          </div>
          <div>
            <span className="eyebrow">YOUR IELTS WORKSPACE</span>
            <h2>
              把每一天的练习，
              <br />
              变成看得见的进步。
            </h2>
            <p>
              今日计划、四科练习、词汇复习与个人记录，都在同一个安静的地方。
            </p>
          </div>
          <div className="auth-note">仅向收到邀请码的学习伙伴开放</div>
        </div>
        <div className="auth-card">
          <div className="auth-tabs">
            <button
              className={tab === "login" && !resetFlow ? "active" : ""}
              onClick={() => {
                setTab("login");
                setResetFlow(false);
              }}
            >
              登录
            </button>
            <button
              className={tab === "register" && !resetFlow ? "active" : ""}
              onClick={() => {
                setTab("register");
                setResetFlow(false);
              }}
            >
              凭邀请码加入
            </button>
          </div>
          <h1>
            {resetFlow
              ? "设置新密码"
              : tab === "login"
                ? "欢迎回来"
                : tab === "register"
                  ? "开始你的备考"
                  : "重设密码"}
          </h1>
          <p className="muted">
            {resetFlow
              ? "输入新的登录密码。"
              : tab === "register"
                ? "先填写小组邀请码，再完成邮箱验证。"
                : "使用你的邮箱继续。"}
          </p>
          <form onSubmit={(event) => void submit(event)}>
            {!resetFlow && tab === "register" && (
              <>
                <label>
                  昵称
                  <input
                    required
                    maxLength={32}
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    placeholder="学习伙伴"
                  />
                </label>
                <label>
                  邀请码
                  <input
                    required
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                    placeholder="输入管理员提供的邀请码"
                  />
                </label>
              </>
            )}
            {!resetFlow && (
              <label>
                邮箱
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                />
              </label>
            )}
            {!resetFlow && tab !== "forgot" && (
              <label>
                密码
                <input
                  required
                  minLength={8}
                  type="password"
                  autoComplete={
                    tab === "login" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 8 位"
                />
              </label>
            )}
            {resetFlow && (
              <label>
                新密码
                <input
                  required
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
            )}
            <button className="button primary full" disabled={busy}>
              {busy
                ? "请稍候…"
                : resetFlow
                  ? "保存新密码"
                  : tab === "login"
                    ? "登录工作台"
                    : tab === "register"
                      ? "发送验证邮件"
                      : "发送重设邮件"}
            </button>
          </form>
          {message && (
            <p className="form-message" role="status">
              {message}
            </p>
          )}
          {!resetFlow && (
            <button
              className="text-link"
              onClick={() => {
                setTab(tab === "forgot" ? "login" : "forgot");
                setMessage("");
              }}
            >
              {tab === "forgot" ? "返回登录" : "忘记密码？"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
