import { NextResponse } from "next/server";
import { z } from "zod";
import { recordTombstone } from "@/lib/backup-ledger";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

export async function POST(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(await request.json());
    const { data: share, error } = await admin.from("share_grants").select("id,owner_id,revoked_at").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!share || share.owner_id !== userId) throw new HttpError(404, "Share unavailable");
    if (!share.revoked_at) {
      await recordTombstone({ entity: "share_grants", entityId: id, ownerId: userId, at: new Date().toISOString() });
      const { error: updateError } = await admin.from("share_grants").update({ revoked_at: new Date().toISOString() }).eq("id", id);
      if (updateError) throw updateError;
    }
    return NextResponse.json({ revoked: true });
  } catch (error) { return apiError(error); }
}
