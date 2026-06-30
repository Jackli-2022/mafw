import { RawLesson, CompactionResult } from '../types/compression';
/**
 * Lesson Compactor — L2 结构化压实器
 *
 * 职责：将自然语言 Lesson 压缩为结构化 YAML，减少约 75% token。
 *
 * 压缩规则（从文档 §3.2 提取）：
 *   1. 保留结构化字段：loop, trigger, result, domain, task, violation, root_cause, details, lesson, energy, files
 *   2. 移除冗余描述：自然语言中的背景说明、重复信息
 *   3. 转为 YAML 格式，便于后续 MemoryExtractor 解析
 *   4. 压缩阈值：自然语言 lesson > 300 tokens 时触发
 *
 * 压缩前 (自然语言，约 500 tokens) → 压缩后 (YAML，约 120 tokens，压缩率 76%)
 */
export declare class LessonCompactor {
    private readonly COMPACTION_THRESHOLD;
    /**
     * 判断是否需要压缩
     */
    shouldCompact(raw: RawLesson): boolean;
    /**
     * 执行压缩：RawLesson → CompactedLesson
     */
    compact(raw: RawLesson): CompactionResult;
    /**
     * 将自然语言 lesson 提炼为简洁的陈述句。
     * 规则：
     *   - 移除"在实现...时"、"这导致..."等背景
     *   - 保留"必须"、"禁止"、"应该"等动作词
     *   - 控制在 30 个中文词或 50 个英文词以内
     */
    private summarizeLesson;
    /**
     * 压缩完整性验证（5 项检查清单）
     */
    private verifyCompaction;
    private extractActionVerbs;
    /**
     * 粗略 token 估算
     */
    private estimateTokens;
}
//# sourceMappingURL=lesson-compactor.d.ts.map