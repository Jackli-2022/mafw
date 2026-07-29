import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { CompactedLesson } from '../types/compression';
import { ConstraintDelta, PromptDelta, PatternDelta, Delta } from '../types/parametric';

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
export class MemoryExtractor {
  /**
   * 从单个 Lesson 提取 Δ
   */
  extract(lesson: CompactedLesson): Delta[] {
    const deltas: Delta[] = [];

    // 1. Constraint Δ 提取：若存在 violation，提取为硬约束
    if (lesson.violation && lesson.violation.rule) {
      const constraintId = this.sanitizeId(`constraint-${lesson.domain}-${lesson.loop}`);
      const constraint: ConstraintDelta = {
        id: constraintId,
        type: 'constraint',
        scope: ['plan', 'execute'],
        enforcement: 'hard',
        trigger_condition: {
          domain: [lesson.domain],
          task_type: ['coding', 'test'],
          loop_stage: ['planning', 'executing']
        },
        rule: lesson.violation.rule,
        origin: {
          goal: lesson.domain, // 简化
          loop: lesson.loop,
          task: lesson.task
        },
        created_at: new Date().toISOString(),
        energy_score: 0.65,
        verified: false,
        priority: 9
      };
      deltas.push(constraint);
    }

    // 2. Prompt Δ 提取：从 lesson 文本提取检查清单
    if (lesson.lesson && lesson.lesson.length > 10) {
      const promptId = this.sanitizeId(`prompt-${lesson.domain}-${lesson.loop}`);
      const prompt: PromptDelta = {
        id: promptId,
        type: 'prompt',
        scope: ['plan'],
        enforcement: 'soft',
        trigger_condition: {
          domain: [lesson.domain],
          keywords: MemoryExtractor.extractKeywords(lesson.lesson)
        },
        prompt_delta: `## [PARAMETRIC] ${lesson.domain} 强制检查\n${lesson.lesson}`,
        origin: {
          goal: lesson.domain,
          loop: lesson.loop,
          task: lesson.task
        },
        created_at: new Date().toISOString(),
        energy_score: 0.5,
        verified: false,
        priority: 7,
        max_injections: 5,
        injection_count: 0
      };
      deltas.push(prompt);
    }

    // 3. Pattern Δ 提取：只在特定 domain 触发（如 auth 模块的 Wave 分解模式）
    if (['auth', 'api', 'user-system'].includes(lesson.domain)) {
      const patternId = this.sanitizeId(`pattern-${lesson.domain}-wave`);
      const pattern: PatternDelta = {
        id: patternId,
        type: 'pattern',
        scope: ['plan'],
        enforcement: 'pattern',
        trigger_condition: {
          domain: [lesson.domain],
          goal_keywords: ['login', 'register', 'auth', 'permission']
        },
        pattern_template: `## Wave 分解模式: ${lesson.domain} 模块\n适用场景: 新${lesson.domain}模块\n强制 Wave 划分: 契约层 → 核心层 → 集成层`,
        usage_stats: { injected_count: 0, success_count: 0 },
        origin: {
          goal: lesson.domain,
          loop: lesson.loop,
          task: lesson.task
        },
        created_at: new Date().toISOString(),
        energy_score: 0.67,
        verified: false,
        priority: 6
      };
      deltas.push(pattern);
    }

    return deltas.slice(0, 2); // 最多 2 个
  }

  /**
   * 从 Goal 的 lessons 文件批量提取
   */
  extractFromFile(lessonsPath: string): Delta[] {
    if (!fs.existsSync(lessonsPath)) return [];
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    // 简化：假设 YAML 块已存在于 markdown 中
    // 实际应使用 YAML front-matter 解析器
    return [];
  }

  private sanitizeId(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  }

  private static extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\u4e00-\u9fff\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3);
    return Array.from(new Set(words)).slice(0, 5);
  }
}
