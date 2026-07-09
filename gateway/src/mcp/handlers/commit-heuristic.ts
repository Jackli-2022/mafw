import { ToolHandler } from "../../types";

export const handleCommitHeuristic: ToolHandler = async (args, { memory }) => {
  try {
    const pattern = args.pattern as string;
    const triggerContext = args.triggerContext as string[] || [];
    const sourceGoalIds = args.sourceGoalIds as string[] || [];
    if (!pattern) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "pattern is required" }) }], isError: true };
    }
    const heuristic = memory.l5.addHeuristic(pattern, triggerContext, sourceGoalIds);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, id: heuristic.id, energy: heuristic.energy }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
