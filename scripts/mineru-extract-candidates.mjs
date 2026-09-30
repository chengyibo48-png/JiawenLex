// Conservative candidate extraction. Output stays in the private review queue;
// OCR text is never marked verified or published by this script.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { vocabularyExercises } from "./native-vocabulary-exercises.mjs";

const root = join(process.cwd(), ".source-archive");
const catalog = JSON.parse(await readFile(join(root, "source-catalog.json"), "utf8"));
const stdout = process.argv.includes("--stdout");
const selected = process.argv.find((arg) => arg.startsWith("--sha="))?.slice(6);
const offset = Math.max(0, Number(process.argv.find((arg) => arg.startsWith("--offset="))?.slice(9) ?? 0) || 0);
const limit = Math.max(1, Math.min(1000, Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? 1000) || 1000));
const available = new Set((await readdir(join(root, "parsed"))).filter((name) => name.endsWith(".json")));
const duplicatePrompts = new Map();
let duplicateCount = 0;
const manifest = [];
if (!stdout) await mkdir(join(root, "candidates"), { recursive: true });

function basePayload(doc, page, prompt, title, skill) {
  const reference = { document_id: doc.id, physical_page: page, role: "question" };
  return {
    title, prompt, skill, track: "academic", origin_kind: "source", questionType: skill === "writing" ? "Task 2" : "Speaking Part 1",
    passage: "", transcript: "", tags: ["MinerU 待核验", `${doc.source_year ?? "年份未核实"}`],
    questions: [{ id: "1", type: skill === "writing" ? "essay" : "speaking", prompt,
      origin_kind: "source", answer_mode: "open", answers: [], explanation: "",
      source_document_id: doc.id, source_physical_page: page, source_printed_page: "", source_refs: [reference], verified: false }],
    source_refs: [reference], reviewed_against_pdf: false, answer_alignment_checked: false,
  };
}

function addSpeaking(items, doc, page, topic, prompt, part) {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (cleaned.length < 12 || cleaned.length > 1200) return;
  const payload = basePayload(doc, page, cleaned, `口语 Part ${part} · ${topic}`, "speaking");
  payload.questionType = `Speaking Part ${part}`;
  items.push({ physicalPage: page, printedPage: String(page), sectionTitle: topic, contentKind: "question", payload });
}

function partTwoCues(text) {
  const cues = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim().startsWith("| Describe ")) continue;
    const columns = [];
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      const row = lines[index].trim().split("|").slice(1, -1).map((cell) => cell.trim());
      if (!row.every((cell) => /^-+$/.test(cell))) row.forEach((cell, column) => { (columns[column] ??= []).push(cell); });
      index++;
    }
    for (const cells of columns) {
      const cue = cells.join(" ").replace(/\s+/g, " ").trim();
      for (const segment of cue.split(/(?=Describe\b)/i).map((part) => part.trim())) {
        if (/^Describe\b/i.test(segment) && /\b(?:explain|And how|And why)\b/i.test(segment)) cues.push(segment);
      }
    }
  }
  for (const match of text.matchAll(/^Describe\b/gm)) {
    const tail = text.slice(match.index, match.index + 1000);
    const end = tail.match(/\b(?:(?:And\s+)?Explain|And\s+(?:how|why))\b[^\n]{0,180}/i);
    if (end && end.index < 700) cues.push(tail.slice(0, end.index + end[0].length).replace(/\s+/g, " ").trim());
  }
  return cues;
}

