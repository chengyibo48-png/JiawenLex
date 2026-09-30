type Saved = { word_id: string; content_revision: number; kind: string; note: string; suggestion: Record<string, unknown> };
type Incoming = { wordId: string; revision: number; kind: string; note: string; suggestion: Record<string, unknown> };
export function sameWordReport(saved: Saved, incoming: Incoming): boolean {
  const fields = ["term", "definition", "example", "pronunciation", "pronunciation_uk", "pronunciation_us"];
  return saved.word_id === incoming.wordId && saved.content_revision === incoming.revision && saved.kind === incoming.kind && saved.note === incoming.note && fields.every(key => (saved.suggestion[key] ?? "") === (incoming.suggestion[key] ?? ""));
}
