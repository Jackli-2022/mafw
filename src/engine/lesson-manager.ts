import * as fs from 'fs';
import * as path from 'path';
import { RawLesson, CompactedLesson } from '../types/compression';
import { LessonCompactor } from '../compression/lesson-compactor';
import { CompressionVerifier } from '../compression/compression-verifier';
import { MemoryIndexManager } from '../compression/memory-index';

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
export class LessonManager {
  private lessonsDir: string;
  private compactor: LessonCompactor;
  private verifier: CompressionVerifier;
  private index: MemoryIndexManager;

  constructor(projectDir: string = '.') {
    this.lessonsDir = path.join(projectDir, '.opencode/mafw/lessons');
    if (!fs.existsSync(this.lessonsDir)) fs.mkdirSync(this.lessonsDir, { recursive: true });
    this.compactor = new LessonCompactor();
    this.verifier = new CompressionVerifier();
    this.index = new MemoryIndexManager(path.join(projectDir, '.opencode/mafw/memory-index.json'));
  }

  /**
   * 写入一个自然语言 Lesson。
   * 返回 lesson 在文件中的 anchor（如 "L12"）。
   */
  async writeLesson(
    goalId: string,
    loop: number,
    data: {
      trigger: string;
      result: string;
      reason: string;
      executeResult: any;
    }
  ): Promise<string> {
    const file = path.join(this.lessonsDir, `${goalId}.md`);
    const raw: RawLesson = {
      loop,
      trigger: data.trigger,
      result: data.result,
      domain: data.executeResult.domain || 'general',
      task: data.executeResult.currentTask || 'unknown',
      violation: {
        rule: data.reason,
        type: 'boundary_cross',
        severity: 'high'
      },
      root_cause: data.reason,
      lesson: `Lesson from Loop ${loop}: ${data.reason}`,
      energy: 'high',
      files: data.executeResult.filesChanged || [],
      created_at: new Date().toISOString()
    };

    const block = this.renderRawBlock(raw);
    const isNew = !fs.existsSync(file);
    fs.appendFileSync(file, block, 'utf-8');

    // 更新索引
    const anchor = this.getAnchor(file, block);
    this.index.add({
      id: `${goalId}-loop-${loop}`,
      file,
      anchor,
      tags: MemoryIndexManager.extractTags(raw.lesson + ' ' + raw.domain),
      energy: 0.8,
      type: 'constraint_source',
      loop,
      goal: goalId
    });
    this.index.save();

    return anchor;
  }

  /**
   * 压缩最后写入的 Lesson（Stop Hook 调用）
   */
  compactLastLesson(goalId: string): void {
    const file = path.join(this.lessonsDir, `${goalId}.md`);
    if (!fs.existsSync(file)) return;

    const content = fs.readFileSync(file, 'utf-8');
    const blocks = content.split(/###\s+Loop\s+/).filter(Boolean);
    if (blocks.length === 0) return;

    const lastBlock = blocks[blocks.length - 1];
    // 解析为 RawLesson（简化解析）
    const raw = this.parseRawBlock('Loop ' + lastBlock);
    if (!raw) return;

    const result = this.compactor.compact(raw);
    if (result.success) {
      // 验证通过，替换为压缩版本
      const newContent = content.replace(
        /###\s+Loop\s+\d+\s+[\s\S]*$/,
        this.renderCompactedBlock(result.compacted)
      );
      fs.writeFileSync(file, newContent, 'utf-8');
    }
  }

  /**
   * 加载所有 lessons（不推荐，用于重建索引）
   */
  loadAll(goalId: string): CompactedLesson[] {
    const file = path.join(this.lessonsDir, `${goalId}.md`);
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file, 'utf-8');
    return this.parseAllBlocks(content);
  }

