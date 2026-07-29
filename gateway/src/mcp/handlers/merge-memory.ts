import * as fs from "fs";
import * as path from "path";
import { config } from "../../config";
import { ToolHandler } from "../../types";
import { HarmonicUnitFileStore } from "../../memory/harmonic-file-store.js";
import { MinHashMerger } from "../../core/memory/minhash-merger";
import { generateHarmonicId } from "../../core/memory/harmonic-types";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

type ResolveStrategy = "manual" | "higher_energy" | "newer";

export const handleMergeMemory: ToolHandler = async (args, { memory }) => {
  try {
    const sourceWorktree = args.sourceWorktree as string;
    const resolveStrategy = (args.resolveStrategy as ResolveStrategy) || "manual";

    if (!sourceWorktree) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "sourceWorktree is required" }) }], isError: true };
    }

    const targetMafwDir = path.join(projectDir, config.paths.mafwDir);
    const sourceMafwDir = path.join(sourceWorktree, config.paths.mafwDir);

    const targetStore = new HarmonicUnitFileStore(targetMafwDir);
    const targetIndex = targetStore.indexManager_().getIndex();
    const targetUnits: any[] = [];
    for (const entry of targetIndex.entries) {
      const unit = await targetStore.read(entry.id);
      if (unit) targetUnits.push(unit);
    }

    let sourceUnits: any[] = [];
    try {
      const sourceStore = new HarmonicUnitFileStore(sourceMafwDir);
      const sourceIndex = sourceStore.indexManager_().getIndex();
      for (const entry of sourceIndex.entries) {
        const unit = await sourceStore.read(entry.id);
        if (unit) sourceUnits.push(unit);
      }
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `No memories found at ${sourceMafwDir}` }) }], isError: true };
    }

    const updatedIds: Set<string> = new Set();

    const minhash = new MinHashMerger();
    const added: any[] = [];
    const conflicts: any[] = [];
    const skipped: string[] = [];

    for (const srcUnit of sourceUnits) {
      const srcSig = minhash.generateSignature(srcUnit.primary_abstraction || "");
      let bestMatch: any = null;
      let bestSim = 0;

      for (const tgtUnit of targetUnits) {
        const tgtSig = minhash.generateSignature(tgtUnit.primary_abstraction || "");
        const sim = minhash.similarity(srcSig, tgtSig);
        if (sim > bestSim) {
          bestSim = sim;
          bestMatch = tgtUnit;
        }
      }

      if (bestSim > 0.6) {
        if (bestMatch.memory_value !== srcUnit.memory_value) {
          conflicts.push({
            source: { id: srcUnit.id, primary_abstraction: srcUnit.primary_abstraction, memory_value: srcUnit.memory_value, energy: srcUnit.energy },
            target: { id: bestMatch.id, primary_abstraction: bestMatch.primary_abstraction, memory_value: bestMatch.memory_value, energy: bestMatch.energy },
            similarity: bestSim,
          });

          if (resolveStrategy === "higher_energy") {
            if (srcUnit.energy > (bestMatch.energy || 0)) {
              bestMatch.memory_value = srcUnit.memory_value;
              bestMatch.energy = Math.max(bestMatch.energy || 0, srcUnit.energy);
              bestMatch.merged_from = [...(bestMatch.merged_from || []), srcUnit.id];
              bestMatch.updated_at = new Date().toISOString();
              updatedIds.add(bestMatch.id);
            }
          } else if (resolveStrategy === "newer") {
            if (new Date(srcUnit.updated_at || srcUnit.created_at) > new Date(bestMatch.updated_at || bestMatch.created_at)) {
              bestMatch.memory_value = srcUnit.memory_value;
              bestMatch.merged_from = [...(bestMatch.merged_from || []), srcUnit.id];
              bestMatch.updated_at = new Date().toISOString();
              updatedIds.add(bestMatch.id);
            }
          }
        } else {
          skipped.push(srcUnit.id);
        }
      } else {
        const now = new Date().toISOString();
        const newUnit = {
          id: generateHarmonicId(),
          type: srcUnit.type || "semantic",
          primary_abstraction: srcUnit.primary_abstraction,
          cue_anchors: srcUnit.cue_anchors || [],
          memory_value: srcUnit.memory_value,
          energy: 0.4,
          salience: srcUnit.salience || 1.0,
          merged_from: [srcUnit.id],
          created_at: now,
          updated_at: now,
        };

        targetUnits.push(newUnit);
        added.push(newUnit);
      }
    }

    if (added.length > 0 || conflicts.length > 0) {
      for (const unit of added) {
        await targetStore.write(unit);
      }

      for (const id of updatedIds) {
        const unit = targetUnits.find(u => u.id === id);
        if (unit) {
          targetStore.indexManager_().removeEntry(id);
          await targetStore.write(unit);
        }
      }

      // Append to fusion log
      const fusionLogPath = path.join(targetMafwDir, "fusion-log.jsonl");
      const logEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        source_worktree: sourceWorktree,
        added: added.map(u => ({ id: u.id, primary_abstraction: u.primary_abstraction })),
        conflicts: conflicts.map(c => ({
          primary_abstraction: c.source.primary_abstraction,
          source_value: c.source.memory_value,
          target_value: c.target.memory_value,
          similarity: c.similarity,
        })),
      });
      fs.appendFileSync(fusionLogPath, logEntry + "\n", "utf-8");
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          added: added.length,
          conflicts: conflicts.length,
          skipped: skipped.length,
          details: {
            added: added.map(u => ({ id: u.id, primary_abstraction: u.primary_abstraction, energy: u.energy })),
            conflicts: resolveStrategy === "manual" ? conflicts : [],
            strategy: resolveStrategy,
          },
        }),
      }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
