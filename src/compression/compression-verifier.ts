import { CompactedLesson, CompressionVerification } from '../types/compression';

/**
 * Compression Verifier — 压缩完整性验证器
 *
 * 职责：在 L2 Compaction 后，运行 5 项验证清单，确保压缩不丢失关键信息。
 *
 * 5 项验证：
 *   1. loop 不丢失
 *   2. result 不丢失
 *   3. domain 不丢失
 *   4. lesson 核心动作不丢失
 *   5. violation.rule 不丢失（若存在）
 */
export class CompressionVerifier {
  private checks: CompressionVerification[] = [
    {
      ruleId: 'V1',
      description: 'loop 字段不能丢失',
      check: (orig, comp) => comp.loop === orig.loop
    },
    {
      ruleId: 'V2',
      description: 'result 字段不能丢失',
      check: (orig, comp) => comp.result === orig.result
    },
    {
      ruleId: 'V3',
      description: 'domain 字段不能丢失',
      check: (orig, comp) => comp.domain === orig.domain
    },
    {
      ruleId: 'V4',
      description: 'lesson 核心动作不能丢失',
      check: (orig, comp) => {
        const actionVerbs = ['必须', '禁止', '应该', '不得', '需要', 'must', 'must not', 'should', 'need to', 'ensure'];
        const hasAction = actionVerbs.some(v => orig.lesson.toLowerCase().includes(v.toLowerCase()));
        if (!hasAction) return true; // 原 lesson 无动作词，无需检查
        return actionVerbs.some(v => comp.lesson.toLowerCase().includes(v.toLowerCase()));
      }
    },
    {
      ruleId: 'V5',
      description: 'violation.rule 不能丢失（若存在）',
      check: (orig, comp) => {
        if (!orig.violation) return true;
        return !!comp.violation && comp.violation.rule === orig.violation.rule;
      }
    }
  ];

  /**
   * 验证单个 CompactedLesson
   */
  verify(original: any, compacted: CompactedLesson): { pass: boolean; failures: string[] } {
    const failures: string[] = [];
    for (const c of this.checks) {
      if (!c.check(original, compacted)) {
        failures.push(`[${c.ruleId}] ${c.description}`);
      }
    }
    return { pass: failures.length === 0, failures };
  }

  /**
   * 批量验证 lessons 文件
   */
  verifyFile(lessons: CompactedLesson[]): { pass: boolean; failures: string[] } {
    const failures: string[] = [];
    for (const lesson of lessons) {
      if (!lesson._compacted) {
        failures.push(`[UNCOMPACTED] Lesson loop=${lesson.loop} 未标记 _compacted`);
      }
    }
    return { pass: failures.length === 0, failures };
  }
}
