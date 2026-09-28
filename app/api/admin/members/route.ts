import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { recordTombstone } from "@/lib/backup-ledger";

export async function POST(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    if (profile.role !== "admin") throw new HttpError(403, "Admin access required");
    const { memberId } = z.object({ memberId: z.string().uuid(), action: z.literal("remove") }).parse(await request.json());
    if (memberId === userId) throw new HttpError(400, "Cannot remove yourself");
    const { data: current, error: currentError } = await admin.from("profiles").select("id").eq("id", memberId).eq("role", "member").eq("status", "active").maybeSingle();
    if (currentError) throw currentError;
    if (!current) throw new HttpError(404, "Active member unavailable");
    await recordTombstone({ entity: "member_removed", entityId: memberId, ownerId: memberId, at: new Date().toISOString() });
    const { data, error } = await admin.from("profiles").update({ status: "removed" }).eq("id", memberId).eq("role", "member").eq("status", "active").select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Active member unavailable");
    const { error: banError } = await admin.auth.admin.updateUserById(memberId, { ban_duration: "876000h" });
    if (banError) throw banError;
    return NextResponse.json({ removed: true });
  } catch (error) { return apiError(error); }
}
