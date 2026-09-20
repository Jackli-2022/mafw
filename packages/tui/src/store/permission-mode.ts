export type PermissionMode = 'read-only' | 'auto' | 'full-access';
const MODES: PermissionMode[] = ['read-only', 'auto', 'full-access'];

export interface PermissionModeClient {
  permissions: {
    getMode(sessionID: string): Promise<{ mode: PermissionMode | string }>;
    setMode(sessionID: string, mode: PermissionMode): Promise<void>;
  };
}

/** per-session 审批模式状态（gateway kv 为真相源；SSE permission_mode 事件驱动更新）。
 *  三档预设（切片 1）：read-only / auto / full-access；legacy 'manual' 等未知值回退 read-only。 */
export class PermissionModeStore {
  private modes = new Map<string, PermissionMode>();
  private client: PermissionModeClient;
  constructor(client: PermissionModeClient) { this.client = client; }
  private static normalize(m: unknown): PermissionMode {
    return m === 'auto' || m === 'full-access' ? m : 'read-only';
  }
  get(sid: string): PermissionMode { return this.modes.get(sid) ?? 'read-only'; }
  set(sid: string, mode: PermissionMode | string): void { this.modes.set(sid, PermissionModeStore.normalize(mode)); }
  async load(sid: string): Promise<void> {
    try { this.set(sid, (await this.client.permissions.getMode(sid)).mode); } catch { /* fail-open */ }
  }
  async toggle(sid: string): Promise<PermissionMode> {
    const idx = MODES.indexOf(this.get(sid));
    const next = MODES[(idx + 1) % MODES.length];
    await this.client.permissions.setMode(sid, next); // 失败抛出：切换不落内存态
    this.set(sid, next);
    return next;
  }
}
