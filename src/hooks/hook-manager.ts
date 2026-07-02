export interface HookContext {
  event: string;
  data: any;
  config: { hookFailBehavior: 'continue' | 'stop'; timeout: number };
  [key: string]: any;
}

export interface HookRegistration {
  name: string;
  event: string;
  handler: (context: HookContext) => Promise<void>;
  priority: number;
  timeout?: number;
}

export class HookManager {
  private hooks: Map<string, HookRegistration[]>;
  private config: { failBehavior: 'continue' | 'stop'; timeout: number };

  constructor(config?: { failBehavior?: string; timeout?: number }) {
    this.hooks = new Map();
    this.config = {
      failBehavior: (config?.failBehavior as 'continue' | 'stop') || 'continue',
      timeout: config?.timeout ?? 30000
    };
  }

  register(hook: HookRegistration): void {
    const event = hook.event;
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    this.hooks.get(event)!.push(hook);
    this.hooks.get(event)!.sort((a, b) => a.priority - b.priority);
  }

  registerMany(hooks: HookRegistration[]): void {
    for (const hook of hooks) {
      this.register(hook);
    }
  }

  unregister(name: string): boolean {
    for (const [event, registrations] of this.hooks) {
      const index = registrations.findIndex(h => h.name === name);
      if (index !== -1) {
        registrations.splice(index, 1);
        if (registrations.length === 0) {
          this.hooks.delete(event);
        }
        return true;
      }
    }
    return false;
  }

  async execute(event: string, context: Partial<HookContext>): Promise<void> {
    const registrations = this.hooks.get(event);
    if (!registrations || registrations.length === 0) {
      return;
    }

    const fullContext: HookContext = {
      event,
      data: context.data,
      config: this.config,
      ...context
    } as HookContext;

    for (const hook of registrations) {
      const timeout = hook.timeout ?? this.config.timeout;
      try {
        await Promise.race([
          hook.handler(fullContext),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Hook "${hook.name}" timed out after ${timeout}ms`)), timeout)
          )
        ]);
      } catch (err: any) {
        if (this.config.failBehavior === 'continue') {
          console.error(`[HookManager] Hook "${hook.name}" failed: ${err.message}`);
        } else {
          throw err;
        }
      }
    }
  }

  getHooks(event?: string): HookRegistration[] {
    if (event) {
      return [...(this.hooks.get(event) || [])];
    }
    const result: HookRegistration[] = [];
    for (const registrations of this.hooks.values()) {
      result.push(...registrations);
    }
    return result;
  }

  clear(): void {
    this.hooks.clear();
  }

  size(): number {
    let count = 0;
    for (const registrations of this.hooks.values()) {
      count += registrations.length;
    }
    return count;
  }
}
