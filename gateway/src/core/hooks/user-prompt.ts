export interface UserPromptContext {
  sessionID: string;
  messageID?: string;
  agent?: string;
  model?: string;
  text?: string;
}

export async function userPromptHook(ctx: UserPromptContext): Promise<void> {
  if (!ctx.text) return;
}
