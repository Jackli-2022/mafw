import * as fs from 'fs';
import * as path from 'path';
import { ToolHandler } from '../../types';

export const handleManagerListGoals: ToolHandler = async (_args, services) => {
  try {
    const mafwDir = services.mafwDir ?? (process.env.MAFW_PROJECT_DIR ? path.join(process.env.MAFW_PROJECT_DIR, '.mafw') : undefined) ?? path.join(process.cwd(), '.mafw');
    const stateDir = path.join(mafwDir, 'state');
    if (!fs.existsSync(stateDir)) return { content: [{ type: 'text', text: JSON.stringify({ success: true, goals: [] }) }] };
    const goals = fs.readdirSync(stateDir).filter(f => f.endsWith('.json')).map(f => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf-8'));
        return { goalId: s.goalId || f.replace('.json', ''), phase: s.phase, round: s.round, verdict: s.reviewVerdict, updatedAt: s.updatedAt };
      } catch { return null; }
    }).filter(Boolean);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, goals }) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
