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

export async function probeOpencodeDialect(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2500,
): Promise<'v1' | 'v2'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 硬超时竞速：不依赖 body reader 在 abort 时 reject（传输层行为不可假设）；
  // no-op catch 防早退路径（v2 命中）的 finally-abort 触发未处理拒绝。
  const abortPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('probe timeout')));
  });
  abortPromise.catch(() => { /* 被竞速消费或有意丢弃 */ });
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/global/event`, {
      headers: { accept: 'text/event-stream' },
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
      for (const signal of V2_SIGNALS) {
        if (buffer.includes(signal)) return 'v2';
      }
    }
    return 'v1';
  } catch {
    return 'v1'; // fail-safe：超时（idle serve）/ 连接失败 / 流错误
  } finally {
    clearTimeout(timer);
    controller.abort(); // 无论结果，断开 peek 连接
  }
}
