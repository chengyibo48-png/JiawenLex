// Retry five timed-out full parses in contiguous local page ranges. No --force or --remote.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const run = promisify(execFile);
const mineru = process.env.MINERU_BIN ?? join(homedir(), ".local", "bin", process.platform === "win32" ? "mineru.exe" : "mineru");
const root = join(process.cwd(), ".source-archive");
const catalog = JSON.parse(await readFile(join(root, "source-catalog.json"), "utf8"));
const failed = new Set([
  "601f4f6aaa33ad29c96db02c2d16958202fce5dd453bca3c2e20d603bc50286c",
  "bf993f6e944e2e5638476f7ae17b47cc09d9756add7eaf99aa5c936b0a46a0a4",
  "f9fcbdc9f070a95041cc236a815e2b4510c5076a5a7631d0eafb57083467df74",
  "847bb26a0787cb3351a77f8ac0c37f1bb24f403d9ea154ae741c5841ea4ea31c",
  "51deb94dce0ebaa0f411d9dd1e81c307cf45882e80128def4f7b9e22fd6b3f57",
]);
const selected = process.argv.find((arg) => arg.startsWith("--sha="))?.slice(6);
let report = [];
try { report = JSON.parse(await readFile(join(root, "timeout-recovery.json"), "utf8")); } catch {}
for (const source of catalog.documents.filter((doc) => failed.has(doc.sha256) && (!selected || selected === doc.sha256))) {
  const path = join("D:\\BaiduNetdiskDownload", source.original_name);
  const prior = report.find((item) => item.sha256 === source.sha256);
  const complete = [...(prior?.complete ?? [])], pending = [];
  for (let first = 1; first <= source.page_count; first += 20) {
    const last = Math.min(source.page_count, first + 19);
    const range = `${first}-${last}`;
    if (complete.includes(range)) continue;
    try {
      const { stdout } = await run(mineru, ["parse", path, "--tier", "standard", "--pages", range, "--wait", "600", "--limit", "1000", "--json"],
        { windowsHide: true, maxBuffer: 10 * 1024 * 1024, timeout: 630000 });
      const parsed = JSON.parse(stdout);
      if (parsed.parse?.sha256 !== source.sha256 || parsed.parse?.status !== "done") throw new Error(parsed.parse?.error_code ?? "parse_not_done");
      complete.push(range);
    } catch (error) {
      let detail;
      try { detail = JSON.parse(error.stdout); } catch {}
      pending.push({ range, reason: detail?.error?.code ?? String(error?.message ?? error).slice(0, 200), parseStatus: detail?.parse?.status ?? null });
    }
    console.log(`${source.title}: ${range} ${pending.at(-1)?.range === range ? "pending" : "done"}`);
    await writeFile(join(root, "timeout-recovery.json"), JSON.stringify([...report.filter((item) => item.sha256 !== source.sha256), { sha256: source.sha256, title: source.title, complete, pending }], null, 2));
  }
  report = [...report.filter((item) => item.sha256 !== source.sha256), { sha256: source.sha256, title: source.title, complete, pending }];
}
console.log(JSON.stringify(report.map(({ title, complete, pending }) => ({ title, complete: complete.length, pending: pending.length }))));
