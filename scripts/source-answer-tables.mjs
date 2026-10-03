// Parse columns by the current table's header; never reuse a prior table's index.
export function sourceAnswerRows(text) {
  const answers = new Map();
  const clean = value => value.replace(/\*\*/g, "").replace(/&amp;/g, "&").trim();
  let answerColumn = -1;
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) { answerColumn = -1; continue; }
    const cells = line.trim().split("|").slice(1, -1).map(clean);
    if (!cells.length || cells.every(c => /^:?-+:?$/.test(c))) continue;
    if (!/^\d{1,2}$/.test(cells[0])) {
      answerColumn = /^(题号|#|question(?: number)?|no\.?|box|number)$/i.test(cells[0]) ? cells.findIndex((c, i) => i > 0 && /^(答案|answer|正确标题|正确段落)(?:\s.*)?$/i.test(c)) : -1;
      continue;
    }
    if (answerColumn > 0 && cells.length > answerColumn && cells[answerColumn].length <= 150) answers.set(cells[0], { value: cells[answerColumn], explanation: cells.length > answerColumn + 1 ? cells.at(-1) : "", excerpt: line });
  }
  return answers;
}
