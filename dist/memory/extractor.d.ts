import { CompactedLesson } from '../types/compression';
import { Delta } from '../types/parametric';
/**
 * Memory Extractor — L2 → L3 Δ 提取器
 *
 * 职责：从 Review 失败后的 L2 YAML Lesson 中自动提取参数化记忆（Δ）。
 *
 * 提取规则：
 *   1. 只输出 enforcement: hard 的布尔约束（可验证）
 *   2. 禁止软性建议（如"建议"、"可以考虑"）
 *   3. 必须标注 origin_loop 和 origin_task
 *   4. 最多生成 0~2 个 Δ
 *
 * 提取类型：
 *   - Constraint Δ: 从 violation.rule 提取（硬约束）
 *   - Prompt Δ: 从 lesson 中的检查清单提取（软提示）
 *   - Pattern Δ: 从 Wave 分解模式提取（仅在特定 domain 出现）
 */
export declare class MemoryExtractor {
    /**
     * 从单个 Lesson 提取 Δ
     */
    extract(lesson: CompactedLesson): Delta[];
    /**
     * 从 Goal 的 lessons 文件批量提取
     */
    extractFromFile(lessonsPath: string): Delta[];
    private sanitizeId;
    private static extractKeywords;
}
//# sourceMappingURL=extractor.d.ts.map