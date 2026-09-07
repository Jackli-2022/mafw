import * as fs from "fs";
import * as path from "path";
import { config } from "../../config";
import { ToolHandler } from "../../types";
import { generateHarmonicId } from "../../core/memory/harmonic-types";
import { calculateSalience, importanceToSalience } from "../../core/memory/salience-perceptor";

export const handleAddMemory: ToolHandler = async (args, { memory, mafwDir }) => {
  try {
    const content = args.content as string;
    const memoryType = (args.memoryType as string) || config.memory.defaultMemoryType;
    const cueAnchors = (args.cueAnchors as string[]) || [];
    const primaryAbstraction = (args.primaryAbstraction as string) || content.slice(0, config.memory.defaultPrimaryAbstractionLength);
    const supersedes = (args.supersedes as string[]) || [];
    const sticky = args.sticky === true;
    const stickyDays = typeof args.stickyDays === 'number' && args.stickyDays > 0 ? args.stickyDays : 7;

    if (!["episodic", "semantic", "procedural", "global"].includes(memoryType)) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Invalid memoryType: ${memoryType}` }) }], isError: true };
    }

    const resolvedDir = mafwDir ?? config.resolvePath();

    const memoryDir = path.join(resolvedDir, "memory");
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    const now = new Date().toISOString();
    const unitId = generateHarmonicId();

    const memCfg = config.memory;
    const importance = (args.importance as number | undefined);
    const salience = importance !== undefined
      ? importanceToSalience(importance)
      : calculateSalience(content);
    const unit = {
      id: unitId,
      type: memoryType,
      primary_abstraction: primaryAbstraction.slice(0, memCfg.abstractionMaxLength),
      cue_anchors: cueAnchors.slice(0, memCfg.maxCueAnchors),
      memory_value: content,
      energy: memCfg.defaultEnergy,
      salience,
      abstraction_level: memoryType === "global" ? 3 : memoryType === "episodic" ? 1 : 2,
      created_at: now,
      updated_at: now,
      // Sticky note board: guaranteed per-turn visibility until the date
      // passes; expiry only removes it from the board, never deletes the memory.
      ...(sticky ? { sticky_until: new Date(Date.now() + stickyDays * 86400e3).toISOString() } : {}),
    };

    const { HarmonicUnitFileStore } = await import("../../memory/harmonic-file-store.js");
    // Share the in-memory index with the rest of the gateway so that memories
    // written via MCP are immediately visible to recall, step-injection, and
    // subsequent searches without requiring a restart.
    const sharedIndex = (memory as any)?.harmonicIndex;
    const sharedGraph = (memory as any)?.harmonicIndex?.getAnchorGraphStore?.()
      ?? (memory as any)?.getAnchorGraphStore?.() ?? undefined;
    const store = sharedIndex
      ? new HarmonicUnitFileStore(resolvedDir, sharedIndex, sharedGraph)
      : new HarmonicUnitFileStore(resolvedDir, undefined, sharedGraph);

    // Mark superseded memories before writing the new one. This establishes
    // the supersede link: old entries get energy halved + search penalty,
    // new entry becomes the authoritative version.
    const supersededIds: string[] = [];
    for (const oldId of supersedes) {
      if (store.markSuperseded(oldId, unitId)) {
        supersededIds.push(oldId);
      }
    }

    await store.write(unit as any);

    return { content: [{ type: "text", text: JSON.stringify({
      success: true,
      id: unitId,
      tier: 'memories',
      sticky_until: (unit as any).sticky_until,
      superseded: supersededIds.length > 0 ? supersededIds : undefined,
    }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
