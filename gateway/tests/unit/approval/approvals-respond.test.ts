// POST /api/approvals/:id/respond 真实现（替换空 stub）：写 user-questions JSON。
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveApprovalFile, respondApprovalFile, handleApprovalsRespond, ApprovalsRespondDeps } from '../../../src/routes/approvals-respond';
import { ServerResponse, IncomingMessage } from 'http';
import { EventEmitter } from 'events';

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-appr-'));
  const qDir = path.join(dir, 'user-questions');
  fs.mkdirSync(qDir, { recursive: true });
  return dir;
}

function writeQuestion(dir: string, id: string, opts: { legacy?: string } = {}): void {
  const qDir = path.join(dir, 'user-questions');
  const target = opts.legacy ? path.join(qDir, opts.legacy) : qDir;
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, `${id}.json`), JSON.stringify({
    questionId: id, question: '继续吗？', answered: false, answer: null,
  }), 'utf-8');
}

describe('resolveApprovalFile', () => {
  test('flat layout hit', () => {
    const dir = makeProject();
    writeQuestion(dir, 'q_1');
    expect(resolveApprovalFile([dir], 'q_1')).toBe(path.join(dir, 'user-questions', 'q_1.json'));
  });
  test('legacy goalId/ subdir hit', () => {
    const dir = makeProject();
    writeQuestion(dir, 'q_2', { legacy: 'goal-1' });
    expect(resolveApprovalFile([dir], 'q_2')).toBe(path.join(dir, 'user-questions', 'goal-1', 'q_2.json'));
  });
  test('miss → null', () => {
    const dir = makeProject();
    expect(resolveApprovalFile([dir], 'q_x')).toBeNull();
  });
  test('路径逃逸 id → null', () => {
    const dir = makeProject();
    writeQuestion(dir, 'q_3');
    expect(resolveApprovalFile([dir], '../q_3')).toBeNull();
    expect(resolveApprovalFile([dir], 'sub/q_3')).toBeNull();
  });
});

describe('respondApprovalFile', () => {
  test('writes answered/answer/answeredAt', () => {
    const dir = makeProject();
    writeQuestion(dir, 'q_9');
    const p = resolveApprovalFile([dir], 'q_9')!;
    respondApprovalFile(p, 'approve');
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    expect(data.answered).toBe(true);
    expect(data.answer).toBe('approve');
    expect(typeof data.answeredAt).toBe('string');
  });
});

describe('handleApprovalsRespond', () => {
  function makeRes() {
    const res = new EventEmitter() as any as ServerResponse;
    (res as any).writeHead = (status: number) => { (res as any).statusCode = status; return res; };
    (res as any).end = (body?: any) => { (res as any).body = body; };
    return res as any as ServerResponse & { statusCode: number; body?: string };
  }
  function makeReq(body: any): IncomingMessage {
    const req = new EventEmitter() as any as IncomingMessage;
    process.nextTick(() => { req.emit('data', JSON.stringify(body)); req.emit('end'); });
    return req;
  }
  function makeDeps(dir: string): ApprovalsRespondDeps {
    return { resolveDirs: () => [dir] };
  }

  test('approve → 200 { status: ok } + 文件更新', async () => {
    const dir = makeProject();
    writeQuestion(dir, 'q_a');
    const res = makeRes();
    await handleApprovalsRespond(makeReq({ decision: 'approve' }), res, 'q_a', makeDeps(dir));
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(fs.readFileSync(resolveApprovalFile([dir], 'q_a')!, 'utf-8'));
    expect(data.answered).toBe(true);
  });

  test('未命中 → 404', async () => {
    const dir = makeProject();
    const res = makeRes();
    await handleApprovalsRespond(makeReq({ decision: 'approve' }), res, 'nope', makeDeps(dir));
    expect(res.statusCode).toBe(404);
  });

  test('decision 非法 → 400', async () => {
    const dir = makeProject();
    writeQuestion(dir, 'q_b');
    const res = makeRes();
    await handleApprovalsRespond(makeReq({ decision: 'yolo' }), res, 'q_b', makeDeps(dir));
    expect(res.statusCode).toBe(400);
  });

  // QuestionWidget（无 goalId 的 MCP ask_user）回答契约：answer 文本直写
  test('answer 文本 → 200 + 文件写回答内容', async () => {
    const dir = makeProject();
    writeQuestion(dir, 'q_c');
    const res = makeRes();
    await handleApprovalsRespond(makeReq({ answer: '选 A' }), res, 'q_c', makeDeps(dir));
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(fs.readFileSync(resolveApprovalFile([dir], 'q_c')!, 'utf-8'));
    expect(data.answered).toBe(true);
    expect(data.answer).toBe('选 A');
    expect(typeof data.answeredAt).toBe('string');
  });

  test('既无 decision 也无 answer → 400', async () => {
    const dir = makeProject();
    writeQuestion(dir, 'q_d');
    const res = makeRes();
    await handleApprovalsRespond(makeReq({}), res, 'q_d', makeDeps(dir));
    expect(res.statusCode).toBe(400);
  });
});
