/**
 * 会话目录解析规则（单一来源，spec: 2026-10-20-session-directory-contract-design）。
 *
 * runtime 侧：建会话用 opts.directory（契约必填）；ctx.projectDir 只作防御性兜底
 * （gateway 内部配置 config.raw.paths.projectDir 不再是插件可见的兜底腿）。
 * gateway 侧：插件 ctx 与内部会话的目录 = UI 当前项目优先，否则 config 项目根（绝对）。
 */

export function requireSessionDir(
  optsDirectory: string | undefined | null,
  ctxProjectDir?: string | null,
): string {
  const dir = optsDirectory ?? ctxProjectDir;
  if (!dir) throw new Error('session.create: directory is required (SessionCreateOpts.directory)');
  return dir;
}

export function resolvePluginProjectDir(
  currentProjectDir: string | null | undefined,
  configProjectDir: string,
): string {
  return currentProjectDir ?? configProjectDir;
}
