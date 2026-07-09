import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";
import { generateHarmonicId } from "../../../../src/memory/harmonic-types";
import { calculateSalience } from "../../../../src/memory/salience-perceptor";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleAddMemory: ToolHandler = async (args, { memory }) => {
  try {
    const content = args.content as string;
    const memoryType = (args.memoryType as string) || "semantic";
    const cueAnchors = (args.cueAnchors as string[]) || [];
    const primaryAbstraction = (args.primaryAbstraction as string) || content.slice(0, 80);

    if (!["episodic", "semantic", "procedural", "global"].includes(memoryType)) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Invalid memoryType: ${memoryType}` }) }], isError: true };
    }

    const mafwDir = path.join(projectDir, ".mafw");
    const tier =
      memoryType === "procedural" ? "tier4"
      : memoryType === "episodic" ? "tier2"
      : memoryType === "global" ? "tier1"
      : "tier3";

    const memoryDir = path.join(mafwDir, "memory");
    const filePath = path.join(memoryDir, `${tier}.json`);

    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    const existing: any[] = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, "utf-8"))
      : [];

    const now = new Date().toISOString();
    const unitId = generateHarmonicId();

    const unit = {
      id: unitId,
      memory_type: memoryType,
      primary_abstraction: primaryAbstraction.slice(0, 200),
      cue_anchors: cueAnchors.slice(0, 8),
      memory_value: content,
      energy: 0.8,
      salience: calculateSalience(content),
      abstraction_level: memoryType === "procedural" ? 3 : memoryType === "global" ? 4 : 2,
      created_at: now,
      updated_at: now,
    };

    existing.push(unit);
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);

    memory.harmonicIndex.addEntry(unit as any, tier);

    return { content: [{ type: "text", text: JSON.stringify({ success: true, id: unitId, tier, filePath }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
