import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

type Context = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { userId, admin } = await requireUser(request);
    const { documentId } = await params;
    const { data: document, error } = await admin.from("source_documents").select("id,status").eq("id", documentId).eq("owner_id", userId).maybeSingle();
    if (error) throw error;
    if (!document || document.status !== "ready") throw new HttpError(404, "Archived PDF unavailable");
    const now = new Date().toISOString();
    const { error: revokeError } = await admin.from("source_import_tokens").update({ revoked_at: now }).eq("owner_id", userId).eq("document_id", documentId).is("revoked_at", null);
    if (revokeError) throw revokeError;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { error: insertError } = await admin.from("source_import_tokens").insert({ owner_id: userId, document_id: documentId, token_hash: createHash("sha256").update(token).digest("hex"), expires_at: expiresAt });
    if (insertError) throw insertError;
    return NextResponse.json({ token, expiresAt, documentId });
  } catch (error) { return apiError(error); }
}
