/** Normalize common browser/storage audio aliases without changing existing records. */
export function canonicalAttachmentMime(value: string | null | undefined, filename = "") {
  const type = (value ?? "").split(";", 1)[0].trim().toLowerCase();
  if (["audio/x-m4a", "audio/m4a"].includes(type)) return "audio/mp4";
  if (["audio/mp3", "audio/x-mpeg"].includes(type)) return "audio/mpeg";
  if (!type || type === "application/octet-stream") {
    if (/\.m4a$/i.test(filename)) return "audio/mp4";
    if (/\.mp3$/i.test(filename)) return "audio/mpeg";
  }
  return type;
}
