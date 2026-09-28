import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./server-auth";

export async function checkBudget(admin: SupabaseClient, userId: string, budget: number | null, estimatedNext: number, override: boolean): Promise<number> {
  if (!budget || budget <= 0) throw new HttpError(403, "Set a monthly AI budget");
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await admin.from("ai_usage").select("estimated_cny").eq("owner_id", userId).gte("created_at", monthStart);
  if (error) throw error;
  const used = (data ?? []).reduce((sum, row) => sum + Number(row.estimated_cny), 0);
  if (used + estimatedNext >= budget && !override) throw new HttpError(409, "budget_confirmation_required");
  return used;
}
