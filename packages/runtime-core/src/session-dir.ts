/**
 * Session directory rules shared by drivers and the gateway
 * (spec: 2026-10-20-session-directory-contract-design).
 *
 * Drivers use `opts.directory` (contract-required); `ctx.projectDir` is only a
 * defensive fallback for direct/test use. The gateway resolves the plugin ctx
 * directory from the live UI project first, then the configured project root.
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
