/**
 * 工作区 patch 应用（gateway-side）。
 *
 * 背景（2026-10-26 真机实证）：opencode 2.1 serve **没有** `/api/vcs/apply`
 * （404），SDK v2 的 `vcs.apply` 方法超前于 serve 且 `throwOnError=false`
 * 会静默吞掉 404——T2-1 files restore 与 B3.1 revertDiff 都曾因此「返回
 * 成功但什么都没改」。改为 gateway 自己跑 `git apply`：
 *   git -C <projectDir> [--git-dir <snapshotRepo>] apply [--check] <patchFile>
 * 文本补丁只需 projectDir；含 binary 的补丁把 snapshotRepo 作为对象库传入
 * （两者对象库不同，见 turn-diff 的 findSnapshotRepo）。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GitRunner } from './turn-diff';

export interface ApplyPatchResult {
  code: number;
  stderr: string;
}

export async function applyPatchToWorktree(
  git: GitRunner,
  opts: {
    projectDir: string;
    patch: string;
    gitDir?: string;
    check?: boolean;
  },
): Promise<ApplyPatchResult> {
  const patchFile = path.join(
    os.tmpdir(),
    `mafw-patch-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`,
  );
  fs.writeFileSync(patchFile, opts.patch, 'utf-8');
  try {
    const args = ['-C', opts.projectDir];
    if (opts.gitDir) args.push('--git-dir', opts.gitDir);
    // 跨 git-dir 应用时 git 读的是 snapshot repo 的配置（Windows 全局常见
    // autocrlf=true 会把补丁写成 CRLF）；强制字节保真，否则 restore 后
    // 文件哈希与 snapshot 树不一致，下一次 diff 全量漂移。
    args.push('-c', 'core.autocrlf=false', '-c', 'core.quotePath=false', 'apply');
    if (opts.check) args.push('--check');
    args.push(patchFile);
    const r = await git.run(args);
    return { code: r.code, stderr: r.stderr || '' };
  } finally {
    try { fs.rmSync(patchFile, { force: true }); } catch { /* best effort */ }
  }
}
