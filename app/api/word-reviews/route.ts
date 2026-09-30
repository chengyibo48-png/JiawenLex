import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
const Input = z.object({ wordId: z.string().uuid(), eventId: z.string().uuid(), known: z.boolean(), revision: z.number().int().positive() });
export async function POST(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const x = Input.parse(await request.json());
    const result = await admin.rpc("record_word_review", { p_owner: userId, p_word: x.wordId, p_event: x.eventId, p_known: x.known, p_revision: x.revision });
    if (result.error) {
      if (/word_changed|review_event_mismatch/.test(result.error.message)) throw new HttpError(409, "词卡已更新或反馈冲突，请保留当前操作并刷新");
      if (/word_unavailable/.test(result.error.message)) throw new HttpError(404, "词卡不可访问");
      throw result.error;
    }
    return NextResponse.json({ word: result.data });
  } catch (error) { return apiError(error); }
}
