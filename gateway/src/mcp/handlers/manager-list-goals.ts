import * as fs from 'fs';
import * as path from 'path';
import { ToolHandler } from '../../types';

export const handleManagerListGoals: ToolHandler = async () => {
  try {
    const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
    const mafwDir = path.join(projectDir, '.mafw');
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
