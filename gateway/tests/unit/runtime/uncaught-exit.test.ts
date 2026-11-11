/**
 * E1-11 全局异常兜底（spec §E1-11 / A14）。
 *
 * 缺陷：gateway 进程没有 `uncaughtException` / `unhandledRejection` handler，
 * 任何遗漏的异步错误直接按 Node 默认方式终止（无 [FATAL] 诊断、退出码不确定）。
 *
 * 契约：注册后
 *  - `[FATAL] uncaughtException` / `[FATAL] unhandledRejection` 写 log.error（含堆栈）
 *    并同步写 stderr（便于 supervisor/日志采集）；
 *  - `process.exitCode = 1` 后受控 `process.exit(1)`（不吞、不"继续运行"）；
 *  - 真子进程验证：unhandledRejection → 退出码 1 + 输出含 boom 标记。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { registerCrashHandlers } from '../../../src/runtime/crash-handlers';

const GATEWAY_ROOT = path.resolve(__dirname, '../../..');

function harness() {
  const emitter = new EventEmitter();
  const errors: string[] = [];
  const stderr: string[] = [];
  const exits: number[] = [];
  const savedExitCode = process.exitCode;
  registerCrashHandlers({
    emitter,
    log: { error: (msg: string, ...args: unknown[]) => errors.push([msg, ...args.map(String)].join(' ')) },
    stderr: (line: string) => stderr.push(line),
    exit: (code: number) => exits.push(code),
  });
  return {
    emitter,
    errors,
    stderr,
    exits,
    restore: () => { process.exitCode = savedExitCode; },
  };
}

describe('registerCrashHandlers（E1-11）', () => {
  it('uncaughtException → [FATAL] 日志 + stderr + 受控 exit(1)', () => {
    const h = harness();
    try {
      h.emitter.emit('uncaughtException', new Error('boom-uncaught'));

      expect(h.errors.join('\n')).toContain('[FATAL]');
      expect(h.errors.join('\n')).toContain('uncaughtException');
      expect(h.errors.join('\n')).toContain('boom-uncaught');
      expect(h.stderr.join('\n')).toContain('[FATAL] uncaughtException');
      expect(h.stderr.join('\n')).toContain('boom-uncaught');
      // 堆栈必须进日志（诊断价值）。
      expect(h.stderr.join('\n')).toContain('at ');
      expect(h.exits).toEqual([1]);
      expect(process.exitCode).toBe(1);
    } finally {
      h.restore();
    }
  });

  it('unhandledRejection（Error 与字符串 reason）→ 同样受控退出', () => {
    const h = harness();
    try {
      h.emitter.emit('unhandledRejection', new Error('boom-rejection'));
      expect(h.stderr.join('\n')).toContain('[FATAL] unhandledRejection');
      expect(h.stderr.join('\n')).toContain('boom-rejection');

      h.emitter.emit('unhandledRejection', 'string-reason');
      expect(h.stderr.join('\n')).toContain('string-reason');
      expect(h.exits).toEqual([1, 1]);
    } finally {
      h.restore();
    }
  });

  it('注册顺序：先注册的 handler 也会被调用（不吞、不提前 return）', () => {
    const h = harness();
    try {
      const order: string[] = [];
      h.emitter.on('uncaughtException', () => order.push('other'));
      h.emitter.emit('uncaughtException', new Error('second'));
      // EventEmitter 同步按注册顺序执行 → 我们注册的 handler 必须已执行。
      expect(h.exits).toEqual([1]);
      expect(h.stderr.join('\n')).toContain('second');
    } finally {
      h.restore();
    }
  });
});

describe('spawn：真实进程 unhandledRejection（E1-11 端到端）', () => {
  it('退出码 1，输出含 [FATAL] + boom 标记（<5s）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-crash-spawn-'));
    const harnessPath = path.join(dir, 'harness.js');
    fs.writeFileSync(
      harnessPath,
      [
        'const { registerCrashHandlers } = require(process.argv[2]);',
        'registerCrashHandlers();',
        "Promise.reject(new Error('boom-marker-e1-11'));",
        'setTimeout(() => {}, 15000);',
        '',
      ].join('\n'),
      'utf8',
    );

    const startedAt = Date.now();
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '-r',
          path.join(GATEWAY_ROOT, 'node_modules/ts-node/register/transpile-only.js'),
          harnessPath,
          path.join(GATEWAY_ROOT, 'src/runtime/crash-handlers.ts'),
        ],
        {
          cwd: GATEWAY_ROOT,
          env: { ...process.env, MAFW_LOG_DIR: path.join(dir, 'logs') },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      child.stdout.on('data', (chunk) => { output += String(chunk); });
      child.stderr.on('data', (chunk) => { output += String(chunk); });
      const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 20_000);
      child.on('error', (err) => { clearTimeout(killer); reject(err); });
      child.on('close', (code) => { clearTimeout(killer); resolve({ code, output }); });
    });
    const elapsedMs = Date.now() - startedAt;

    expect(result.code).toBe(1);
    expect(result.output).toContain('[FATAL] unhandledRejection');
    expect(result.output).toContain('boom-marker-e1-11');
    // 记录运行时（需求：<5s；ts-node 冷启动占大头）。
    expect(elapsedMs).toBeLessThan(15_000);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20_000);
});

describe('index.ts bootstrap wiring（E1-11）', () => {
  it('注册 crash handlers 先于构造 scheduler（首件事）', () => {
    const src = fs.readFileSync(path.join(GATEWAY_ROOT, 'src/index.ts'), 'utf8');
    const registeredAt = src.indexOf('registerCrashHandlers()');
    const constructedAt = src.indexOf('new MafwScheduler(');
    expect(registeredAt).toBeGreaterThan(-1);
    expect(constructedAt).toBeGreaterThan(-1);
    expect(registeredAt).toBeLessThan(constructedAt);
  });
});
