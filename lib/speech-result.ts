export class SpeechResultError extends Error {}
export interface SpeechTaskResult {
  output?: { task_status?: string; results?: { subtask_status?: string; transcription_url?: string }[] };
}
export function speechTaskStatus(result: SpeechTaskResult): "PENDING" | "SUCCEEDED" | "FAILED" {
  const status = result.output?.task_status;
  if (status === "FAILED" || status === "CANCELED") return "FAILED";
  if (status === "SUCCEEDED") {
    const files = result.output?.results;
    if (files?.some((file) => file.subtask_status === "FAILED")) return "FAILED";
    if (!files || files.length !== 1 || files[0].subtask_status !== "SUCCEEDED") throw new SpeechResultError("Speech provider returned an incomplete task");
    return "SUCCEEDED";
  }
  if (status === "PENDING" || status === "RUNNING") return "PENDING";
  throw new SpeechResultError("Speech provider returned an unknown task status");
}
export function transcriptUrl(result: SpeechTaskResult): URL {
  let url: URL;
  try { url = new URL(result.output?.results?.[0]?.transcription_url ?? ""); }
  catch { throw new SpeechResultError("Invalid transcript URL"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !url.hostname.endsWith(".aliyuncs.com")) throw new SpeechResultError("Invalid transcript URL");
  return url;
}
export function transcriptText(value: unknown): string {
  const parts = (value as { transcripts?: { text?: unknown }[] })?.transcripts;
  if (!Array.isArray(parts) || parts.some((part) => !part || typeof part.text !== "string")) throw new SpeechResultError("Invalid transcript content");
  const text = parts.map((part) => part.text).join("\n");
  if (!text.trim() || text.length > 100000) throw new SpeechResultError("Empty or oversized transcript");
  return text;
}
