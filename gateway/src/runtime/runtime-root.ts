/**
 * Runtime server root（**不是 session 目录**）。
 *
 * 规范（2026-10-29）：agent runtime 的 server（opencode `serve`）必须在一个
 * 稳定的、跨项目共享的根目录启动，而不是继承 gateway/Electron 的启动目录，
 * 也不能跟随 UI 当前项目切换（server 不随项目重启）。
 *
 * 固定根：`~/.mafw/runtime-root`。
 * session 的工作目录仍然只由 `SessionCreateOpts.directory` 决定。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const RUNTIME_ROOT_DIRNAME = 'runtime-root';

/** 默认数据根为 `~/.mafw`；测试可注入其他数据根。 */
export function resolveRuntimeRoot(dataRoot: string = path.join(os.homedir(), '.mafw')): string {
  return path.join(dataRoot, RUNTIME_ROOT_DIRNAME);
}

/**
 * 确保 root 存在并返回绝对路径。
 * - 相对路径拒绝（规范要求绝对路径）；
 * - 缺失时递归创建；
 * - 同名文件不是目录时 fail-loud。
 */
export function ensureRuntimeRoot(root: string): string {
  if (!path.isAbsolute(root)) {
    throw new Error(`runtime root must be an absolute path: ${root}`);
  }
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch (err: any) {
    if (err?.code === 'EEXIST' || err?.code === 'ENOTDIR') {
      throw new Error(`runtime root is not a directory: ${root}`);
    }
    throw err;
  }
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    throw new Error(`runtime root is not a directory: ${root}`);
  }
  return root;
}
