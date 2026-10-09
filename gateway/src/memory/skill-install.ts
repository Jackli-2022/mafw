// W2 安装器：把 staging 的 skill 草稿拷进用户级 skills 目录，并把源记忆改写为
// 指针（记忆为索引，skill 文件为真相源——"指针优于全文"原则的闭环）。
// deps 注入，纯逻辑可测；真实接线在 index.ts。
import * as path from 'path';

export interface SkillDraftDeps {
  copyDir(src: string, dst: string): void;
  readMemory(id: string): Promise<{ id: string; memory_value: string; cue_anchors?: string[] } | null>;
  writeMemory(unit: { id: string; memory_value: string; cue_anchors?: string[] }): Promise<unknown>;
  stagingDir: string;
  skillsDir: string;
}

export async function installSkillDraft(
  draft: { name: string; memoryId: string },
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
  return { installed: draft.name };
}
