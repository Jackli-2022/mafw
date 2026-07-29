import { ToolHandler } from "../../types";

export const handleListAutomationRules: ToolHandler = async (args, { automation, ledger }) => {
  try {
    const rules = automation?.getRules() || [];
    const enriched = rules.map(r => ({
      id: r.id,
      enabled: r.enabled,
      trigger: r.trigger,
      skill: r.skill || null,
      action: r.action || null,
      onResult: r.onResult || null,
      goal_defaults: r.goal_defaults || null,
      nextTriggers: automation?.getNextTriggers(r).next5 || [],
      recentHistory: ledger?.getHistory(r.id, 3) || [],
    }));
    return { content: [{ type: "text", text: JSON.stringify({ rules: enriched, count: enriched.length }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
