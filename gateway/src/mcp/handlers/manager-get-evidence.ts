import * as fs from 'fs';
import * as path from 'path';
import { ToolHandler } from '../../types';

export const handleManagerGetEvidence: ToolHandler = async (args, services) => {
  try {
    const goalId = args.goalId as string;
    const mafwDir = services.mafwDir ?? (process.env.MAFW_PROJECT_DIR ? path.join(process.env.MAFW_PROJECT_DIR, '.mafw') : undefined) ?? path.join(process.cwd(), '.mafw');
    const reviewsDir = path.join(mafwDir, 'reviews');
    const files = fs.existsSync(reviewsDir)
      ? fs.readdirSync(reviewsDir).filter(f => f.startsWith(goalId)).sort().reverse()
      : [];
    if (files.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, goalId, evidence: null, message: 'No review reports found' }) }] };
    }
    const latest = fs.readFileSync(path.join(reviewsDir, files[0]), 'utf-8');
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, goalId, file: files[0], content: latest.slice(0, 2000) }) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
