import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { sourceStorage } from "@/lib/source-storage";

type Context = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { userId, admin } = await requireUser(request);
    const { documentId } = await params;
    const { data: document, error } = await admin.from("source_documents").select("object_key,original_name,status,owner_id,members_visible").eq("id", documentId).maybeSingle();
    if (error) throw error;
    if (!document || document.status !== "ready" || (document.owner_id !== userId && !document.members_visible)) throw new HttpError(404, "Document unavailable");
    const storage = sourceStorage();
    const url = await getSignedUrl(storage.client, new GetObjectCommand({ Bucket: storage.bucket, Key: document.object_key, ResponseContentType: "application/pdf", ResponseContentDisposition: "inline" }), { expiresIn: 300 });
    return NextResponse.json({ url, fileName: document.original_name });
  } catch (error) { return apiError(error); }
}
