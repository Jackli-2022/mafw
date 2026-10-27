/**
 * Wrap a runtime session's prompt surface so the instruction-entry sync runs
 * immediately before every gateway-driven prompt. Sync failures are always
 * swallowed: instruction blocks are an optimization/disclosure layer, never a
 * reason to block the user's turn.
 *
 * Applied *inside* withIdentityPrompt so the queue intercept (busy +
 * delivery:'queue') short-circuits before an unnecessary sync. When the queued
 * message is flushed later, promptAsync runs again and syncs then.
 */
export function withInstructionSync<
  T extends { promptAsync(o: any): Promise<any>; prompt(o: any): Promise<any> },
>(
  session: T,
  sync: (sessionID: string) => Promise<unknown>,
): T {
  return new Proxy(session as any, {
    get(target, prop, receiver) {
      if (prop === 'promptAsync') {
        return async (o: any) => {
          try { await sync(o?.sessionID); } catch { /* fail-open */ }
          return target.promptAsync(o);
        };
      }
      if (prop === 'prompt') {
        return async (o: any) => {
          try { await sync(o?.sessionID); } catch { /* fail-open */ }
          return target.prompt(o);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as T;
}
