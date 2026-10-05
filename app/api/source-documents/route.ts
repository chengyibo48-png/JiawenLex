import { AbortMultipartUploadCommand, CreateMultipartUploadCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { SOURCE_MAX_FILE_BYTES, SOURCE_PART_BYTES, sourceStorage, usedSourceBytes } from "@/lib/source-storage";

export const maxDuration = 60;

const UploadInput = z.object({
  title: z.string().trim().min(1).max(500),
  originalName: z.string().trim().min(1).max(500).regex(/\.pdf$/i),
  byteSize: z.number().int().positive().max(SOURCE_MAX_FILE_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  pageCount: z.number().int().positive().max(100000).optional(),
  sourceTitle: z.string().max(500).default(""),
  author: z.string().max(300).default(""),
  sourceYear: z.number().int().min(1900).max(2200).nullable().default(null),
  skill: z.enum(["reading", "listening", "writing", "speaking"]).nullable().default(null),
  skillTags: z.array(z.enum(["reading", "listening", "writing", "speaking"])).max(4).optional(),
  contentKind: z.enum(["reference", "questions", "vocabulary", "plan", "mixed", "unknown"]).default("unknown"),
  sourceUrl: z.string().max(2000).default(""),
  licenseName: z.string().max(500).default(""),
});

function safeFileName(value: string) {
  const stem = value.slice(0, -4).normalize("NFKC").replace(/[^\p{L}\p{N}_.-]+/gu, "_").replace(/^\.+/, "").slice(0, 160) || "document";
  return `${stem}.pdf`;
}

async function createUpload(userId: string, admin: import("@supabase/supabase-js").SupabaseClient, storage: ReturnType<typeof sourceStorage>, input: z.infer<typeof UploadInput>) {
  const { data: existing, error: existingError } = await admin.from("source_documents").select("id,status").eq("owner_id", userId).eq("sha256", input.sha256).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.status === "ready") throw new HttpError(409, "This exact PDF is already in your archive");
  if (existing) {
    const { data: session, error } = await admin.from("source_upload_sessions").select("id,object_key,upload_id,status,expires_at").eq("document_id", existing.id).eq("owner_id", userId).eq("status", "uploading").maybeSingle();
    if (error) throw error;
    if (session && Date.parse(session.expires_at) > Date.now()) return { documentId: existing.id, uploadId: session.id, partSize: SOURCE_PART_BYTES, existing: true };
    if (session) {
      await storage.client.send(new AbortMultipartUploadCommand({ Bucket: storage.bucket, Key: session.object_key, UploadId: session.upload_id })).catch(() => undefined);
      const { error: sessionDeleteError } = await admin.from("source_upload_sessions").delete().eq("id", session.id).eq("owner_id", userId);
      if (sessionDeleteError) throw sessionDeleteError;
    }
    const { error: documentDeleteError } = await admin.from("source_documents").delete().eq("id", existing.id).eq("owner_id", userId);
    if (documentDeleteError) throw documentDeleteError;
  }

  const usage = await usedSourceBytes(storage.client, storage.bucket);
  const { data: active, error: activeError } = await admin.from("source_upload_sessions").select("expected_size").eq("status", "uploading").gt("expires_at", new Date().toISOString());
  if (activeError) throw activeError;
  const reserved = (active ?? []).reduce((sum, row) => sum + Number(row.expected_size), 0);
  if (!Number.isSafeInteger(reserved) || usage + reserved + input.byteSize > storage.maxBytes)
    throw new HttpError(413, `Archive capacity reached (${usage + reserved} of ${storage.maxBytes} bytes used or reserved)`);

  const id = crypto.randomUUID();
  const objectKey = `originals/${userId}/${id}/${safeFileName(input.originalName)}`;
  const { data: document, error: insertError } = await admin.from("source_documents").insert({
    id, owner_id: userId, title: input.title, original_name: input.originalName, object_key: objectKey,
    byte_size: input.byteSize, sha256: input.sha256, page_count: input.pageCount ?? null,
    source_title: input.sourceTitle, author: input.author, source_year: input.sourceYear,
    skill: input.skill, skill_tags: input.skillTags?.length ? [...new Set(input.skillTags)] : input.skill ? [input.skill] : [],
    content_kind: input.contentKind, source_url: input.sourceUrl, license_name: input.licenseName,
  }).select("id").single();
  if (insertError) throw insertError;
  let uploadId: string | undefined;
  try {
    const upload = await storage.client.send(new CreateMultipartUploadCommand({
      Bucket: storage.bucket, Key: objectKey, ContentType: "application/pdf",
      Metadata: { "document-id": id, "owner-id": userId, sha256: input.sha256 },
    }));
    uploadId = upload.UploadId;
    if (!uploadId) throw new Error("Document storage did not return an upload session");
    const { data: session, error: sessionError } = await admin.from("source_upload_sessions").insert({
      owner_id: userId, document_id: id, object_key: objectKey, upload_id: uploadId,
      expected_size: input.byteSize, sha256: input.sha256, part_size: SOURCE_PART_BYTES,
    }).select("id").single();
    if (sessionError) throw sessionError;
    return { documentId: document.id, uploadId: session.id, partSize: SOURCE_PART_BYTES, existing: false };
  } catch (error) {
    if (uploadId) await storage.client.send(new AbortMultipartUploadCommand({ Bucket: storage.bucket, Key: objectKey, UploadId: uploadId })).catch(() => undefined);
    await admin.from("source_documents").delete().eq("id", id).eq("owner_id", userId);
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const { userId, admin, profile } = await requireUser(request);
    let query = admin.from("source_documents").select("id,owner_id,title,original_name,byte_size,sha256,page_count,source_title,author,source_year,skill,skill_tags,content_kind,source_url,license_name,rights_attestation,rights_attested_at,rights_review_status,rights_reviewed_at,rights_reviewed_by,rights_review_note,parse_status,parsed_pages,status,created_at,members_visible");
    if (profile.role !== "admin") query = query.or(`owner_id.eq.${userId},members_visible.eq.true`);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    let capacity = null;
    if (new URL(request.url).searchParams.get("includeCapacity") !== "false") {
      const storage = sourceStorage();
      const usedBytes = await usedSourceBytes(storage.client, storage.bucket);
      capacity = { usedBytes, maxBytes: storage.maxBytes, maxFileBytes: SOURCE_MAX_FILE_BYTES };
    }
    return NextResponse.json({ documents: (data ?? []).map(({ owner_id, rights_reviewed_by, rights_review_note, rights_reviewed_at, ...document }) => ({ ...document,
      ...(profile.role === "admin" || owner_id === userId ? { rights_reviewed_by, rights_review_note, rights_reviewed_at } : {}),
      ...(profile.role === "admin" ? { ownerId: owner_id } : {}), canManageSharing: owner_id === userId })), capacity }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const input = UploadInput.parse(await request.json());
    const storage = sourceStorage();
    const result = await createUpload(userId, admin, storage, input);
    return NextResponse.json(result, { status: result.existing ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
