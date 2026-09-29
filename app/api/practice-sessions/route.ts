import { NextResponse } from "next/server";
import { sameSessionState } from "@/lib/practice-sessions";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

const State = z.object({
  answerExposed: z.boolean().optional(),
  runId: z.string().uuid(), phase: z.enum(["active", "completed"]), materialStamp: z.string().max(80),
  questionIds: z.array(z.string().max(100)).max(200),
  answers: z.record(z.string().max(100), z.string().max(2000)),
  flagged: z.array(z.string().max(100)).max(200), revealed: z.array(z.string().max(100)).max(200),
  currentQuestionId: z.string().max(100).nullable(), mobilePane: z.enum(["passage", "questions"]),
  mode: z.enum(["practice", "timed"]), durationMinutes: z.union([z.literal(20), z.literal(40), z.literal(60)]),
  startedAt: z.number().int().nonnegative().nullable(), deadline: z.number().int().nonnegative().nullable(),
  elapsedSeconds: z.number().int().nonnegative().max(31536000),
}).superRefine((value, ctx) => {
  if (Object.keys(value.answers).length > 200) ctx.addIssue({ code: "custom", message: "Too many answers" });
  if (value.mode === "timed" && value.startedAt !== null && value.deadline !== value.startedAt + value.durationMinutes * 60000)
    ctx.addIssue({ code: "custom", message: "Invalid deadline" });
});
const Input = z.object({ materialId: z.string().uuid(), version: z.number().int().min(0), state: State });

export async function PUT(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const { materialId, version, state } = Input.parse(await request.json());
    const { data: material, error: materialError } = await admin.from("materials").select("id,owner_id,skill,track,visibility,approval").eq("id", materialId).maybeSingle();
    if (materialError) throw materialError;
    if (!material || !["reading", "listening"].includes(material.skill) || material.track !== "academic") throw new HttpError(403, "Practice material unavailable");
    let allowed = material.owner_id === userId || (material.visibility === "shared" && material.approval === "approved");
    if (!allowed) {
      const { data: grant, error } = await admin.from("share_grants").select("id").eq("target_type", "material").eq("target_id", materialId).eq("recipient_id", userId).is("revoked_at", null).limit(1).maybeSingle();
      if (error) throw error;
      allowed = !!grant;
    }
    if (!allowed) throw new HttpError(403, "Practice material unavailable");
    const { data: existing, error: readError } = await admin.from("practice_sessions").select("*").eq("owner_id", userId).eq("material_id", materialId).maybeSingle();
    if (readError) throw readError;
    if (existing && sameSessionState(existing.state, state)) return NextResponse.json({ session: existing });
    if ((existing?.version ?? 0) !== version) return NextResponse.json({ error: "session_conflict", session: existing }, { status: 409 });
    // Retries are idempotent, including a save whose response was lost.
    if (existing?.state.phase === "active" && existing.state.runId === state.runId && existing.state.mode === "timed" && existing.state.startedAt !== null &&
      (state.mode !== "timed" || state.startedAt !== existing.state.startedAt || state.deadline !== existing.state.deadline || state.durationMinutes !== existing.state.durationMinutes))
      return NextResponse.json({ error: "timed_session_locked", session: existing }, { status: 409 });
    const answerSeen = !!existing?.answer_seen || state.revealed.length > 0 || !!state.answerExposed;
    if (existing) {
      const { data, error } = await admin.from("practice_sessions").update({ state, answer_seen: answerSeen, version: version + 1, updated_at: new Date().toISOString() }).eq("id", existing.id).eq("owner_id", userId).eq("version", version).select("*").maybeSingle();
      if (error) throw error;
      if (data) return NextResponse.json({ session: data });
    } else {
      const { data, error } = await admin.from("practice_sessions").insert({ owner_id: userId, material_id: materialId, skill: material.skill, state, answer_seen: answerSeen, version: 1 }).select("*").single();
      if (!error) return NextResponse.json({ session: data });
      if (error.code !== "23505") throw error;
    }
    const { data: current, error } = await admin.from("practice_sessions").select("*").eq("owner_id", userId).eq("material_id", materialId).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ error: "session_conflict", session: current }, { status: 409 });
  } catch (error) { return apiError(error); }
}
