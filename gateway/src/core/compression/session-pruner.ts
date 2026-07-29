import { WaveDigest, TokenBudgetConfig } from '../types/compression';

/**
 * Session Pruner — L1 实时剪枝器
 *
 * 职责：Session 过长时自动压缩历史内容，保留当前 Wave 完整上下文。
 *
 * 策略（从文档 §3.1 提取）：
 *   ┌──────────────┬─────────────┬──────────────┬────────────┐
 *   │ 内容类型      │ 当前 Wave   │ 已完成 Wave  │ 处理方式   │
 *   ├──────────────┼─────────────┼──────────────┼────────────┤
 *   │ System Prompt │ 完整保留    │ 完整保留    │ 不可压缩   │
 *   │ Parametric Δ  │ 完整保留    │ 完整保留    │ 不可压缩   │
 *   │ Task 定义     │ 完整保留    │ 摘要        │ 保留ID+状态│
 *   │ 代码编辑      │ 完整保留    │ 摘要        │ 保留路径   │
 *   │ 工具输出      │ 完整保留    │ 截断        │ 最后10行   │
 *   │ 对话历史      │ 完整保留    │ 压缩        │ Wave摘要   │
 *   │ 成功测试日志  │ 完整保留    │ 丢弃        │ 只保留标记 │
 *   │ 失败测试日志  │ 完整保留    │ 完整保留    │ 不压缩     │
 *   └──────────────┴─────────────┴──────────────┴────────────┘
 *
 * 触发条件：Session 达到 6000 tokens (75% 压缩阈值) 时触发
 */
export class SessionPruner {
  private config: TokenBudgetConfig;

  constructor(config: Partial<TokenBudgetConfig> = {}) {
    this.config = {
      maxContextTokens: 8000,
      compressionThreshold: 0.6, // 4800 tokens
      currentWaveReserve: 2000,
      toolOutputReserve: 10,
      ...config
    };
  }

  /**
   * 检查是否需要剪枝
   */
  shouldPrune(currentTokens: number): boolean {
    return currentTokens >= this.config.maxContextTokens * this.config.compressionThreshold;
  }

  /**
   * 执行剪枝：将已完成 Wave 的内容压缩为摘要
   */
  prune(session: any[], currentWaveId: string, completedDigests: WaveDigest[]): any[] {
    const pruned: any[] = [];
    let currentTokens = 0;

    for (const item of session) {
      // 当前 Wave 的内容完整保留
      if (item.waveId === currentWaveId) {
        pruned.push(item);
        currentTokens += this.estimateTokens(item);
        continue;
      }

      // 已完成 Wave 的内容按类型压缩
      const compressed = this.compressItem(item);
      if (compressed) {
        pruned.push(compressed);
        currentTokens += this.estimateTokens(compressed);
      }
    }

    // 在 Session 开头插入已完成 Wave 的摘要卡片
    if (completedDigests.length > 0) {
      const digestBlock = this.renderDigests(completedDigests);
      pruned.unshift({ type: 'wave_digests', content: digestBlock });
    }

    return pruned;
  }

  /**
   * 压缩单个 Session 条目
   */
  private compressItem(item: any): any | null {
    switch (item.type) {
      case 'system_prompt':
      case 'parametric_delta':
      case 'test_log_fail':
        // 不可压缩
        return item;

      case 'task_definition':
        return {
          ...item,
          content: `[SUMMARY] Task ${item.taskId}: ${item.status || 'completed'}`,
          _compressed: true
        };

      case 'code_edit':
        return {
          ...item,
          content: `[SUMMARY] ${item.filePath}: ${item.linesChanged || 'changed'}`,
          _compressed: true
        };

      case 'tool_output':
        return {
          ...item,
          content: this.truncateToolOutput(item.content),
          _compressed: true
        };

      case 'dialogue':
        // 丢弃对话历史，已包含在 Wave 摘要中
        return null;

      case 'test_log_success':
        // 只保留标记
        return { type: 'test_log_success', status: 'PASS', _compressed: true };

      default:
        return item;
    }
  }

  /**
   * 工具输出截断：保留最后 N 行
   */
  private truncateToolOutput(output: string): string {
    const lines = output.split('\n');
    if (lines.length <= this.config.toolOutputReserve) return output;
    const lastLines = lines.slice(-this.config.toolOutputReserve);
    return `[TRUNCATED: ${lines.length} lines → last ${this.config.toolOutputReserve}]\n${lastLines.join('\n')}`;
  }

  /**
   * 渲染 Wave 摘要卡片
   */
  private renderDigests(digests: WaveDigest[]): string {
    const lines = ['[WAVE_DIGESTS COMPLETED]'];
    for (const d of digests) {
      lines.push(
        `[WAVE_DIGEST id=${d.id} status=${d.status} tokens_saved=${d.tokens_saved}]`,
        `  domain: ${d.domain}`,
        `  completed_tasks: [${d.completed_tasks.join(', ')}]`,
        `  key_decisions: [${d.key_decisions.join(', ')}]`,
        `  blockers: [${d.blockers.join(', ')}]`,
        `  files_changed: [${d.files_changed.join(', ')}]`
      );
    }
    return lines.join('\n');
  }

  /**
   * 粗略 token 估算
   */
  private estimateTokens(item: any): number {
    const text = typeof item === 'string' ? item : JSON.stringify(item);
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = text.split(/\s+/).filter(w => /[a-zA-Z]/.test(w)).length;
    return Math.ceil(chineseChars + englishWords * 0.75);
  }
}
