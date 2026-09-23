import * as fs from "fs";
import * as path from "path";
import { config } from "../../config";
import { ToolHandler } from "../../types";
import { generateHarmonicId } from "../../core/memory/harmonic-types";
import { abstractionLevelFor } from "../../core/memory/abstraction-level";
import { judgeSalience } from "../../judge/salience";
import { schemaFastPath } from "../../judge/schema";
import { getEmbeddingRuntime } from "../../memory/embedding-runtime";
import { getRouteWriteDeps, routeAndWrite } from "../../memory/route-write";
import { importanceToSalience } from "../../core/memory/salience-perceptor";

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
    const sharedIndex = (memory as any)?.harmonicIndex;
    // Tier 0 salience judgment: integrate novelty (embedding distance to the
    // nearest existing memory) with the regex emotional signal — brain's
    // neuromodulator scalar integration, not an LLM. Fail-open.
    let novelty: number | undefined;
    let nearestSemanticCosine = 0;
    try {
      const rt = getEmbeddingRuntime();
      if (rt) {
        const [v] = await rt.provider.embed([content], 'document');
        if (v) {
          const hits = rt.vectors.searchByCosine(v, 5);
          novelty = hits.length > 0 ? 1 - hits[0].cosine : 1;
          for (const h of hits) {
            const e = sharedIndex?.getIndex().entries.find((x: any) => x.id === h.id);
            if (e && e.type === 'semantic') { nearestSemanticCosine = h.cosine; break; }
          }
        }
      }
    } catch { /* fail-open */ }
    const salience = importance !== undefined
      ? importanceToSalience(importance)
      : judgeSalience({ text: content, novelty }).score;
    const energy = schemaFastPath({ nearestSemanticCosine, type: memoryType }).energy;
    const unit = {
      id: unitId,
      type: memoryType,
      primary_abstraction: primaryAbstraction.slice(0, memCfg.abstractionMaxLength),
      cue_anchors: cueAnchors.slice(0, memCfg.maxCueAnchors),
      memory_value: content,
      energy,
      salience,
      abstraction_level: abstractionLevelFor(memoryType),
      created_at: now,
      updated_at: now,
      // Sticky note board: guaranteed per-turn visibility until the date
      // passes; expiry only removes it from the board, never deletes the memory.
      ...(sticky ? { sticky_until: new Date(Date.now() + stickyDays * 86400e3).toISOString() } : {}),
    };

    const { HarmonicUnitFileStore } = await import("../../memory/harmonic-file-store.js");
    // Share the in-memory index with the rest of the gateway so that memories
    // written via MCP are immediately visible to recall and subsequent
    // searches without requiring a restart.
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

    // S1 write-time routing: when the embedding runtime + judge are wired,
    // decide skip (duplicate → non-write) / update (integrate) / create before
    // persisting. Absent deps → fall through to the plain write (rollback-safe).
    const routeDeps = getRouteWriteDeps();
    if (routeDeps) {
      const routed = await routeAndWrite(unit as any, store as any, routeDeps);
      return { content: [{ type: "text", text: JSON.stringify({
        success: true,
        id: routed.id,
        tier: 'memories',
        deduped: routed.action === 'skip' ? true : undefined,
        updated: routed.action === 'update' ? routed.targetId : undefined,
        sticky_until: routed.action === 'create' ? (unit as any).sticky_until : undefined,
        superseded: supersededIds.length > 0 ? supersededIds : undefined,
      }) }] };
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
