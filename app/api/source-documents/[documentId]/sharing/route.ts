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
    const { data, error } = await admin.from("source_documents")
      .update({ members_visible: membersVisible })
      .eq("id", documentId).eq("owner_id", userId).eq("status", "ready")
      .select("id,members_visible").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Document unavailable");
    return NextResponse.json({ membersVisible: data.members_visible });
  } catch (error) { return apiError(error); }
}
