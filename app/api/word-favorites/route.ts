import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, authenticatedDb, HttpError, requireUser } from "@/lib/server-auth";

// Personal collection changes touch no learning or scheduling fields.
export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const input = z.object({ wordId: z.string().uuid(), favorite: z.boolean() }).parse(await request.json());
    const db = authenticatedDb(request);
    for (let retry = 0; retry < 3; retry++) {
      const found = await db.from("vocabulary").select("tags,content_revision").eq("id",input.wordId).eq("owner_id",userId).maybeSingle();
      if (found.error) throw found.error;
      if (!found.data) throw new HttpError(404,"词卡不可访问");
      const tags: string[] = found.data.tags;
      const next = input.favorite ? [...new Set([...tags,"收藏"])] : tags.filter(tag=>tag!=="收藏");
      // Compare all prior tags so concurrent edits on another device survive.
      const previous = `{${tags.map(tag=>'"'+tag.replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"').join(",")}}`;
      const updated = await db.from("vocabulary").update({tags:next}).eq("id",input.wordId).eq("owner_id",userId).eq("content_revision",found.data.content_revision).eq("tags",previous).select("*").maybeSingle();
      if (updated.error) throw updated.error;
      if (updated.data) return NextResponse.json({word:updated.data});
    }
    throw new HttpError(409,"词卡在其他设备发生变化，请重试");
  } catch(error) { return apiError(error); }
}
