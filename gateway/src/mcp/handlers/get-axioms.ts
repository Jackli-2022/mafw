import { ToolHandler } from "../../types";

export const handleGetAxioms: ToolHandler = async (args, { memory }) => {
  try {
    const topK = (args.topK as number) || 10;
    const result = memory.l5.getTop(topK);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, axioms: result.axioms, heuristics: result.heuristics }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
