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
    const search=(params.get("search")??"").normalize("NFKC").trim();
    if(search.length>100)throw new HttpError(400,"搜索内容请勿超过 100 字符");
    if (!collections.has(collection) || (cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor))) throw new HttpError(400,"无效的词卡分类或页码");
    const [pageResult,reviewResult]=await Promise.all([
      db.rpc("word_collection_search",{p_collection:collection,p_search:search,p_cursor:cursor||null}),
      !cursor&&!search?db.rpc("word_collection_reviews",{p_collection:collection}):Promise.resolve({data:[],error:null})
    ]);
    if(pageResult.error)throw pageResult.error;if(reviewResult.error)throw reviewResult.error;
    const reviews=reviewResult.data??[];
    const page=(pageResult.data??[]).slice(0,250-reviews.length);
    const words=[...new Map([...page,...reviews].map(word=>[word.id,word])).values()];
    return NextResponse.json({words,hasMore:(pageResult.data??[]).length>page.length,cursor:page.at(-1)?.id??null},{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) { return apiError(error); }
}
