"use client";
import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Skill, View } from "@/lib/types";
export function useMemberPresence(client: SupabaseClient | null, memberId: string | undefined, view: View, skill: Skill) {
  const instance = useRef<string | null>(null);
  useEffect(() => {
    if (!client || !memberId) return;
    const instanceId = instance.current ?? (instance.current = crypto.randomUUID());
    let stopped = false;
    let busy = false;
    const controller = new AbortController();
    async function heartbeat(visible = document.visibilityState === "visible") {
      if (stopped || busy || !navigator.onLine) return;
      busy = true;
      try {
        const { data } = await client!.auth.getSession();
        if (stopped || data.session?.user.id !== memberId) return;
        if (!data.session) return;
        await fetch("/api/activity", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ instanceId, module: view === "practice" ? skill : view, visible }) });
      } catch { /* Presence is approximate; learning must work when this request fails. */ }
      finally { busy = false; }
    }
    const update = () => { void heartbeat(); };
    void heartbeat();
    const timer = window.setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", update); window.removeEventListener("online", update); };
  }, [client, memberId, view, skill]);
}
