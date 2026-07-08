import { Delta, MergeResult, Conflict } from '../types/parametric';

/**
 * Merger — L3 Δ 去重合并器
 *
 * 职责：
 *   1. 检测重复 Δ（相同 ID 或语义相同）
 *   2. 冲突解决（energy_score 更高者胜出）
 *   3. 版本升级（superseded 标记）
 *   4. 与 ParametricStore.ban 配合处理震荡 Δ
 */
interface HookManagerLike {
  execute(event: string, context: any): Promise<void>;
}

export class DeltaMerger {
  private hookManager: HookManagerLike | null;

  constructor(hookManager?: HookManagerLike | null) {
    this.hookManager = hookManager || null;
  }

  /**
   * 合并候选 Δ 列表，去重并解决冲突。
   */
  merge(deltas: Delta[]): MergeResult {
    const merged = new Map<string, Delta>();
    const conflicts: Conflict[] = [];
    const banned: string[] = [];

    for (const d of deltas) {
      // 1. 严格去重：相同 ID
      if (merged.has(d.id)) {
        const existing = merged.get(d.id)!;
        this.hookManager?.execute('memory.contradiction', {
          existingId: existing.id,
          newId: d.id,
          field: 'id',
          existingValue: existing.id,
          newValue: d.id
        });
        if (d.energy_score > existing.energy_score) {
          conflicts.push({
            deltaId: d.id,
            reason: 'superseded',
            suggestion: `新版本 energy_score 更高 (${d.energy_score} > ${existing.energy_score})`
          });
          merged.set(d.id, d);
        } else {
          conflicts.push({
            deltaId: d.id,
            reason: 'duplicate',
            suggestion: '保留能量分更高的版本'
          });
        }
        continue;
      }

      // 2. 语义去重：相同 rule / prompt_delta 内容（简化）
      const semanticDup = this.findSemanticDuplicate(d, merged.values());
      if (semanticDup) {
        conflicts.push({
          deltaId: d.id,
          reason: 'duplicate',
          suggestion: `语义重复于 ${semanticDup.id}`
        });
        this.hookManager?.execute('memory.contradiction', {
          existingId: semanticDup.id,
          newId: d.id,
          field: 'content',
          existingValue: this.getContent(semanticDup).substring(0, 100),
          newValue: this.getContent(d).substring(0, 100)
        });
        if (d.energy_score > semanticDup.energy_score) {
          merged.set(d.id, d);
          merged.delete(semanticDup.id);
        }
        continue;
      }

      merged.set(d.id, d);
    }

    return {
      merged: Array.from(merged.values()),
      conflicts,
      banned
    };
  }

  /**
   * 查找语义重复的 Δ（简单：rule 或 prompt_delta 前 100 字符相同）
   */
  private findSemanticDuplicate(d: Delta, existing: Iterable<Delta>): Delta | null {
    const dContent = this.getContent(d).substring(0, 100);
    for (const e of existing) {
      if (this.getContent(e).substring(0, 100) === dContent) {
        return e;
      }
    }
    return null;
  }

  private getContent(d: Delta): string {
    if (d.type === 'constraint') return (d as any).rule || '';
    if (d.type === 'prompt') return (d as any).prompt_delta || '';
    if (d.type === 'pattern') return (d as any).pattern_template || '';
    return '';
  }
}
