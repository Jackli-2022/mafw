import { ToolHandler } from "../../types";

export const handleProposeTriageDecision: ToolHandler = async (args, { automation, ledger }) => {
  try {
    if (!automation) throw new Error('Automation engine not available');

    const triageId = args.triage_id as string;
    const suggestion = args.suggestion as 'confirm' | 'reject';
    const reason = args.reason as string;
    const priority = (args.priority as string) || 'medium';

    if (!['confirm', 'reject'].includes(suggestion)) {
      throw new Error('suggestion must be "confirm" or "reject"');
    }

    const result = automation.proposeTriageDecision(triageId, suggestion, reason, priority);

    ledger?.append({
      timestamp: new Date().toISOString(),
      event: 'AUTOMATION_TRIGGERED',
      source: 'llm',
      reason: `proposed_${suggestion}_for_${triageId}`,
      details: { triageId, suggestion, priority, reasonLength: reason.length },
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: result.success ? 'suggestion_submitted' : 'error',
          message: result.message,
          note: 'Triage item remains PENDING_CONFIRMATION — user will review your suggestion',
        }),
      }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
