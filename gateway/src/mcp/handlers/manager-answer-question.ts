import { ToolHandler } from '../../types';
import * as http from 'http';

export const handleManagerAnswerQuestion: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const questionId = args.questionId as string;
    const answer = args.answer as string;
    const action = (args.action as string) || 'answer';

    const port = parseInt(process.env.MAFW_SERVER_API_PORT || '3000', 10);
    const body = JSON.stringify({ type: action, answer: answer || '' });
    const result = await new Promise<string>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port,
        path: `/api/goals/${goalId}/questions/${questionId}/respond`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      });
      req.on('error', reject);
      req.write(body); req.end();
    });
    return { content: [{ type: 'text', text: result }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
