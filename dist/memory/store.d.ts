import { Delta, DeltaType, StoreConfig, BaseSkillManifest, OscillationResult, MergeResult } from '../types/parametric';
import { EnergyEvent } from './energy-system';
/**
 * Parametric Memory Store
 *
 * L3 参数化记忆的 CRUD + 索引中心。
 * 负责 Constraint/Prompt/Pattern 三类 Δ 的持久化、检索、去重、熔断。
 *
 * 目录结构:
 *   parametric/
 *   ├── prompt-deltas/
 *   ├── constraint-deltas/
 *   ├── pattern-deltas/
 *   ├── banned/
 *   └── base-skill-manifest.yaml
 */
export declare class ParametricStore {
    private config;
    private energySystem;
    constructor(config?: Partial<StoreConfig>, energyConfig?: {
        decayRatePerDay?: number;
        cleanupThreshold?: number;
        criticalThreshold?: number;
    });
    private ensureDirs;
    private deltaDir;
    private deltaPath;
    /**
     * 保存一个 Δ。如果已存在且内容相同，跳过写入。
     */
    save(delta: Delta): void;
    /**
     * 更新 Δ 的能量值（基于事件和时间的衰减/奖励）
     */
    updateEnergy(id: string, type: DeltaType, event: EnergyEvent): void;
    /**
     * 读取单个 Δ
     */
    load(id: string, type: DeltaType): Delta | null;
    /**
     * 加载所有未熔断的 Δ
     */
    loadAll(): Delta[];
    /**
     * 根据 trigger_condition 匹配候选 Δ
     */
    match(context: {
        domain?: string;
        taskType?: string;
        goalKeywords?: string[];
        loopStage?: string;
        loopCount?: number;
        affectedFiles?: string[];
    }): Delta[];
    private matchPattern;
    /**
     * 检测单个 Δ 是否震荡（连续 N 次参与 Loop 未通过验证）
     */
    detectOscillation(deltaId: string, history: {
        loop: number;
        result: string;
    }[]): OscillationResult;
    /**
     * 熔断（将 Δ 移入 banned/）
     */
    ban(deltaId: string, meta: {
        reason: string;
        suggestion: string;
    }): void;
    /**
     * 去重 + 冲突检测 + 震荡 Δ 自动熔断
     */
    merge(deltas: Delta[], history: {
        loop: number;
        result: string;
    }[]): MergeResult;
    /**
     * 读取固化清单
     */
    loadManifest(): BaseSkillManifest;
    /**
     * 更新固化清单（Archive 阶段由 DeltaValidator 调用）
     */
    updateManifest(manifest: BaseSkillManifest): void;
}
//# sourceMappingURL=store.d.ts.map