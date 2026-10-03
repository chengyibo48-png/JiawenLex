import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const { admin } = await requireUser(request);
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(params.get("page")) || 1)));
    const search = (params.get("search") ?? "").replace(/[%,()]/g, "").slice(0, 100);
    const tag = (params.get("tag") ?? "").slice(0,80);
    let q = admin.from("vocabulary_templates").select("id,term,definition,example,tags,part_of_speech,pronunciation,pronunciation_uk,pronunciation_us", { count: "exact" }).eq("approved", true).order("term").order("id").range((page - 1) * 50, page * 50 - 1);
    if (search) q = q.ilike("term", `%${search}%`);
    if (tag) q = q.contains("tags",[tag]);
    const result = await q;
    if (result.error) throw result.error;
    return NextResponse.json({ words: result.data, count: result.count, page });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).parse(await request.json());
    const result = await admin.from("vocabulary_templates").select("*").in("id", ids).eq("approved", true);
    if (result.error) throw result.error;
    if (result.data.length !== new Set(ids).size) throw new HttpError(404, "词库条目不可访问");
    for (const word of result.data) {
      const key = createHash("sha256").update(JSON.stringify([word.term.normalize("NFKC").toLowerCase(), word.part_of_speech, word.definition])).digest("hex");
      const inserted = await admin.rpc("import_word_card", { p_owner: userId, p_id: crypto.randomUUID(), p_key: key, p_data: { ...word, source_verified: !word.tags?.includes("administrator-approved-unverified") } });
      if (inserted.error) throw inserted.error;
    }
    return NextResponse.json({ added: result.data.length });
  } catch (error) { return apiError(error); }
}
