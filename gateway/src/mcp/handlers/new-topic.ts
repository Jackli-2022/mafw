import { ToolHandler } from "../../types";

export const handleNewTopic: ToolHandler = async (args, { rotateManagerSession }) => {
  try {
    if (!rotateManagerSession) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Manager rotate not available" }) }], isError: true };
    }
    const reason = typeof args.reason === 'string' ? args.reason : undefined;
    const result = await rotateManagerSession(reason);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, ...result, message: `New manager topic started: ${result.sessionId}` }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
