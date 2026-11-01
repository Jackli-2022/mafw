import type { RuntimeAccess } from '../../runtime/runtime-access';
import type { ActionDescriptor } from '../../experience/experience-contract';

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
  if (revert.files === false) return { enabled: false, reason: 'unsupported' };
  let sawFiles = false;
  for (const cp of targets) {
    if (typeof cp.snapshotTree === 'string' && cp.snapshotTree.length > 0) {
      sawFiles = true;
      continue;
    }
    if (cp.filesKnown === true && Array.isArray(cp.files)) {
      sawFiles = true;
      if (!cp.files.every((f) => invertible(f.patch))) {
        return { enabled: false, reason: 'non-invertible-patch' };
      }
      continue;
    }
    return { enabled: false, reason: 'missing-data' };
  }
  if (!sawFiles) return { enabled: false, reason: 'missing-data' };
  return { enabled: true };
}

export function projectCheckpointActions(
  checkpoint: CheckpointActionInput,
  ctx: { access: RuntimeAccess; busy: boolean; targets: CheckpointActionInput[] },
): CheckpointActions {
  if (ctx.busy) {
    const busy = { enabled: false, reason: 'busy' as const };
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
      restoreConversation: { enabled: false, reason: 'unsupported' },
      restoreFiles: file,
      restoreBoth: { enabled: false, reason: 'unsupported' },
    };
  }
  return {
    restoreConversation: { enabled: true },
    restoreFiles: file,
    restoreBoth: {
      enabled: file.enabled,
      ...(file.enabled ? {} : { reason: file.reason }),
      warningKey,
    },
  };
}
