// Share work only within the same login generation. An old completion must
// never release a newer login's request or block a quick re-login.
export function createSessionRequestQueue() {
  let current: { ownerId: string; generation: number; promise: Promise<void> } | null = null;
  return {
    reset() { current = null; },
    run(ownerId: string, generation: number, work: () => Promise<void>): Promise<void> {
      if (current?.ownerId === ownerId && current.generation === generation) return current.promise;
      const entry = { ownerId, generation, promise: Promise.resolve() };
      entry.promise = Promise.resolve().then(work).finally(() => {
        if (current === entry) current = null;
      });
      current = entry;
      return entry.promise;
    },
  };
}

export function mergeConfirmedRows<T extends { id: string; owner_id: string }>(rows: T[], confirmations: Map<string, T>, ownerId: string): T[] {
  const accepted = new Map([...confirmations].filter(([, row]) => row.owner_id === ownerId));
  const result = rows.map(row => accepted.get(row.id) ?? row);
  const ids = new Set(rows.map(row => row.id));
  for (const row of accepted.values()) if (!ids.has(row.id)) result.push(row);
  return result;
}
