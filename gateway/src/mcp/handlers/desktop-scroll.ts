import { ToolHandler } from "../../types";

export const handleDesktopScroll: ToolHandler = async (args, { desktop }) => {
  try {
    if (!desktop) return { content: [{ type: "text", text: JSON.stringify({ error: "Desktop not connected" }) }], isError: true };
    const direction = args.direction as string;
    const amount = args.amount as number | undefined;
    if (!direction) return { content: [{ type: "text", text: JSON.stringify({ error: "direction is required (up/down/left/right)" }) }], isError: true };
    const result = await desktop.scroll(direction as any, amount);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
