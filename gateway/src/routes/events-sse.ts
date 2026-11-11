/**
 * Phase D1 Task H2: GET /api/events（SSE）→ registry dispatch（event.subscribe）。
 *
 * E3-2：Mode B（`?sessionID=` 的 per-session 流，ChatSessionManager）已删除——
 * 自述零源码消费方（desktop/TUI 均走全局流）。现在**所有**请求都是 Mode A：
 * `?sessionID` 被忽略；Last-Event-ID / ?since 游标 → attachGlobalSse（greeting +
 * newest-window 回放 + 直播），per-connection write 收进 sseClients，req close
 * 时移除。
 *
 * 迁移评估（brief 要求先评估）：legacy 是单个 `req.url && req.url.startsWith
 * ('/api/events') && method === 'GET'` 盲点分支，全部连接生命周期动作（注册 /
 * 移除）都在分支内，闭包（conn.write / buffer / replay 游标）由 attachGlobalSse
 * 在 handler 调用内自持；分支外的 sseClients 只被 broadcast / dashboard 统计
 * 读取（与本分支共享的是同一个 Map 引用，迁移不改归属）；WS upgrade 走
 * server.on('upgrade')，不经此分支。→ 单分支、依赖干净，逐字迁移（SSE over
 * registry 已在 routes/tts.ts 的 tts.speakStream 验证）。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../config';
import type { EventStore } from '../events/event-store';
import { parseSince, attachGlobalSse } from '../events/sse-attach';
import type { RouteRegistry } from './registry';

export interface EventsSseRouteDeps {
  /** null = 纯直播（EventStore 初始化失败的降级语义）。 */
  eventStore: () => EventStore | null;
  /** Mode A per-connection write 表（broadcast / dashboard 统计共读）。 */
  sseClients: () => Map<ServerResponse, (frame: string, seq: number | null) => void>;
  /**
   * E2-1: greeting 纪元（instanceId / schemaEpoch）。live getter——release
   * metadata 在 boot 阶段加载，attach 时才取；null = 未就绪（字段省略）。
   */
  releaseIdentity?: () => { instanceId: string; schemaEpoch: number } | null;
}

export function attachEventsSseRoutes(registry: RouteRegistry, deps: EventsSseRouteDeps): void {
  registry.attachHandler('event.subscribe', async (req: IncomingMessage, res: ServerResponse) => {
    const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);

    // Mode A（唯一模式）：`?sessionID` 历史参数被忽略，保持向后兼容（旧客户端仍拿到
    // 全局流，而不是 404/挂起）。2026-10-22 持久回放：Last-Event-ID 头（原生
    // EventSource 重连自动携带）/ ?since 参数 → 重放后直播（newest-window +
    // firstReplayedSeq 截断信号）。
    const since = parseSince(parsedUrl.searchParams, req.headers['last-event-id'] as string | undefined);
    const release = deps.releaseIdentity?.() ?? null;
    const conn = attachGlobalSse({
      res,
      store: deps.eventStore(),
      replayLimit: config.events.replayLimit,
      writeFrame: (r, frame) => { if (frame) r.write(frame); },
      since,
      instanceId: release?.instanceId,
      schemaEpoch: release?.schemaEpoch,
    });
    deps.sseClients().set(res, conn.write);
    req.on('close', () => { deps.sseClients().delete(res); });
  });
}
