import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/server-auth";
import { deleteSourceDocument } from "@/lib/source-deletion";

type Context = { params: Promise<{ documentId: string }> };

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { userId, admin } = await requireUser(request);
    const { documentId } = await params;
    await deleteSourceDocument(admin, userId, documentId);
    return NextResponse.json({ deleted: true });
  } catch (error) { return apiError(error); }
}
