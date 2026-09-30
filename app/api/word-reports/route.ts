import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { sameWordReport } from "@/lib/word-report";
const Content = z.object({ term: z.string().trim().min(1).max(160), definition: z.string().trim().min(1).max(4000), example: z.string().max(4000), pronunciation:z.string().max(300).optional(), pronunciation_uk:z.string().max(300).optional(), pronunciation_us:z.string().max(300).optional() });
export async function POST(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const x = z.object({ id: z.string().uuid(), wordId: z.string().uuid(), revision: z.number().int().positive(), kind: z.enum(["spelling","meaning","pronunciation","example","other"]), note: z.string().max(2000), suggestion: Content }).parse(await request.json());
    const previous = await admin.from("word_error_reports").select("owner_id,word_id,content_revision,kind,note,suggestion").eq("id",x.id).maybeSingle();
    if (previous.error) throw previous.error;
    if (previous.data) {
      if (previous.data.owner_id !== userId || !sameWordReport(previous.data,x)) throw new HttpError(409,"反馈编号已被使用，请保留修改并重新打开报错窗口");
      return NextResponse.json({saved:true});
    }
    const word = await admin.from("vocabulary").select("*").eq("owner_id", userId).eq("id", x.wordId).maybeSingle();
    if (word.error) throw word.error;
    if (!word.data) throw new HttpError(404, "词卡不可访问");
    if (word.data.content_revision !== x.revision) throw new HttpError(409, "词卡已更新，请保留建议并刷新");
    const saved = await admin.from("word_error_reports").upsert({ id: x.id, owner_id: userId, word_id: x.wordId, content_revision: x.revision, kind: x.kind, note: x.note, suggestion: x.suggestion, snapshot: word.data }, { onConflict: "id", ignoreDuplicates: true });
    if (saved.error) throw saved.error;
    const confirmed = await admin.from("word_error_reports").select("owner_id,word_id,content_revision,kind,note,suggestion").eq("id",x.id).single();
    if (confirmed.error) throw confirmed.error;
    if (confirmed.data.owner_id !== userId || !sameWordReport(confirmed.data,x)) throw new HttpError(409,"反馈内容与已有记录不一致，请重新核对");
    return NextResponse.json({ saved: true });
  } catch (error) { return apiError(error); }
}
export async function GET(request: Request) {
  try { const { userId, admin } = await requireUser(request); const result = await admin.from("word_error_reports").select("id,word_id,kind,note,status,created_at,suggestion").eq("owner_id", userId).order("created_at", { ascending: false }).limit(100); if (result.error) throw result.error; return NextResponse.json({ reports: result.data }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(await request.json());
    const changed = await admin.rpc("apply_word_report", { p_owner: userId, p_report: id });
    if (changed.error) {
      if (changed.error.message.includes("word_changed")) throw new HttpError(409, "词卡已被修改，请重新核对");
      if (changed.error.message.includes("report_unavailable")) throw new HttpError(404, "反馈不可访问");
      throw changed.error;
    }
    return NextResponse.json({ applied: true });
  } catch (error) { return apiError(error); }
}
