import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

const Update = z.object({
  candidateId: z.string().uuid(),
  action: z.enum(["save", "reject", "publish_question", "publish_vocabulary"]),
  payload: z.record(z.string(), z.unknown()).optional(),
  contentKind: z.enum(["page_text", "question", "vocabulary", "reference_answer", "figure", "note"]).optional(),
});
type ReviewCandidate = { id: string; owner_id: string; document_id: string; batch_id: string; fingerprint: string; physical_page: number; printed_page: string; section_title: string; content_kind: string; payload: Record<string, unknown>; status: string; published_material_id: string | null };

export async function GET(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const status = new URL(request.url).searchParams.get("status") ?? "open";
    if (!(["open", "pending", "edited", "rejected", "published", "all"] as const).includes(status as "open")) throw new HttpError(400, "Invalid review status");
    let query = admin.from("source_review_candidates").select("*").eq("owner_id", userId).order("created_at", { ascending: true }).limit(300);
    if (status === "open") query = query.in("status", ["pending", "edited"]);
    else if (status !== "all") query = query.eq("status", status);
    const { data: candidates, error } = await query;
    if (error) throw error;
    const ids = [...new Set((candidates ?? []).map((item) => item.document_id))];
    let documents: Record<string, unknown>[] = [];
    if (ids.length) {
      const result = await admin.from("source_documents").select("id,title,original_name,page_count,skill,content_kind").eq("owner_id", userId).in("id", ids);
      if (result.error) throw result.error;
      documents = result.data ?? [];
    }
    return NextResponse.json({ candidates: candidates ?? [], documents });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { userId, admin, profile } = await requireUser(request);
    const input = Update.parse(await request.json());
    const { data, error } = await admin.from("source_review_candidates").select("*").eq("id", input.candidateId).eq("owner_id", userId).maybeSingle();
    if (error) throw error;
    const candidate = data as ReviewCandidate | null;
    if (!candidate) throw new HttpError(404, "Review candidate unavailable");
    if (candidate.status === "published" || candidate.status === "rejected") throw new HttpError(409, "This candidate has already been closed");
    const payload = input.payload ?? candidate.payload;
    const contentKind = input.contentKind ?? candidate.content_kind;
    if (input.action === "save") {
      const result = await admin.from("source_review_candidates").update({ payload, content_kind: contentKind, status: "edited", updated_at: new Date().toISOString() }).eq("id", candidate.id).eq("owner_id", userId);
      if (result.error) throw result.error;
      return NextResponse.json({ saved: true });
    }
    if (input.action === "reject") {
      const result = await admin.from("source_review_candidates").update({ payload, content_kind: contentKind, status: "rejected", updated_at: new Date().toISOString() }).eq("id", candidate.id).eq("owner_id", userId);
      if (result.error) throw result.error;
      return NextResponse.json({ rejected: true });
    }
    const { data: document, error: sourceError } = await admin.from("source_documents").select("title,license_name,skill").eq("id", candidate.document_id).eq("owner_id", userId).maybeSingle();
    if (sourceError) throw sourceError;
    if (!document) throw new HttpError(404, "Source document unavailable");
    const id = candidate.id;
    if (input.action === "publish_vocabulary") {
      if (contentKind !== "vocabulary") throw new HttpError(400, "Only vocabulary candidates can be added as word cards");
      const term = String(payload.term ?? "").trim();
      if (!term || term.length > 160) throw new HttpError(400, "A vocabulary entry needs a term");
      const result = await admin.from("vocabulary").upsert({
        id, owner_id: userId, term, definition: String(payload.definition ?? "").slice(0, 4000),
        example: String(payload.example ?? "").slice(0, 4000), tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 30) : [],
        due_at: new Date().toISOString(), interval_days: 0, streak: 0,
        source_document_id: candidate.document_id, source_physical_page: candidate.physical_page,
        source_printed_page: candidate.printed_page, source_verified: true,
      }, { onConflict: "id" });
      if (result.error) throw result.error;
      const candidateUpdate = await admin.from("source_review_candidates").update({ payload, content_kind: contentKind, status: "published", updated_at: new Date().toISOString() }).eq("id", id).eq("owner_id", userId);
      if (candidateUpdate.error) throw candidateUpdate.error;
      return NextResponse.json({ published: true, vocabularyId: id });
    }
    if (contentKind !== "question") throw new HttpError(400, "Only question candidates can be published as exercises");
    const prompt = String(payload.prompt ?? "").trim();
    const skill = payload.skill ?? document.skill ?? "reading";
    if (!prompt || prompt.length > 20000 || !(["reading", "listening", "writing", "speaking"] as const).includes(skill as "reading")) throw new HttpError(400, "A question candidate needs a prompt and a valid IELTS skill");
    const questionItems = Array.isArray(payload.questions) ? payload.questions : [];
    if (questionItems.length > 200) throw new HttpError(400, "A material cannot contain more than 200 questions");
    const questions = questionItems.map((item, index) => {
      const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        id: typeof value.id === "string" ? value.id : `${index + 1}`,
        type: typeof value.type === "string" ? value.type.slice(0, 100) : "",
        prompt: String(value.prompt ?? "").slice(0, 4000),
        answers: Array.isArray(value.answers) ? value.answers.filter((answer): answer is string => typeof answer === "string").slice(0, 100) : [],
        explanation: String(value.explanation ?? "").slice(0, 4000),
        source_document_id: candidate.document_id,
        source_physical_page: candidate.physical_page,
        source_printed_page: candidate.printed_page,
      };
    });
    if (questions.some((question) => !question.prompt.trim())) throw new HttpError(400, "Each imported question needs a prompt");
    const material = {
      id, owner_id: userId, visibility: "private", approval: "approved",
      title: String(payload.title ?? `${document.title} · 第${candidate.physical_page}页`).slice(0, 240),
      skill, track: payload.track === "general" ? "general" : "academic",
      question_type: String(payload.questionType ?? "").slice(0, 240), prompt,
      passage: String(payload.passage ?? "").slice(0, 50000), transcript: String(payload.transcript ?? "").slice(0, 50000),
      questions, tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 50) : [],
      source_title: document.title, source_url: "", license_name: document.license_name,
      file_path: null, file_name: null, file_kind: null,
      source_document_id: candidate.document_id, source_physical_page: candidate.physical_page, source_printed_page: candidate.printed_page,
    };
    const { error: materialError } = await admin.from("materials").upsert(material, { onConflict: "id" });
    if (materialError) throw materialError;
    const result = await admin.from("source_review_candidates").update({ payload, content_kind: contentKind, status: "published", published_material_id: id, updated_at: new Date().toISOString() }).eq("id", id).eq("owner_id", userId);
    if (result.error) throw result.error;
    return NextResponse.json({ published: true, materialId: id });
  } catch (error) { return apiError(error); }
}
