import { ToolHandler } from "../../types";

export const handleBtw: ToolHandler = async (args, { btwAsk }) => {
  try {
    const question = typeof args.question === 'string' ? args.question.trim() : '';
    if (!question) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "question is required" }) }], isError: true };
    }
    if (!btwAsk) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "btw not available" }) }], isError: true };
    }
    const { answer } = await btwAsk(question);
    return { content: [{ type: "text", text: answer }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