for (const doc of catalog.documents) {
  if (selected && doc.sha256 !== selected) continue;
  if (!available.has(`${doc.sha256}.json`)) { manifest.push({ documentId: doc.id, title: doc.title, status: "parse_pending", candidates: 0 }); continue; }
  const parsed = JSON.parse(await readFile(join(root, "parsed", `${doc.sha256}.json`), "utf8"));
  const items = [];
  items.push(...vocabularyExercises(doc, parsed.pages));
  if (doc.title === "2021年全年雅思写作真题集") {
    for (const page of parsed.pages) {
      const chunks = page.text.split(/^##\s+(?=2021\.\d{1,2}\.\d{1,2})/m).slice(1);
      for (const chunk of chunks) {
        const match = chunk.match(/^(2021\.\d{1,2}\.\d{1,2})\s*\n+([\s\S]*?)(?=\n\s*\d+\s*$|$)/);
        const prompt = match?.[2]?.replace(/\s+/g, " ").trim() ?? "";
        if (!prompt || prompt.length < 60 || prompt.length > 1200 || !prompt.includes("?")) continue;
        const payload = basePayload(doc, page.physicalPage, prompt, `写作 Task 2 · ${match[1]}`, "writing");
        items.push({ physicalPage: page.physicalPage, printedPage: String(page.physicalPage), sectionTitle: match[1], contentKind: "question", payload });
      }
    }
  }
  if (/^20(?:15|16|17|18|19|20)年雅思大作文总结$/.test(doc.title)) {
    const year = doc.title.slice(0, 4);
    let current = null;
    const finishWriting = () => {
      if (!current) return;
      const prompt = current.lines.join(" ").replace(/\s+/g, " ").trim();
      if (prompt.length >= 45 && prompt.length <= 1200) {
        const payload = basePayload(doc, current.startPage, prompt, `写作 Task 2 · ${current.date}`, "writing");
        payload.possible_multiple_prompts = (prompt.match(/\?/g) ?? []).length > 3;
        if (current.endPage !== current.startPage) {
          const ref = { document_id: doc.id, physical_page: current.endPage, role: "question" };
          payload.source_refs.push(ref);
          payload.questions[0].source_refs.push(ref);
        }
        items.push({ physicalPage: current.startPage, printedPage: String(current.startPage), sectionTitle: current.date, contentKind: "question", payload });
      }
      current = null;
    };
    for (const page of parsed.pages) {
      for (const raw of page.text.split("\n")) {
        const line = raw.trim();
        const heading = line.match(/^##\s*((?:20\d{2}\.\d{1,2}\.\d{1,2}|20\d{6}|\d{4})(?:\s+[AB])?)\s*$/);
        if (heading) {
          finishWriting();
          current = { date: heading[1].length === 4 ? `${year}.${heading[1].slice(0, 2)}.${heading[1].slice(2)}` : heading[1],
            startPage: page.physicalPage, endPage: page.physicalPage, lines: [] };
        } else if (current && line && !/^\d{1,2}$/.test(line) && !/^羊驼雅思/.test(line) && !/^!\[Image block\]/.test(line)) {
          current.lines.push(line);
          current.endPage = page.physicalPage;
        }
      }
    }
    finishWriting();
  }
  if (doc.title.includes("安小雅口语素材 Part1")) {
    let topic = "Part 1";
    for (const page of parsed.pages) {
      if (page.physicalPage < 8) continue;
      const heading = page.text.match(/^##\s+\d+:([^\n]+)/m);
      if (heading) topic = heading[1].trim();
      for (const match of page.text.matchAll(/^##\s+(\d+)\.\s+([^\n?]{8,180}\?)/gm)) {
        const prompt = match[2].trim();
        const payload = basePayload(doc, page.physicalPage, prompt, `口语 Part 1 · ${topic}`, "speaking");
        payload.questionType = "Speaking Part 1";
        items.push({ physicalPage: page.physicalPage, printedPage: String(page.physicalPage), sectionTitle: topic, contentKind: "question", payload });
      }
    }
  }
  if (doc.title.includes("安小雅口语素材 Part2")) {
    let topic = "Part 2";
    for (const page of parsed.pages) {
      if (page.physicalPage < 6) continue;
      const heading = page.text.match(/^##\s+\d+(?:-\d+)?:([^\n]+)/m);
      if (heading) topic = heading[1].trim();
      for (const cue of partTwoCues(page.text)) addSpeaking(items, doc, page.physicalPage, topic, cue, 2);
    }
  }
  if (doc.title.includes("安小雅口语素材 Part3")) {
    let topic = "Part 3";
    for (const page of parsed.pages) {
      if (page.physicalPage < 6) continue;
      const text = page.text.split(/##\s*中文翻译[:：]/)[0];
      const heading = text.match(/^##\s+\d+:([^\n]+)/m);
      if (heading) topic = heading[1].trim();
      for (const match of text.matchAll(/^(?:##\s*)?([A-Z][^\n]{11,180}\?)\s*$/gm)) addSpeaking(items, doc, page.physicalPage, topic, match[1], 3);
    }
  }
  if (doc.title === "2024年5-8月口语练习题") {
    let topic = "Part 1";
    for (const page of parsed.pages) {
      for (const line of page.text.split("\n")) {
        if (/^##\s*Part\s*2/i.test(line)) break;
        const heading = line.match(/^##\s*\d+\.\s*(.+)/);
        if (heading) { topic = heading[1].trim(); continue; }
        let remainder = line.trim();
        while (remainder.includes("?")) {
          const end = remainder.indexOf("?");
          const prompt = remainder.slice(0, end + 1).trim();
          if (/^[A-Z]/.test(prompt) && prompt.length <= 180) addSpeaking(items, doc, page.physicalPage, topic, prompt, 1);
          remainder = remainder.slice(end + 1).trim();
        }
      }
    }
    let current = null;
    const finishCue = () => {
      if (!current) return;
      const prompt = current.lines.join(" ").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
      if (/^Describe\b/i.test(prompt) && prompt.length >= 45 && prompt.length <= 1200) {
        addSpeaking(items, doc, current.startPage, `2024 题单 #${current.number}`, prompt, 2);
        const item = items.at(-1);
        if (item?.physicalPage === current.startPage && item.payload.prompt === prompt) {
          item.payload.source_sequence_number = current.number;
          if (current.endPage !== current.startPage) {
            const ref = { document_id: doc.id, physical_page: current.endPage, role: "question" };
            item.payload.source_refs.push(ref);
            item.payload.questions[0].source_refs.push(ref);
          }
        }
      }
      current = null;
    };
    let inPartTwo = false;
    for (const page of parsed.pages) {
      for (const raw of page.text.split("\n")) {
        if (/^##\s*Part\s*2/i.test(raw)) { inPartTwo = true; continue; }
        if (!inPartTwo) continue;
        let line = raw.trim();
        if (line.includes("盗版必究")) line = line.slice(line.indexOf("盗版必究") + "盗版必究".length).trim();
        if (/微信公众号|版权所有/.test(line) || /^\d+$/.test(line)) continue;
        const start = line.match(/^(?:\*\*|-\s*)\s*(\d{1,3})\.\s*(Describe\b.*)$/i);
        if (start) {
          finishCue();
          current = { number: Number(start[1]), startPage: page.physicalPage, endPage: page.physicalPage, lines: [start[2]] };
        } else if (current && line && !/^##/.test(line)) {
          current.lines.push(line.replace(/^-\s*/, ""));
          current.endPage = page.physicalPage;
        }
      }
    }
    finishCue();
  }
  if (doc.title.startsWith("25年9-12月雅思口语题库")) {
    let part = 1, topic = "保留题", cue = null;
    const finishCue = () => {
      if (!cue) return;
      addSpeaking(items, doc, cue.page, topic, cue.lines.join(" "), 2);
      const item = items.at(-1);
      if (item?.physicalPage === cue.page && cue.endPage !== cue.page) {
        const ref = { document_id: doc.id, physical_page: cue.endPage, role: "question" };
        item.payload.source_refs.push(ref);
        item.payload.questions[0].source_refs.push(ref);
      }
      cue = null;
    };
    for (const page of parsed.pages) {
      if (page.physicalPage < 4) continue;
      for (const raw of page.text.split("\n")) {
        const line = raw.trim();
        if (/^(?:##\s*)?Part\s*1\b/i.test(line)) { finishCue(); part = 1; continue; }
        if (/^(?:##\s*)?Part\s*2\s*&\s*3/i.test(line) || /^(?:##\s*)?Part\s*2\s*$/i.test(line)) { finishCue(); part = 2; continue; }
        if (/^(?:##\s*)?Part\s*3\s*$/i.test(line)) { finishCue(); part = 3; continue; }
        const topicHeading = line.match(/^##\s*\d+\.\s*([^?\n]+)$/);
        if (topicHeading) { topic = topicHeading[1].trim(); continue; }
        const questionLine = line.match(/^(?:##\s*)?\d+\.\s*([A-Z][^\n]{11,220}\?)\s*$/);
        if (questionLine && part !== 2) {
          addSpeaking(items, doc, page.physicalPage, topic, questionLine[1], part);
          continue;
        }
        if (part === 2 && /^Describe\b/i.test(line)) {
          finishCue();
          cue = { page: page.physicalPage, endPage: page.physicalPage, lines: [line] };
          continue;
        }
        if (cue && /^[A-Za-z]/.test(line) && cue.lines.join(" ").length < 1200) {
          cue.lines.push(line);
          cue.endPage = page.physicalPage;
          if (/\b(?:and\s+)?explain\b/i.test(line)) finishCue();
        }
      }
    }
    finishCue();
  }
  const seenOnPage = new Set();
  for (const item of items) {
    const key = item.payload.prompt.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const pageKey = `${item.physicalPage}:${key}`;
    if (seenOnPage.has(pageKey)) item.skip = true;
    seenOnPage.add(pageKey);
    const previous = duplicatePrompts.get(key);
    if (previous) { item.payload.possible_duplicate_of = previous; duplicateCount++; }
    else duplicatePrompts.set(key, { documentId: doc.id, page: item.physicalPage });
    item.payload.candidate_fingerprint = createHash("sha256").update(`${doc.sha256}:${item.physicalPage}:${key}`).digest("hex");
  }
  const uniqueItems = items.filter((item) => !item.skip);
  for (const item of uniqueItems) delete item.skip;
  if (items.length && !stdout) await writeFile(join(root, "candidates", `${doc.sha256}.json`), JSON.stringify({
    format: "jiawenlex-mineru-v1", parser: "MinerU", parserVersion: "local-standard", totalPages: doc.page_count,
    parsedPages: parsed.pages.length, items: uniqueItems,
  }, null, 2));
  if (stdout) console.log(JSON.stringify({ documentId: doc.id, sha256: doc.sha256, totalPages: doc.page_count, parsedPages: parsed.pages.length, totalCandidates: uniqueItems.length, items: uniqueItems.slice(offset, offset + limit) }));
  manifest.push({ documentId: doc.id, title: doc.title, status: parsed.pages.length === doc.page_count ? "parsed" : "partial",
    pageCoverage: parsed.pages.length, totalPages: doc.page_count, candidates: uniqueItems.length });
}
if (!stdout) await writeFile(join(root, "candidate-manifest.json"), JSON.stringify(manifest, null, 2));
if (!stdout) console.log(JSON.stringify({ documents: manifest.length, candidates: manifest.reduce((sum, entry) => sum + entry.candidates, 0),
  duplicatePrompts: duplicateCount }));
