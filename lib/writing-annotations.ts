export interface AnnotationRange { start: number; end: number; note: number }
export interface AnnotatedSegment { text: string; notes: number[] }

/** Locate only quotes actually present in the answer; tolerate whitespace changes. */
export function locateAnnotations(body: string, annotations: { quote: string }[]): AnnotationRange[] {
  const ranges: AnnotationRange[] = [];
  annotations.forEach(({ quote }, note) => {
    const trimmed = quote.trim();
    if (!trimmed) return;
    const escaped = trimmed.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    const pattern = new RegExp(escaped, "g");
    for (const match of body.matchAll(pattern)) {
      ranges.push({ start: match.index, end: match.index + match[0].length, note });
    }
  });
  return ranges.sort((a, b) => a.start - b.start || a.note - b.note);
}

/** Segment at every boundary so overlapping notes never duplicate or lose text. */
export function annotationSegments(body: string, ranges: AnnotationRange[]): AnnotatedSegment[] {
  const boundaries = [...new Set([0, body.length, ...ranges.flatMap((range) => [range.start, range.end])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    return { text: body.slice(start, end), notes: [...new Set(ranges.filter((range) => range.start <= start && range.end >= end).map((range) => range.note))] };
  });
}
