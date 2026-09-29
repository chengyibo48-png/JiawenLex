/* Paths are interpolated into Storage SDK URLs; prefix checks alone allow traversal. */
export function ownedStoragePath(path: string, ownerId: string): boolean {
  const parts = path.split("/");
  return path.length <= 500 && parts.length >= 2 && parts[0] === ownerId && parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== "..");
}

export function ownedRecordingPath(path: string, ownerId: string): boolean {
  return ownedStoragePath(path, ownerId) && path.split("/").length === 2 && /^[0-9a-f-]{36}\.(webm|m4a)$/i.test(path.split("/")[1]);
}
