/**
 * 写前文件历史快照（插件侧）：opencode 的 part.updated(running) 在工具写入之后才到，
 * gateway 侧事件钩子只能抓到写后内容；必须在 tool.execute.before 里先调 gateway。
 *
 * - 2s 硬超时；失败 fail-open（返回 false，不阻塞工具）。
 * - 路径用绝对路径（gateway 会按 session 目录归一/校验）。
 */
const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';

export function fileHistorySnapshotUrl(): string {
  return `http://127.0.0.1:${GATEWAY_PORT}/api/file-history/snapshot`;
}

export async function snapshotBeforeWrite(input: {
  sessionID: string;
  directory: string;
  paths: string[];
  reason?: string;
}): Promise<boolean> {
  if (!input.sessionID || input.paths.length === 0) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(fileHistorySnapshotUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionID: input.sessionID,
        directory: input.directory,
        paths: input.paths,
        reason: input.reason ?? 'tool:before',
      }),
      signal: controller.signal,
    });
    return !!res?.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
