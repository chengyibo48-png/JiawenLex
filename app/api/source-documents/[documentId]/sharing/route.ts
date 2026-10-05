import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

type Context = { params: Promise<{ documentId: string }> };
const SharingInput = z.object({ membersVisible: z.boolean() });

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { userId, admin } = await requireUser(request);
    const { documentId } = await params;
    const { membersVisible } = SharingInput.parse(await request.json());
    const current = await admin.from("source_documents").select("rights_attested_at,rights_review_status").eq("id", documentId).eq("owner_id", userId).eq("status", "ready").maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) throw new HttpError(404, "Document unavailable");
    if (membersVisible && (!current.data.rights_attested_at || current.data.rights_review_status !== "approved"))
      throw new HttpError(409, "请先提交分享授权声明并等待管理员批准");
    let update = admin.from("source_documents")
      .update({ members_visible: membersVisible })
      .eq("id", documentId).eq("owner_id", userId).eq("status", "ready");
    if (membersVisible) update = update.eq("rights_review_status", "approved").not("rights_attested_at", "is", null);
    const { data, error } = await update.select("id,members_visible").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(409, "资料状态或授权已变化，请刷新后重试");
    return NextResponse.json({ membersVisible: data.members_visible });
  } catch (error) { return apiError(error); }
}
