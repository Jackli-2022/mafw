import type { SessionInfo } from '../contract';

/**
 * pi SessionManager.list() 返回的会话信息格式
 */
export interface PiSessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
  parentSessionPath?: string;
}

/**
 * 将 pi 的 SessionInfo 映射为 gateway 的 SessionInfo 格式
 */
export function mapPiSessionToGateway(pi: PiSessionInfo): SessionInfo {
  return {
    id: pi.id,
    projectID: pi.cwd || '',
    directory: pi.cwd || '',
    title: pi.name || pi.firstMessage || pi.id,
    time: {
      created: pi.created?.getTime?.() ?? 0,
      updated: pi.modified?.getTime?.() ?? 0,
    },
  };
}

/**
 * 按目录列出持久化会话（从 pi 的 SessionManager.list 读取）
 * 
 * @param directory - 工作目录（cwd）
 * @param limit - 可选，限制返回数量
 * @param piModule - 可选，已加载的 pi SDK 模块（用于测试注入）
 * @returns gateway SessionInfo 数组
 */
export async function listByDirectory(
  directory: string,
  limit?: number,
  piModule?: any
): Promise<SessionInfo[]> {
  try {
    // 动态导入 pi SDK（ESM-only）或使用注入的模块
    const mod = piModule ?? await import('@earendil-works/pi-coding-agent');
    if (!mod?.SessionManager) return [];

    // 调用 pi 的 SessionManager.list(cwd)
    const sessions: PiSessionInfo[] = await mod.SessionManager.list(directory);

    // 映射格式
    const mapped = sessions.map(mapPiSessionToGateway);

    // 应用 limit
    return limit ? mapped.slice(0, limit) : mapped;
  } catch {
    return [];
  }
}
