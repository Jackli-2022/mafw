export interface PermissionModeClient {
  permissions: {
    getMode(sessionID: string): Promise<{ mode: 'manual' | 'auto' }>;
    setMode(sessionID: string, mode: 'manual' | 'auto'): Promise<void>;
  };
}

/** per-session 审批模式状态（gateway kv 为真相源；SSE permission_mode 事件驱动更新）。 */
export class PermissionModeStore {
  private modes = new Map<string, 'manual' | 'auto'>();
  private client: PermissionModeClient;
  constructor(client: PermissionModeClient) { this.client = client; }
  get(sid: string): 'manual' | 'auto' { return this.modes.get(sid) ?? 'manual'; }
  set(sid: string, mode: 'manual' | 'auto'): void { this.modes.set(sid, mode); }
  async load(sid: string): Promise<void> {
    try { this.set(sid, (await this.client.permissions.getMode(sid)).mode); } catch { /* fail-open */ }
  }
  async toggle(sid: string): Promise<'manual' | 'auto'> {
    const next = this.get(sid) === 'manual' ? 'auto' : 'manual';
    await this.client.permissions.setMode(sid, next); // 失败抛出：切换不落内存态
    this.set(sid, next);
    return next;
  }
}
