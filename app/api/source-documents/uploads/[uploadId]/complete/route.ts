import { CompleteMultipartUploadCommand, HeadObjectCommand, ListPartsCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { sourceStorage } from "@/lib/source-storage";

const Input = z.object({ parts: z.array(z.object({ partNumber: z.number().int().min(1).max(100), etag: z.string().min(2).max(200) })).min(1).max(100) });
type Context = { params: Promise<{ uploadId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { userId, admin } = await requireUser(request);
    const { uploadId } = await params;
    const input = Input.parse(await request.json());
    const { data: session, error } = await admin.from("source_upload_sessions").select("id,document_id,object_key,upload_id,expected_size,sha256,part_size,status,expires_at").eq("id", uploadId).eq("owner_id", userId).maybeSingle();
    if (error) throw error;
    if (!session || Date.parse(session.expires_at) < Date.now()) throw new HttpError(404, "Upload session is unavailable");
    const storage = sourceStorage();
    let head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: session.object_key })).catch(() => null);
    if (!head) {
      if (session.status !== "uploading") throw new HttpError(409, "Upload session is no longer active");
      const expectedPartCount = Math.ceil(Number(session.expected_size) / Number(session.part_size));
      if (input.parts.length !== expectedPartCount) throw new HttpError(400, "Upload is missing one or more parts");
      const received = await storage.client.send(new ListPartsCommand({ Bucket: storage.bucket, Key: session.object_key, UploadId: session.upload_id }));
      if (received.IsTruncated || received.Parts?.length !== expectedPartCount) throw new HttpError(409, "Storage has not received every part");
      const supplied = new Map(input.parts.map((part) => [part.partNumber, part.etag]));
      if (supplied.size !== input.parts.length || received.Parts.some((part) => !part.PartNumber || !part.ETag || supplied.get(part.PartNumber) !== part.ETag))
        throw new HttpError(409, "The upload part list does not match storage");
      await storage.client.send(new CompleteMultipartUploadCommand({
        Bucket: storage.bucket,
        Key: session.object_key,
        UploadId: session.upload_id,
        MultipartUpload: { Parts: received.Parts.map((part) => ({ PartNumber: part.PartNumber, ETag: part.ETag })).sort((a, b) => Number(a.PartNumber) - Number(b.PartNumber)) },
      }));
      head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: session.object_key }));
    }
    if (Number(head.ContentLength) !== Number(session.expected_size) || head.Metadata?.["document-id"] !== session.document_id || head.Metadata?.["owner-id"] !== userId || head.Metadata?.sha256 !== session.sha256)
      throw new HttpError(409, "The uploaded PDF failed its size and identity checks");
    const { error: documentError } = await admin.from("source_documents").update({ status: "ready" }).eq("id", session.document_id).eq("owner_id", userId);
    if (documentError) throw documentError;
    const { error: sessionError } = await admin.from("source_upload_sessions").update({ status: "complete" }).eq("id", session.id).eq("owner_id", userId);
    if (sessionError) throw sessionError;
    return NextResponse.json({ documentId: session.document_id, verifiedBytes: Number(head.ContentLength) });
  } catch (error) { return apiError(error); }
}
