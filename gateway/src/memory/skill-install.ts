// W2 安装器 + Skill v1 能力注册/deopt：staging → 用户级 skills 目录，并把源记忆改写为
// 指针（记忆为索引，skill 文件为真相源——"指针优于全文"原则的闭环）。
// deopt 只移动目录，保证在 skill 下一次发现/激活边界生效；不承诺撤回已注入上下文。
import * as path from 'path';

export interface SkillDraft {
  name: string;
  memoryId: string;
  version?: number;
  sourceMemoryIds?: string[];
  sourceTraceIds?: string[];
}

export interface SkillDraftDeps {
  copyDir(src: string, dst: string): void;
  readMemory(id: string): Promise<{ id: string; memory_value: string; cue_anchors?: string[] } | null>;
  writeMemory(unit: { id: string; memory_value: string; cue_anchors?: string[] }): Promise<unknown>;
  stagingDir: string;
  skillsDir: string;
  /** Skill v1: persist the installed capability row (fail-open). */
  recordInstall?: (record: {
    name: string;
    version: number;
    sourceMemoryIds: string[];
    sourceTraceIds: string[];
  }) => void;
}

export async function installSkillDraft(
  draft: SkillDraft,
  deps: SkillDraftDeps,
): Promise<{ installed: string }> {
  const src = path.join(deps.stagingDir, draft.name);
  const dst = path.join(deps.skillsDir, draft.name);
  deps.copyDir(src, dst);
  try {
    const unit = await deps.readMemory(draft.memoryId);
    if (unit) {
      const pointer = `【已物化为 skill:${draft.name}——直接调用该 skill；本条仅作索引】\n\n`;
      await deps.writeMemory({
        ...unit,
        memory_value: pointer + unit.memory_value,
        cue_anchors: [...(unit.cue_anchors ?? []), `skill:${draft.name}`],
      });
    }
  } catch {
    // fail-open: skill 已安装；指针改写失败不阻塞
  }
  try {
    deps.recordInstall?.({
      name: draft.name,
      version: draft.version ?? 1,
      sourceMemoryIds: draft.sourceMemoryIds ?? [draft.memoryId],
      sourceTraceIds: draft.sourceTraceIds ?? [],
    });
  } catch {
    // fail-open: registry write must not un-install a copied skill
  }
  return { installed: draft.name };
}

export interface SkillDeoptDeps {
  skillsDir: string;
  renameDir(src: string, dst: string): void;
  ensureDir?(dir: string): void;
  recordStatus?(name: string, status: 'paused' | 'deprecated', reason: string): void;
  now?(): Date;
}

/**
 * Deopt a playbook at the next discovery boundary: move its directory into
 * `.disabled/` (runtime no longer discovers it), then mark the registry row.
 */
export function deoptSkill(
  name: string,
  reason: string,
  deps: SkillDeoptDeps,
): { deopted: boolean; archivedTo?: string; error?: string } {
  const safe = String(name || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(safe)) {
    return { deopted: false, error: 'invalid skill name' };
  }
  const stamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const src = path.join(deps.skillsDir, safe);
  const disabledDir = path.join(deps.skillsDir, '.disabled');
  const dst = path.join(disabledDir, `${safe}-${stamp}`);
  try {
    deps.ensureDir?.(disabledDir);
    deps.renameDir(src, dst);
  } catch (err: any) {
    return { deopted: false, error: err?.message || String(err) };
  }
  try {
    deps.recordStatus?.(safe, 'paused', reason);
  } catch {
    // fail-open: the directory is already out of discovery scope
  }
  return { deopted: true, archivedTo: dst };
}
