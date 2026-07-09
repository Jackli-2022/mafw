import * as fs from 'fs';
import * as path from 'path';

const QUESTIONS_DIR = '.mafw/user-questions';

export interface AskUserInput {
  question: string;
  options?: string[];
  priority: 'normal' | 'high';
  goalId: string;
  loopNum: number;
}

export interface AskUserOutput {
  success: boolean;
  questionId: string;
  questionPath: string;
}

export async function askUser(input: AskUserInput): Promise<AskUserOutput> {
  const dir = path.join(process.cwd(), QUESTIONS_DIR, input.goalId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const questionId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const questionPath = path.join(dir, `${questionId}.json`);
  const data = { questionId, ...input, timestamp: new Date().toISOString(), answered: false, answer: null };
  fs.writeFileSync(questionPath, JSON.stringify(data, null, 2), 'utf-8');
  return { success: true, questionId, questionPath };
}

export function getUnansweredQuestions(goalId: string): any[] {
  const dir = path.join(process.cwd(), QUESTIONS_DIR, goalId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    return { ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')), filePath: path.join(dir, f) };
  }).filter(q => q.answered === false);
}

export function recordAnswer(questionId: string, answer: string): boolean {
  const baseDir = path.join(process.cwd(), QUESTIONS_DIR);
  if (!fs.existsSync(baseDir)) return false;
  const goals = fs.readdirSync(baseDir);
  for (const goal of goals) {
    const p = path.join(baseDir, goal, `${questionId}.json`);
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      data.answered = true;
      data.answer = answer;
      data.answeredAt = new Date().toISOString();
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    }
  }
  return false;
}
