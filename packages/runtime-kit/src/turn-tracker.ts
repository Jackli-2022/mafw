/**
 * 回合追踪 —— 在原生事件进总线前观察，按会话合成 turn.started 并在终态复位。
 *
 * gateway 的事件映射执行器是 first-match：命中映射行的终态事件不会到达
 * transformEvent，所以「每回合首条 user → turn.started」这类跨事件状态机
 * 必须在插件侧 raw 流上完成（spec 2026-10-31 §4.1 裁决）。
 */

export interface TurnTrackerOptions<T> {
  push(value: T): void;
  sessionIdOf(raw: T): string | undefined;
  isTurnStart(raw: T): boolean;
  isTerminal(raw: T): boolean;
  makeTurnStarted(sessionID: string): T;
}

export interface TurnTracker<T> {
  push(raw: T): void;
  /** 本地失败（无原生终态事件）时复位，使下一回合能重新合成 start。 */
  reset(sessionID: string): void;
}

export function createTurnTracker<T>(opts: TurnTrackerOptions<T>): TurnTracker<T> {
  const inFlight = new Set<string>();
  return {
    push(raw: T): void {
      const sid = opts.sessionIdOf(raw);
      if (!sid) {
        opts.push(raw);
        return;
      }
      if (opts.isTerminal(raw)) {
        inFlight.delete(sid);
        opts.push(raw);
        return;
      }
      if (opts.isTurnStart(raw) && !inFlight.has(sid)) {
        inFlight.add(sid);
        opts.push(opts.makeTurnStarted(sid));
      }
      opts.push(raw);
    },
    reset(sessionID: string): void {
      inFlight.delete(sessionID);
    },
  };
}
