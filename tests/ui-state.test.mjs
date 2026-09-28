import test from "node:test";
import assert from "node:assert/strict";
import { locateAnnotations, annotationSegments } from "../lib/writing-annotations.ts";
import { mergeProfileDraft } from "../lib/profile-draft.ts";

test("Settings refresh keeps edited fields and updates untouched fields", () => {
  const original = { display_name: "Jiawen", timezone: "Asia/Shanghai", language: "zh", monthly_budget_cny: null };
  const draft = { ...original, display_name: "My new nickname", timezone: "Europe/London" };
  const remote = { ...original, language: "en", monthly_budget_cny: 20 };
  assert.deepEqual(mergeProfileDraft(draft, original, remote), { ...draft, language: "en", monthly_budget_cny: 20 });
  assert.equal(draft.language, "zh");
});

test("Later refresh keeps a pending local edit after another device changes it", () => {
  const original = { display_name: "First", theme: "light" };
  const draft = { ...original, display_name: "Local pending" };
  const next = { display_name: "Remote change", theme: "dark" };
  const merged = mergeProfileDraft(draft, original, next);
  assert.equal(merged.display_name, "Local pending");
  assert.equal(mergeProfileDraft(merged, next, next).display_name, "Local pending");
  assert.equal(merged.theme, "dark");
});

test("Annotations locate repeated quotes without losing original text", () => {
  const body = "City parks help. City parks matter.";
  const ranges = locateAnnotations(body, [{ quote: "City parks" }]);
  assert.equal(ranges.length, 2);
  const segments = annotationSegments(body, ranges);
  assert.equal(segments.map((segment) => segment.text).join(""), body);
  assert.equal(segments.filter((segment) => segment.notes.length).length, 2);
});

test("Annotations allow line breaks and multiple spaces in quoted phrases", () => {
  const body = "We need\n  more parks.";
  const ranges = locateAnnotations(body, [{ quote: "need more parks" }]);
  assert.deepEqual(ranges, [{ start: 3, end: body.length - 1, note: 0 }]);
});

test("Quotes escape regular expression syntax and ignore empty or invented quotes", () => {
  const body = "The rate rose (by 5%).";
  const ranges = locateAnnotations(body, [{ quote: "(by 5%)" }, { quote: "   " }, { quote: "a quote absent from the essay" }]);
  assert.equal(ranges.length, 1);
  assert.equal(body.slice(ranges[0].start, ranges[0].end), "(by 5%)");
});

test("Overlapping annotations share segments and preserve exact response", () => {
  const body = "A green city park is valuable.";
  const ranges = locateAnnotations(body, [{ quote: "green city park" }, { quote: "city park is" }]);
  const segments = annotationSegments(body, ranges);
  assert.equal(segments.map((segment) => segment.text).join(""), body);
  assert.ok(segments.some((segment) => segment.text === "city park" && segment.notes.join(",") === "0,1"));
});

test("Unmatched annotations and empty answers remain safe to render", () => {
  assert.deepEqual(annotationSegments("", locateAnnotations("", [{ quote: "missing" }])), []);
  assert.deepEqual(annotationSegments("<script>text</script>", []), [{ text: "<script>text</script>", notes: [] }]);
});
