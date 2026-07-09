import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";
import { eventBus } from "../../event-bus";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleUpdateState: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const patch = args.patch as Record<string, unknown>;
    const mafwDir = path.join(projectDir, ".mafw");
    const statePath = path.join(mafwDir, "state", `${goalId}.json`);
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    const updated = { ...state, ...patch, updatedAt: new Date().toISOString() };
    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
    fs.renameSync(tmpPath, statePath);
    eventBus.emit("state_change", { type: "state_change", goalId, patch, projectDir });
    return { content: [{ type: "text", text: JSON.stringify(updated) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
