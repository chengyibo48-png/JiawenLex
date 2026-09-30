import { assertReleaseMutation } from './release-policy.mjs';
assertReleaseMutation();
// Import conservative native candidates into the owner's PRIVATE review queue.
// This script never publishes exercises, marks OCR verified, or reads PDF contents remotely.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

if (process.env.SUPABASE_SECRET_KEY === undefined) process.loadEnvFile(".env.local");
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Supabase configuration unavailable");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
const catalog = JSON.parse(await readFile(".source-archive/source-catalog.json", "utf8"));
const selected = process.argv.find((arg) => arg.startsWith("--sha="))?.slice(6);
const run = promisify(execFile);
const check = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
let added = 0;
for (const source of catalog.documents) {
  if (selected && selected !== source.sha256) continue;
  const document = check(await admin.from("source_documents").select("id,owner_id,page_count,sha256,parsed_pages,status").eq("id", source.id).maybeSingle());
  if (!document || document.sha256 !== source.sha256 || document.page_count !== source.page_count || document.status !== "ready") throw new Error(`Source identity mismatch: ${source.title}`);
  // OCR coverage is independent of whether this file has an extraction adapter.
  try {
    const parsed = JSON.parse(await readFile(`.source-archive/parsed/${source.sha256}.json`, "utf8"));
    const pages = new Set(parsed.pages.map((page) => page.physicalPage));
    if (parsed.sha256 !== source.sha256 || pages.size !== parsed.pages.length || [...pages].some((page) => !Number.isInteger(page) || page < 1 || page > document.page_count)) throw new Error("Invalid OCR page coverage");
    check(await admin.from("source_documents").update({ parsed_pages: Math.max(document.parsed_pages, pages.size), parse_status: "review" }).eq("id", document.id).eq("owner_id", document.owner_id));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  let offset = 0, total = 0;
  do {
    const { stdout } = await run(process.execPath, ["scripts/mineru-extract-candidates.mjs", "--stdout", `--sha=${source.sha256}`, `--offset=${offset}`, "--limit=50"], { windowsHide: true, maxBuffer: 5 * 1024 * 1024 });
    if (!stdout.trim()) break;
    const bundle = JSON.parse(stdout);
    if (bundle.documentId !== document.id || bundle.sha256 !== document.sha256) throw new Error("Candidate identity mismatch");
    total = bundle.totalCandidates;
    if (!bundle.items.length) break;
    const digest = createHash("sha256").update(`${document.id}:local-standard:${bundle.parsedPages}`).digest("hex");
    const batchKey = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
    const batch = check(await admin.from("source_parse_batches").upsert({ owner_id: document.owner_id, document_id: document.id, parser: "MinerU", parser_version: "local-standard", total_pages: bundle.totalPages, parsed_pages: bundle.parsedPages, status: "review", idempotency_key: batchKey }, { onConflict: "owner_id,idempotency_key" }).select("id").single());
    const rows = bundle.items.map((item) => {
      if (!Number.isInteger(item.physicalPage) || item.physicalPage < 1 || item.physicalPage > document.page_count || item.payload.reviewed_against_pdf !== false || item.payload.questions.some((q) => q.verified !== false)) throw new Error("Unchecked OCR must remain unverified");
      return { owner_id: document.owner_id, document_id: document.id, batch_id: batch.id, fingerprint: item.payload.candidate_fingerprint, physical_page: item.physicalPage, printed_page: item.printedPage, section_title: item.sectionTitle, content_kind: item.contentKind, payload: item.payload, status: "pending" };
    });
    added += check(await admin.from("source_review_candidates").upsert(rows, { onConflict: "document_id,fingerprint", ignoreDuplicates: true }).select("id")).length;
    check(await admin.from("source_documents").update({ parsed_pages: Math.max(document.parsed_pages, bundle.parsedPages), parse_status: "review" }).eq("id", document.id).eq("owner_id", document.owner_id));
    offset += bundle.items.length;
  } while (offset < total);
  if (total) console.log(`${source.title}: ${total} private candidates`);
}
console.log(`Added ${added} candidates; nothing published.`);
