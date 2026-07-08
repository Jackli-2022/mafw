import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleLoadState: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const statePath = path.join(projectDir, ".opencode/mafw/state", `${goalId}.json`);
    if (!fs.existsSync(statePath)) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `State not found for ${goalId}` }) }], isError: true };
    }
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    return { content: [{ type: "text", text: JSON.stringify(state) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
