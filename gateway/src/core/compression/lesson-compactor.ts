import { RawLesson, CompactedLesson, CompactionResult } from '../types/compression';

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
export class LessonCompactor {
  private readonly COMPACTION_THRESHOLD = 300;

  /**
   * 判断是否需要压缩
   */
  shouldCompact(raw: RawLesson): boolean {
    const tokens = this.estimateTokens(raw.lesson);
    return tokens > this.COMPACTION_THRESHOLD;
  }

  /**
   * 执行压缩：RawLesson → CompactedLesson
   */
  compact(raw: RawLesson): CompactionResult {
    const originalTokens = this.estimateTokens(raw.lesson);

    const compacted: CompactedLesson = {
      loop: raw.loop,
      trigger: raw.trigger,
      result: raw.result,
      domain: raw.domain,
      task: raw.task,
      violation: raw.violation,
      root_cause: raw.root_cause,
      details: raw.details,
      lesson: this.summarizeLesson(raw.lesson),
      energy: raw.energy,
      files: raw.files,
      metrics: raw.metrics,
      applied_deltas: raw.applied_deltas,
      created_at: raw.created_at,
      _compacted: true,
      _originalTokens: originalTokens,
      _compactedTokens: this.estimateTokens(this.summarizeLesson(raw.lesson))
    };

    const errors = this.verifyCompaction(raw, compacted);
    return {
      success: errors.length === 0,
      original: raw,
      compacted,
      errors
    };
  }

  /**
   * 将自然语言 lesson 提炼为简洁的陈述句。
   * 规则：
   *   - 移除"在实现...时"、"这导致..."等背景
   *   - 保留"必须"、"禁止"、"应该"等动作词
   *   - 控制在 30 个中文词或 50 个英文词以内
   */
  private summarizeLesson(lesson: string): string {
    // 简单启发式：提取包含"必须/禁止/应该/不得/需要"的句子
    const sentences = lesson.split(/[。\.!！?？]/);
    const core = sentences.filter(s =>
      /(必须|禁止|应该|不得|需要|需|务必|严禁|确保|检查|验证|引用|查阅|对比|禁止|不能|不准|不允许|must|must not|should|need to|ensure|check|verify|reference|compare)/i.test(s)
    );
    if (core.length > 0) {
      return core.map(s => s.trim()).join('。').substring(0, 200);
    }
    //  fallback：直接截断
    return lesson.substring(0, 120).trim() + (lesson.length > 120 ? '...' : '');
  }

  /**
   * 压缩完整性验证（5 项检查清单）
   */
  private verifyCompaction(original: RawLesson, compacted: CompactedLesson): string[] {
    const errors: string[] = [];

    // 1. loop 不能丢失
    if (compacted.loop !== original.loop) errors.push('loop 字段丢失');

    // 2. result 不能丢失
    if (compacted.result !== original.result) errors.push('result 字段丢失');

    // 3. domain 不能丢失
    if (compacted.domain !== original.domain) errors.push('domain 字段丢失');

    // 4. lesson 核心动作不能丢失（检查是否包含关键动词）
    const originalVerbs = this.extractActionVerbs(original.lesson);
    const compactedVerbs = this.extractActionVerbs(compacted.lesson);
    if (originalVerbs.length > 0 && compactedVerbs.length === 0) {
      errors.push('lesson 核心动作丢失');
    }

    // 5. violation 若存在，rule 不能丢失
    if (original.violation && (!compacted.violation || !compacted.violation.rule)) {
      errors.push('violation.rule 字段丢失');
    }

    return errors;
  }

  private extractActionVerbs(text: string): string[] {
    const verbs = ['必须', '禁止', '应该', '不得', '需要', '务必', '确保', '检查', '验证', '引用', '查阅', '对比', 'must', 'must not', 'should', 'need to', 'ensure', 'check', 'verify', 'reference', 'compare'];
    return verbs.filter(v => text.toLowerCase().includes(v.toLowerCase()));
  }

  /**
   * 粗略 token 估算
   */
  private estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = text.split(/\s+/).filter(w => /[a-zA-Z]/.test(w)).length;
    return Math.ceil(chineseChars + englishWords * 0.75);
  }
}
