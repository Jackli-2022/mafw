export interface HandoffContext {
  from: string;
  to: string;
  goalId: string;
  context?: any;
  projectDir?: string;
}

export async function handoffHook(ctx: HandoffContext): Promise<void> {

  if (ctx.context) {
  }
}
