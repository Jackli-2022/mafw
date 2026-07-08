import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleGetDeltas: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const agentType = args.agentType as string;
    const loopNum = (args.loopNum as number) || 1;

    const parametricDir = path.join(projectDir, ".opencode/mafw/parametric");
    const deltas: any[] = [];

    if (fs.existsSync(parametricDir)) {
      const files = fs.readdirSync(parametricDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(parametricDir, file), "utf-8");
          const yaml = await import("js-yaml");
          const doc = yaml.load(content) as any;
          if (doc && doc.scope && doc.scope.includes(agentType)) {
            deltas.push({ ...doc, sourceFile: file });
          }
        } catch { /* skip malformed */ }
      }
    }

    const manifestPath = path.join(parametricDir, "manifest.json");
    const manifest: any = {};
    if (fs.existsSync(manifestPath)) {
      try { Object.assign(manifest, JSON.parse(fs.readFileSync(manifestPath, "utf-8"))); } catch {}
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ goalId, agentType, loopNum, deltas, manifest }) }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
