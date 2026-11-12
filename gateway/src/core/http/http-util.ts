/**
 * HTTP 叶子工具（D3 Task 1）。
 *
 * 三个从 `src/index.ts` 原样搬出的模块级 helper —— 不依赖 MafwScheduler 实例
 * 状态，也不参与组合根生命周期，所以可以放在 class 之外：
 *   - `readBody`      请求体拼串（legacy 无上限、无 JSON 解析）；
 *   - `normalizeDir`  项目目录比较归一化（小写 + 正斜杠 + 去尾斜杠）；
 *   - `isPortHealthy` 127.0.0.1 健康探测（1s 超时，永不抛出）。
 *
 * 搬运纪律（D3 global constraint「extract as-is」）：签名与函数体逐字保留，
 * 行为不可改变。已知重复：`routes/cognition.ts` 的 `readRouteBody` 是 body
 * 相同的副本（`{ body += chunk; }` 多一对花括号），`routes/*.ts` 另有十余份
 * 局部 `readBody`；合并属独立重构（会改错误传播路径），不在 D3 范围。
 *
 * CJS TDZ：本模块只引 node 内置 `http`，不引 kernel/entry —— 放在 index.ts
 * 顶部 import 区不会造成 require 顺序风险。
 */
import * as http from 'http';

/**
 * E5a-3 (F2): hard cap for the only unauthenticated request body
 * (`POST /api/mobile/pairing/verify`). Shared by the transport's
 * `content-length` pre-check and the route's capped reader.
 */
export const PAIRING_VERIFY_MAX_BODY_BYTES = 8192;

export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Normalize a directory path for comparison: lowercase + forward slashes
// (Windows drives/case differences must not split sessions across projects).
export function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

export async function isPortHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
