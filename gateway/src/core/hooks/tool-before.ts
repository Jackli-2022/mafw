export interface ToolBeforeContext {
  tool: string;
  sessionID: string;
  callID?: string;
  args?: any;
}

export async function toolBeforeHook(ctx: ToolBeforeContext): Promise<{ args?: any } | void> {
}
