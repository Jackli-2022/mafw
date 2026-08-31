import { config } from "../../config";
import { ToolHandler } from "../../types";

export const handlePinMemory: ToolHandler = async (args, { memory, mafwDir }) => {
  try {
    const id = String(args.id || '');
    const pinned = args.pinned === true;

    if (!id) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: 'id required' }) }], isError: true };
    }

    const resolvedDir = mafwDir ?? config.resolvePath();

    const { HarmonicUnitFileStore } = await import("../../memory/harmonic-file-store.js");
    const sharedIndex = (memory as any)?.harmonicIndex;
    const sharedGraph = (memory as any)?.harmonicIndex?.getAnchorGraphStore?.()
      ?? (memory as any)?.getAnchorGraphStore?.() ?? undefined;
    const store = sharedIndex
      ? new HarmonicUnitFileStore(resolvedDir, sharedIndex, sharedGraph)
      : new HarmonicUnitFileStore(resolvedDir, undefined, sharedGraph);

    const ok = store.setPinned(id, pinned);
    if (!ok) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `memory not found: ${id}` }) }], isError: true };
    }

    return { content: [{ type: "text", text: JSON.stringify({ success: true, id, pinned }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
