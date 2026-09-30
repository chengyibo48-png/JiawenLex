import { createHash } from "node:crypto";

/** Ignore review edits and import batch boundaries when identifying an extracted question. */
export function sourceCandidateFingerprint(documentId: string, item: { physicalPage: number; printedPage: string; sectionTitle: string; contentKind: string; payload: Record<string, unknown> }) {
  const supplied = item.payload.candidate_fingerprint;
  if (typeof supplied === "string" && /^[a-f0-9]{64}$/i.test(supplied)) return supplied.toLowerCase();
  const prompt = typeof item.payload.prompt === "string" ? item.payload.prompt.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") : "";
  const identity = item.contentKind === "question" && prompt
    ? [documentId, item.physicalPage, item.contentKind, prompt]
    : [documentId, item.physicalPage, item.printedPage, item.sectionTitle, item.contentKind, item.payload];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
