import { ToolHandler } from "../../types";

export const handleGetTriageItem: ToolHandler = async (args, { automation }) => {
  try {
    const triageId = args.triage_id as string;
    const item = automation?.getTriageItem(triageId);
    if (!item) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Triage item not found: ${triageId}` }) }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(item) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
