import { ToolHandler } from "../../types";
import type { AutomationRule } from "../../automation-engine";

export const handleValidateRule: ToolHandler = async (args, { automation }) => {
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

    const result = automation.validateRule(rule);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          valid: result.valid,
          errors: result.errors,
          nextTriggers: result.nextTriggers,
          note: result.valid ? 'Rule is valid — nothing was saved' : 'Rule has errors — see errors array',
        }),
      }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
