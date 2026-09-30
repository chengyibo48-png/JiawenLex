import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { deleteSourceDocument } from "@/lib/source-deletion";

type Context = { params: Promise<{ documentId: string }> };
const UpdateLicense = z.object({ licenseName: z.string().trim().max(500) });

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { userId, admin } = await requireUser(request);
    const { documentId } = await params;
    const { licenseName } = UpdateLicense.parse(await request.json());
    const { data, error } = await admin.from("source_documents")
      .update({ license_name: licenseName }).eq("id", documentId).eq("owner_id", userId)
      .select("id,license_name").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Document unavailable");
    return NextResponse.json({ documentId: data.id, licenseName: data.license_name });
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
