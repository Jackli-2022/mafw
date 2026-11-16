import * as path from "path";
import { ToolHandler } from "../../types";
import { eventBus } from "../../event-bus";
import { writeGoalState } from "../../core/goal/state-v3";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleUpdateState: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const patch = args.patch as Record<string, unknown>;
    const mafwDir = path.join(projectDir, ".mafw");
    // SQLite authority + JSON mirror (Phase 2).
    const updated = writeGoalState(mafwDir, goalId, patch as any);
    eventBus.emit("state_change", { type: "state_change", goalId, patch, projectDir });
    return { content: [{ type: "text", text: JSON.stringify(updated) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
