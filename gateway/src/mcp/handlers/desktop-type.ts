import { ToolHandler } from "../../types";

export const handleDesktopType: ToolHandler = async (args, { desktop }) => {
  try {
    if (!desktop) return { content: [{ type: "text", text: JSON.stringify({ error: "Desktop not connected" }) }], isError: true };
    const selector = args.selector as string;
    const text = args.text as string;
    if (!selector || text === undefined) return { content: [{ type: "text", text: JSON.stringify({ error: "selector and text are required" }) }], isError: true };
    const result = await desktop.type(selector, text);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
