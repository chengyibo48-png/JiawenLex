import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, authenticatedDb, HttpError, requireUser } from "@/lib/server-auth";
import { validateSourceQuestion } from "@/lib/source-question";

const Update = z.object({
  candidateId: z.string().uuid(),
  action: z.enum(["save", "reject", "publish_question", "publish_vocabulary", "publish_guide"]),
  shared: z.boolean().default(false),
  payload: z.record(z.string(), z.unknown()).optional(),
  contentKind: z.enum(["page_text", "question", "vocabulary", "reference_answer", "figure", "note"]).optional(),
});
type ReviewCandidate = { id: string; owner_id: string; document_id: string; batch_id: string; fingerprint: string; physical_page: number; printed_page: string; section_title: string; content_kind: string; payload: Record<string, unknown>; status: string; published_material_id: string | null };
const PageUpdate = z.object({ documentId: z.string().uuid(), physicalPage: z.number().int().positive(),
  status: z.enum(["extracted", "non_exercise", "pending"]), note: z.string().max(1000).default("") });

export async function POST(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const input = PageUpdate.parse(await request.json());
    const document = await admin.from("source_documents").select("page_count").eq("id", input.documentId).eq("owner_id", userId).maybeSingle();
    if (document.error) throw document.error;
    if (!document.data?.page_count || input.physicalPage > document.data.page_count) throw new HttpError(404, "Source page unavailable");
    if (input.status === "extracted" || input.status === "non_exercise") {
      const unresolved = await admin.from("source_review_candidates")
        .select("id", { count: "exact", head: true })
        .eq("document_id", input.documentId).eq("owner_id", userId)
        .eq("physical_page", input.physicalPage).in("status", ["pending", "edited"]);
      if (unresolved.error) throw unresolved.error;
      if (unresolved.count) throw new HttpError(409, "本页仍有待审核内容，请先发布、退回或忽略");
    }
    const result = await admin.from("source_page_audit").upsert({ document_id: input.documentId, owner_id: userId,
      physical_page: input.physicalPage, status: input.status, note: input.note, updated_at: new Date().toISOString() }, { onConflict: "document_id,physical_page" });
    if (result.error) throw result.error;
    return NextResponse.json({ saved: true });
  } catch (error) { return apiError(error); }
}

