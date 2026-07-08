export interface SessionCompactingContext {
  sessionID: string;
  projectDir?: string;
}

export async function sessionCompactingHook(ctx: SessionCompactingContext): Promise<void> {
  console.log(`[hook:session.compacting] Session ${ctx.sessionID} — preserving high-energy context`);
}
