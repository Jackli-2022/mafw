export interface LlmAfterContext {
  sessionID: string;
  messageID?: string;
  partID?: string;
  text?: string;
}

export async function llmAfterHook(ctx: LlmAfterContext): Promise<void> {
  if (!ctx.text) return;
}
