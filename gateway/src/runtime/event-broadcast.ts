/**
 * Mode A 全局广播信封构造器（MafwScheduler.broadcast 的载荷形状）。
 *
 * wire 契约（桌面 renderer / TUI 均按此解析）：
 *   { type: 'mafw_event', data: { type, properties?, sessionID?, directory?, error?, internal? } }
 *
 * v2（2026-10-12）：信封名 opencode_event → mafw_event（词汇所有权归 MAFW，
 * spec 2026-10-12-native-event-vocabulary-design.md D2）。desktop 剥壳
 * `raw?.data || raw` 信封无关；SDK sse.ts 判定串已同步。
 *
 * 规则：可选字段缺失时不得出现在 data 上（key 稳定性，消费方用
 * `'x' in data` 判定时不受缺省值污染）。
 */

export interface MafwEventBroadcast {
  type: 'mafw_event';
  data: {
    type: string;
    properties?: unknown;
    sessionID?: string;
    directory?: string;
    error?: string;
    internal?: boolean;
  };
}

export interface BroadcastEventData {
  type: string;
  properties?: unknown;
  sessionID?: string;
  directory?: string;
  error?: string;
}

export function mafwBroadcast(data: BroadcastEventData, internal?: boolean): MafwEventBroadcast {
  if (typeof data?.type !== 'string' || !data.type) {
    // 形状守卫（fail-open）：信封照常返回，但给出可定位诊断——畸形事件
    // 在桌面/TUI 是"静默忽略"，没有这行日志时插件作者无从排查。
    // eslint-disable-next-line no-console
    console.error(
      `[EventBroadcast] malformed mafw_event data: 'type' must be a non-empty string ` +
      `(got ${JSON.stringify(data?.type)}); payload keys: ${data ? Object.keys(data).join(',') : '(null)'} ` +
      `— downstream (desktop/TUI) will ignore this event`,
    );
  }
  return {
    type: 'mafw_event',
    data: {
      ...data,
      ...(data.directory === undefined ? {} : { directory: data.directory }),
      ...(internal ? { internal: true } : {}),
    },
  };
}

/**
 * 项目注册广播（桌面 renderer 依此刷新 Rail 项目列表）。
 *
 * 顶层广播必须扁平（无 `data` 键）：desktop 剥壳逻辑 `event = raw?.data || raw`
 * 会把 `data` 当作 mafw_event 的内层载荷，`type` 随之丢失——与
 * runtime_switched / user_question 同一约定。
 */
export function projectRegisteredEvent(projectDir: string): { type: string; projectDir: string } {
  return { type: 'project_registered', projectDir };
}
