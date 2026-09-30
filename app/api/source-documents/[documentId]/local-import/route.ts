import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase";

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
  items: z.array(Item).min(1).max(100),
});
type Context = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { documentId } = await params;
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!token || token.length > 200) throw new HttpError(401, "MinerU import token is required");
    const admin = getAdminClient();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { data: grant, error: grantError } = await admin.from("source_import_tokens").select("id,owner_id,document_id").eq("token_hash", tokenHash).eq("document_id", documentId).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (grantError) throw grantError;
    if (!grant) throw new HttpError(401, "MinerU import token expired or revoked");
    const input = Input.parse(await request.json());
    if (input.parsedPages > input.totalPages || input.items.some((item) => item.physicalPage > input.totalPages)) throw new HttpError(400, "Page references exceed the parsed document");
    const [{ data: profile, error: profileError }, { data: document, error: documentError }] = await Promise.all([
      admin.from("profiles").select("id,status").eq("id", grant.owner_id).maybeSingle(),
      admin.from("source_documents").select("id,page_count,status").eq("id", documentId).eq("owner_id", grant.owner_id).maybeSingle(),
    ]);
    if (profileError) throw profileError;
    if (documentError) throw documentError;
    if (!profile || profile.status !== "active" || !document || document.status !== "ready") throw new HttpError(403, "Owner or source document is unavailable");
    if (document.page_count && document.page_count !== input.totalPages) throw new HttpError(409, "Page count does not match the source PDF");
    const { data: prior, error: priorError } = await admin.from("source_parse_batches")
      .select("id,document_id,parser,parser_version,total_pages,parsed_pages")
      .eq("owner_id", grant.owner_id).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (priorError) throw priorError;
    if (prior && (prior.document_id !== documentId || prior.parser !== input.parser ||
      prior.parser_version !== input.parserVersion || prior.total_pages !== input.totalPages ||
      prior.parsed_pages !== input.parsedPages))
      throw new HttpError(409, "Import key belongs to a different document or parse");
    let batchId = prior?.id;
    if (!batchId) {
      const { data: batch, error: batchError } = await admin.from("source_parse_batches").insert({
        owner_id: grant.owner_id, document_id: documentId, parser: input.parser, parser_version: input.parserVersion,
        total_pages: input.totalPages, parsed_pages: input.parsedPages,
        status: input.parsedPages === input.totalPages ? "review" : "parsing", idempotency_key: input.idempotencyKey,
      }).select("id").single();
      if (batchError) throw batchError;
      batchId = batch.id;
    }
    const rows = input.items.map((item) => ({
      owner_id: grant.owner_id, document_id: documentId, batch_id: batchId,
      fingerprint: createHash("sha256").update(JSON.stringify([item.physicalPage, item.printedPage, item.sectionTitle, item.contentKind, item.payload])).digest("hex"),
      physical_page: item.physicalPage, printed_page: item.printedPage, section_title: item.sectionTitle,
      content_kind: item.contentKind, payload: item.payload,
    }));
    const { data, error } = await admin.from("source_review_candidates").upsert(rows, { onConflict: "document_id,fingerprint", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    const { error: updateError } = await admin.from("source_documents").update({
      page_count: input.totalPages, parse_status: input.parsedPages === input.totalPages ? "review" : "parsing",
      parsed_pages: Math.max(0, Math.min(input.parsedPages, input.totalPages)),
    }).eq("id", documentId).eq("owner_id", grant.owner_id);
    if (updateError) throw updateError;
    await admin.from("source_import_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", grant.id);
    return NextResponse.json({ batchId, inserted: data?.length ?? 0, duplicate: !!prior }, { status: prior ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
