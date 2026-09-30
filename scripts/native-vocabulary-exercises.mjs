// Preserve the source's wording. These are adapted textual exercises, never audio tests.
export function vocabularyExercises(doc, pages) {
  const items = [];
  for (const page of pages) {
    const entries = [];
    for (const line of page.text.split("\n")) {
      if (doc.title === "「雅思听力」179考点词") {
        const row = line.match(/^\|\s*(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*$/);
        if (row) entries.push({ term: row[2].trim(), definition: row[3].trim(), number: row[1] });
      } else if (doc.title === "雅思阅读500词") {
        const row = line.match(/^([a-z]+)\s*\[[^\]]+\]\s*(.+)$/);
        if (row && /[\u3400-\u9fff]/.test(row[2])) entries.push({ term: row[1], definition: row[2].trim(), number: String(entries.length + 1) });
      }
    }
    const unique = entries.filter((entry, index) => entries.findIndex((other) => other.term === entry.term) === index);
    for (let start = 0; start < unique.length; start += 10) {
      const group = unique.slice(start, start + 10);
      if (unique.length < 4) continue;
      const listening = doc.title === "「雅思听力」179考点词";
      const ref = { document_id: doc.id, physical_page: page.physicalPage, role: "question" };
      const questions = group.map((entry, index) => {
        const correct = listening ? entry.definition : entry.term;
        const pool = unique.map((other) => listening ? other.definition : other.term).filter((choice) => choice !== correct);
        const choices = [...new Set(pool)].slice((start + index) % Math.max(1, pool.length - 2), ((start + index) % Math.max(1, pool.length - 2)) + 3);
        choices.splice(index % 4, 0, correct);
        return { id: String(index + 1), type: listening ? "listening_text" : "vocabulary", answer_mode: "single_choice", origin_kind: "adapted",
          prompt: listening ? `按资料中的对应表达表，关键词「${entry.term}」对应哪组表达？` : `按资料词条，释义「${entry.definition}」对应哪个词？`,
          choices, answers: [correct], explanation: `原词条：${entry.term} — ${entry.definition}。仅依据此处的资料语境，不代表在所有句子中可互换。`,
          source_document_id: doc.id, source_physical_page: page.physicalPage, source_printed_page: "", source_refs: [ref], verified: false };
      });
      items.push({ physicalPage: page.physicalPage, printedPage: "", sectionTitle: `词汇训练 ${start + 1}–${start + group.length}`, contentKind: "question",
        payload: { title: `${listening ? "听力表达文本训练" : "阅读词汇训练"} · 第 ${page.physicalPage} 页 · ${start + 1}–${start + group.length}`,
          prompt: questions.map((q) => q.prompt).join("\n"), skill: listening ? "listening" : "reading", track: "academic", origin_kind: "adapted",
          questionType: listening ? "Listening text vocabulary" : "Reading vocabulary", tags: ["改编练习", "MinerU 待核验"],
          passage: listening ? "" : "本练习根据资料中的词汇表改编，为词义识别训练。", transcript: listening ? group.map((entry) => `${entry.term} — ${entry.definition}`).join("\n") : "",
          listening_text_training: listening, questions, source_refs: [ref], reviewed_against_pdf: false, answer_alignment_checked: false } });
    }
  }
  return items;
}
