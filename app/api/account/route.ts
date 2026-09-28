import { NextResponse } from "next/server";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { recordTombstone } from "@/lib/backup-ledger";

async function listPaths(admin: ReturnType<typeof import("@/lib/supabase").getAdminClient>, bucket: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw error;
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) paths.push(path);
      else paths.push(...await listPaths(admin, bucket, path));
    }
    if (!data || data.length < 100) break;
  }
  return paths;
}

export async function DELETE(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    const { data: active, error: activeError } = await admin.from("profiles").select("id").eq("status", "active");
    if (activeError) throw activeError;
    if (profile.role === "admin" && (active?.length ?? 0) > 1) throw new HttpError(409, "Assign another admin before deleting this account");
    const { data: approved, error: materialError } = await admin.from("materials").select("*").eq("owner_id", userId).eq("visibility", "shared").eq("approval", "approved").neq("license_name", "");
    if (materialError) throw materialError;
    const { data: nextAdmin, error: adminLookupError } = profile.role === "admin"
      ? { data: null, error: null }
      : await admin.from("profiles").select("id").eq("role", "admin").eq("status", "active").limit(1).maybeSingle();
    if (adminLookupError) throw adminLookupError;
    const nextOwner = nextAdmin?.id;
    if (approved?.length && !nextOwner && profile.role !== "admin") throw new HttpError(409, "No active admin can retain approved group material");
    await recordTombstone({ entity: "account", entityId: userId, ownerId: userId, at: new Date().toISOString() });
    const retained = new Set<string>();
    for (const material of approved ?? []) {
      let newPath = material.file_path as string | null;
      if (newPath && nextOwner) {
        const copied = `${nextOwner}/retained-${material.id}/${material.file_name ?? "attachment"}`;
        const { error: copyError } = await admin.storage.from("study-files").copy(newPath, copied);
        if (copyError) throw copyError;
        newPath = copied;
      }
      if (nextOwner) {
        const { error } = await admin.from("materials").update({ owner_id: nextOwner, file_path: newPath }).eq("id", material.id);
        if (error) throw error;
        await admin.from("deletion_events").insert({ owner_id: userId, entity: "transferred_material", entity_id: material.id });
        if (newPath) retained.add(newPath);
      }
    }
    const { error: ledgerError } = await admin.from("deletion_events").insert({ owner_id: userId, entity: "account", entity_id: userId });
    if (ledgerError) throw ledgerError;
    // Clear private objects before deleting auth user; a later retry remains safe.
    for (const bucket of ["study-files", "study-audio"]) {
      const paths = await listPaths(admin, bucket, userId);
      const removable = paths.filter((path) => !retained.has(path));
      for (let index = 0; index < removable.length; index += 100) {
        const { error } = await admin.storage.from(bucket).remove(removable.slice(index, index + 100));
        if (error) throw error;
      }
    }
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) { return apiError(error); }
}