  /**
   * 加载相关 lessons（由 RalphLoop 调用，最多 3 条）
   */
  loadRelevant(goalId: string, keywords: string[], maxResults = 3): CompactedLesson[] {
    const all = this.loadAll(goalId);
    // 简单关键词过滤
    const scored = all.map(l => {
      const score = keywords.filter(kw =>
        l.lesson.toLowerCase().includes(kw.toLowerCase()) ||
        l.domain.toLowerCase().includes(kw.toLowerCase())
      ).length;
      return { lesson: l, score };
    }).sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map(s => s.lesson);
  }

  // ── 渲染/解析辅助 ──

  private renderRawBlock(raw: RawLesson): string {
    const lines = [
      `### Loop ${raw.loop} (${raw.created_at})`,
      `loop: ${raw.loop}`,
      `trigger: ${raw.trigger}`,
      `result: ${raw.result}`,
      `domain: ${raw.domain}`,
      `task: "${raw.task}"`,
      raw.violation ? `violation:\n  rule: "${raw.violation.rule}"\n  type: ${raw.violation.type}\n  severity: ${raw.violation.severity}` : '',
      raw.root_cause ? `root_cause: ${raw.root_cause}` : '',
      `lesson: "${raw.lesson}"`,
      `energy: ${raw.energy}`,
      `files: [${raw.files.map(f => `"${f}"`).join(', ')}]`,
      ''
    ];
    return lines.join('\n');
  }

  private renderCompactedBlock(compacted: CompactedLesson): string {
    const lines = [
      `### Loop ${compacted.loop} (${compacted.created_at})`,
      `loop: ${compacted.loop}`,
      `trigger: ${compacted.trigger}`,
      `result: ${compacted.result}`,
      `domain: ${compacted.domain}`,
      `task: "${compacted.task}"`,
      compacted.violation ? `violation:\n  rule: "${compacted.violation.rule}"\n  type: ${compacted.violation.type}\n  severity: ${compacted.violation.severity}` : '',
      compacted.root_cause ? `root_cause: ${compacted.root_cause}` : '',
      `lesson: "${compacted.lesson}"`,
      `energy: ${compacted.energy}`,
      `files: [${compacted.files.map(f => `"${f}"`).join(', ')}]`,
      `# _compacted: true, saved ${compacted._originalTokens - compacted._compactedTokens} tokens`,
      ''
    ];
    return lines.join('\n');
  }

  private parseRawBlock(block: string): RawLesson | null {
    try {
      const loop = parseInt(block.match(/loop:\s*(\d+)/)?.[1] || '0');
      const trigger = block.match(/trigger:\s*(.+)/)?.[1] || '';
      const result = block.match(/result:\s*(.+)/)?.[1] || '';
      const domain = block.match(/domain:\s*(.+)/)?.[1] || '';
      const task = block.match(/task:\s*"?(.+?)"?\s*$/)?.[1] || '';
      const lesson = block.match(/lesson:\s*"?(.+?)"?\s*$/)?.[1] || '';
      const energy = (block.match(/energy:\s*(.+)/)?.[1] || 'medium') as any;
      const files = (block.match(/files:\s*\[(.+?)\]/)?.[1] || '').split(',').map(f => f.trim().replace(/"/g, '')).filter(Boolean);
      return { loop, trigger, result, domain, task, lesson, energy, files, created_at: new Date().toISOString() };
    } catch {
      return null;
    }
  }

  private parseAllBlocks(content: string): CompactedLesson[] {
    const blocks = content.split(/###\s+Loop\s+/).filter(Boolean);
    return blocks.map(b => {
      const raw = this.parseRawBlock('Loop ' + b);
      if (!raw) return null;
      return { ...raw, _compacted: /_compacted/.test(b), _originalTokens: 0, _compactedTokens: 0 } as CompactedLesson;
    }).filter(Boolean) as CompactedLesson[];
  }

  private getAnchor(file: string, block: string): string {
    const content = fs.readFileSync(file, 'utf-8');
    const idx = content.indexOf(block.split('\n')[0]);
    const lines = content.substring(0, idx).split('\n').length;
    return `L${lines}`;
  }
}
