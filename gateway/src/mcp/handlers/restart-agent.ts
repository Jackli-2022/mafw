import { ToolHandler } from "../../types";

export const handleRestartAgent: ToolHandler = async (_args, { restartAgent }) => {
  try {
    if (!restartAgent) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Agent restart not available (runtime does not support agentProcessApi)" }) }],
        isError: true,
      };
    }
    const result = await restartAgent();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err: any) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      isError: true,
    };
  }
};
