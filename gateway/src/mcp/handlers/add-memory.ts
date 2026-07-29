import * as fs from "fs";
import * as path from "path";
import { config } from "../../config";
import { ToolHandler } from "../../types";
import { generateHarmonicId } from "../../core/memory/harmonic-types";
import { calculateSalience } from "../../core/memory/salience-perceptor";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleAddMemory: ToolHandler = async (args, { memory }) => {
  try {
    const content = args.content as string;
    const memoryType = (args.memoryType as string) || config.memory.defaultMemoryType;
    const cueAnchors = (args.cueAnchors as string[]) || [];
    const primaryAbstraction = (args.primaryAbstraction as string) || content.slice(0, config.memory.defaultPrimaryAbstractionLength);

    if (!["episodic", "semantic", "procedural", "global"].includes(memoryType)) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Invalid memoryType: ${memoryType}` }) }], isError: true };
    }

    const mafwDir = path.join(projectDir, config.paths.mafwDir);

    const memoryDir = path.join(mafwDir, "memory");
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    const now = new Date().toISOString();
    const unitId = generateHarmonicId();

    const memCfg = config.memory;
    const unit = {
      id: unitId,
      type: memoryType,
      primary_abstraction: primaryAbstraction.slice(0, memCfg.abstractionMaxLength),
      cue_anchors: cueAnchors.slice(0, memCfg.maxCueAnchors),
      memory_value: content,
      energy: memCfg.defaultEnergy,
      salience: calculateSalience(content),
      abstraction_level: memoryType === "procedural" ? 3 : memoryType === "global" ? 4 : 2,
      created_at: now,
      updated_at: now,
    };

    const { HarmonicUnitFileStore } = await import("../../memory/harmonic-file-store.js");
    const store = new HarmonicUnitFileStore(mafwDir);
    await store.write(unit as any);

    return { content: [{ type: "text", text: JSON.stringify({ success: true, id: unitId, tier: 'memories' }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
