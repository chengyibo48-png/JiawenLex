/** Refresh untouched settings without erasing edits still being made. */
export function mergeProfileDraft<T extends object>(draft: T, previous: T, next: T): T {
  const merged = { ...draft };
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (Object.is(draft[key], previous[key])) merged[key] = next[key];
  }
  return merged;
}
