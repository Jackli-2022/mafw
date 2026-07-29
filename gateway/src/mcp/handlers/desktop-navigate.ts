import { ToolHandler } from "../../types";

export const handleDesktopNavigate: ToolHandler = async (args, { desktop }) => {
  try {
    if (!desktop) return { content: [{ type: "text", text: JSON.stringify({ error: "Desktop not connected" }) }], isError: true };
    const tab = args.tab as string;
    if (!tab) return { content: [{ type: "text", text: JSON.stringify({ error: "tab is required" }) }], isError: true };
    const result = await desktop.navigate(tab);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
