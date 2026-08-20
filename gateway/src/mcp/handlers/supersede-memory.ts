import * as path from "path";
import { config } from "../../config";
import { ToolHandler } from "../../types";

/**
 * Mark one or more existing memories as superseded. Use this when a new fact
 * contradicts or replaces an old memory but you don't need to write a new
 * entry (e.g., the user explicitly retracts a preference). For the common
 * case of "new memory replaces old", use mafw_add_memory with the supersedes
 * field instead.
 */
export const handleSupersedeMemory: ToolHandler = async (args, { memory, mafwDir }) => {
  try {
    const ids = args.ids as string[];
    const reason = (args.reason as string) || 'superseded by agent';

    if (!Array.isArray(ids) || ids.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: 'ids must be a non-empty array' }) }], isError: true };
    }

    const resolvedDir = mafwDir ?? config.resolvePath();

    const { HarmonicUnitFileStore } = await import("../../memory/harmonic-file-store.js");
    const sharedIndex = (memory as any)?.harmonicIndex;
    const sharedGraph = (memory as any)?.harmonicIndex?.getAnchorGraphStore?.()
      ?? (memory as any)?.getAnchorGraphStore?.() ?? undefined;
    const store = sharedIndex
      ? new HarmonicUnitFileStore(resolvedDir, sharedIndex, sharedGraph)
      : new HarmonicUnitFileStore(resolvedDir, undefined, sharedGraph);

    // Use a synthetic "by" id to mark the supersession source. This is a
    // tombstone marker — the old entries are kept but demoted in search.
    const byId = `__agent_supersede__${Date.now()}`;
    const supersededIds: string[] = [];
    for (const id of ids) {
      if (store.markSuperseded(id, byId)) {
        supersededIds.push(id);
      }
    }

    return { content: [{ type: "text", text: JSON.stringify({
      success: true,
      superseded: supersededIds,
      skipped: ids.filter(id => !supersededIds.includes(id)),
      reason,
    }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
