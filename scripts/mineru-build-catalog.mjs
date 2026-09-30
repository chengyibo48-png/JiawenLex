// Reads only completed local MinerU parses; never invokes remote parsing or force.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const mineru = process.env.MINERU_BIN ?? join(homedir(), ".local", "bin", process.platform === "win32" ? "mineru.exe" : "mineru");
const root = join(process.cwd(), ".source-archive");
const catalog = JSON.parse(await readFile(join(root, "source-catalog.json"), "utf8"));
let recovery = [];
try { recovery = JSON.parse(await readFile(join(root, "timeout-recovery.json"), "utf8")); } catch {}
const args = new Set(process.argv.slice(2));
const selected = process.argv.find((arg) => arg.startsWith("--sha="))?.slice(6);
const json = async (command) => {
  const { stdout } = await run(mineru, command, { windowsHide: true, maxBuffer: 80 * 1024 * 1024, timeout: 5 * 60 * 1000 });
  return JSON.parse(stdout);
};
const docs = (await json(["list", "docs", "--file-type", "pdf", "--limit", "1000", "--json"])).docs;
const parses = (await json(["list", "parses", "--tier", "standard", "--limit", "1000", "--json"])).parses;
const docBySha = new Map(docs.map((doc) => [doc.sha256, doc]));
const parseBySha = new Map();
for (const parse of parses) {
  const prior = parseBySha.get(parse.sha256);
  if (!prior || (prior.status !== "done" && parse.status === "done")) parseBySha.set(parse.sha256, parse);
}
await mkdir(join(root, "parsed"), { recursive: true });
const manifest = [];
for (const source of catalog.documents) {
  if (selected && source.sha256 !== selected) continue;
  const doc = docBySha.get(source.sha256);
  const parse = parseBySha.get(source.sha256);
  const entry = { id: source.id, title: source.title, sha256: source.sha256, totalPages: source.page_count,
    mineruShortId: doc?.short_id ?? null, parseStatus: parse?.status ?? "missing", pageCoverage: 0,
    skillTags: source.skill_tags, contentKind: source.content_kind, issues: [] };
  if (!doc || parse?.status !== "done") {
    entry.issues.push(parse?.error_code ?? "parse_unavailable");
    manifest.push(entry);
    continue;
  }
  const output = join(root, "parsed", `${source.sha256}.json`);
  if (!args.has("--refresh")) {
    try {
      const cached = JSON.parse(await readFile(output, "utf8"));
      if (cached.pages.length === source.page_count) { entry.pageCoverage = cached.pages.length; manifest.push(entry); continue; }
    } catch {}
  }
  const pages = new Map();
  const recovered = recovery.find((item) => item.sha256 === source.sha256);
  const availablePages = recovered ? new Set(recovered.complete.flatMap((range) => {
    const [first, last] = range.split("-").map(Number);
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  })) : null;
  try {
    // Read overlapping windows through MinerU, preserving its physical page markers.
    // Overlap ensures both endpoints are covered without treating continuation as completion.
    for (let first = 1; first <= source.page_count; first += 49) {
      const windowPages = Array.from({ length: Math.min(49, source.page_count - first + 1) }, (_, index) => first + index);
      if (availablePages && !windowPages.some((page) => availablePages.has(page))) continue;
      const center = Math.min(first + 24, source.page_count);
      const command = ["read", `doc:${doc.short_id}/tier:standard/page:${center}`, "--context", "24", "--format", "markdown", "--limit", "1000000", "--json"];
      let result;
      try {
        if (availablePages && windowPages.some((page) => !availablePages.has(page))) throw new Error("Partial window");
        result = await json(command);
      }
      catch {
        // A window touching an unfinished page may fail as a whole. Recover the
        // completed pages individually, without enqueueing fresh parses.
        for (let page = first; page <= Math.min(first + 48, source.page_count); page++) {
          if (availablePages && !availablePages.has(page)) continue;
          try {
            const single = await json(["read", `doc:${doc.short_id}/tier:standard/page:${page}`, "--limit", "1000000", "--json"]);
            if (single.sha256 !== source.sha256 || single.truncated) throw new Error("Invalid page result");
            pages.set(page, String(single.content ?? "").replace(/<!--\s*page\s+\d+\s+of\s+\d+\s*-->/g, "").trim());
          } catch { entry.issues.push(`page_unavailable:${page}`); }
        }
        continue;
      }
      if (result.sha256 !== source.sha256 || result.tier !== "standard") throw new Error("MinerU document identity mismatch");
      const content = String(result.content ?? "");
      const markers = [...content.matchAll(/<!--\s*page\s+(\d+)\s+of\s+(\d+)\s*-->/g)];
      for (let i = 0; i < markers.length; i++) {
        const page = Number(markers[i][1]);
        if (Number(markers[i][2]) !== source.page_count || page < 1 || page > source.page_count) throw new Error("MinerU page count mismatch");
        const end = markers[i + 1]?.index ?? content.length;
        pages.set(page, content.slice(markers[i].index + markers[i][0].length, end).trim());
      }
      if (result.truncated) throw new Error(`Read window truncated at page ${first}; reduce the window before continuing`);
    }
    entry.pageCoverage = pages.size;
    if (pages.size !== source.page_count) entry.issues.push(`missing_pages:${Array.from({ length: source.page_count }, (_, i) => i + 1).filter((page) => !pages.has(page)).slice(0, 50).join(",")}`);
    await writeFile(output, JSON.stringify({ sourceId: source.id, sha256: source.sha256, pages: [...pages].sort(([a], [b]) => a - b).map(([physicalPage, text]) => ({ physicalPage, text })) }));
  } catch (error) { entry.issues.push(String(error?.message ?? error)); }
  manifest.push(entry);
  console.log(`${manifest.length}: ${source.title} — ${entry.pageCoverage}/${source.page_count}`);
  await writeFile(join(root, "parse-manifest.json"), JSON.stringify(manifest, null, 2));
}
console.log(JSON.stringify({ documents: manifest.length, complete: manifest.filter((entry) => entry.pageCoverage === entry.totalPages).length,
  coveredPages: manifest.reduce((sum, entry) => sum + entry.pageCoverage, 0), totalPages: manifest.reduce((sum, entry) => sum + entry.totalPages, 0) }));
