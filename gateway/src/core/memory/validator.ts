import { Delta } from '../types/parametric';

/**
 * Delta Validator — L3 验证与固化器
 *
 * 职责：
 *   1. Archive 阶段验证 Δ 的有效性（energy_score 调整）
 *   2. 将 verified Δ 合并到 AGENTS.md.runtime
 *   3. 更新 base-skill-manifest.yaml
 *
 * 验证规则：
 *   - 若 Δ 参与了成功的 Loop（verdict=pass），energy_score += 0.1
 *   - 若 Δ 参与了失败的 Loop（verdict=fail），energy_score -= 0.05
 *   - energy_score < 0.3 的 Δ 标记为 deprecated
 *   - verified=true 的 Δ 才能写入 AGENTS.md.runtime
 */
export class DeltaValidator {
  /**
   * 验证单个 Δ：根据 Loop 结果调整 energy_score
   */
  validate(delta: Delta, loopResult: 'pass' | 'fail'): Delta {
    const validated = { ...delta };
    if (loopResult === 'pass') {
      validated.energy_score = Math.min(1.0, validated.energy_score + 0.1);
    } else {
      validated.energy_score = Math.max(0.0, validated.energy_score - 0.05);
    }

    // 达到阈值则标记 verified
    if (validated.energy_score >= 0.8) {
      validated.verified = true;
    }

    // 过低则废弃
    if (validated.energy_score < 0.3) {
      validated.verified = false;
    }

    return validated;
  }

  /**
   * 批量验证所有参与本次 Loop 的 Δ
   */
  validateBatch(deltas: Delta[], loopResult: 'pass' | 'fail'): Delta[] {
    return deltas.map(d => this.validate(d, loopResult));
  }

  /**
   * 生成 AGENTS.md.runtime 追加内容
   */
  renderRuntimeDelta(delta: Delta): string {
    if (!delta.verified) return '';
    const lines = [
      `## [固化约束] ${delta.id}`,
      `- 来源: ${delta.origin.goal} Loop ${delta.origin.loop} Task ${delta.origin.task}`,
      `- 能量分: ${delta.energy_score.toFixed(2)}`,
      `- 类型: ${delta.type}`,
      ''
    ];
    if (delta.type === 'constraint') {
      lines.push(`- 规则: ${(delta as any).rule}`);
    }
    lines.push('');
    return lines.join('\n');
  }
}
