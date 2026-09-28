const DATABASE = "jiawenlex-offline-v1";

type StoredDraft = { iv: Uint8Array; data: ArrayBuffer; updatedAt: string; revision?: string; format?: number };
export type LocalDraft = { body: string; version: number | null; updatedAt: string; revision: string };
const queues = new Map<string, Promise<unknown>>();

function serial<T>(id: string, work: () => Promise<T>): Promise<T> {
  const pending = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(work);
  queues.set(id, pending);
  void pending.finally(() => { if (queues.get(id) === pending) queues.delete(id); }).catch(() => undefined);
  return pending;
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      for (const name of ["keys", "drafts", "conflicts"]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("Local storage failed"));
  });
}
async function getKey(database: IDBDatabase): Promise<CryptoKey> {
  const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  // Reading and creating the device key in ONE transaction prevents races between tabs.
  const transaction = database.transaction("keys", "readwrite");
  const done = committed(transaction);
  const store = transaction.objectStore("keys");
  const request = store.get("device");
  let key = candidate;
  request.onsuccess = () => { if (request.result) key = request.result; else store.put(candidate, "device"); };
  await done;
  return key;
}
function draftId(userId: string, materialId: string) { return `${userId}:${materialId}`; }
async function decode(database: IDBDatabase, record: StoredDraft): Promise<LocalDraft> {
  const key = await getKey(database);
  const text = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv) }, key, record.data));
  const payload = record.format === 2 ? JSON.parse(text) : { body: text, version: null };
  return { ...payload, updatedAt: record.updatedAt, revision: record.revision ?? record.updatedAt };
}
export function saveLocalDraft(userId: string, materialId: string, body: string, version: number | null = null): Promise<LocalDraft> {
  return serial(draftId(userId, materialId), async () => {
    const database = await openDatabase();
    try {
      const key = await getKey(database);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify({ body, version })));
      const record: StoredDraft = { iv, data, updatedAt: new Date().toISOString(), revision: crypto.randomUUID(), format: 2 };
      const transaction = database.transaction("drafts", "readwrite");
      const done = committed(transaction);
      transaction.objectStore("drafts").put(record, draftId(userId, materialId));
      await done;
      return { body, version, updatedAt: record.updatedAt, revision: record.revision! };
    } finally { database.close(); }
  });
}
export function readLocalDraft(userId: string, materialId: string): Promise<LocalDraft | null> {
  return serial(draftId(userId, materialId), async () => {
    const database = await openDatabase();
    try {
      const record = await requestValue(database.transaction("drafts", "readonly").objectStore("drafts").get(draftId(userId, materialId))) as StoredDraft | undefined;
      return record ? await decode(database, record) : null;
    } finally { database.close(); }
  });
}
export function clearLocalDraft(userId: string, materialId: string, expectedRevision?: string): Promise<void> {
  return serial(draftId(userId, materialId), async () => {
    const database = await openDatabase();
    try {
      const transaction = database.transaction("drafts", "readwrite");
      const done = committed(transaction);
      const store = transaction.objectStore("drafts");
      const request = store.get(draftId(userId, materialId));
      request.onsuccess = () => {
        const record = request.result as StoredDraft | undefined;
        if (record && (!expectedRevision || (record.revision ?? record.updatedAt) === expectedRevision)) store.delete(draftId(userId, materialId));
      };
      await done;
    } finally { database.close(); }
  });
}
export async function localDraftIds(userId: string): Promise<string[]> {
  await Promise.allSettled([...queues.values()]);
  const database = await openDatabase();
  try {
    const keys = await requestValue(database.transaction("drafts", "readonly").objectStore("drafts").getAllKeys());
    return keys.map(String).filter((key) => key.startsWith(userId + ":")).map((key) => key.slice(userId.length + 1));
  } finally { database.close(); }
}
export function archiveLocalDraft(userId: string, materialId: string): Promise<void> {
  return serial(draftId(userId, materialId), async () => {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(["drafts", "conflicts"], "readwrite");
      const done = committed(transaction);
      const request = transaction.objectStore("drafts").get(draftId(userId, materialId));
      request.onsuccess = () => {
        if (request.result) transaction.objectStore("conflicts").put(request.result, `${draftId(userId, materialId)}:${crypto.randomUUID()}`);
      };
      await done;
    } finally { database.close(); }
  });
}
export async function conflictCopies(userId: string, materialId: string): Promise<LocalDraft[]> {
  const database = await openDatabase();
  try {
    const store = database.transaction("conflicts", "readonly").objectStore("conflicts");
    const [keys, rows] = await Promise.all([requestValue(store.getAllKeys()), requestValue(store.getAll())]);
    return await Promise.all(rows.filter((_, index) => String(keys[index]).startsWith(draftId(userId, materialId) + ":")).map((row: StoredDraft) => decode(database, row)));
  } finally { database.close(); }
}
