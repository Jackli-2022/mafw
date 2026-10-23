import { serveAuthHeaders } from './serve-sidecar';
/**
 * probeOpencodeDialect —— opencode 方言探测（SSE peek）。
 *
 * 设计 §3.2（用户裁决：v1/v2 双兼容自适应）：裸 `opencode` 在事件订阅时探测
 * serve 能力——对 `{base}/global/event` 开一条**短命 peek 连接**，流内首见
 * sync 信封或 session.next.* 即判 2.x serve（@v2）；窗口内无信号（idle
 * serve）/超时/连接失败 ⇒ @v1 fail-safe。
 *
 * fail-safe 方向是硬约束：@v1 表在 2.x serve 上照常工作（legacy 族双发），
 * 仅损失 next 族丰富度；反向误选 @v2 会丢重叠 legacy 事件（双发防双计的
 * drop 行所致）——不可接受。多订阅者并存（desktop + gateway 已共存），
 * peek 连接读完即断，不干扰主订阅。
 */

const V2_SIGNALS = ['"type":"sync"', '"type":"session.next.'] as const;
/** 2.1.0 durable 信封的信号：连接握手事件只有 2.1 发（顶层 type + data）。 */
const V21_SIGNALS = ['"type":"server.connected"', '"type":"session.execution.'] as const;

/** 2.1 的确定性探针：/api/session 是 2.1 新增的真 API 面（旧 serve 根路径落 SPA）。 */
async function isV21Api(baseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/session?limit=1`, {
      headers: { accept: 'application/json', ...serveAuthHeaders() },
      signal: AbortSignal.timeout(2000),
    });
    if (!res?.ok) return false;
    const ct = typeof res.headers?.get === 'function' ? (res.headers.get('content-type') ?? '') : '';
    if (ct && !ct.includes('json')) return false;
    if (typeof res.text !== 'function') return false;
    const body = await res.text();
    return body.trimStart().startsWith('{');
  } catch {
    return false;
  }
}

export async function probeOpencodeDialect(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2500,
): Promise<'v1' | 'v2' | 'v21'> {
  // 2.1 优先走确定性 API 检测（SSE peek 在 serve 未就绪时会误判 v1，
  // 2026-10-23 实测：启动竞态让 gateway 落在 v1 表，2.1 事件全部不翻译）。
  if (await isV21Api(baseUrl, fetchImpl)) return 'v21';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 硬超时竞速：不依赖 body reader 在 abort 时 reject（传输层行为不可假设）；
  // no-op catch 防早退路径（v2 命中）的 finally-abort 触发未处理拒绝。
  const abortPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('probe timeout')));
  });
  abortPromise.catch(() => { /* 被竞速消费或有意丢弃 */ });
  try {
    // 2.1.0（2026-10-22 修复）：API 全挂 /api 前缀 + 强制 Basic auth——根路径
    // /global/event 无认证落 SPA HTML（res.ok true 但无事件流，静默 fail-safe）。
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/event`, {
      headers: { accept: 'text/event-stream', ...serveAuthHeaders() },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return 'v1';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // 逐块扫描，见信号即断——不消费完整流；read 与 abort 竞速保证 timeoutMs 内必返回
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 2.1 first: its envelope is top-level type/data, not payload.*.
      for (const signal of V21_SIGNALS) {
        if (buffer.includes(signal)) return 'v21';
      }
      for (const signal of V2_SIGNALS) {
        if (buffer.includes(signal)) return 'v2';
      }
    }
    return (await isV21Api(baseUrl, fetchImpl)) ? 'v21' : 'v1';
  } catch {
    // peek 期间 serve 可能刚好就绪——返回前再确定性确认一次
    return (await isV21Api(baseUrl, fetchImpl)) ? 'v21' : 'v1';
  } finally {
    clearTimeout(timer);
    controller.abort(); // 无论结果，断开 peek 连接
  }
}
