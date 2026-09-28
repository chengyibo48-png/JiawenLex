import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

const Input = z.object({ materialId: z.string().uuid(), body: z.string().max(100000), version: z.number().int().min(0) });

export async function PUT(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const { materialId, body, version } = Input.parse(await request.json());
    const { data: material } = await admin.from("materials").select("id, owner_id, skill").eq("id", materialId).single();
    if (!material || material.owner_id !== userId || material.skill !== "writing") throw new HttpError(403, "Writing material unavailable");
    const { data: existing, error: readError } = await admin.from("writing_drafts").select("*").eq("owner_id", userId).eq("material_id", materialId).maybeSingle();
    if (readError) throw readError;
    if (existing && existing.version !== version) return NextResponse.json({ error: "draft_conflict", serverDraft: existing }, { status: 409 });
    if (!existing && version !== 0) return NextResponse.json({ error: "draft_conflict", serverDraft: null }, { status: 409 });
    if (existing) {
      const { data, error } = await admin.from("writing_drafts").update({ body, version: version + 1, updated_at: new Date().toISOString() }).eq("id", existing.id).eq("version", version).select("*").maybeSingle();
      if (error) throw error;
      if (data) return NextResponse.json({ draft: data });
    } else {
      const { data, error } = await admin.from("writing_drafts").insert({ owner_id: userId, material_id: materialId, body, version: 1 }).select("*").single();
      if (!error) return NextResponse.json({ draft: data });
      if (error.code !== "23505") throw error;
    }
    const { data: current } = await admin.from("writing_drafts").select("*").eq("owner_id", userId).eq("material_id", materialId).single();
    return NextResponse.json({ error: "draft_conflict", serverDraft: current }, { status: 409 });
  } catch (error) { return apiError(error); }
}
