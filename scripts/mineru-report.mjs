import { readFile, writeFile } from "node:fs/promises";
const catalog = JSON.parse(await readFile(".source-archive/source-catalog.json", "utf8"));
const candidates = JSON.parse(await readFile(".source-archive/candidate-manifest.json", "utf8"));
const output = ["# 94 份 PDF 原生练习整理进度", "", "日期：2026-09-30。该表记录本机 OCR 和候选提取进度，不代表逐页审核或组内发布已完成。", "",
  "## 已实现", "", "四科分类、逐题原题/改编标识、单选/多选/开放回答、缺答案不判分、听力文本训练单独标识、分页审核、原页核验、稳定指纹、缺图表发布拦截、原生题型纠错校验、历史版本参考回答。", "",
  "## 已知边界", "", "- 完成 OCR 只表示页码缓存覆盖，不表示文字正确。所有自动提取内容保留未核验状态。", "- 179 考点词已提取 179 个词条，生成 21 组听力表达文本训练；没有配套音频，不作为听力测试。", "- 阅读500词目前提取 489 个可识别词条，生成 57 组训练。无音标词条、异常拆字和孤立释义仍需逐页处理；不以文件名中的500作为已提取数量。", "- 同题不同范文的合并操作、全批原页核验、图表素材入库和完整登录后浏览器验收尚未完成。", "- 同时需要图表和音频的题组暂保留待处理，避免只发布一个附件导致题目不完整。", "- 未解析或未审核的页仍保留待处理；下表0组表示尚未提取成候选，不能据此认定文件无练习内容。", "",
  "## 逐文件清单", "", "| 文件 | 科目分类 | PDF页数 | OCR缓存覆盖 | 候选题组 | 处理结果 |", "| --- | --- | ---: | ---: | ---: | --- |"];
for (const doc of catalog.documents) {
  let count = 0;
  try { count = JSON.parse(await readFile(`.source-archive/parsed/${doc.sha256}.json`, "utf8")).pages.length; } catch (error) { if (error.code !== "ENOENT") throw error; }
  const extracted = candidates.find((item) => item.documentId === doc.id)?.candidates ?? 0;
  const result = count < doc.page_count ? "页段解析/覆盖核验中" : extracted ? "已生成未核验候选，等待原页对照" : "文本已缓存，仍待内容整理";
  output.push(`| ${doc.title.replaceAll("|", "\\|")} | ${(doc.skill_tags ?? []).join(" / ")} | ${doc.page_count} | ${count} | ${extracted} | ${result} |`);
}
await writeFile("docs/native-exercises-progress-2026-09-30.md", output.join("\n") + "\n");
console.log("Wrote the 94-document progress report; no content was published.");
