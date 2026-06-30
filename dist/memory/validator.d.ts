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
export declare class DeltaValidator {
    /**
     * 验证单个 Δ：根据 Loop 结果调整 energy_score
     */
    validate(delta: Delta, loopResult: 'pass' | 'fail'): Delta;
    /**
     * 批量验证所有参与本次 Loop 的 Δ
     */
    validateBatch(deltas: Delta[], loopResult: 'pass' | 'fail'): Delta[];
    /**
     * 生成 AGENTS.md.runtime 追加内容
     */
    renderRuntimeDelta(delta: Delta): string;
}
//# sourceMappingURL=validator.d.ts.map