import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./server-auth";
import { materialUnit, originalUnits } from "./micro-training";
import type { Material } from "./types";
export async function availableMaterial(
  admin: SupabaseClient,
  userId: string,
  id: string,
): Promise<Material> {
  const result = await admin
    .from("materials")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw result.error;
  const m = result.data as Material | null;
  if (!m || m.track !== "academic")
    throw new HttpError(404, "资料不存在或不可访问 / Material unavailable");
  let allowed =
    m.owner_id === userId ||
    (m.visibility === "shared" && m.approval === "approved");
  if (!allowed) {
    const grant = await admin
      .from("share_grants")
      .select("id")
      .eq("target_type", "material")
      .eq("target_id", id)
      .eq("recipient_id", userId)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();
    if (grant.error) throw grant.error;
    allowed = !!grant.data;
  }
  if (!allowed) throw new HttpError(403, "资料不可访问 / Material unavailable");
  return m;
}
export async function resolveMicroUnit(
  admin: SupabaseClient,
  userId: string,
  key: string,
) {
  const builtin = originalUnits.find((unit) => unit.key === key);
  if (builtin) return builtin;
  const id = /^material:([a-f\d-]{36})$/i.exec(key)?.[1];
  if (!id) throw new HttpError(404, "训练不存在 / Training unavailable");
  const material = await availableMaterial(admin, userId, id);
  const unit = materialUnit(material);
  if (!unit)
    throw new HttpError(
      400,
      "训练资料不完整：补齐来源、许可、参考表达和完成标准 / Incomplete training content",
    );
  return unit;
}
