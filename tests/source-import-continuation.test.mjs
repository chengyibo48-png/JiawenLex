import test from "node:test";
import assert from "node:assert/strict";
import { sourceCandidateFingerprint } from "../lib/source-fingerprint.ts";
import { vocabularyExercises } from "../scripts/native-vocabulary-exercises.mjs";
import { validateQuestionAnswers } from "../lib/question-answers.ts";

test("answer corrections preserve native answer modes and legacy variants", () => {
  assert.throws(() => validateQuestionAnswers({ answer_mode: "open" }, ["model answer"]));
  assert.throws(() => validateQuestionAnswers({ answer_mode: "single_choice", choices: ["A", "B"] }, ["C"]));
  assert.throws(() => validateQuestionAnswers({ answer_mode: "multi_choice", choices: ["A", "B"] }, ["A", "A"]));
  assert.doesNotThrow(() => validateQuestionAnswers({ answer_mode: "multi_choice", choices: ["A", "B"] }, ["B", "A"]));
  assert.doesNotThrow(() => validateQuestionAnswers({ answer_mode: "text" }, ["color", "colour"]));
  assert.doesNotThrow(() => validateQuestionAnswers({ answer_mode: "single_choice" }, []));
});

test("question import identity survives review edits and batch boundaries", () => {
  const item = { physicalPage: 2, printedPage: "1", sectionTitle: "OCR", contentKind: "question", payload: { prompt: "What is it?", reviewed_against_pdf: false } };
  const before = sourceCandidateFingerprint("doc", item);
  assert.equal(before, sourceCandidateFingerprint("doc", { ...item, sectionTitle: "Reviewed", payload: { ...item.payload, prompt: " What is it ? ", reviewed_against_pdf: true } }));
  assert.notEqual(before, sourceCandidateFingerprint("doc", { ...item, physicalPage: 3 }));
  assert.equal(sourceCandidateFingerprint("doc", { ...item, payload: { candidate_fingerprint: "a".repeat(64) } }), "a".repeat(64));
});

test("text vocabulary adaptation retains every source row without pretending to be audio", () => {
  const doc = { id: "document", title: "「雅思听力」179考点词" };
  const entries = Array.from({ length: 23 }, (_, index) => `| ${index + 1} | term${index} | expression${index} |`);
  const result = vocabularyExercises(doc, [{ physicalPage: 4, text: entries.join("\n") }]);
  assert.equal(result.length, 3);
  const questions = result.flatMap((item) => item.payload.questions);
  assert.equal(questions.length, 23);
  for (const [index, q] of questions.entries()) {
    assert.equal(q.origin_kind, "adapted");
    assert.equal(q.verified, false);
    assert.equal(q.answers[0], `expression${index}`);
    assert.equal(q.choices.filter((choice) => choice === q.answers[0]).length, 1);
    assert.equal(new Set(q.choices).size, q.choices.length);
    assert.equal(q.source_physical_page, 4);
  }
  assert.ok(result.every((item) => item.payload.listening_text_training && item.payload.reviewed_against_pdf === false && !item.payload.audioFilePath));
});
