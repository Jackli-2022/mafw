import { ToolHandler } from "../../types";

export const handleDesktopClick: ToolHandler = async (args, { desktop }) => {
  try {
    if (!desktop) return { content: [{ type: "text", text: JSON.stringify({ error: "Desktop not connected" }) }], isError: true };
    const selector = args.selector as string;
    if (!selector) return { content: [{ type: "text", text: JSON.stringify({ error: "selector is required" }) }], isError: true };
    const result = await desktop.click(selector);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
