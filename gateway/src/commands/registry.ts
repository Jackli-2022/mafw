/**
 * MAFW 命令注册表（P0 收敛）：/api/mafw-commands/run 的单一元数据真源。
 * - 内置命令：元数据在 BUILTIN_COMMAND_DEFS，handler 在 builtin-handlers.ts（deps 注入）
 * - 自定义命令：custom-commands.ts 扫描 markdown 文件后 register（kind:'custom'）
 * 客户端（TUI/Desktop）经 GET /api/mafw-commands 拉取 list() 输出做补全/面板。
 */

export type MafwCommandCategory = 'goals' | 'session' | 'memory' | 'custom';

export interface MafwCommandDef {
  name: string;
  aliases?: string[];
  description: string;
  /** 补全提示，如 '<问题>'、'<worktree路径> [strategy]' */
  argumentHint?: string;
  category: MafwCommandCategory;
  /** 破坏性操作：客户端据此弹确认（对齐 TUI COMMAND_REGISTRY 语义） */
  destructive?: boolean;
  kind: 'builtin' | 'custom';
  /** custom：来源文件绝对路径（调试/展示用） */
  source?: string;
}

export interface MafwCommandContext {
  args: string;
  sessionID?: string;
  projectDir: string;
}

export interface MafwCommandResult {
  ok: boolean;
  message?: string;
  text?: string;
  error?: string;
  [k: string]: unknown;
}

export type MafwCommandHandler = (ctx: MafwCommandContext) => Promise<MafwCommandResult>;

interface RegistryEntry {
  def: MafwCommandDef;
  handler?: MafwCommandHandler;
}

export class MafwCommandRegistry {
  private entries = new Map<string, RegistryEntry>();

  register(def: MafwCommandDef, handler?: MafwCommandHandler): void {
    this.entries.set(def.name, { def, handler });
  }

  unregister(name: string): void {
    this.entries.delete(name);
  }

  resolve(nameOrAlias: string): RegistryEntry | null {
    const key = String(nameOrAlias || '').trim().toLowerCase();
    if (!key) return null;
    const direct = this.entries.get(key);
    if (direct) return direct;
    for (const entry of this.entries.values()) {
      if (entry.def.aliases?.includes(key)) return entry;
    }
    return null;
  }

  /** 元数据清单（不含 handler），供 GET /api/mafw-commands 输出。 */
  list(): MafwCommandDef[] {
    return [...this.entries.values()].map((e) => ({ ...e.def }));
  }
}

/** 内置命令元数据（handler 由 builtin-handlers.ts 绑定）。 */
export const BUILTIN_COMMAND_DEFS: MafwCommandDef[] = [
  { name: 'goal', description: '提交新 Goal 给 Manager', argumentHint: '<目标描述>', category: 'goals', kind: 'builtin' },
  { name: 'new-topic', aliases: ['new'], description: '开新话题（当前 Manager 会话归档）', category: 'session', destructive: true, kind: 'builtin' },
  { name: 'btw', description: '支线问答（一次性会话，不污染主线）', argumentHint: '<问题>', category: 'session', kind: 'builtin' },
  { name: 'waitwhat', description: '没听懂：用简明语言+项目术语重述上一条回复', category: 'session', kind: 'builtin' },
  { name: 'status', description: 'MAFW 状态（活跃 Goal 摘要）', category: 'goals', kind: 'builtin' },
  { name: 'merge-memory', description: '跨 worktree 记忆融合', argumentHint: '<worktree路径> [strategy]', category: 'memory', kind: 'builtin' },
];
