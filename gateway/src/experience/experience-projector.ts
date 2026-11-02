import type { RuntimeAccess } from '../runtime/runtime-access';
import {
  EXPERIENCE_ACTION_IDS,
  action,
  type ActionDescriptor,
  type ExperienceActionId,
} from './experience-contract';

export interface ExperienceProjectionWorktree {
  supported: boolean;
  reason?: 'unsupported' | 'missing-data';
}

export interface ExperienceProjectionContext {
  sessionID?: string;
  busy?: boolean;
  /**
   * 目录级 worktree 可用性（git 工作区 + `session.create({directory})` 契约）。
   * 缺省 = 未解析目录（只按 runtime surface 判断）；desktop 在会话上下文里恒传。
   */
  worktree?: ExperienceProjectionWorktree;
}

/** worktree 动作的目录级判定：surface 可用 + 本地 git 事实，不再用 runtime 能力位。 */
function worktreeDescriptor(
  ctx: ExperienceProjectionContext,
  surfaceOk: boolean,
): { supported: boolean; enabled: boolean; reason?: 'missing-data' } {
  if (!surfaceOk) return { supported: false, enabled: false };
  if (!ctx.worktree) return { supported: true, enabled: true };
  if (ctx.worktree.supported) return { supported: true, enabled: true };
  // 目录不是 git 工作区 = 对象/环境级缺失数据，功能面仍在（换项目即可用）。
  if (ctx.worktree.reason === 'missing-data') {
    return { supported: true, enabled: false, reason: 'missing-data' };
  }
  return { supported: false, enabled: false };
}

/**
 * action → 必须同时可用的 runtime surface。空数组 = 纯本地能力（不依赖 runtime）。
 *
 * 这张表是「动作面 ↔ capability」的唯一映射：路由/前端都不得再用 runtime 名或
 * 方法存在性自行推导。新增动作先补 manifest surface，再改这里。
 * `terminal.pty` 是中性 PTY 协议 surface（本批加入 manifest）。
 */
export const EXPERIENCE_ACTION_SURFACES: Record<ExperienceActionId, readonly string[]> = {
  'checkpoint.restore': ['branch.checkpoint'],
  'checkpoint.create': ['branch.checkpoint'],
  'branch.fork': ['branch.fork'],
  'branch.revert': ['branch.revert'],
  'branch.unrevert': ['branch.unrevert'],
  'branch.diff': ['branch.diff', 'branch.vcs'],
  'run.control': ['branch.runState'],
  'session.worktree': ['session.worktree'],
  'session.summarize': ['session.summarize'],
  'session.switch-agent': ['session.switchAgent'],
  'session.switch-model': ['session.switchModel'],
  'session.discovery': ['discovery.list'],
  'approval.permission': ['approval.permissionReply', 'approval.permissionList'],
  'approval.question': ['approval.question.list', 'approval.question.reply', 'approval.question.reject'],
  'background.jobs': [],
  'terminal.attach': ['terminal.pty'],
  'prompt.steer': ['prompt.delivery.steer'],
  'session.background': ['session.background'],
  'mcp.manage': ['mcp.list', 'mcp.connect', 'mcp.disconnect'],
  'mcp.config.write': ['mcp.config.preview', 'mcp.config.apply', 'mcp.config.remove', 'mcp.config.restore'],
};

/**
 * 回合进行中（busy）不得进入的动作——它们要么会改写会话历史/工作区，要么要求稳定状态。
 * 纯查询（diff/discovery/switch/MCP/approval）与 busy-only 动作（steer / run.control 的
 * suspend）不受限：busy-only 动作正是只在运行中的回合里有意义，禁用它们等于把功能删掉。
 */
const BUSY_BLOCKED: ReadonlySet<ExperienceActionId> = new Set<ExperienceActionId>([
  'checkpoint.restore',
  'checkpoint.create',
  'branch.fork',
  'branch.revert',
  'branch.unrevert',
  'session.summarize',
]);

/** manifest 未声明的 surface（未来协议）视为不可用，而不是抛错中断整个投影。 */
function surfacesAvailable(access: RuntimeAccess | null, ids: readonly string[]): boolean {
  if (ids.length === 0) return true;
  if (!access) return false;
  return ids.every((id) => {
    try {
      return access.can(id);
    } catch {
      return false;
    }
  });
}

