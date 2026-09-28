"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { archiveLocalDraft, clearLocalDraft, conflictCopies, readLocalDraft, saveLocalDraft, type LocalDraft } from "@/lib/offline-drafts";
import { demoMode } from "@/lib/supabase";
import type { WritingDraft } from "@/lib/types";

type Status = "saved" | "saving" | "local" | "conflict" | "error";
type Context = {
  materialId: string; body: string; version: number; revision: string | null;
  hydrated: boolean; dirty: boolean; blocked: boolean; saving: boolean; localWrite: Promise<unknown>; localFailed: boolean;
};
interface Options {
  userId: string; materialId: string | null; remote: WritingDraft | undefined; client: SupabaseClient | null;
  saveDemo: (draft: WritingDraft) => Promise<void>;
  onCloudSaved: (draft: WritingDraft) => void;
}
export function useWritingDraft(options: Options) {
  const latestOptions = useRef(options); latestOptions.current = options;
  const context = useRef<Context | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<Status>("saved");
  const [ready, setReady] = useState(false);
  const [conflict, setConflict] = useState<{ draft: WritingDraft | null } | null>(null);
  const [copies, setCopies] = useState<LocalDraft[]>([]);
  const current = (ctx: Context) => context.current === ctx;
  const showStatus = (ctx: Context, value: Status) => { if (current(ctx)) setStatus(value); };
  function persist(ctx: Context): Promise<unknown> {
    const text = ctx.body, version = ctx.version;
    const pending = saveLocalDraft(latestOptions.current.userId, ctx.materialId, text, version);
    ctx.localWrite = pending;
    void pending.then((local) => { ctx.revision = local.revision; ctx.localFailed = false; }).catch(() => { ctx.localFailed = true; showStatus(ctx, "error"); });
    return pending;
  }
  async function flush(ctx: Context) {
    if (!ctx.hydrated || !ctx.dirty || ctx.blocked || ctx.saving) return;
    ctx.saving = true;
    const { userId, client, saveDemo } = latestOptions.current;
    try {
      while (ctx.dirty && !ctx.blocked) {
        await ctx.localWrite;
        if (!navigator.onLine && !demoMode) { showStatus(ctx, "local"); break; }
        const text = ctx.body, version = ctx.version, revision = ctx.revision;
        showStatus(ctx, "saving");
        let saved: WritingDraft;
        if (demoMode) {
          saved = { id: latestOptions.current.remote?.id ?? crypto.randomUUID(), owner_id: userId, material_id: ctx.materialId, body: text, version: version + 1, updated_at: new Date().toISOString() };
          await saveDemo(saved);
        } else {
          const { data } = await client!.auth.getSession();
          const response = await fetch("/api/drafts", {
            method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
            body: JSON.stringify({ materialId: ctx.materialId, body: text, version }),
          });
          const result = await response.json();
          if (response.status === 409) {
            ctx.blocked = true;
            if (current(ctx)) setConflict({ draft: result.serverDraft ?? null });
            showStatus(ctx, "conflict");
            break;
          }
          if (!response.ok) throw new Error(result.error ?? "Draft save failed");
          saved = result.draft;
        }
        ctx.version = saved.version;
        latestOptions.current.onCloudSaved(saved);
        if (ctx.body === text) {
          ctx.dirty = false;
          await clearLocalDraft(userId, ctx.materialId, revision ?? undefined);
          showStatus(ctx, "saved");
        } else {
          // Carry the new cloud version into the newer LOCAL edit before another request.
          await persist(ctx);
        }
      }
    } catch { showStatus(ctx, ctx.localFailed ? "error" : "local"); }
    finally { ctx.saving = false; }
  }
  function schedule(ctx: Context) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(ctx); }, 900);
  }
  useEffect(() => {
    const { materialId, userId, client } = latestOptions.current;
    let remote = latestOptions.current.remote;
    if (!materialId) { context.current = null; setReady(false); return; }
    const ctx: Context = { materialId, body: remote?.body ?? "", version: remote?.version ?? 0, revision: null, hydrated: false, dirty: false, blocked: false, saving: false, localWrite: Promise.resolve(), localFailed: false };
    context.current = ctx;
    setBody(ctx.body); setStatus("saved"); setReady(false); setConflict(null); setCopies([]);
    void (async () => {
      try {
        const [local, backups] = await Promise.all([readLocalDraft(userId, materialId), conflictCopies(userId, materialId)]);
        if (!current(ctx)) return;
        if (client && navigator.onLine) {
          const { data, error } = await client.from("writing_drafts").select("*").eq("owner_id", userId).eq("material_id", materialId).maybeSingle();
          if (!current(ctx)) return;
          if (!error) {
            remote = data ?? undefined;
            ctx.body = remote?.body ?? ""; ctx.version = remote?.version ?? 0;
            setBody(ctx.body);
            if (remote) latestOptions.current.onCloudSaved(remote);
          }
        }
        setCopies(backups);
        if (local) {
          ctx.body = local.body; ctx.revision = local.revision;
          ctx.version = local.version ?? 0;
          setBody(local.body);
          if (remote && local.body === remote.body) {
            ctx.version = remote.version;
            await clearLocalDraft(userId, materialId, local.revision);
          } else {
            ctx.dirty = true;
            if (local.version === null || ctx.version !== (remote?.version ?? 0)) {
              ctx.blocked = true; setConflict({ draft: remote ?? null }); setStatus("conflict");
            } else setStatus("local");
          }
        }
      } catch { if (current(ctx)) setStatus("error"); }
      finally {
        ctx.hydrated = true;
        if (current(ctx)) { setReady(true); if (ctx.dirty && !ctx.blocked) schedule(ctx); }
      }
    })();
    const reconnect = () => { void flush(ctx); };
    const unload = (event: BeforeUnloadEvent) => {
      if (ctx.dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("online", reconnect); window.addEventListener("beforeunload", unload);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", reconnect); window.removeEventListener("beforeunload", unload);
      if (current(ctx)) context.current = null;
    };
    // Draft hydration happens once on opening, so refreshes cannot replace text while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.materialId, options.userId]);
  function edit(text: string) {
    const ctx = context.current;
    if (!ctx?.hydrated) return;
    ctx.body = text; ctx.dirty = true;
    setBody(text); showStatus(ctx, ctx.blocked ? "conflict" : "saving");
    // The local write starts immediately; ONLY the cloud request is debounced.
    void persist(ctx).then(() => { if (!ctx.blocked) schedule(ctx); }).catch(() => undefined);
  }
  async function useCloud() {
    const ctx = context.current;
    if (!ctx || !conflict) return;
    try {
      await ctx.localWrite;
      await archiveLocalDraft(options.userId, ctx.materialId);
      await clearLocalDraft(options.userId, ctx.materialId, ctx.revision ?? undefined);
      ctx.body = conflict.draft?.body ?? ""; ctx.version = conflict.draft?.version ?? 0;
      ctx.dirty = false; ctx.blocked = false;
      setBody(ctx.body); setConflict(null); setStatus("saved");
      setCopies(await conflictCopies(options.userId, ctx.materialId));
    } catch { showStatus(ctx, "error"); }
  }
  async function canLeave(message: string, failureMessage: string, ask = true) {
    const ctx = context.current;
    if (!ctx?.dirty) return true;
    try { await ctx.localWrite; }
    catch { return window.confirm(failureMessage); }
    return !ctx.dirty || !ask || window.confirm(message);
  }
  return { body, edit, status, ready, conflict, copies, useCloud, canLeave };
}
