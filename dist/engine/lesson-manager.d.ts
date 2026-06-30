import { CompactedLesson } from '../types/compression';
/**
 * Lesson Manager — L2 经验档案管理器
 *
 * 职责：
 *   1. 写入自然语言 Lesson（Review 失败时）
 *   2. 写入前调用 L2 LessonCompactor 压缩为 YAML
 *   3. 写入后异步更新 L2 MemoryIndex
 *   4. 提供加载接口（loadAll / loadRelevant）
 *
 * 文件结构：
 *   .opencode/mafw/lessons/{goal_id}.md
 */
export declare class LessonManager {
    private lessonsDir;
    private compactor;
    private verifier;
    private index;
    constructor(projectDir?: string);
    /**
     * 写入一个自然语言 Lesson。
     * 返回 lesson 在文件中的 anchor（如 "L12"）。
     */
    writeLesson(goalId: string, loop: number, data: {
        trigger: string;
        result: string;
        reason: string;
        executeResult: any;
    }): Promise<string>;
    /**
     * 压缩最后写入的 Lesson（Stop Hook 调用）
     */
    compactLastLesson(goalId: string): void;
    /**
     * 加载所有 lessons（不推荐，用于重建索引）
     */
    loadAll(goalId: string): CompactedLesson[];
    /**
     * 加载相关 lessons（由 RalphLoop 调用，最多 3 条）
     */
    loadRelevant(goalId: string, keywords: string[], maxResults?: number): CompactedLesson[];
    private renderRawBlock;
    private renderCompactedBlock;
    private parseRawBlock;
    private parseAllBlocks;
    private getAnchor;
}
//# sourceMappingURL=lesson-manager.d.ts.map