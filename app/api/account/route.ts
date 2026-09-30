import { NextResponse } from "next/server";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { recordTombstone } from "@/lib/backup-ledger";
import { createHash } from "node:crypto";
import { AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { removeSourceOwnerVersions, sourceStorage } from "@/lib/source-storage";

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
    const [{ data: sourceDocs, error: sourceDocsError }, { data: sourceSessions, error: sourceSessionsError }] = await Promise.all([
      admin.from("source_documents").select("object_key").eq("owner_id", userId),
      admin.from("source_upload_sessions").select("object_key,upload_id").eq("owner_id", userId).eq("status", "uploading"),
    ]);
    if (sourceDocsError) throw sourceDocsError;
    if (sourceSessionsError) throw sourceSessionsError;
    const sourceStore = sourceDocs?.length || sourceSessions?.length ? sourceStorage() : null;
    await recordTombstone({ entity: "account", entityId: userId, ownerId: userId, at: new Date().toISOString() });
    const retained = new Set<string>();
    for (const material of approved ?? []) {
      let newPath = material.file_path as string | null;
      if (newPath && nextOwner) {
        const name = (material.file_name ?? "attachment").replace(/[\\/\x00-\x1f\x7f]/g, "-");
        const copied = `${nextOwner}/retained-${material.id}/${name}`;
        const { error: copyError } = await admin.storage.from("study-files").copy(newPath, copied);
        if (copyError) {
          // A previous attempt may have copied the object before its database update failed.
          const [source, destination] = await Promise.all([admin.storage.from("study-files").download(newPath), admin.storage.from("study-files").download(copied)]);
          if (source.error || destination.error || !source.data || !destination.data) throw copyError;
          const digest = async (blob: Blob) => createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex");
          if (await digest(source.data) !== await digest(destination.data)) throw copyError;
        }
        newPath = copied;
      }
      if (nextOwner) {
        const { error } = await admin.from("materials").update({ owner_id: nextOwner, file_path: newPath }).eq("id", material.id);
        if (error) throw error;
        const { error: transferError } = await admin.from("deletion_events").insert({ owner_id: userId, entity: "transferred_material", entity_id: material.id });
        if (transferError) throw transferError;
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
    for (const session of sourceSessions ?? []) {
      if (!sourceStore) throw new Error("Document storage configuration is missing");
      try {
        await sourceStore.client.send(new AbortMultipartUploadCommand({ Bucket: sourceStore.bucket, Key: session.object_key, UploadId: session.upload_id }));
      } catch (error) {
        if (error instanceof Error && error.name !== "NoSuchUpload" && (error as Error & { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
      }
    }
    if ((sourceDocs?.length || sourceSessions?.length) && sourceStore)
      await removeSourceOwnerVersions(sourceStore.client, sourceStore.bucket, userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) { return apiError(error); }
}
