import type { SupabaseClient } from "@supabase/supabase-js";
import { clearLocalDraft, localDraftIds, readLocalDraft } from "./offline-drafts";

const running = new Set<string>();
export async function syncPendingDrafts(client: SupabaseClient, userId: string, activeMaterial: () => string | null): Promise<boolean> {
  if (running.has(userId) || !navigator.onLine) return false;
  running.add(userId);
  let changed = false;
  try {
    const { data } = await client.auth.getSession();
    if (!data.session) return false;
    for (const id of await localDraftIds(userId)) {
      if (id === activeMaterial()) continue;
      const draft = await readLocalDraft(userId, id);
      // Legacy drafts have no trustworthy base version: restore them through the conflict UI.
      if (!draft || draft.version === null || id === activeMaterial()) continue;
      const response = await fetch("/api/drafts", {
        method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ materialId: id, body: draft.body, version: draft.version }),
      });
      if (response.ok) { await clearLocalDraft(userId, id, draft.revision); changed = true; }
      // Conflicts remain encrypted locally; other requests can still be synchronized.
      if (response.status === 401 || response.status === 403) break;
    }
  } catch { /* Leave all failed drafts locally for a later retry. */ }
  finally { running.delete(userId); }
  return changed;
}
