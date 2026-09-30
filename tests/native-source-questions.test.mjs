import test from "node:test";
import assert from "node:assert/strict";
import { isCorrectAnswer, isGradableQuestion, weakSkills } from "../lib/study.ts";
import { validateSourceQuestion } from "../lib/source-question.ts";

const documentId = "11111111-1111-4111-8111-111111111111";
const reference = { document_id: documentId, physical_page: 24, role: "question" };
function payload(overrides = {}) {
  return { title: "Reading set", prompt: "Read and answer", skill: "reading", track: "academic", origin_kind: "source",
    questionType: "multiple choice", passage: "A complete reading passage.", transcript: "", tags: [],
    source_refs: [reference], reviewed_against_pdf: true, answer_alignment_checked: true,
    questions: [{ id: "1", type: "multiple choice", prompt: "Choose two", origin_kind: "source", answer_mode: "multi_choice",
      choices: ["A", "B", "C"], answers: ["A", "C"], explanation: "", source_document_id: documentId,
      source_physical_page: 24, source_printed_page: "23", source_refs: [reference, { ...reference, physical_page: 230, role: "answer" }], verified: true }], ...overrides };
}
test("multiple choice requires the complete unordered answer set", () => {
  const q = payload().questions[0];
  assert.equal(isCorrectAnswer(q, '["C","A"]'), true);
  assert.equal(isCorrectAnswer(q, '["A"]'), false);
  assert.equal(isCorrectAnswer(q, '["A","B","C"]'), false);
  assert.equal(isCorrectAnswer(q, "A,C"), false);
});
test("open responses and missing answers are never scored", () => {
  const q = { ...payload().questions[0], answer_mode: "open", answers: [] };
  assert.equal(isGradableQuestion(q), false);
  assert.equal(isCorrectAnswer(q, "Any essay"), false);
  assert.equal(isGradableQuestion({ ...q, answer_mode: "text" }), false);
});
test("source review rejects missing passage, audio, bad choices and unverified OCR", () => {
  assert.equal(validateSourceQuestion(payload(), documentId).questions.length, 1);
  assert.throws(() => validateSourceQuestion(payload({ passage: "" }), documentId));
  assert.throws(() => validateSourceQuestion(payload({ skill: "listening", passage: "" }), documentId));
  assert.throws(() => validateSourceQuestion(payload({ reviewed_against_pdf: false }), documentId));
  assert.throws(() => validateSourceQuestion(payload({ questions: [{ ...payload().questions[0], answers: ["D"] }] }), documentId));
  assert.throws(() => validateSourceQuestion(payload({ questions: [{ ...payload().questions[0], requires_figure: true }] }), documentId));
  assert.throws(() => validateSourceQuestion(payload({ source_refs: [{ ...reference, role: "figure" }] }), documentId));
});
test("adapted listening text is labelled and excluded from listening trends", () => {
  const q = { ...payload().questions[0], origin_kind: "adapted", type: "listening_text", answer_mode: "text", choices: undefined,
    answers: ["book"], source_refs: [reference] };
  const item = payload({ skill: "listening", origin_kind: "adapted", passage: "", transcript: "reserve → book",
    listening_text_training: true, questions: [q] });
  assert.equal(validateSourceQuestion(item, documentId).listening_text_training, true);
  assert.deepEqual(weakSkills(Array.from({ length: 2 }, () => ({ skill: "listening", learning_kind: "first",
    question_count: 10, correct_count: 0, question_stats: [{ type: "listening_text", count: 10, correct: 0 }] }))), []);
});
