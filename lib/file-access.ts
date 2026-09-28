import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./server-auth";
import { getAdminClient } from "./supabase";

function secret() {
  const value = process.env.FILE_ACCESS_SECRET ?? process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!value || value.length < 32) throw new Error("FILE_ACCESS_SECRET is not configured");
  return value;
}

export function fileToken(userId: string, materialId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, materialId, expires: Date.now() + 60 * 60 * 1000 })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function parseFileToken(token: string): { userId: string; materialId: string } {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new HttpError(403, "Invalid file token");
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(403, "Invalid file token");
  const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as { userId?: string; materialId?: string; expires?: number };
  if (!value.userId || !value.materialId || !value.expires || value.expires < Date.now()) throw new HttpError(403, "File token expired");
  return { userId: value.userId, materialId: value.materialId };
}

export async function accessibleMaterial(userId: string, materialId: string) {
  const admin = getAdminClient();
  const [{ data: profile }, { data: material }] = await Promise.all([
    admin.from("profiles").select("role,status").eq("id", userId).maybeSingle(),
    admin.from("materials").select("id,owner_id,visibility,approval,file_path,file_kind").eq("id", materialId).maybeSingle(),
  ]);
  if (!profile || profile.status !== "active" || !material?.file_path) throw new HttpError(404, "Attachment unavailable");
  const { data: grant } = await admin.from("share_grants").select("id").eq("target_type", "material").eq("target_id", materialId).eq("recipient_id", userId).is("revoked_at", null).limit(1).maybeSingle();
  const allowed = material.owner_id === userId || (material.visibility === "shared" && material.approval === "approved") || (profile.role === "admin" && material.visibility === "shared") || !!grant;
  if (!allowed) throw new HttpError(403, "Attachment access denied");
  return { admin, material };
}
