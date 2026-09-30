import { NextResponse } from "next/server";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

export async function GET(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const result = await admin.from("vocabulary_learned_words")
      .select("term_key", { count: "exact", head: true }).eq("owner_id", userId);
    if (result.error) {
      if (["42P01", "PGRST205"].includes(result.error.code))
        throw new HttpError(503, "成就统计尚未启用，请在下一次版本更新时应用成就迁移。");
      throw result.error;
    }
    const learned = result.count ?? 0;
    return NextResponse.json({ learned, unlocked: Math.floor(learned / 500), nextTarget: (Math.floor(learned / 500) + 1) * 500 },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
