/**
 * 会话注册表 —— busy / 排队 / abort 控制器的公共机械。
 * 各 runtime 的额外字段（如 claude 的 firstPrompt）通过 init 扩展注入。
 */
export interface RegistrySession<Q> {
  directory: string;
  busy: boolean;
  queue: Q[];
  controller: { interrupt(): void } | null;
}

export interface SessionRegistry<Q, X extends object = {}> {
  get(sid: string): (RegistrySession<Q> & X) | undefined;
  getOrCreate(sid: string, directory: string): RegistrySession<Q> & X;
  begin(sid: string): void;
  attach(sid: string, controller: { interrupt(): void } | null): void;
  enqueue(sid: string, item: Q): void;
  /** 置 busy=false 并 FIFO 出队一条；空队列返回 null。 */
  finish(sid: string): Q | null;
  clearQueue(sid: string): void;
  delete(sid: string): void;
  entries(): IterableIterator<[string, RegistrySession<Q> & X]>;
}

export function createSessionRegistry<Q, X extends object = {}>(
  init?: (directory: string) => X,
): SessionRegistry<Q, X> {
  const sessions = new Map<string, RegistrySession<Q> & X>();

  const getOrCreate = (sid: string, directory: string): RegistrySession<Q> & X => {
    let state = sessions.get(sid);
    if (!state) {
      state = {
        directory,
        busy: false,
        queue: [],
        controller: null,
        ...(init ? init(directory) : ({} as X)),
      } as RegistrySession<Q> & X;
      sessions.set(sid, state);
    }
    return state;
  };

  return {
    get: (sid) => sessions.get(sid),
    getOrCreate,
    begin(sid) {
      const state = getOrCreate(sid, '');
      state.busy = true;
    },
    attach(sid, controller) {
      const state = getOrCreate(sid, '');
      state.controller = controller;
    },
    enqueue(sid, item) {
      getOrCreate(sid, '').queue.push(item);
    },
    finish(sid) {
      const state = sessions.get(sid);
      if (!state) return null;
      state.busy = false;
      return state.queue.shift() ?? null;
    },
    clearQueue(sid) {
      const state = sessions.get(sid);
      if (state) state.queue.length = 0;
    },
    delete(sid) {
      sessions.delete(sid);
    },
    entries: () => sessions.entries(),
  };
}
