import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/server-auth";
const payload = z.object({ instanceId: z.string().uuid(), module: z.enum(["today", "practice", "reading", "listening", "writing", "speaking", "vocabulary", "plan", "library", "methods", "progress", "settings", "admin"]), visible: z.boolean() }).strict();
export async function POST(request: Request) {
  try {
    const { userId, sessionId, admin } = await requireUser(request);
    const body = payload.parse(await request.json());
    const { error } = await admin.from("member_presence").upsert({ owner_id: userId, session_id: sessionId, instance_id: body.instanceId, module: body.module, visible: body.visible, last_seen: new Date().toISOString() }, { onConflict: "owner_id,session_id,instance_id" });
    if (error) throw error;
    // This ephemeral table is bounded per member; it contains no answer content.
    const { error: cleanupError } = await admin.from("member_presence").delete().eq("owner_id", userId).lt("last_seen", new Date(Date.now() - 30 * 86400000).toISOString());
    if (cleanupError) throw cleanupError;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
