import * as fs from 'fs';
import * as path from 'path';

const FEEDBACK_DIR = '.mafw/user-feedback';

export interface FeedbackInput {
  targetId: string;
  type: 'thumbs_up' | 'thumbs_down' | 'correction';
  comment?: string;
  goalId: string;
  loopNum: number;
}

export interface FeedbackOutput {
  success: boolean;
  feedbackId: string;
  energyDelta: number;
  comment?: string;
}

export const ENERGY_DELTAS: Record<string, number> = {
  thumbs_up: 0.2,
  thumbs_down: -0.1,
  correction: 0.0
};

export async function recordFeedback(input: FeedbackInput): Promise<FeedbackOutput> {
  const dir = path.join(process.cwd(), FEEDBACK_DIR, input.goalId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const energyDelta = ENERGY_DELTAS[input.type] || 0;
  const data = { feedbackId, ...input, energyDelta, timestamp: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, `${feedbackId}.json`), JSON.stringify(data, null, 2), 'utf-8');
  return { success: true, feedbackId, energyDelta, comment: input.comment };
}
