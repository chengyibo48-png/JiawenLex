import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { resolveMicroUnit } from "@/lib/micro-server";
import { parseMicroState } from "@/lib/micro-training";
const Input = z.object({
  materialId: z
    .string()
    .max(160)
    .regex(/^micro:(builtin:[a-z\d-]+|material:[a-f\d-]{36})$/i),
  body: z.string().max(100000),
  version: z.number().int().min(0),
});
export async function PUT(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    if (profile.track !== "academic")
      throw new HttpError(403, "Academic training only");
    const { materialId, body, version } = Input.parse(await request.json());
    const unit = await resolveMicroUnit(admin, userId, materialId.slice(6));
    const read = await admin
      .from("micro_sessions")
      .select("*")
      .eq("owner_id", userId)
      .eq("material_id", materialId)
      .maybeSingle();
    if (read.error) throw read.error;
    const existing = read.data;
    if (body) {
      const state = parseMicroState(body, unit);
      if (!state) throw new HttpError(400, "Invalid training draft");
      if (state.stamp !== unit.stamp)
        return NextResponse.json(
          { error: "training_version_changed", serverDraft: existing },
          { status: 409 },
        );
    }
    if (existing?.body === body) return NextResponse.json({ draft: existing });
    if ((existing?.version ?? 0) !== version)
      return NextResponse.json(
        { error: "draft_conflict", serverDraft: existing },
        { status: 409 },
      );
    if (existing) {
      const saved = await admin
        .from("micro_sessions")
        .update({
          body,
          version: version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("owner_id", userId)
        .eq("version", version)
        .select("*")
        .maybeSingle();
      if (saved.error) throw saved.error;
      if (saved.data) return NextResponse.json({ draft: saved.data });
    } else {
      const saved = await admin
        .from("micro_sessions")
        .insert({
          owner_id: userId,
          material_id: materialId,
          source_material_id: unit.materialId,
          body,
          version: 1,
        })
        .select("*")
        .single();
      if (!saved.error) return NextResponse.json({ draft: saved.data });
      if (saved.error.code !== "23505") throw saved.error;
    }
    const current = await admin
      .from("micro_sessions")
      .select("*")
      .eq("owner_id", userId)
      .eq("material_id", materialId)
      .maybeSingle();
    if (current.error) throw current.error;
    return NextResponse.json(
      { error: "draft_conflict", serverDraft: current.data },
      { status: 409 },
    );
  } catch (error) {
    return apiError(error);
  }
}
