import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { deleteSourceDocument } from "@/lib/source-deletion";

type Context = { params: Promise<{ documentId: string }> };
const UpdateDocument = z.union([
  z.object({ licenseName: z.string().trim().max(500) }).strict(),
  z.object({ rightsAttestation: z.string().trim().min(20).max(2000) }).strict(),
  z.object({ rightsReview: z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(1000).default(""), expectedAttestedAt: z.string().datetime({ offset: true }), expectedAttestation: z.string().max(2000) }).strict() }).strict(),
]);

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    const { documentId } = await params;
    const input = UpdateDocument.parse(await request.json());
    if ("rightsReview" in input) {
      if (profile.role !== "admin") throw new HttpError(403, "Administrator access required");
      if (input.rightsReview.decision === "approved" && !input.rightsReview.expectedAttestation.trim()) throw new HttpError(409, "授权声明为空，请先请上传者补充声明");
      const { data, error } = await admin.from("source_documents").update({
        rights_review_status: input.rightsReview.decision,
        rights_reviewed_at: new Date().toISOString(),
        rights_reviewed_by: userId,
        rights_review_note: input.rightsReview.note,
        ...(input.rightsReview.decision === "rejected" ? { members_visible: false } : {}),
      }).eq("id", documentId).eq("status", "ready").eq("rights_attested_at", input.rightsReview.expectedAttestedAt).eq("rights_attestation", input.rightsReview.expectedAttestation).eq("rights_review_status", "pending")
        .select("id,rights_review_status,rights_reviewed_at,rights_reviewed_by,rights_review_note,members_visible").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(409, "授权声明已变化或已处理，请刷新后重新审核");
      return NextResponse.json(data);
    }
    const values = "rightsAttestation" in input
      ? { rights_attestation: input.rightsAttestation, rights_attested_at: new Date().toISOString(), rights_review_status: "pending", rights_reviewed_at: null, rights_reviewed_by: null, rights_review_note: "", members_visible: false }
      : { license_name: input.licenseName };
    let update = admin.from("source_documents").update(values).eq("id", documentId).eq("owner_id", userId);
    if ("rightsAttestation" in input) update = update.eq("status", "ready");
    const { data, error } = await update.select("id,license_name,rights_attestation,rights_attested_at,rights_review_status,members_visible").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Document unavailable");
    return NextResponse.json({ documentId: data.id, licenseName: data.license_name, rightsAttestation: data.rights_attestation, rightsAttestedAt: data.rights_attested_at, rightsReviewStatus: data.rights_review_status, membersVisible: data.members_visible });
  } catch (error) { return apiError(error); }
}

export async function GET(request: Request, { params }: Context) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    const { documentId } = await params;
    const document = await admin.from("source_documents").select("owner_id").eq("id", documentId).maybeSingle();
    if (document.error) throw document.error;
    if (!document.data || (profile.role !== "admin" && document.data.owner_id !== userId)) throw new HttpError(404, "Document unavailable");
    const { data, error } = await admin.from("source_rights_audit").select("id,actor_id,decision,attestation,attested_at,note,created_at")
      .eq("document_id", documentId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ history: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { userId, admin } = await requireUser(request);
    const { documentId } = await params;
    await deleteSourceDocument(admin, userId, documentId);
    return NextResponse.json({ deleted: true });
  } catch (error) { return apiError(error); }
}
