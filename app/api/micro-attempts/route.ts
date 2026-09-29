import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { resolveMicroUnit } from "@/lib/micro-server";
import { microComplete } from "@/lib/micro-training";
import { normalizeTerm } from "@/lib/review";
const State = z.object({
  stamp: z.string().max(100),
  runId: z.string().uuid(),
  answers: z.record(z.string().max(100), z.string().max(4000)),
  checks: z.record(
    z.string().max(100),
    z.record(z.string().max(10), z.boolean()),
  ),
  revealed: z.array(z.string().max(100)).max(200),
  index: z.number().int().min(0).max(199),
  elapsedSeconds: z.number().int().min(0).max(31536000),
  completed: z.boolean(),
});
const Input = z.object({ key: z.string().max(160), state: State });
export async function POST(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    if (profile.track !== "academic")
      throw new HttpError(403, "Academic training only");
    const { key, state } = Input.parse(await request.json());
    if (
      Object.keys(state.answers).length > 200 ||
      Object.keys(state.checks).length > 200
    )
      throw new HttpError(400, "Too many answers");
    const previous = await admin
      .from("micro_attempts")
      .select("id,unit_key")
      .eq("id", state.runId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (previous.error) throw previous.error;
    if (previous.data) {
      if (previous.data.unit_key !== key)
        throw new HttpError(409, "Attempt ID already used");
      return NextResponse.json({ id: previous.data.id });
    }
    const unit = await resolveMicroUnit(admin, userId, key);
    if (state.stamp !== unit.stamp)
      throw new HttpError(
        409,
        "资料已更新，请保留副本后开始新版本 / Training version changed; retain a copy before restarting",
      );
    if (!microComplete(unit, state))
      throw new HttpError(
        400,
        "请完成作答、查看参考，并逐项自评 / Complete answers, references and self-review",
      );
    const answers = Object.fromEntries(
      unit.items.map((item) => [item.id, state.answers[item.id]]),
    );
    const checks = Object.fromEntries(
      unit.items.map((item) => [
        item.id,
        Object.fromEntries(
          item.checklist.map((_, n) => [
            String(n),
            state.checks[item.id]?.[String(n)],
          ]),
        ),
      ]),
    );
    const row = {
      id: state.runId,
      owner_id: userId,
      unit_key: key,
      unit_title: unit.title,
      unit_stamp: unit.stamp,
      criteria_total: unit.items.reduce((n, i) => n + i.checklist.length, 0),
      criteria_passed: unit.items.reduce(
        (n, i) =>
          n +
          i.checklist.filter((_, c) => checks[i.id]?.[String(c)] === true)
            .length,
        0,
      ),
      kind: unit.kind,
      skill: unit.skill,
      duration_seconds: state.elapsedSeconds,
      item_count: unit.items.length,
      correct_count:
        unit.kind === "paraphrase"
          ? unit.items.filter((item) =>
              item.answers.some(
                (a) => normalizeTerm(a) === normalizeTerm(answers[item.id]),
              ),
            ).length
          : null,
      answer_body: answers,
      self_review: checks,
      unit_snapshot: unit,
    };
    const saved = await admin.rpc("submit_micro_attempt", {
      payload: row,
      source_material: unit.materialId,
    });
    if (saved.error) throw new HttpError(409, saved.error.message);
    return NextResponse.json({ id: saved.data });
  } catch (error) {
    return apiError(error);
  }
}
