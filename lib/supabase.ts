import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WorkspaceData } from "./types";

let browserClient: SupabaseClient | null = null;

export const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export function getBrowserClient(): SupabaseClient | null {
  if (demoMode) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (!browserClient) browserClient = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return browserClient;
}

export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function loadWorkspace(client: SupabaseClient, userId: string): Promise<WorkspaceData> {
  const tables = ["profiles", "study_tasks", "materials", "vocabulary", "practice_attempts", "writing_drafts", "share_grants", "share_comments", "ai_usage"] as const;
  const results = await Promise.all(tables.map((table) => client.from(table).select("*")));
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw firstError;
  const membersResult = await client.rpc("list_members");
  if (membersResult.error) throw membersResult.error;
  const profile = (results[0].data ?? []).find((row) => row.id === userId);
  if (!profile || profile.status !== "active") throw new Error("账号已停用或个人资料尚未建立");
  return {
    profile,
    tasks: results[1].data ?? [],
    materials: results[2].data ?? [],
    words: results[3].data ?? [],
    attempts: results[4].data ?? [],
    drafts: results[5].data ?? [],
    shares: results[6].data ?? [],
    comments: results[7].data ?? [],
    members: membersResult.data ?? [],
    usage: results[8].data ?? [],
  } as WorkspaceData;
}

export async function saveRow(client: SupabaseClient | null, table: string, row: Record<string, unknown>): Promise<void> {
  if (!client) return;
  if (table === "share_grants" && row.revoked_at) {
    await apiFetch(client, "/api/shares/revoke", { method: "POST", body: JSON.stringify({ id: row.id }) });
    return;
  }
  const { data, error } = await client.from(table).update(row).eq("id", row.id).select("id");
  if (error) throw error;
  if (data?.length) return;
  const inserted = await client.from(table).insert(row);
  if (inserted.error) throw inserted.error;
}

export async function deleteRow(client: SupabaseClient | null, table: string, id: string): Promise<void> {
  if (!client) return;
  if (["materials", "practice_attempts", "vocabulary"].includes(table)) {
    await apiFetch(client, "/api/records", { method: "DELETE", body: JSON.stringify({ table, id }) });
    return;
  }
  const { error } = await client.from(table).delete().eq("id", id);
  if (error) throw error;
}

export async function apiFetch(client: SupabaseClient | null, path: string, init?: RequestInit): Promise<unknown> {
  if (!client) throw new Error("本地演示模式不连接云端服务");
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("请先登录");
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "请求失败");
  return body;
}
