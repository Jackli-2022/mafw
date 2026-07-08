export interface ToolBeforeContext {
  tool: string;
  sessionID: string;
  callID?: string;
  args?: any;
}

export async function toolBeforeHook(ctx: ToolBeforeContext): Promise<{ args?: any } | void> {
  console.log(`[hook:tool.before] Tool ${ctx.tool} (session: ${ctx.sessionID})`);
}
