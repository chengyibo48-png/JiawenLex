"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { archiveLocalValue, clearLocalDraft, conflictCopies, localConflictIds, localDraftIds, readLocalDraft, saveLocalDraft, type LocalDraft } from "@/lib/offline-drafts";
import { initialSessionState, sameSessionState, sessionLocalId, type PracticeSession, type PracticeSessionState } from "@/lib/practice-sessions";
import type { Material } from "@/lib/types";

export type SessionStatus = "saved" | "saving" | "local" | "conflict" | "error";
type Entry = { row: PracticeSession; dirty: boolean; revision?: string; status: SessionStatus;
  conflict?: { cloud: PracticeSession | null }; copies: LocalDraft[]; write: Promise<unknown>;
  syncing?: Promise<void>; edit: number };
interface Options {
  userId: string | null; client: SupabaseClient | null; remote: PracticeSession[]; materials: Material[];
  activeMaterial: () => string | null; onSaved: (row: PracticeSession) => void;
}
export function usePracticeSessions(options: Options) {
  const latest = useRef(options); latest.current = options;
  const entries = useRef(new Map<string, Entry>());
  const owner = useRef<string | null>(null);
  const retainedCopies = useRef(new Map<string, LocalDraft[]>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [, render] = useState(0);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const mounted = useRef(true);
  const touch = () => { if (mounted.current) render((n) => n + 1); };
  const valid = (entry: Entry) => owner.current === entry.row.owner_id && entries.current.get(entry.row.material_id) === entry;
  const allowed = (id: string) => latest.current.materials.some((m) => m.id === id);
  function persist(entry: Entry) {
    const snapshot = { ...entry.row };
    const write = saveLocalDraft(entry.row.owner_id, sessionLocalId(entry.row.material_id), JSON.stringify(snapshot), snapshot.version);
    entry.write = write;
    void write.then((local) => { entry.revision = local.revision; }).catch(() => { entry.status = "error"; touch(); });
    return write;
  }
  async function archive(entry: Entry, row: PracticeSession) {
    await archiveLocalValue(row.owner_id, sessionLocalId(row.material_id), JSON.stringify(row), row.version);
    entry.copies = await conflictCopies(row.owner_id, sessionLocalId(row.material_id));
    retainedCopies.current.set(row.material_id, entry.copies);
  }
  async function block(entry: Entry, cloud: PracticeSession | null) {
    entry.status = "conflict"; entry.conflict = { cloud };
    try { await archive(entry, entry.row); } catch { /* Keep the pending encrypted copy and visible editor. */ }
    touch();
  }
  async function syncWork(entry: Entry) {
    try {
      while (valid(entry) && entry.dirty && !entry.conflict && allowed(entry.row.material_id)) {
        await entry.write;
        if (!valid(entry)) return;
        if (!navigator.onLine && latest.current.client) { entry.status = "local"; touch(); break; }
        const snapshot = { ...entry.row }, edit = entry.edit, revision = entry.revision;
        entry.status = "saving"; touch();
        let saved: PracticeSession;
        if (!latest.current.client) saved = { ...snapshot, version: snapshot.version + 1, updated_at: new Date().toISOString() };
        else {
          const { data } = await latest.current.client.auth.getSession();
          if (!data.session || data.session.user.id !== snapshot.owner_id) throw new Error("Session expired");
          const response = await fetch("/api/practice-sessions", {
            method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
            body: JSON.stringify({ materialId: snapshot.material_id, state: snapshot.state, version: snapshot.version }),
            signal: AbortSignal.timeout(10000),
          });
          const result = await response.json();
          if (!valid(entry)) return;
          if (response.status === 409) {
            // A lost response can produce the same state with a newer version.
            if (result.session && sameSessionState(result.session.state, snapshot.state)) saved = result.session;
            else { await block(entry, result.session ?? null); break; }
          } else {
            if (!response.ok) throw new Error(result.error ?? "Save failed");
            saved = result.session;
          }
        }
        if (!valid(entry)) return;
        entry.row = { ...entry.row, id: saved.id, version: saved.version };
        latest.current.onSaved(saved);
        if (entry.edit === edit) {
          entry.row = saved; entry.dirty = false; entry.status = "saved";
          await clearLocalDraft(saved.owner_id, sessionLocalId(saved.material_id), revision);
        } else await persist(entry);
        touch();
      }
    } catch { if (valid(entry)) { entry.status = entry.status === "error" ? "error" : "local"; touch(); } }
  }
  async function flushEntry(entry: Entry) {
    if (entry.syncing) await entry.syncing;
    if (!valid(entry) || !entry.dirty || entry.conflict) return;
    const promise = syncWork(entry);
    entry.syncing = promise;
    await promise;
    if (entry.syncing === promise) entry.syncing = undefined;
  }
  function schedule(entry: Entry) {
    const key = entry.row.material_id;
    const previous = timers.current.get(key);
    if (previous) clearTimeout(previous);
    timers.current.set(key, setTimeout(() => { timers.current.delete(key); void flushEntry(entry); }, 700));
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const timer of timers.current.values()) clearTimeout(timer); };
  }, []);
  useEffect(() => {
    const userId = options.userId;
    owner.current = userId; entries.current = new Map(); retainedCopies.current = new Map();
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear(); setReady(false); setLoadError(false);
    if (!userId) return;
    const map = entries.current;
    const create = (row: PracticeSession): Entry => ({ row, dirty: false, status: "saved", copies: [], write: Promise.resolve(), edit: 0 });
    for (const row of latest.current.remote) if (row.owner_id === userId && allowed(row.material_id)) map.set(row.material_id, create(row));
    let hydrationFailed = false;
    void (async () => {
      try {
        const pendingIds = (await localDraftIds(userId)).filter((id) => id.startsWith("practice:"));
        const copyIds = (await localConflictIds(userId)).filter((id) => id.startsWith("practice:")).map((id) => id.slice(9));
        const ids = new Set([...map.keys(), ...copyIds, ...pendingIds.map((id) => id.slice(9))]);
        for (const id of ids) {
          if (owner.current !== userId || entries.current !== map) return;
          if (!allowed(id)) continue;
          const local = await readLocalDraft(userId, sessionLocalId(id));
          const cloud = map.get(id)?.row ?? null;
          if (local) {
            const row = JSON.parse(local.body) as PracticeSession;
            if (row.owner_id !== userId || row.material_id !== id || !row.state?.questionIds) continue;
            if (Date.now() - Date.parse(local.updatedAt) > 365 * 86400000) { await clearLocalDraft(userId, sessionLocalId(id), local.revision); continue; }
            const entry = create({ ...row, version: local.version ?? row.version });
            entry.dirty = true; entry.revision = local.revision; entry.status = "local";
            map.set(id, entry);
            if (cloud && sameSessionState(cloud.state, row.state)) {
              entry.row = cloud; entry.dirty = false; entry.status = "saved";
              await clearLocalDraft(userId, sessionLocalId(id), local.revision);
            } else if (entry.row.version !== (cloud?.version ?? 0)) await block(entry, cloud);
          }
          const entry = map.get(id);
          const backups = await conflictCopies(userId, sessionLocalId(id));
          retainedCopies.current.set(id, backups);
          if (entry) entry.copies = backups;
        }
      } catch { hydrationFailed = true; if (owner.current === userId) setLoadError(true); }
      finally {
        if (owner.current === userId && entries.current === map) {
          setReady(!hydrationFailed); touch();
          for (const entry of map.values()) if (!hydrationFailed && entry.dirty && !entry.conflict) schedule(entry);
        }
      }
    })();
  }, [options.userId]);
  useEffect(() => {
    if (!ready) return;
    for (const row of options.remote) {
      if (row.owner_id !== owner.current || !allowed(row.material_id)) continue;
      const entry = entries.current.get(row.material_id);
      if (!entry) { entries.current.set(row.material_id, { row, dirty: false, status: "saved", copies: [], write: Promise.resolve(), edit: 0 }); touch(); }
      else if (row.version > entry.row.version && !entry.syncing && entry.conflict?.cloud?.version !== row.version) {
        if (entry.dirty || latest.current.activeMaterial() === row.material_id) void block(entry, row);
        else { entry.row = row; touch(); }
      }
    }
  }, [options.remote, ready]);
  useEffect(() => {
    const retry = () => { for (const entry of entries.current.values()) void flushEntry(entry); };
    const leaving = (event: BeforeUnloadEvent) => {
      if ([...entries.current.values()].some((entry) => entry.dirty)) { event.preventDefault(); event.returnValue = ""; }
    };
    const checkpoint = () => { if (document.visibilityState === "hidden") retry(); };
    window.addEventListener("online", retry); window.addEventListener("beforeunload", leaving);
    document.addEventListener("visibilitychange", checkpoint);
    const timer = setInterval(retry, 30000);
    return () => { window.removeEventListener("online", retry); window.removeEventListener("beforeunload", leaving); document.removeEventListener("visibilitychange", checkpoint); clearInterval(timer); };
  }, []);
  function update(material: Material, patch: Partial<PracticeSessionState>) {
    if (!ready || !owner.current || !allowed(material.id) || !["reading", "listening"].includes(material.skill)) return;
    let entry = entries.current.get(material.id);
    if (!entry) {
      entry = { row: { id: crypto.randomUUID(), owner_id: owner.current, material_id: material.id,
        skill: material.skill as "reading" | "listening", state: initialSessionState(material), version: 0, updated_at: new Date().toISOString() },
        dirty: false, status: "saved", copies: [], write: Promise.resolve(), edit: 0 };
      entries.current.set(material.id, entry);
    }
    entry.row = { ...entry.row, state: { ...entry.row.state, ...patch, answerExposed: !!entry.row.answer_seen || !!entry.row.state.answerExposed || entry.row.state.revealed.length > 0 || !!patch.answerExposed || !!patch.revealed?.length }, updated_at: new Date().toISOString() };
    entry.edit++; entry.dirty = true; entry.status = entry.conflict ? "conflict" : "saving";
    void persist(entry).then(() => { if (valid(entry)) schedule(entry); }).catch(() => undefined);
    touch();
  }
  async function resolve(materialId: string, choice: "cloud" | "local") {
    const entry = entries.current.get(materialId);
    if (!entry?.conflict) return;
    const cloud = entry.conflict.cloud;
    await archive(entry, choice === "cloud" ? entry.row : cloud ?? entry.row);
    await entry.write;
    if (choice === "cloud") {
      await clearLocalDraft(entry.row.owner_id, sessionLocalId(materialId), entry.revision);
      if (cloud) { entry.row = cloud; entry.dirty = false; entry.status = "saved"; entry.conflict = undefined; entry.edit++; }
      else entries.current.delete(materialId);
    } else {
      entry.row = { ...entry.row, id: cloud?.id ?? entry.row.id, version: cloud?.version ?? 0 };
      entry.conflict = undefined; entry.dirty = true; entry.status = "saving"; entry.edit++;
      await persist(entry); await flushEntry(entry);
    }
    touch();
  }
  async function restart(material: Material) {
    const entry = entries.current.get(material.id);
    if (entry?.conflict) throw new Error("请先处理会话冲突 / Resolve the session conflict first");
    if (entry) await archive(entry, entry.row);
    update(material, initialSessionState(material));
  }
  async function complete(material: Material) {
    const entry = entries.current.get(material.id);
    if (!entry) return;
    if (entry.conflict) {
      // The other device's work stays active; this submission is already a separate attempt.
      await resolve(material.id, "cloud"); return;
    }
    update(material, { phase: "completed" });
    await flushEntry(entry);
  }
  return {
    ready, loadError,
    sessions: [...entries.current.values()].filter((entry) => allowed(entry.row.material_id) && entry.row.state.phase === "active").map((entry) => entry.row),
    get: (id: string) => entries.current.get(id)?.row,
    status: (id: string): SessionStatus => entries.current.get(id)?.status ?? "saved",
    conflict: (id: string) => entries.current.get(id)?.conflict,
    copies: (id: string) => entries.current.get(id)?.copies ?? retainedCopies.current.get(id) ?? [],
    update, resolve, restart, complete,
    restore: async (material: Material, state: PracticeSessionState) => {
      const entry = entries.current.get(material.id);
      if (entry?.conflict) throw new Error("Resolve the conflict first");
      if (entry) await archive(entry, entry.row);
      update(material, { ...state, phase: "active" });
    },
    flush: async (id: string) => { const entry = entries.current.get(id); if (entry) { if (entry.status === "error") await persist(entry); await entry.write; await flushEntry(entry); } },
    canLeave: async (id: string) => {
      const entry = entries.current.get(id);
      if (!entry) return true;
      try { await entry.write; await flushEntry(entry); return entry.status !== "error"; } catch { return false; }
    },
  };
}
export type PracticeSessionManager = ReturnType<typeof usePracticeSessions>;
