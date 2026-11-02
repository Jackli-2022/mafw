import type { RuntimeAccess } from '../../runtime/runtime-access';
import { action, type ActionDescriptor } from '../../experience/experience-contract';

export interface CheckpointActionInput {
  id: string;
  kind?: 'auto' | 'manual';
  anchorMessageID?: string;
  messageID?: string;
  snapshotTree?: string | null;
  filesKnown?: boolean;
  files?: Array<{ patch?: string }>;
}

export interface CheckpointActions {
  restoreConversation: ActionDescriptor;
  restoreFiles: ActionDescriptor;
  restoreBoth: ActionDescriptor;
}

function invertible(patch: string | undefined): boolean {
  if (!patch?.trim()) return false;
  if (patch.includes('--- /dev/null') || patch.includes('+++ /dev/null')) return false;
  if (/^new file mode /m.test(patch) || /^deleted file mode /m.test(patch)) return false;
  return /^@@ /m.test(patch);
}

function fileState(targets: CheckpointActionInput[], access: RuntimeAccess): ActionDescriptor {
  const revert = access.semantics<{ files?: boolean; undo?: boolean }>('branch.revert');
  // 适配器根本无法恢复文件 → 功能面不存在；数据缺失则是对象级不可用。
  if (revert.files === false) return action(false, false);
  let sawFiles = false;
  for (const cp of targets) {
    if (typeof cp.snapshotTree === 'string' && cp.snapshotTree.length > 0) {
      sawFiles = true;
      continue;
    }
    if (cp.filesKnown === true && Array.isArray(cp.files)) {
      sawFiles = true;
      if (!cp.files.every((f) => invertible(f.patch))) {
        return action(true, false, 'non-invertible-patch');
      }
      continue;
    }
    return action(true, false, 'missing-data');
  }
  if (!sawFiles) return action(true, false, 'missing-data');
  return action(true, true);
}

export function projectCheckpointActions(
  checkpoint: CheckpointActionInput,
  ctx: { access: RuntimeAccess; busy: boolean; targets: CheckpointActionInput[] },
): CheckpointActions {
  if (ctx.busy) {
    // busy 是暂时限制：功能面仍存在，只是此刻不可执行。
    const busy = action(true, false, 'busy');
    return { restoreConversation: busy, restoreFiles: busy, restoreBoth: busy };
  }

  const file = fileState(ctx.targets.length > 0 ? ctx.targets : [checkpoint], ctx.access);
  const revert = ctx.access.semantics<{ files?: boolean; undo?: boolean }>('branch.revert');
  const warningKey = file.enabled && revert.files !== false
    ? revert.undo === true
      ? 'restore-conversation-files-undoable'
      : 'restore-conversation-files-no-undo'
    : 'restore-conversation-only-no-undo';

  if (checkpoint.kind === 'manual') {
    return {
      restoreConversation: action(false, false),
      restoreFiles: file,
      restoreBoth: action(false, false),
    };
  }
  return {
    restoreConversation: action(true, true),
    restoreFiles: file,
    restoreBoth: {
      ...(file.supported
        ? action(true, file.enabled, file.enabled ? undefined : file.reason)
        : action(false, false)),
      warningKey,
    },
  };
}
