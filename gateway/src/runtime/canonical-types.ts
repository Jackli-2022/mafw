/**
 * canonical v3 flat 消息/部件类型 —— gateway 内部 canonical 模型的唯一类型定义。
 *
 * spec: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md §3.1
 * 事实源: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-mapping-audit.md §2
 *
 * 约定：
 *  - 内部管线（normalizeMessages 输出、历史管线）一律 flat；wire 形状
 *    （{info, parts[]}）仅在 egress 出口经 wire-compat.ts 还原——shim 是
 *    唯一转换点，内部任何模块不得再持有 v1 信封。
 *  - 字段完备是硬约束：identity 字段（id/sessionID/messageID）承重——桌面按
 *    part.id upsert、assembler 以 id 做 live/历史去重；step-finish 的
 *    cost/tokens 是 trajectory/BudgetGuard 主干；tool 的 pending 态 + raw/
 *    title/metadata 随 v1 ToolState 保留。
 *  - 透传变体兜住未枚举的 part 类型（subtask/snapshot/patch/agent/retry/
 *    compaction 等）——session-ui 今日渲染 compaction/agent part，字段丢失
 *    即桌面回归，shim 原样保留。
 *  - 守卫刻意宽松（结构校验，非语义校验）：部件只要求 id+type 为 string，
 *    消息只要求 role 合法 + content（若存在）为部件数组。深度语义由
 *    生产方（各家 normalizeMessages）保证，守卫只防形状漂移。
 */

export interface MafwMessage {
  id?: string;
  sessionID?: string;
  role: 'user' | 'assistant';
  /** 事件载荷形态可缺省（parts 经 part.updated 单独流）；历史形态必有。 */
  content?: MafwPart[];
  time?: { created?: number; updated?: number; completed?: number };
  /** runtime 原生 finish reason（opencode finish / pi stopReason）。 */
  finish?: string;
  /** 平台特有字段（modelID / model 对象 / agent / mode / summary 等）经全量
   *  拷贝同名透传，不在本接口枚举——零换名是 round-trip 保真的硬约束。 */
  providerID?: string;
  /** trajectory / usage 统计主干字段（opencode wire：cost 为 number、tokens 为对象；原样透传）。 */
  tokens?: Record<string, unknown>;
  cost?: number | Record<string, unknown>;
  parentID?: string;
}

export interface MafwPartBase {
  id: string;
  sessionID?: string;
  messageID?: string;
}

export type MafwPart =
  | (MafwPartBase & { type: 'text'; text: string })
  | (MafwPartBase & { type: 'reasoning'; text: string; signature?: string })
  | (MafwPartBase & {
      type: 'tool';
      callID: string;
      tool: string;
      state: {
        status: 'pending' | 'running' | 'completed' | 'error';
        input?: unknown;
        raw?: string;
        output?: string;
        error?: string;
        title?: string;
        metadata?: Record<string, unknown>;
        time?: { start?: number; end?: number };
      };
    })
  | (MafwPartBase & { type: 'file'; mime?: string; url?: string; filename?: string; [k: string]: unknown })
  | (MafwPartBase & { type: 'step-start' })
  | (MafwPartBase & {
      type: 'step-finish';
      reason?: string;
      cost?: Record<string, unknown>;
      tokens?: Record<string, unknown>;
    })
  /** 透传变体：未枚举的 part 类型原样保留（含全部自定义字段）。 */
  | (MafwPartBase & { type: string; [k: string]: unknown });

/** 部件结构守卫：id 与 type 均为 string 即视为合法（透传语义，见文件头注释）。 */
export function isMafwPart(v: unknown): v is MafwPart {
  if (v === null || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.type === 'string';
}

/** 消息结构守卫：role ∈ user|assistant；content（若存在）为部件数组。 */
export function isMafwMessage(v: unknown): v is MafwMessage {
  if (v === null || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  if (m.role !== 'user' && m.role !== 'assistant') return false;
  if (m.content !== undefined) {
    if (!Array.isArray(m.content)) return false;
    if (!(m.content as unknown[]).every((p) => isMafwPart(p))) return false;
  }
  return true;
}
