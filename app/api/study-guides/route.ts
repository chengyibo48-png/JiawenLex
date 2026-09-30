import { NextResponse } from "next/server";
import { apiError, authenticatedDb, HttpError, requireUser } from "@/lib/server-auth";
export async function GET(request: Request) {
  try {
    await requireUser(request);
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
    let query = authenticatedDb(request).from("study_guides").select("id,title,category,body,skill_tags,created_at", { count: "exact" }).order("title").order("id").range((page - 1) * 20, page * 20 - 1);
    const category = params.get("category");
    if (category && !["plan","writing_method","answering_strategy","patterns","grammar"].includes(category)) throw new HttpError(400, "Invalid category");
    if (category) query = query.eq("category", category);
    const skill = params.get("skill");
    if (skill && !["reading","listening","writing","speaking"].includes(skill)) throw new HttpError(400, "Invalid skill");
    if (skill) query = query.contains("skill_tags", [skill]);
    const search=(params.get("search")??"").trim().replace(/[%,()_]/g," ").slice(0,120);
    if(search) query=query.or(`title.ilike.%${search}%,body.ilike.%${search}%`);
    const result = await query;
    if (result.error) throw result.error;
    return NextResponse.json({ guides: result.data, count: result.count, page });
  } catch (error) { return apiError(error); }
}
