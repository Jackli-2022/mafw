import { ToolHandler } from "../../types";

export const handleGetModelRoute: ToolHandler = async (args, { cost }) => {
  try {
    const agentType = args.agentType as "plan" | "execute" | "review";
    const remainingBudget = args.remainingBudget as number;
    const totalBudget = args.totalBudget as number;
    const selection = cost.getModelRoute(agentType, remainingBudget, totalBudget);
    return { content: [{ type: "text", text: JSON.stringify(selection) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
