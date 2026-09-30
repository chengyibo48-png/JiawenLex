import "server-only";
import { AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordTombstone } from "./backup-ledger";
import { HttpError } from "./server-auth";
import { removeSourceObjectVersions, sourceStorage } from "./source-storage";

export async function deleteSourceDocument(admin: SupabaseClient, ownerId: string, documentId: string): Promise<void> {
  const { data: document, error } = await admin.from("source_documents")
    .select("id,object_key").eq("id", documentId).eq("owner_id", ownerId).maybeSingle();
  if (error) throw error;
  if (!document) throw new HttpError(404, "Document unavailable");
  const { data: sessions, error: sessionsError } = await admin.from("source_upload_sessions")
    .select("object_key,upload_id,status").eq("document_id", documentId).eq("owner_id", ownerId);
  if (sessionsError) throw sessionsError;
  const storage = sourceStorage();
  const at = new Date().toISOString();
  // The independent ledger must be durable before an older snapshot can be restored.
  await recordTombstone({ entity: "source_documents", entityId: documentId, ownerId, at });
  const { error: ledgerError } = await admin.from("deletion_events")
    .insert({ owner_id: ownerId, entity: "source_documents", entity_id: documentId });
  if (ledgerError) throw ledgerError;
  for (const session of sessions ?? []) {
    if (session.status !== "uploading") continue;
    try {
      await storage.client.send(new AbortMultipartUploadCommand({
        Bucket: storage.bucket, Key: session.object_key, UploadId: session.upload_id,
      }));
    } catch (abortError) {
      const status = (abortError as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404 && !(abortError instanceof Error && abortError.name === "NoSuchUpload")) throw abortError;
    }
  }
  // A plain DeleteObject leaves old B2 versions accessible and still billable.
  await removeSourceObjectVersions(storage.client, storage.bucket, ownerId, documentId, document.object_key);
  const { error: deleteError } = await admin.from("source_documents")
    .delete().eq("id", documentId).eq("owner_id", ownerId);
  if (deleteError) throw deleteError;
}
