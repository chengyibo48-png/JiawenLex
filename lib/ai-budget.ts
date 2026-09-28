import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./server-auth";

export async function reserveBudget(admin: SupabaseClient, userId: string, provider: string, operation: string, estimated: number, override: boolean, reference: string | null = null): Promise<{ id: string; used: number }> {
  const { data, error } = await admin.rpc("reserve_ai_usage", { member_id: userId, provider_name: provider, operation_name: operation, estimate: estimated, override_budget: override, reference });
  if (error) {
    if (error.code === "PGRST202") throw new HttpError(503, "数据库更新尚未应用，AI 预算保护准备完成后才能调用服务。");
    if (error.message.includes("budget_confirmation_required")) throw new HttpError(409, "budget_confirmation_required");
    if (error.message.includes("monthly AI budget") || error.message.includes("AI is disabled")) throw new HttpError(403, error.message);
    throw error;
  }
  return { id: data.id, used: Number(data.used) };
}
export async function settleBudget(admin: SupabaseClient, id: string, estimated: number): Promise<void> {
  const { error } = await admin.from("ai_usage").update({ estimated_cny: estimated, status: "settled", reserved_until: null }).eq("id", id);
  if (error) throw error;
}
