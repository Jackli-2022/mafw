import * as fs from 'fs';
import * as path from 'path';
import { ToolHandler } from '../../types';

export const handleManagerListPendingQuestions: ToolHandler = async () => {
  try {
    const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
    const mafwDir = path.join(projectDir, '.mafw');
    const ledgerPath = path.join(mafwDir, 'question-ledger.jsonl');
    if (!fs.existsSync(ledgerPath)) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, questions: [] }) }] };
    }
    const lines = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n');
    const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const lastByQid = new Map<string, any>();
    for (const e of events) lastByQid.set(e.questionId, e);
    const askedEvents = events.filter((e: any) => e.type === 'asked');
    const pending = askedEvents.filter((e: any) => {
      const last = lastByQid.get(e.questionId);
      return last && last.type === 'asked';
    }).map((e: any) => ({ questionId: e.questionId, goalId: e.goalId, node: e.node, loop: e.loop, questions: e.questions, askedAt: e.askedAt }));
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, questions: pending }) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
