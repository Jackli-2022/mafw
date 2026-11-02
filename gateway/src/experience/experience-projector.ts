import type { RuntimeAccess } from '../runtime/runtime-access';
import {
  EXPERIENCE_ACTION_IDS,
  action,
  type ActionDescriptor,
  type ExperienceActionId,
} from './experience-contract';

export interface ExperienceProjectionContext {
  sessionID?: string;
  busy?: boolean;
}

/**
 * action → 必须同时可用的 runtime surface。空数组 = 纯本地能力（不依赖 runtime）。
 *
 * 这张表是「动作面 ↔ capability」的唯一映射：路由/前端都不得再用 runtime 名或
 * 方法存在性自行推导。新增动作先补 manifest surface，再改这里。
 * `terminal.pty` 由中性 PTY 协议任务加入 manifest；在此之前 attach 恒 unsupported。
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
 * 纯查询（diff/discovery/switch/MCP/approval）与 busy-only 动作（steer）不受限。
 */
const BUSY_BLOCKED: ReadonlySet<ExperienceActionId> = new Set<ExperienceActionId>([
  'checkpoint.restore',
  'checkpoint.create',
  'branch.fork',
  'branch.revert',
  'branch.unrevert',
  'run.control',
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
    case 'run.control':
      // suspend 只对运行中的回合有意义（requireBusy），而 resume/discard 需要稳定状态；
      // descriptor 的 enabled 表示「当前可进入 run 状态变更」，客户端按 verb 读取 semantics。
      return { suspend: true, resume: true, discard: true, requireBusy: true };
    case 'prompt.steer':
      return {
        boundary: (surfaceSemantics(access, 'prompt.delivery.steer').boundary as string) ?? 'unspecified',
        queue: true,
      };
    case 'mcp.manage':
      return nonEmpty(surfaceSemantics(access, 'mcp.list'));
    case 'background.jobs':
      // MAFW 本地任务始终可用；runtime shell / 子代理来源随中性 jobs 面扩展。
      return { sources: ['mafw-task'] };
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
    const supported = surfacesAvailable(access, EXPERIENCE_ACTION_SURFACES[id]);
    const enabled = supported && !(busy && BUSY_BLOCKED.has(id));
    actions[id] = action(
      supported,
      enabled,
      enabled ? undefined : supported ? 'busy' : 'unsupported',
      semanticsFor(id, access, supported),
    );
  }
  return actions;
}