export async function GET(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const params = new URL(request.url).searchParams;
    const status = params.get("status") ?? "open";
    const page = Math.max(1, Math.min(100000, Number(params.get("page") ?? 1) || 1));
    const pageSize = Math.max(1, Math.min(100, Number(params.get("pageSize") ?? 30) || 30));
    const documentId = params.get("documentId");
    const skill = params.get("skill");
    const kind = params.get("kind");
    const verified = params.get("verified");
    const pageAuditDocumentId = params.get("pageAuditDocumentId");
    if (pageAuditDocumentId) {
      if (!z.string().uuid().safeParse(pageAuditDocumentId).success) throw new HttpError(400, "Invalid source document");
      const document = await admin.from("source_documents").select("page_count").eq("id", pageAuditDocumentId).eq("owner_id", userId).maybeSingle();
      if (document.error) throw document.error;
      if (!document.data) throw new HttpError(404, "Source document unavailable");
      const requestedPage = Number(params.get("pageAuditPhysicalPage") ?? 1);
      if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > (document.data.page_count ?? 0)) throw new HttpError(400, "Invalid source page");
      const counts = await Promise.all(["extracted", "non_exercise", "pending"].map((state) => admin.from("source_page_audit")
        .select("physical_page", { count: "exact", head: true }).eq("document_id", pageAuditDocumentId).eq("owner_id", userId).eq("status", state)));
      for (const result of counts) if (result.error) throw result.error;
      const current = await admin.from("source_page_audit").select("status,note").eq("document_id", pageAuditDocumentId).eq("owner_id", userId).eq("physical_page", requestedPage).maybeSingle();
      if (current.error) throw current.error;
      return NextResponse.json({ totalPages: document.data.page_count, extracted: counts[0].count ?? 0,
        nonExercise: counts[1].count ?? 0, pending: counts[2].count ?? 0, current: current.data ?? { status: "pending", note: "" } });
    }
    if (documentId && !z.string().uuid().safeParse(documentId).success) throw new HttpError(400, "Invalid source document");
    if (skill && !["reading", "listening", "writing", "speaking"].includes(skill)) throw new HttpError(400, "Invalid skill");
    if (kind && !["question","vocabulary","note","page_text","reference_answer","figure"].includes(kind)) throw new HttpError(400, "Invalid content kind");
    if (verified && verified !== "true") throw new HttpError(400, "Invalid verification filter");
    if (!(["open", "pending", "edited", "rejected", "published", "all"] as const).includes(status as "open")) throw new HttpError(400, "Invalid review status");
    let query = admin.from("source_review_candidates").select("*", { count: "exact" }).eq("owner_id", userId).order("created_at", { ascending: true }).order("id", { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1);
    if (documentId) query = query.eq("document_id", documentId);
    if (skill) query = query.eq("payload->>skill", skill);
    if (kind) query = query.eq("content_kind", kind);
    if (verified) query = query.eq("payload->>reviewed_against_pdf", "true");
    if (status === "open") query = query.in("status", ["pending", "edited"]);
    else if (status !== "all") query = query.eq("status", status);
    const { data: candidates, count, error } = await query;
    if (error) throw error;
    const ids = [...new Set((candidates ?? []).map((item) => item.document_id))];
    let documents: Record<string, unknown>[] = [];
    if (ids.length) {
      const result = await admin.from("source_documents").select("id,title,original_name,page_count,skill,content_kind").eq("owner_id", userId).in("id", ids);
      if (result.error) throw result.error;
      documents = result.data ?? [];
    }
    return NextResponse.json({ candidates: candidates ?? [], documents, count: count ?? 0, page, pageSize });
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
    const payload = { ...(input.payload ?? candidate.payload) };
    if (candidate.payload.possible_duplicate_of) payload.possible_duplicate_of = candidate.payload.possible_duplicate_of;
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
    const { data: document, error: sourceError } = await admin.from("source_documents").select("title,license_name,skill,page_count,rights_attested_at,rights_attestation").eq("id", candidate.document_id).eq("owner_id", userId).maybeSingle();
    if (sourceError) throw sourceError;
    if (!document) throw new HttpError(404, "Source document unavailable");
    const id = candidate.id;
    if (input.shared && (profile.role !== "admin" || !document.rights_attested_at)) throw new HttpError(403, "组内发布需要管理员及上传者授权声明");
    if (input.action === "publish_guide") {
      if (contentKind !== "note" || payload.reviewed_against_pdf !== true) throw new HttpError(400, "方法笔记尚未对照原页核验");
      if (Array.isArray(payload.extraction_issues) && payload.extraction_issues.length) throw new HttpError(400, "方法笔记仍有识别疑点");
      const guide = z.object({ title: z.string().trim().min(1).max(500), category: z.enum(["plan","writing_method","answering_strategy","patterns","grammar"]), body: z.string().trim().min(20).max(50000), skill_tags: z.array(z.enum(["reading","listening","writing","speaking"])).max(4) }).parse(payload);
      const result = await authenticatedDb(request).from("study_guides").upsert({ id, owner_id:userId, ...guide, source_document_id:candidate.document_id, visibility:input.shared?"shared":"private", approval:"approved", license_name:document.license_name||document.rights_attestation||"" });
      if(result.error) throw result.error;
      const closed = await admin.from("source_review_candidates").update({payload,content_kind:contentKind,status:"published",updated_at:new Date().toISOString()}).eq("id",id).eq("owner_id",userId);
      if(closed.error)throw closed.error;
      return NextResponse.json({published:true,guideId:id});
    }
    if (input.action === "publish_vocabulary") {
      if (contentKind !== "vocabulary") throw new HttpError(400, "Only vocabulary candidates can be added as word cards");
      if (payload.reviewed_against_pdf !== true) throw new HttpError(400, "词卡尚未对照原页核验");
      const term = String(payload.term ?? "").trim();
      if (!term || term.length > 160) throw new HttpError(400, "A vocabulary entry needs a term");
      if (!String(payload.definition ?? "").trim() || (Array.isArray(payload.extraction_issues) && payload.extraction_issues.length)) throw new HttpError(400, "词卡缺少释义或仍有识别疑点");
      const word = {
        term, definition: String(payload.definition ?? "").slice(0, 4000),
        example: String(payload.example ?? "").slice(0, 4000), tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 30) : [],
        part_of_speech:String(payload.part_of_speech??""), pronunciation:String(payload.pronunciation??""), pronunciation_uk:String(payload.pronunciation_uk??""), pronunciation_us:String(payload.pronunciation_us??""),
        source_document_id: candidate.document_id, source_physical_page: candidate.physical_page,
        source_printed_page: candidate.printed_page, source_verified: true,
      };
      const result = await admin.rpc("import_word_card",{p_owner:userId,p_id:id,p_key:candidate.fingerprint,p_data:word});
      if (result.error) throw result.error;
      if(input.shared) {
        const {source_physical_page: unusedPage,source_printed_page:unusedPrinted,source_verified:unusedVerified,...template}=word;
        const saved=await admin.from("vocabulary_templates").upsert({id,owner_id:userId,...template,approved:true},{onConflict:"id"});
        if(saved.error)throw saved.error;
      }
      const candidateUpdate = await admin.from("source_review_candidates").update({ payload, content_kind: contentKind, status: "published", updated_at: new Date().toISOString() }).eq("id", id).eq("owner_id", userId);
      if (candidateUpdate.error) throw candidateUpdate.error;
      return NextResponse.json({ published: true, vocabularyId: id });
    }
    if (contentKind !== "question") throw new HttpError(400, "Only question candidates can be published as exercises");
    if (!document.rights_attested_at) throw new HttpError(409, "请先记录上传者的组内发布授权声明");
    if (payload.possible_duplicate_of && (payload.duplicate_resolution !== "distinct" || String(payload.duplicate_note ?? "").trim().length < 10)) {
      throw new HttpError(409, "发现相同题干。请先检查已有题目；不同题目需填写 duplicate_resolution=distinct 和至少 10 字的 duplicate_note，同题的不同范文应合并为参考答案变体");
    }
    let value: ReturnType<typeof validateSourceQuestion>;
    try { value = validateSourceQuestion(payload, candidate.document_id); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "题目未通过发布校验"); }
    const existing = await admin.from("source_review_candidates").select("id").eq("owner_id", userId)
      .eq("content_kind", "question").eq("status", "published").eq("payload->>prompt", value.prompt).neq("id", candidate.id).limit(1);
    if (existing.error) throw existing.error;
    if (existing.data?.length && (payload.duplicate_resolution !== "distinct" || String(payload.duplicate_note ?? "").trim().length < 10)) {
      throw new HttpError(409, "相同题干已发布；请将新的范文合并为参考答案变体，或说明为何必须单独保留");
    }
    const allRefs = [...value.source_refs, ...value.questions.flatMap((question) => question.source_refs)];
    const refIds = [...new Set(allRefs.map((ref) => ref.document_id))];
    const sources = await admin.from("source_documents").select("id,page_count").eq("owner_id", userId).in("id", refIds);
    if (sources.error) throw sources.error;
    const pageCounts = new Map((sources.data ?? []).map((source) => [source.id, source.page_count]));
    if (refIds.length !== pageCounts.size || allRefs.some((ref) => !pageCounts.has(ref.document_id) || (pageCounts.get(ref.document_id) && ref.physical_page > Number(pageCounts.get(ref.document_id))))) throw new HttpError(400, "来源文件或页码无效");
    let attachmentMime: string | null = null;
    const attachmentPath = value.audioFilePath ?? value.figureFilePath;
    if (attachmentPath) {
      const audioPath = attachmentPath;
      if (!audioPath.startsWith(`${userId}/`) || !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)+$/.test(audioPath) || /(^|\/)\.{1,2}(\/|$)/.test(audioPath)) throw new HttpError(400, "听力音频路径无效");
      const slash = audioPath.lastIndexOf("/");
      const listed = await admin.storage.from("study-files").list(audioPath.slice(0, slash), { search: audioPath.slice(slash + 1), limit: 100 });
      if (listed.error) throw listed.error;
      const prefix = value.audioFilePath ? "audio/" : "image/";
      const audio = (listed.data ?? []).find((file) => file.name === audioPath.slice(slash + 1) && String(file.metadata?.mimetype ?? "").startsWith(prefix));
      if (!audio) throw new HttpError(400, "辅助附件未上传或格式无效");
      attachmentMime = String(audio.metadata?.mimetype);
    }
    const material = {
      id, owner_id: userId, visibility: input.shared ? "shared" : "private", approval: "approved",
      title: value.title, skill: value.skill, track: value.track,
      origin_kind: value.origin_kind, question_type: value.questionType, prompt: value.prompt,
      passage: value.passage, transcript: value.transcript,
      questions: value.questions, tags: value.listening_text_training ? [...new Set([...value.tags, "listening-text"])] : value.tags,
      source_title: document.title, source_url: "", license_name: document.license_name || document.rights_attestation,
      file_path: attachmentPath ?? null, file_name: attachmentPath?.split("/").at(-1) ?? null, file_kind: attachmentMime,
      source_document_id: candidate.document_id, source_physical_page: candidate.physical_page, source_printed_page: candidate.printed_page,
    };
    const { error: materialError } = await authenticatedDb(request).from("materials").upsert(material, { onConflict: "id" });
    if (materialError) throw materialError;
    const result = await admin.from("source_review_candidates").update({ payload, content_kind: contentKind, status: "published", published_material_id: id, updated_at: new Date().toISOString() }).eq("id", id).eq("owner_id", userId);
    if (result.error) throw result.error;
    return NextResponse.json({ published: true, materialId: id });
  } catch (error) { return apiError(error); }
}