function surfaceSemantics(
  access: RuntimeAccess | null,
  id: string,
): Record<string, unknown> {
  try {
    return (access?.semantics<Record<string, unknown>>(id) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function revertSemantics(access: RuntimeAccess | null): { files?: boolean; undo?: boolean } {
  return surfaceSemantics(access, 'branch.revert') as { files?: boolean; undo?: boolean };
}

function nonEmpty(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return value && Object.keys(value).length > 0 ? value : undefined;
}

function semanticSurfaceAvailable(access: RuntimeAccess | null, id: string): boolean {
  try {
    return !!access?.can(id);
  } catch {
    return false;
  }
}

function semanticsFor(
  id: ExperienceActionId,
  access: RuntimeAccess | null,
  supported: boolean,
): Record<string, unknown> | undefined {
  if (!supported) return undefined;
  switch (id) {
    case 'checkpoint.restore': {
      const revert = revertSemantics(access);
      // sessionBacked 明确服务端模式：前端不得再用 enabled 推断（busy 时仍可读）。
      return { sessionBacked: true, files: revert.files !== false, undo: revert.undo === true };
    }
    case 'branch.revert': {
      const revert = revertSemantics(access);
      return { files: revert.files !== false, undo: revert.undo === true };
    }
    case 'run.control': {
      // 适配器声明的语义（如 pi 的 requireBusy）原样透传，投影不得覆盖；这里只补
      // gateway run 路由确实提供、投影确实掌握的 verb（surface 可用即 suspend/resume/discard 全在）。
      const declared = surfaceSemantics(access, 'branch.runState');
      return { suspend: true, resume: true, discard: true, ...declared };
    }
    case 'prompt.steer':
      return {
        boundary: (surfaceSemantics(access, 'prompt.delivery.steer').boundary as string) ?? 'unspecified',
        queue: true,
      };
    case 'mcp.manage':
      return nonEmpty(surfaceSemantics(access, 'mcp.list'));
    case 'background.jobs':
      // MAFW 本地任务始终可用；其余来源按 runtime surface 真实点亮（三源统一，Task 3）：
      //  - subagent：会话子列表（runtime.session.children）
      //  - runtime-shell：runtime 拥有 shell 面（生命周期经事件流上报 → background.job.updated）
      // verbs 是该 façade 的稳定动作集，`session.background` 仍是独立动作（把工具转后台）。
      return {
        sources: [
          'mafw-task',
          ...(semanticSurfaceAvailable(access, 'session.children') ? ['subagent'] : []),
          ...(semanticSurfaceAvailable(access, 'session.shell') ? ['runtime-shell'] : []),
        ],
        verbs: ['list', 'output', 'cancel'],
      };
    case 'terminal.attach':
      return nonEmpty(surfaceSemantics(access, 'terminal.pty'));
    default:
      return undefined;
  }
}

export function projectExperienceActions(
  access: RuntimeAccess | null,
  ctx: ExperienceProjectionContext = {},
): Record<ExperienceActionId, ActionDescriptor> {
  const busy = ctx.busy === true;
  const actions = {} as Record<ExperienceActionId, ActionDescriptor>;
  for (const id of EXPERIENCE_ACTION_IDS) {
    const surfaceOk = surfacesAvailable(access, EXPERIENCE_ACTION_SURFACES[id]);
    const worktree = id === 'session.worktree' ? worktreeDescriptor(ctx, surfaceOk) : null;
    const supported = worktree ? worktree.supported : surfaceOk;
    const environmentBlocked = worktree ? !worktree.enabled : false;
    const busyBlocked = supported && busy && BUSY_BLOCKED.has(id);
    const enabled = supported && !environmentBlocked && !busyBlocked;
    const reason = enabled
      ? undefined
      : !supported
        ? 'unsupported'
        : environmentBlocked
          ? worktree?.reason ?? 'missing-data'
          : 'busy';
    actions[id] = action(supported, enabled, reason, semanticsFor(id, access, supported));
  }
  return actions;
}
