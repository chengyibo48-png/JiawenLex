import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WorkspaceData } from "./types";

let browserClient: SupabaseClient | null = null;

export const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export function getBrowserClient(): SupabaseClient | null {
  if (demoMode) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (!browserClient)
    browserClient = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  return browserClient;
}

export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function loadWorkspace(
  client: SupabaseClient,
  userId: string,
): Promise<WorkspaceData> {
  const tables = [
    "profiles",
    "study_tasks",
    "materials",
    "vocabulary",
    "practice_attempts",
    "writing_drafts",
    "share_grants",
    "share_comments",
    "ai_usage",
    "practice_sessions",
    "attempt_reviews",
    "vocabulary_sources",
    "spelling_sessions",
    "micro_sessions",
    "micro_attempts",
  ] as const;
  const results = await Promise.all(
    tables.map((table) => client.from(table).select("*")),
  );
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw firstError;
  const membersResult = await client.rpc("list_members");
  if (membersResult.error) throw membersResult.error;
  const profile = (results[0].data ?? []).find((row) => row.id === userId);
  if (!profile || profile.status !== "active")
    throw new Error("账号已停用或个人资料尚未建立");
  return {
    microDrafts: results[13].data ?? [],
    microAttempts: results[14].data ?? [],
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
    practiceSessions: results[9].data ?? [],
    attemptReviews: results[10].data ?? [],
    vocabularySources: results[11].data ?? [],
    spellingSessions: (results[12].data ?? []).sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    ),
  } as WorkspaceData;
}

export async function saveRow(
  client: SupabaseClient | null,
  table: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown> | void> {
  if (!client) return;
  if (table === "materials") {
    const { revision, updated_at, ...payload } = row;
    if (typeof revision === "number" && revision > 0) {
      const result = await client
        .from(table)
        .update(payload)
        .eq("id", row.id)
        .eq("revision", revision)
        .select("*")
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data)
        throw new Error(
          "资料已在其他页面修改，请保留编辑内容并重新加载 / Material changed elsewhere; retain edits and reload",
        );
      return result.data;
    }
    const result = await client
      .from(table)
      .insert(payload)
      .select("*")
      .single();
    if (result.error) throw result.error;
    return result.data;
  }
  if (
    table === "practice_attempts" &&
    row.material_id &&
    row.material_revision &&
    ["writing", "speaking"].includes(String(row.skill))
  ) {
    await apiFetch(client, "/api/responses", {
      method: "POST",
      body: JSON.stringify(row),
    });
    return;
  }
  if (table === "share_grants" && row.revoked_at) {
    await apiFetch(client, "/api/shares/revoke", {
      method: "POST",
      body: JSON.stringify({ id: row.id }),
    });
    return;
  }
  // These records are append-only for members. An UPDATE-first upsert would need
  // privileges the app intentionally does not grant for these tables.
  if (["practice_attempts", "share_grants", "share_comments"].includes(table)) {
    const { error } = await client.from(table).insert(row);
    if (
      error &&
      table === "practice_attempts" &&
      error.code === "PGRST204" &&
      /feedback_tags|question_stats/.test(error.message)
    ) {
      // Compatibility until the reviewed, additive summary migration is applied.
      const legacy = { ...row };
      delete legacy.feedback_tags;
      delete legacy.question_stats;
      const retry = await client.from(table).insert(legacy);
      if (retry.error) throw retry.error;
    } else if (error?.code === "23505" && table === "practice_attempts") {
      const { data: existing, error: readError } = await client
        .from(table)
        .select("owner_id,skill,material_id")
        .eq("id", row.id)
        .maybeSingle();
      if (
        readError ||
        !existing ||
        existing.owner_id !== row.owner_id ||
        existing.skill !== row.skill ||
        existing.material_id !== row.material_id
      )
        throw error;
    } else if (error) throw error;
    return;
  }
  const { data, error } = await client
    .from(table)
    .update(row)
    .eq("id", row.id)
    .select("id");
  if (error) throw error;
  if (data?.length) return;
  if (table === "profiles") throw new Error("个人设置未保存，请刷新后重试。");
  const inserted = await client.from(table).insert(row);
  if (inserted.error) throw inserted.error;
}

export async function deleteRow(
  client: SupabaseClient | null,
  table: string,
  id: string,
): Promise<void> {
  if (!client) return;
  if (
    ["materials", "practice_attempts", "vocabulary", "micro_attempts"].includes(
      table,
    )
  ) {
    await apiFetch(client, "/api/records", {
      method: "DELETE",
      body: JSON.stringify({ table, id }),
    });
    return;
  }
  const { error } = await client.from(table).delete().eq("id", id);
  if (error) throw error;
}

export async function apiFetch(
  client: SupabaseClient | null,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  if (!client) throw new Error("本地演示模式不连接云端服务");
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("请先登录");
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "请求失败");
  return body;
}
