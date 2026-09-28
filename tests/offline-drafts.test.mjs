import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { archiveLocalDraft, clearLocalDraft, conflictCopies, localDraftIds, readLocalDraft, saveLocalDraft } from "../lib/offline-drafts.ts";

function freshDatabase() { globalThis.indexedDB = new IDBFactory(); }
test("Encrypted drafts retain their ORIGINAL cloud version", async () => {
  freshDatabase();
  const local = await saveLocalDraft("owner", "essay", "Private essay content", 4);
  const restored = await readLocalDraft("owner", "essay");
  assert.equal(restored.body, "Private essay content");
  assert.equal(restored.version, 4);
  assert.equal(restored.revision, local.revision);
  assert.deepEqual(await localDraftIds("another-owner"), []);
});
test("Older save acknowledgement never deletes a newer edit", async () => {
  freshDatabase();
  const first = await saveLocalDraft("owner", "essay", "First edit", 1);
  const second = await saveLocalDraft("owner", "essay", "Newer edit", 1);
  await clearLocalDraft("owner", "essay", first.revision);
  assert.equal((await readLocalDraft("owner", "essay")).body, "Newer edit");
  await clearLocalDraft("owner", "essay", second.revision);
  assert.equal(await readLocalDraft("owner", "essay"), null);
});
test("Conflict copy remains recoverable after loading cloud", async () => {
  freshDatabase();
  const local = await saveLocalDraft("owner", "essay", "Offline version", 2);
  await archiveLocalDraft("owner", "essay");
  await clearLocalDraft("owner", "essay", local.revision);
  assert.equal(await readLocalDraft("owner", "essay"), null);
  assert.equal((await conflictCopies("owner", "essay"))[0].body, "Offline version");
  assert.equal((await conflictCopies("another-owner", "essay")).length, 0);
});
test("Parallel tabs share one device key without corrupting drafts", async () => {
  freshDatabase();
  const tab = await import("../lib/offline-drafts.ts?tab=another");
  await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? tab.saveLocalDraft : saveLocalDraft)("owner", "essay-" + index, "Body " + index, index)));
  for (let index = 0; index < 12; index++) {
    assert.equal((await readLocalDraft("owner", "essay-" + index)).body, "Body " + index);
  }
  assert.equal((await localDraftIds("owner")).length, 12);
});
test("Rapid queued edits persist the final body", async () => {
  freshDatabase();
  await Promise.all(Array.from({ length: 30 }, (_, index) => saveLocalDraft("owner", "essay", "Edit " + index, 3)));
  assert.equal((await readLocalDraft("owner", "essay")).body, "Edit 29");
});
