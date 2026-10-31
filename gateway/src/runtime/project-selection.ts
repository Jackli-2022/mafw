/**
 * 项目注册 vs "当前项目"选择（2026-10-31）。
 *
 * POST /register 有两个调用方：
 *  - 插件激活时的自动注册（`registerWithGateway`，每小时/每次项目配置加载都会发生）
 *  - 桌面 Rail 的显式切换项目（SDK `project.setCurrent`）
 *
 * 只有后者可以改写当前项目。历史实现把两者混在一起，导致插件自动注册
 * `~/.mafw/runtime-root`（serve 根）或 `.` 时把用户当前项目顶掉；桌面工作台
 * 根（`benchRoot`）跟随 currentProject，于是文件树/编辑器指向 runtime-root。
 *
 * 语义：
 *  - `setCurrent` 默认 false（自动注册只登记，不切换）
 *  - runtime server root 与相对路径（含 "."）永远不能成为"当前项目"
 *  - 已污染的 current-project 读取时回退到第一个可选项目
 */
import * as path from 'path';

export type RegisterIntent = {
  projectDir: string;
  mafwDir: string;
  setCurrent: boolean;
};

/** 归一化比较：反斜杠 → 正斜杠、去尾斜杠、Windows 大小写不敏感（统一小写）。 */
function normDir(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** 解析 POST /register body；缺字段 → null（调用方 400）。 */
export function parseRegisterIntent(body: any): RegisterIntent | null {
  const projectDir = typeof body?.projectDir === 'string' ? body.projectDir.trim() : '';
  const mafwDir = typeof body?.mafwDir === 'string' ? body.mafwDir.trim() : '';
  if (!projectDir || !mafwDir) return null;
  return { projectDir, mafwDir, setCurrent: body?.setCurrent === true };
}

/** 是否允许成为"当前项目"：绝对路径，且不是 runtime server root（"." 等相对路径一律拒绝）。 */
export function isSelectableProject(
  dir: string | null | undefined,
  runtimeRoot: string,
): boolean {
  if (!dir) return false;
  if (!path.isAbsolute(dir)) return false;
  return normDir(dir) !== normDir(runtimeRoot);
}

/**
 * 解析当前项目：保留用户选择（已注册且可选），否则回退第一个可选项目。
 * 返回 null = 没有任何可选项目（调用方返回 `{ project: null }`）。
 */
export function pickCurrentProject(input: {
  stored: string | null | undefined;
  registered: Iterable<string>;
  runtimeRoot: string;
}): string | null {
  const dirs = Array.from(input.registered);
  const stored = input.stored ?? null;
  if (stored && dirs.includes(stored) && isSelectableProject(stored, input.runtimeRoot)) {
    return stored;
  }
  return dirs.find((d) => isSelectableProject(d, input.runtimeRoot)) ?? null;
}
