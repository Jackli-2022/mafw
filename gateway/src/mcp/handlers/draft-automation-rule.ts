import { ToolHandler } from "../../types";
import type { AutomationRule } from "../../automation-engine";

export const handleDraftAutomationRule: ToolHandler = async (args, { automation }) => {
  try {
    if (!automation) throw new Error('Automation engine not available');

    const trigger = (args.trigger as any) || {};
    const rule: AutomationRule = {
      id: args.id as string,
      enabled: false,
      trigger: {
        type: 'cron',
        schedule: (trigger.schedule as string) || '',
        timezone: trigger.timezone || 'UTC',
      },
      skill: args.skill as string | undefined,
      action: args.action as any,
      onResult: args.onResult as any,
      goal_defaults: args.goal_defaults as any,
    };

    if (args.args) {
      rule.args = args.args as Record<string, any>;
    }

    const result = automation.draftRule(rule);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          id: result.id,
          valid: result.valid,
          errors: result.errors,
          enabled: false,
          message: result.valid
            ? `Rule "${result.id}" saved as draft (disabled). User must enable it manually.`
            : `Rule "${result.id}" has validation errors — see errors array`,
        }),
      }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
