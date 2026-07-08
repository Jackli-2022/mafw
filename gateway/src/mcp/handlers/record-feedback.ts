import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";
import { eventBus } from "../../event-bus";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleRecordFeedback: ToolHandler = async (args) => {
  try {
    const targetId = args.targetId as string;
    const type = args.type as "thumbs_up" | "thumbs_down" | "correction";
    const goalId = args.goalId as string;
    const loopNum = args.loopNum as number;
    const comment = args.comment as string | undefined;

    const feedback = { targetId, type, goalId, loopNum, comment, createdAt: new Date().toISOString() };

    const feedbackDir = path.join(projectDir, ".opencode/mafw/feedback");
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(
      path.join(feedbackDir, `${targetId}-${Date.now()}.json`),
      JSON.stringify(feedback, null, 2),
      "utf-8"
    );

    eventBus.emit("user_feedback", { type: "user_feedback", goalId, targetId, feedbackType: type });

    return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
