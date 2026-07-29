export interface SessionCompactingContext {
  sessionID: string;
  projectDir?: string;
}

export async function sessionCompactingHook(ctx: SessionCompactingContext): Promise<void> {
}
