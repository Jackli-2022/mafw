/**
 * Write Lesson Tool — 写入 Lesson tool 函数
 *
 * 职责：
 *   1. 将 Review 失败结果写入 lessons/{goalId}-loop{loop}.md
 *   2. 格式化 Lesson 结构
 *
 * 被 mafw-review/entry.ts 调用。
 */
export interface LessonData {
    goalId: string;
    loop: number;
    reason: string;
    metrics: Record<string, number>;
    domain?: string;
    task?: string;
}
/**
 * 写入 Lesson 文件
 */
export declare function writeLesson(data: LessonData, projectDir?: string): string;
//# sourceMappingURL=write-lesson.d.ts.map