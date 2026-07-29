import { ToolHandler } from "../../types";

export const handleGetAutomationHistory: ToolHandler = async (args, { ledger }) => {
  try {
    const ruleId = (args.rule_id as string) || undefined;
    const limit = (args.limit as number) || 20;
    const history = ledger?.getHistory(ruleId, limit) || [];
    return { content: [{ type: "text", text: JSON.stringify({ history, count: history.length }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
