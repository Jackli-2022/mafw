/**
 * Mode A 全局广播信封构造器（MafwScheduler.broadcast 的载荷形状）。
 *
 * wire 契约（桌面 renderer / TUI 均按此解析）：
 *   { type: 'opencode_event', data: { type, properties?, sessionID?, directory?, error?, internal? } }
 *
 * 规则：可选字段缺失时不得出现在 data 上（key 稳定性，消费方用
 * `'x' in data` 判定时不受缺省值污染）。
 */

export interface OpencodeEventBroadcast {
  type: 'opencode_event';
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

export function opencodeBroadcast(data: BroadcastEventData, internal?: boolean): OpencodeEventBroadcast {
  return {
    type: 'opencode_event',
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
 * 会把 `data` 当作 opencode_event 的内层载荷，`type` 随之丢失——与
 * runtime_switched / user_question 同一约定。
 */
export function projectRegisteredEvent(projectDir: string): { type: string; projectDir: string } {
  return { type: 'project_registered', projectDir };
}
