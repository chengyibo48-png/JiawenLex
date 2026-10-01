import { NextResponse } from "next/server";
import { apiError, authenticatedDb, HttpError, requireUser } from "@/lib/server-auth";
export const maxDuration = 60;
const collections = new Set(["reading","listening","writing","speaking","academic","general","favorites","all"]);
export async function GET(request: Request) {
  try {
    await requireUser(request);
    const db = authenticatedDb(request);
    const params = new URL(request.url).searchParams;
    const collection = params.get("collection");
    if (!collection) {
      const { data, error } = await db.rpc("word_collection_counts");
      if (error) throw error;
      return NextResponse.json({ collections: data }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const cursor = params.get("cursor");
    if (!collections.has(collection) || (cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor))) throw new HttpError(400,"无效的词卡分类或页码");
    const { data, error } = await db.rpc("word_collection_page", { p_collection: collection, p_cursor: cursor || null });
    if (error) throw error;
    const words = (data ?? []).slice(0,250);
    return NextResponse.json({ words, hasMore: (data ?? []).length>250, cursor: words.at(-1)?.id ?? null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
