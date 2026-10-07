import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { materialStamp } from "@/lib/practice-sessions";
import { snapshotMaterial } from "@/lib/review";
import { isCorrectAnswer, isGradableQuestion } from "@/lib/study";
import type { Material } from "@/lib/types";
const Input = z.object({
  id: z.string().uuid(),
  materialId: z.string().uuid(),
  materialStamp: z.string().max(80),
  mode: z.enum(["practice", "timed"]),
  durationSeconds: z.number().int().min(0).max(31536000),
  intensive: z.boolean().default(false),
  answers: z.record(z.string().max(100), z.string().max(2000)).default({}),
  flagged: z.array(z.string().max(100)).max(200).default([]),
  answerExposed: z.boolean().default(false),
});
async function attemptResponse(admin: Awaited<ReturnType<typeof requireUser>>["admin"], id: string, userId: string) {
  try {
    const attempt = await admin.from("practice_attempts").select("*").eq("id", id).eq("owner_id", userId).single();
    const review = await admin.from("attempt_reviews").select("*").eq("id", id).eq("owner_id", userId).maybeSingle();
    return NextResponse.json({ id, attempt: attempt.data, review: review.data, refreshRequired: !!(attempt.error || review.error) });
  } catch { return NextResponse.json({ id, attempt: null, review: null, refreshRequired: true }); }
}
export async function POST(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const input = Input.parse(await request.json());
    if (Object.keys(input.answers).length > 200)
      throw new HttpError(400, "Too many answers");
    // Retry an already committed ID without changing its answers or duplicating time.
    const prior = await admin
      .from("practice_attempts")
      .select("id,material_id")
      .eq("id", input.id)
      .eq("owner_id", userId)
      .maybeSingle();
    if (prior.error) throw prior.error;
    if (prior.data) {
      if (prior.data.material_id !== input.materialId)
        throw new HttpError(409, "Attempt ID already used");
      return attemptResponse(admin, prior.data.id, userId);
    }
    const { data, error } = await admin
      .from("materials")
      .select("*")
      .eq("id", input.materialId)
      .maybeSingle();
    if (error) throw error;
    const m = data as Material | null;
    if (
      !m ||
      m.track !== "academic" ||
      !["reading", "listening"].includes(m.skill) ||
      (input.intensive && m.skill !== "listening")
    )
      throw new HttpError(403, "Material unavailable");
    let allowed =
      m.owner_id === userId ||
      (m.visibility === "shared" && m.approval === "approved");
    if (!allowed) {
      const grant = await admin
        .from("share_grants")
        .select("id")
        .eq("target_type", "material")
        .eq("target_id", m.id)
        .eq("recipient_id", userId)
        .is("revoked_at", null)
        .limit(1)
        .maybeSingle();
      if (grant.error) throw grant.error;
      allowed = !!grant.data;
    }
    if (!allowed) throw new HttpError(403, "Material unavailable");
    if (m.tags.includes("listening-text") && input.mode === "timed") throw new HttpError(400, "Text-only listening vocabulary is practice mode only");
    if (input.materialStamp !== materialStamp(m))
      throw new HttpError(
        409,
        "资料已经更新，作答仍保留；请保留副本后重新开始。 / Material changed; keep a copy and restart.",
      );
    if (!input.intensive && !m.questions.length)
      throw new HttpError(
        400,
        "资料缺少题目，无法提交 / Material has no questions",
      );
    const gradable = m.questions.filter(isGradableQuestion);
    const questionType = (question: Material["questions"][number]) => m.tags.includes("listening-text") ? "listening_text" : question.type || m.question_type || "Other";
    const payload = {
      id: input.id,
      owner_id: userId,
      material_id: m.id,
      mode: input.mode,
      duration_seconds: input.durationSeconds,
      learning_kind: input.intensive ? "intensive" : "first",
      answer_exposed: input.answerExposed,
      answer_body: input.answers,
      flagged: input.flagged.filter((id) =>
        m.questions.some((q) => q.id === id),
      ),
      correct_count: gradable.length ? gradable.filter((q) =>
        isCorrectAnswer(q, input.answers[q.id] ?? ""),
      ).length : null,
      question_count: gradable.length ? gradable.length : null,
      question_stats: gradable.length ? [
        ...new Set(
          gradable.map(questionType),
        ),
      ].map((type) => {
        const questions = gradable.filter(
          (q) => questionType(q) === type,
        );
        return {
          type,
          count: questions.length,
          correct: questions.filter((q) =>
            isCorrectAnswer(q, input.answers[q.id] ?? ""),
          ).length,
        };
      }) : [],
    };
    const saved = await admin.rpc("submit_objective_attempt", {
      payload,
      expected_snapshot: snapshotMaterial(m),
    });
    if (saved.error) throw new HttpError(409, saved.error.message);
    return attemptResponse(admin, saved.data, userId);
  } catch (error) {
    return apiError(error);
  }
}
