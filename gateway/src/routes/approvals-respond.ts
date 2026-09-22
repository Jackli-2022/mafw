// POST /api/approvals/:id/respond 真实现（替换空 stub，2026-09-20）：
// 在注册项目的 .mafw/user-questions/（flat + legacy goalId/ 子目录）中定位提问 JSON，
// 写 answered/answer/answeredAt —— goal askUser 流程轮询该字段消费。
// id 防路径逃逸：只允许 [A-Za-z0-9_-]。
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export interface ApprovalsRespondDeps {
  resolveDirs(): string[];
}

/** 在候选目录（项目根，其下找 user-questions/）中定位提问 JSON；flat + legacy 两层。 */
export function resolveApprovalFile(projectDirs: string[], id: string): string | null {
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null; // 路径逃逸防护
  for (const dir of projectDirs) {
    const qDir = path.join(dir, 'user-questions');
    const flat = path.join(qDir, `${id}.json`);
    if (fs.existsSync(flat)) return flat;
    try {
      if (!fs.existsSync(qDir)) continue;
      for (const g of fs.readdirSync(qDir)) {
        const gPath = path.join(qDir, g);
        if (!fs.statSync(gPath).isDirectory()) continue;
        const legacy = path.join(gPath, `${id}.json`);
        if (fs.existsSync(legacy)) return legacy;
      }
    } catch { /* 单项目失败不影响其他 */ }
  }
  return null;
}

/** 写回答：answer 可为 approve/reject 决定或用户文本回答（弹窗输入/选项） */
export function respondApprovalFile(filePath: string, answer: string): void {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  data.answered = true;
  data.answer = answer;
  data.answeredAt = new Date().toISOString();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export async function handleApprovalsRespond(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
  deps: ApprovalsRespondDeps,
): Promise<void> {
  let body: any = {};
  try {
    body = JSON.parse(await readBody(req) || '{}');
  } catch { /* invalid json → {} */ }
  const decision: 'approve' | 'reject' | undefined = body?.decision;
  // QuestionWidget（无 goalId 的 MCP ask_user）以文本回答：{ answer: string }
  const answer: string | undefined = typeof body?.answer === 'string' ? body.answer : undefined;
  if (decision !== 'approve' && decision !== 'reject' && answer === undefined) {
    json(res, 400, { error: "decision must be 'approve'|'reject' or answer must be a string" });
    return;
  }
  const file = resolveApprovalFile(deps.resolveDirs(), id);
  if (!file) {
    json(res, 404, { error: 'approval (user question) not found' });
    return;
  }
  try {
    respondApprovalFile(file, answer !== undefined ? answer : decision!);
    json(res, 200, { status: 'ok', decision: answer !== undefined ? 'answered' : decision });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
