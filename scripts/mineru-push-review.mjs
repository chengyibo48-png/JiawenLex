import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BATCH = 100;
const PAGE_MARKER = /<!--\s*page\s+(\d+)\s+of\s+(\d+)\s*-->/gi;

function argumentsMap(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith("--") || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Invalid argument near ${argv[index]}`);
    result.set(argv[index].slice(2), argv[++index]);
  }
  return result;
}

function parsePages(value, totalPages) {
  if (!value) throw new Error("--pages is required (example: --pages 1-20,35,40-45)");
  if (value === "all") return new Set(Array.from({ length: totalPages }, (_, index) => index + 1));
  const pages = new Set();
  for (const item of value.split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(item.trim());
    if (!match) throw new Error(`Invalid page range: ${item}`);
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > totalPages) throw new Error(`Page range must be between 1 and ${totalPages}`);
    for (let page = first; page <= last; page++) pages.add(page);
  }
  return pages;
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function mineruJson(binary, args) {
  const { stdout } = await execFileAsync(binary, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000, encoding: "utf8" });
  try { return JSON.parse(stdout); }
  catch { throw new Error("MinerU returned invalid JSON. Confirm the selected document has a completed standard parse."); }
}

async function postBatch(api, documentId, token, totalPages, parsedPages, items) {
  const response = await fetch(`${api.replace(/\/$/, "")}/api/source-documents/${encodeURIComponent(documentId)}/local-import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      parser: "MinerU",
      parserVersion: "local-standard",
      totalPages,
      parsedPages,
      idempotencyKey: randomUUID(),
      items,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `JiawenLex import failed (${response.status})`);
  return Number(body.inserted ?? 0);
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  const pdf = resolve(args.get("pdf") ?? "");
  const documentId = args.get("document");
  const token = args.get("token");
  const api = args.get("api");
  if (!args.get("pdf") || !documentId || !token || !api) throw new Error("Usage: node scripts/mineru-push-review.mjs --pdf <local.pdf> --document <JiawenLex document UUID> --token <short-lived token> --pages <1-20,35> --api <site URL>");
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw new Error("Invalid JiawenLex document ID");
  if (!/^https:\/\//i.test(api) && !/^http:\/\/localhost(?::\d+)?$/i.test(api)) throw new Error("--api must be HTTPS (or localhost for local development)");
  await access(pdf);
  const binary = process.env.MINERU_BIN ?? join(homedir(), ".local", "bin", process.platform === "win32" ? "mineru.exe" : "mineru");
  const expectedSha = await hashFile(pdf);
  const docs = await mineruJson(binary, ["list", "docs", "--file-type", "pdf", "--limit", "200", "--json"]);
  const doc = docs.docs?.find((item) => item.sha256 === expectedSha);
  if (!doc?.short_id) throw new Error("This local PDF is not in the MinerU document library. Parse it with MinerU standard first; the tool never falls back to remote parsing.");
  const parses = await mineruJson(binary, ["list", "parses", "--tier", "standard", "--limit", "200", "--json"]);
  const complete = parses.parses?.some((item) => item.sha256 === expectedSha && item.status === "done");
  if (!complete) throw new Error("The full MinerU standard parse is not complete yet. Wait for the local parse job, then retry.");
  const totalPages = Number(doc.page_count);
  const wantedPages = parsePages(args.get("pages"), totalPages);
  const candidates = new Map();
  let locator = `doc:${doc.short_id}/tier:standard`;
  let after;
  let readPages = new Set();
  for (;;) {
    const command = ["read", locator, "--format", "markdown", "--limit", "200000", "--json"];
    if (after) command.push("--after", after);
    const parsed = await mineruJson(binary, command);
    if (parsed.tier !== "standard" || parsed.short_id !== doc.short_id) throw new Error("MinerU returned a different document or quality tier");
    const content = String(parsed.content ?? "");
    const markers = [...content.matchAll(PAGE_MARKER)];
    for (let index = 0; index < markers.length; index++) {
      const marker = markers[index];
      const page = Number(marker[1]), pageTotal = Number(marker[2]);
      if (pageTotal !== totalPages) throw new Error(`MinerU page count (${pageTotal}) does not match the indexed PDF (${totalPages})`);
      const end = markers[index + 1]?.index ?? content.length;
      const pageText = content.slice(marker.index + marker[0].length, end).trim();
      readPages.add(page);
      if (wantedPages.has(page)) {
        const heading = pageText.match(/^#{1,4}\s+(.+)$/m)?.[1]?.slice(0, 500) ?? "";
        candidates.set(page, { physicalPage: page, printedPage: "", sectionTitle: heading, contentKind: "page_text", payload: { text: pageText } });
      }
    }
    const next = parsed.next_request;
    if (!next) break;
    if (next.locator) locator = next.locator;
    after = next.after ?? undefined;
    if (!next.locator && !after) throw new Error("MinerU could not provide a continuation cursor");
  }
  const missingSelected = [...wantedPages].filter((page) => !candidates.has(page));
  if (missingSelected.length) throw new Error(`MinerU did not return requested physical pages: ${missingSelected.slice(0, 20).join(", ")}`);
  if (readPages.size !== totalPages) throw new Error(`Full-page check failed: MinerU returned ${readPages.size} of ${totalPages} physical pages. Nothing was imported.`);
  const items = [...candidates.values()].sort((a, b) => a.physicalPage - b.physicalPage);
  let inserted = 0;
  for (let start = 0; start < items.length; start += MAX_BATCH) {
    inserted += await postBatch(api, documentId, token, totalPages, totalPages, items.slice(start, start + MAX_BATCH));
  }
  console.log(`MinerU ${doc.short_id}: checked ${readPages.size}/${totalPages} pages; sent ${items.length} selected page(s); added ${inserted} new review candidate(s).`);
  console.log("All imports are private review candidates. Confirm them against the original PDF before publishing.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "MinerU import failed");
  process.exitCode = 1;
});
