import { ToolHandler } from "../../types";

export const handleRunAutomation: ToolHandler = async (args, { automation, ledger }) => {
  try {
    const ruleId = args.rule_id as string;
    if (!automation) throw new Error('Automation engine not available');
    if (!ledger) throw new Error('Ledger not available');

    const result = await automation.runRuleFromLLM(ruleId, ledger);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: 'executed',
          triage_id: result.triageId,
          message: result.message,
          note: 'auto_confirm was forced to false — result is PENDING_CONFIRMATION',
        }),
      }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
