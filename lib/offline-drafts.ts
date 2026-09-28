const DATABASE = "jiawenlex-offline-v1";

type StoredDraft = { iv: Uint8Array; data: ArrayBuffer; updatedAt: string };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore("keys");
      database.createObjectStore("drafts");
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

async function getKey(database: IDBDatabase): Promise<CryptoKey> {
  const existing = await requestValue(database.transaction("keys", "readonly").objectStore("keys").get("device")) as CryptoKey | undefined;
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await requestValue(database.transaction("keys", "readwrite").objectStore("keys").put(key, "device"));
  return key;
}

function draftId(userId: string, materialId: string) {
  return `${userId}:${materialId}`;
}

export async function saveLocalDraft(userId: string, materialId: string, body: string): Promise<void> {
  const database = await openDatabase();
  try {
    const key = await getKey(database);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(body));
    const record: StoredDraft = { iv: new Uint8Array(iv), data, updatedAt: new Date().toISOString() };
    await requestValue(database.transaction("drafts", "readwrite").objectStore("drafts").put(record, draftId(userId, materialId)));
  } finally { database.close(); }
}

export async function readLocalDraft(userId: string, materialId: string): Promise<{ body: string; updatedAt: string } | null> {
  const database = await openDatabase();
  try {
    const record = await requestValue(database.transaction("drafts", "readonly").objectStore("drafts").get(draftId(userId, materialId))) as StoredDraft | undefined;
    if (!record) return null;
    const key = await getKey(database);
    const body = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv) }, key, record.data));
    return { body, updatedAt: record.updatedAt };
  } finally { database.close(); }
}

export async function clearLocalDraft(userId: string, materialId: string): Promise<void> {
  const database = await openDatabase();
  try { await requestValue(database.transaction("drafts", "readwrite").objectStore("drafts").delete(draftId(userId, materialId))); }
  finally { database.close(); }
}
