import { ToolHandler } from "../../types";

export const handleListTriageItems: ToolHandler = async (args, { automation }) => {
  try {
    const status = (args.status as string) || 'PENDING_CONFIRMATION';
    const items = automation?.getTriageItems(status) || [];
    return { content: [{ type: "text", text: JSON.stringify({ items, count: items.length }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
