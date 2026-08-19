import * as fs from "fs";
import * as path from "path";
import { config } from "../../config";
import { ToolHandler } from "../../types";
import { eventBus } from "../../event-bus";

export const handleAskUser: ToolHandler = async (args) => {
  try {
    const question = args.question as string;
    const goalId = args.goalId as string;
    const loopNum = args.loopNum as number;
    const options = args.options as string[] | undefined;
    const priority = (args.priority as string) || "normal";

    const questionDir = path.join(config.resolvePath(), "user-questions");
    fs.mkdirSync(questionDir, { recursive: true });

    const questionId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const questionFile = {
      id: questionId, goalId, loopNum, question, options, priority,
      status: "pending", createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(questionDir, `${questionId}.json`),
      JSON.stringify(questionFile, null, 2),
      "utf-8"
    );

    eventBus.emit("user_question", { type: "user_question", goalId, questionId });

    return { content: [{ type: "text", text: JSON.stringify({ success: true, questionId, status: "pending" }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
