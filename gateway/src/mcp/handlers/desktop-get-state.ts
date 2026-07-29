import { ToolHandler } from "../../types";

export const handleDesktopGetState: ToolHandler = async (args, { desktop }) => {
  try {
    if (!desktop) return { content: [{ type: "text", text: JSON.stringify({ error: "Desktop not connected" }) }], isError: true };
    const result = await desktop.uiState();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
