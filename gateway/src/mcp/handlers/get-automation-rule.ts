import { ToolHandler } from "../../types";

export const handleGetAutomationRule: ToolHandler = async (args, { automation, ledger }) => {
  try {
    const id = args.id as string;
    const rule = automation?.getRule(id);
    if (!rule) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Rule not found: ${id}` }) }], isError: true };
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ...rule,
          nextTriggers: automation?.getNextTriggers(rule).next5 || [],
          history: ledger?.getHistory(id, 10) || [],
        }),
      }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
