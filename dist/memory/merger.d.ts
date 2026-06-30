import { Delta, MergeResult } from '../types/parametric';
/**
 * Merger — L3 Δ 去重合并器
 *
 * 职责：
 *   1. 检测重复 Δ（相同 ID 或语义相同）
 *   2. 冲突解决（energy_score 更高者胜出）
 *   3. 版本升级（superseded 标记）
 *   4. 与 ParametricStore.ban 配合处理震荡 Δ
 */
export declare class DeltaMerger {
    /**
     * 合并候选 Δ 列表，去重并解决冲突。
     */
    merge(deltas: Delta[]): MergeResult;
    /**
     * 查找语义重复的 Δ（简单：rule 或 prompt_delta 前 100 字符相同）
     */
    private findSemanticDuplicate;
    private getContent;
}
//# sourceMappingURL=merger.d.ts.map