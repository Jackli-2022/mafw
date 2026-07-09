import * as fs from 'fs';
import * as path from 'path';

export interface SessionStartContext {
  sessionId: string;
  goalId?: string;
  projectDir?: string;
}

export async function sessionStartHook(ctx: SessionStartContext, options?: { mafwDir?: string }): Promise<void> {
  const projectDir = ctx.projectDir || process.cwd();
  const mafwDir = options?.mafwDir || path.join(projectDir, '.mafw');
  const goalDir = path.join(mafwDir, 'goals');

  console.log(`[hook:session-start] Session ${ctx.sessionId} started`);

  if (!fs.existsSync(goalDir)) return;

  const files = fs.readdirSync(goalDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) return;

  const latest = files.sort().reverse()[0];
  const goalPath = path.join(goalDir, latest);
  const goalContent = fs.readFileSync(goalPath, 'utf-8');

  console.log(`[hook:session-start] Loaded goal charter: ${latest} (${goalContent.length} chars)`);
}
