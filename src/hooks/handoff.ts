export interface HandoffContext {
  from: string;
  to: string;
  goalId: string;
  context?: any;
  projectDir?: string;
}

export async function handoffHook(ctx: HandoffContext): Promise<void> {
  console.log(`[hook:session.handoff] ${ctx.from} → ${ctx.to} (goal: ${ctx.goalId})`);

  if (ctx.context) {
    console.log(`[hook:session.handoff] Transferring context: ${JSON.stringify(ctx.context).substring(0, 200)}`);
  }
}
