import { sourceCandidateFingerprint } from "@/lib/source-fingerprint";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

const Item = z.object({
  physicalPage: z.number().int().positive().max(100000),
  printedPage: z.string().max(100).default(""),
  sectionTitle: z.string().max(500).default(""),
  contentKind: z.enum(["page_text", "question", "vocabulary", "reference_answer", "figure", "note"]),
  payload: z.record(z.string(), z.unknown()),
});
const Input = z.object({
  parser: z.string().trim().min(1).max(80).default("MinerU"),
  parserVersion: z.string().max(80).default(""),
  totalPages: z.number().int().positive().max(100000),
  parsedPages: z.number().int().nonnegative().max(100000),
  idempotencyKey: z.string().uuid(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  items: z.array(Item).min(1).max(100),
});
type Context = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { userId, admin } = await requireUser(request);
    const { documentId } = await params;
    const input = Input.parse(await request.json());
    if (input.parsedPages > input.totalPages || input.items.some((item) => item.physicalPage > input.totalPages)) throw new HttpError(400, "Page references exceed the parsed document");
    const { data: document, error: documentError } = await admin.from("source_documents").select("id,page_count,status,sha256,parsed_pages").eq("id", documentId).eq("owner_id", userId).maybeSingle();
    if (documentError) throw documentError;
    if (!document || document.status !== "ready") throw new HttpError(404, "Original PDF is unavailable");
    if(input.sourceSha256 && input.sourceSha256!==document.sha256)throw new HttpError(409,"审核包与原始 PDF 不匹配");
    if (document.page_count && document.page_count !== input.totalPages) throw new HttpError(409, "Page count does not match the uploaded document");
    const { data: prior, error: priorError } = await admin.from("source_parse_batches")
      .select("id,document_id,parser,parser_version,total_pages,parsed_pages")
      .eq("owner_id", userId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (priorError) throw priorError;
    if (prior && (prior.document_id !== documentId || prior.parser !== input.parser ||
      prior.parser_version !== input.parserVersion || prior.total_pages !== input.totalPages ||
      prior.parsed_pages !== input.parsedPages))
      throw new HttpError(409, "Import key belongs to a different document or parse");
    let batchId = prior?.id;
    if (!batchId) {
      const { data: batch, error: batchError } = await admin.from("source_parse_batches").insert({
        owner_id: userId, document_id: documentId, parser: input.parser, parser_version: input.parserVersion,
        total_pages: input.totalPages, parsed_pages: input.parsedPages,
        status: input.parsedPages === input.totalPages ? "review" : "parsing", idempotency_key: input.idempotencyKey,
      }).select("id").single();
      if (batchError) throw batchError;
      batchId = batch.id;
    }
    const rows = input.items.map((item) => ({
      owner_id: userId, document_id: documentId, batch_id: batchId,
      fingerprint: sourceCandidateFingerprint(documentId, item), physical_page: item.physicalPage, printed_page: item.printedPage,
      section_title: item.sectionTitle, content_kind: item.contentKind, payload: item.payload,
    }));
    const { data, error } = await admin.from("source_review_candidates").upsert(rows, { onConflict: "document_id,fingerprint", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    const { error: documentUpdateError } = await admin.from("source_documents").update({
      page_count: input.totalPages, parse_status: Math.max(document.parsed_pages,input.parsedPages) === input.totalPages ? "review" : "parsing", parsed_pages: Math.max(document.parsed_pages, input.parsedPages),
    }).eq("id", documentId).eq("owner_id", userId);
    if (documentUpdateError) throw documentUpdateError;
    return NextResponse.json({ batchId, inserted: data?.length ?? 0, duplicate: !!prior }, { status: prior ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
