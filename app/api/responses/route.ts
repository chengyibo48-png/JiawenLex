import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { availableMaterial } from "@/lib/micro-server";
const Feedback = z.object({
  summary: z.string().max(20000),
  strengths: z.array(z.string().max(4000)).max(30),
  priorities: z.array(z.string().max(4000)).max(30),
  annotations: z
    .array(
      z.object({
        quote: z.string().max(10000),
        comment: z.string().max(10000),
      }),
    )
    .max(200),
  tags: z.array(z.string().max(160)).max(30),
});
const Input = z.object({
  id: z.string().uuid(),
  material_id: z.string().uuid(),
  material_revision: z.number().int().positive(),
  skill: z.enum(["writing", "speaking"]),
  mode: z.enum(["practice", "timed"]),
  duration_seconds: z.number().int().min(0).max(31536000),
  answer_body: z.record(z.string().max(100), z.string().max(100000)).nullable(),
  feedback: Feedback.nullable(),
  transcript: z.string().max(100000).nullable(),
  recording_path: z.string().max(500).nullable(),
  saved_recording: z.boolean(),
});
export async function POST(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    if (profile.track !== "academic")
      throw new HttpError(403, "Academic training only");
    const input = Input.parse(await request.json());
    if (input.recording_path && !input.recording_path.startsWith(userId + "/"))
      throw new HttpError(403, "Recording unavailable");
    const existing = await admin
      .from("practice_attempts")
      .select("id,material_id,skill")
      .eq("id", input.id)
      .eq("owner_id", userId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      if (
        existing.data.material_id !== input.material_id ||
        existing.data.skill !== input.skill
      )
        throw new HttpError(409, "Attempt ID already used");
      return NextResponse.json({ id: existing.data.id });
    }
    const material = await availableMaterial(admin, userId, input.material_id);
    const history = await admin
      .from("material_versions")
      .select("snapshot")
      .eq("material_id", material.id)
      .eq("revision", input.material_revision)
      .maybeSingle();
    if (history.error) throw history.error;
    const snapshot = history.data?.snapshot;
    if (
      !snapshot ||
      snapshot.skill !== input.skill ||
      snapshot.track !== "academic"
    )
      throw new HttpError(
        409,
        "原题版本不可用，作答已保留 / Original prompt version unavailable; response retained",
      );
    const saved = await admin.rpc("submit_response_attempt", {
      payload: { ...input, owner_id: userId },
      expected_snapshot: snapshot,
    });
    if (saved.error) throw new HttpError(409, saved.error.message);
    return NextResponse.json({ id: saved.data });
  } catch (error) {
    return apiError(error);
  }
}
