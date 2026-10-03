import test from "node:test";
import assert from "node:assert/strict";
import { sourceAnswerRows } from "../scripts/source-answer-tables.mjs";
test("Flow-chart table switches from three-column classification answers to two-column answer position", () => {
 const rows = sourceAnswerRows("| # | Statement | Answer | Explanation |\n| --- | --- | --- | --- |\n| 6 | can be seen through | B (amber only) | transparent |\n\n| Box | Answer | 定位句 |\n| --- | --- | --- |\n| 7 | beaks | It is from the problems... |\n| 8 | vomited up | from time to time... |\n| 9 | hardens | Once outside... |");
 assert.equal(rows.get("6").value, "B (amber only)"); assert.equal(rows.get("7").value, "beaks"); assert.equal(rows.get("8").value, "vomited up"); assert.equal(rows.get("9").value, "hardens");
});
test("An unrelated numbered table cannot inherit the previous answer column", () => {
 const rows = sourceAnswerRows("| # | Answer |\n| --- | --- |\n| 1 | C |\n\n| Year | Description |\n| --- | --- |\n| 2 | not an answer |");
 assert.equal(rows.size, 1); assert.equal(rows.get("1").value, "C"); assert.equal(rows.has("2"), false);
});
