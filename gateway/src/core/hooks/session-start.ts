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


  if (fs.existsSync(goalDir)) {
    const files = fs.readdirSync(goalDir).filter(f => f.endsWith('.md'));
    if (files.length > 0) {
      const latest = files.sort().reverse()[0];
      const goalPath = path.join(goalDir, latest);
      const goalContent = fs.readFileSync(goalPath, 'utf-8');
    }
  }
}
