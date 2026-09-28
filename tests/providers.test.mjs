import test from "node:test";
import assert from "node:assert/strict";
import { generateFeedback, providerEndpoint, estimatedTextCostCny } from "../lib/provider-client.ts";
import { speechTaskStatus, transcriptUrl, transcriptText } from "../lib/speech-result.ts";
const feedback = { summary: "Clear argument", strengths: ["Specific example"], priorities: ["Link ideas"], annotations: [{ quote: "many people", comment: "Specify the group" }], tags: ["cohesion"] };
test("Text calls disable thinking, preserve language and validate feedback", async (t) => {
  let body, destination;
  t.mock.method(globalThis, "fetch", async (url, init) => { destination = url; body = JSON.parse(init.body); return Response.json({ choices: [{ message: { content: JSON.stringify(feedback) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }); });
  const result = await generateFeedback("deepseek", "", "fixture-api-key", "writing", "Task", "many people", "en");
  assert.equal(destination, "https://api.deepseek.com/chat/completions");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.response_format.type, "json_object");
  assert.match(body.messages[0].content, /Write feedback in English/);
  assert.match(body.messages[0].content, /never an IELTS band score/);
  assert.deepEqual(result, { feedback, inputTokens: 100, outputTokens: 50 });
  await generateFeedback("qwen", "workspace123", "fixture-api-key", "speaking", "Task", "Spoken answer");
  assert.equal(body.enable_thinking, false);
  assert.match(destination, /^https:\/\/workspace123\.cn-beijing\.maas\.aliyuncs\.com\//);
  assert.throws(() => providerEndpoint("qwen", "https://untrusted.example"));
  assert.ok(estimatedTextCostCny("deepseek", 100, 50) > 0);
});
test("Malformed and incomplete provider responses do not return invented feedback", async (t) => {
  const responses = [ { choices: [{ message: { content: "not JSON" } }] }, { choices: [{ message: { content: '{"summary":"only summary"}' } }] }, { choices: [] } ];
  for (const response of responses) {
    t.mock.method(globalThis, "fetch", async () => Response.json(response));
    await assert.rejects(generateFeedback("deepseek", "", "fixture", "writing", "Task", "Answer"), /feedback/);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("fixture secret must not appear", { status: 401 }));
  await assert.rejects(generateFeedback("deepseek", "", "fixture", "writing", "Task", "Answer"), /AI provider returned 401/);
});
test("An overall successful speech task can contain a failed file", () => {
  assert.equal(speechTaskStatus({ output: { task_status: "SUCCEEDED", results: [{ subtask_status: "FAILED" }] } }), "FAILED");
  assert.equal(speechTaskStatus({ output: { task_status: "RUNNING" } }), "PENDING");
  assert.equal(speechTaskStatus({ output: { task_status: "CANCELED" } }), "FAILED");
  assert.throws(() => speechTaskStatus({ output: { task_status: "SUCCEEDED", results: [] } }));
});
test("Speech transcript parsing rejects unsafe URLs, empty and oversized responses", () => {
  const task = (url) => ({ output: { task_status: "SUCCEEDED", results: [{ subtask_status: "SUCCEEDED", transcription_url: url }] } });
  assert.equal(speechTaskStatus(task("https://speech.oss-cn-beijing.aliyuncs.com/text.json")), "SUCCEEDED");
  assert.equal(transcriptUrl(task("https://speech.oss-cn-beijing.aliyuncs.com/text.json")).protocol, "https:");
  for (const url of ["http://speech.aliyuncs.com/x", "https://aliyuncs.com.attacker.example/x", "https://user:pass@speech.aliyuncs.com/x", "https://speech.aliyuncs.com:8080/x"]) assert.throws(() => transcriptUrl(task(url)));
  assert.equal(transcriptText({ transcripts: [{ text: "Hello" }, { text: "world" }] }), "Hello\nworld");
  assert.throws(() => transcriptText({ transcripts: [{ text: "" }] }));
  assert.throws(() => transcriptText({ transcripts: [{ text: "x".repeat(100001) }] }));
});
