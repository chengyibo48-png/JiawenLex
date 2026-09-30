import { UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { sourceStorage } from "@/lib/source-storage";

type Context = { params: Promise<{ uploadId: string; partNumber: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { userId, admin } = await requireUser(request);
    const { uploadId, partNumber: rawPartNumber } = await params;
    const partNumber = Number(rawPartNumber);
    const { data: session, error } = await admin.from("source_upload_sessions").select("object_key,upload_id,expected_size,part_size,status,expires_at").eq("id", uploadId).eq("owner_id", userId).maybeSingle();
    if (error) throw error;
    if (!session || session.status !== "uploading" || Date.parse(session.expires_at) < Date.now()) throw new HttpError(404, "Upload session is unavailable");
    const count = Math.ceil(Number(session.expected_size) / Number(session.part_size));
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) throw new HttpError(400, "Invalid part number");
    const storage = sourceStorage();
    const command = new UploadPartCommand({ Bucket: storage.bucket, Key: session.object_key, UploadId: session.upload_id, PartNumber: partNumber });
    const url = await getSignedUrl(storage.client, command, { expiresIn: 3600 });
    return NextResponse.json({ url, expiresIn: 3600 });
  } catch (error) { return apiError(error); }
}
