import { AbortMultipartUploadCommand, DeleteObjectCommand, ListPartsCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { sourceStorage } from "@/lib/source-storage";

type Context = { params: Promise<{ uploadId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { userId, admin } = await requireUser(request);
    const { uploadId } = await params;
    const { data: session, error } = await admin.from("source_upload_sessions").select("id,document_id,object_key,upload_id,expected_size,part_size,status,expires_at").eq("id", uploadId).eq("owner_id", userId).maybeSingle();
    if (error) throw error;
    if (!session || session.status !== "uploading" || Date.parse(session.expires_at) < Date.now()) throw new HttpError(404, "Upload session is unavailable");
    const storage = sourceStorage();
    const result = await storage.client.send(new ListPartsCommand({ Bucket: storage.bucket, Key: session.object_key, UploadId: session.upload_id }));
    if (result.IsTruncated) throw new HttpError(503, "Upload session has too many parts");
    return NextResponse.json({
      documentId: session.document_id,
      byteSize: Number(session.expected_size),
      partSize: session.part_size,
      parts: (result.Parts ?? []).map((part) => ({ partNumber: part.PartNumber, etag: part.ETag, size: part.Size })),
    });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { userId, admin } = await requireUser(request);
    const { uploadId } = await params;
    const { data: session, error } = await admin.from("source_upload_sessions").select("id,document_id,object_key,upload_id,status").eq("id", uploadId).eq("owner_id", userId).maybeSingle();
    if (error) throw error;
    if (!session) throw new HttpError(404, "Upload session is unavailable");
    const storage = sourceStorage();
    if (session.status === "uploading") await storage.client.send(new AbortMultipartUploadCommand({ Bucket: storage.bucket, Key: session.object_key, UploadId: session.upload_id }));
    if (session.status === "complete") await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: session.object_key }));
    const { error: deleteError } = await admin.from("source_documents").delete().eq("id", session.document_id).eq("owner_id", userId);
    if (deleteError) throw deleteError;
    return NextResponse.json({ deleted: true });
  } catch (error) { return apiError(error); }
}
