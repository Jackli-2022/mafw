import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  Delta, DeltaType, StoreConfig, BaseSkillManifest,
  OscillationResult, MergeResult, Conflict
} from '../types/parametric';
import { EnergySystem, EnergyEvent } from './energy-system';

const DEFAULT_CONFIG: StoreConfig = {
  baseDir: '.mafw/parametric',
  bannedDir: '.mafw/parametric/banned',
  manifestFile: '.mafw/parametric/base-skill-manifest.yaml'
};

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
export class ParametricStore {
  private config: StoreConfig;
  private energySystem: EnergySystem;

  constructor(config: Partial<StoreConfig> = {}, energyConfig?: {
    decayRatePerDay?: number;
    cleanupThreshold?: number;
    criticalThreshold?: number;
  }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.energySystem = new EnergySystem(energyConfig);
    this.ensureDirs();
  }

  private ensureDirs(): void {
    [this.config.baseDir, this.config.bannedDir].forEach(d => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
    ['prompt-deltas', 'constraint-deltas', 'pattern-deltas'].forEach(sub => {
      const p = path.join(this.config.baseDir, sub);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
  }

  private deltaDir(type: DeltaType): string {
    return path.join(this.config.baseDir, `${type}-deltas`);
  }

  private deltaPath(id: string, type: DeltaType): string {
    return path.join(this.deltaDir(type), `${id}.yaml`);
  }

  /**
   * 保存一个 Δ。如果已存在且内容相同，跳过写入。
   * 能量按增量衰减结算：自 last_energy_at（缺失回退 created_at）起算流逝天数，
   * 结算后盖章 last_energy_at —— 重复保存不会重复扣全龄衰减。
   */
  save(delta: Delta): void {
    const p = this.deltaPath(delta.id, delta.type);
    const data = yaml.dump(delta, { lineWidth: -1 });
    if (fs.existsSync(p)) {
      const existing = fs.readFileSync(p, 'utf-8');
      if (existing === data) return; // 无变化，跳过
    }
    const now = Date.now();
    const base = new Date(delta.last_energy_at || delta.created_at || 0).getTime();
    const daysSinceEnergy = base > 0 ? Math.max(0, (now - base) / 86_400_000) : 0;
    delta.energy_score = this.energySystem.calculateEnergy(delta.energy_score, { type: 'retrieved' }, daysSinceEnergy, 1.0, delta.id);
    delta.last_energy_at = new Date(now).toISOString();
    fs.writeFileSync(p, yaml.dump(delta, { lineWidth: -1 }), 'utf-8');
  }

  /**
   * 更新 Δ 的能量值（基于事件和时间的增量衰减/奖励），结算后盖章 last_energy_at。
   */
  updateEnergy(id: string, type: DeltaType, event: EnergyEvent): void {
    const delta = this.load(id, type);
    if (!delta) return;
    const now = Date.now();
    const base = new Date(delta.last_energy_at || delta.created_at || 0).getTime();
    const daysSinceEnergy = base > 0 ? Math.max(0, (now - base) / 86_400_000) : 0;
    delta.energy_score = this.energySystem.calculateEnergy(delta.energy_score, event, daysSinceEnergy, 1.0, delta.id);
    delta.last_energy_at = new Date(now).toISOString();
    fs.writeFileSync(this.deltaPath(id, type), yaml.dump(delta, { lineWidth: -1 }), 'utf-8');
  }

  /**
   * 读取单个 Δ
   */
  load(id: string, type: DeltaType): Delta | null {
    const p = this.deltaPath(id, type);
    if (!fs.existsSync(p)) return null;
    return yaml.load(fs.readFileSync(p, 'utf-8')) as Delta;
  }

  /**
   * 加载所有未熔断的 Δ
   */
  loadAll(): Delta[] {
    const deltas: Delta[] = [];
    const types: DeltaType[] = ['constraint', 'prompt', 'pattern'];
    for (const t of types) {
      const dir = this.deltaDir(t);
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
      for (const f of files) {
        const d = yaml.load(fs.readFileSync(path.join(dir, f), 'utf-8')) as Delta;
        deltas.push(d);
      }
    }
    return deltas;
  }

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
  }): Delta[] {
    return this.loadAll().filter(d => {
      const tc = d.trigger_condition;
      if (tc.min_loop_count !== undefined && (context.loopCount ?? 0) < tc.min_loop_count) return false;
      if (tc.domain && context.domain && !tc.domain.includes(context.domain)) return false;
      if (tc.task_type && context.taskType && !tc.task_type.includes(context.taskType)) return false;
      if (tc.loop_stage && context.loopStage && !tc.loop_stage.includes(context.loopStage)) return false;
      if (tc.keywords && context.goalKeywords) {
        const hasKeyword = tc.keywords.some(kw =>
          context.goalKeywords!.some(gk => gk.toLowerCase().includes(kw.toLowerCase()))
        );
        if (!hasKeyword) return false;
      }
      if (tc.affected_file_pattern && context.affectedFiles) {
        const hasPattern = tc.affected_file_pattern.some(pat =>
          context.affectedFiles!.some(f => this.matchPattern(f, pat))
        );
        if (!hasPattern) return false;
      }
      return true;
    });
  }

  private matchPattern(file: string, pattern: string): boolean {
    // 简单 glob: *.test.ts -> 正则
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(file);
  }

  /**
   * 检测单个 Δ 是否震荡（连续 N 次参与 Loop 未通过验证）
   */
  detectOscillation(deltaId: string, history: { loop: number; result: string }[]): OscillationResult {
    const last3 = history.slice(-3);
    const sameReason = last3.length === 3 && last3.every(l => l.result === 'review_fail');
    if (!sameReason) return { isOscillating: false };
    return {
      isOscillating: true,
      deltaId,
      reason: 'OSCILLATION: 连续 3 次参与 Loop 均未通过验证',
      suggestion: '该约束可能过于刚性或条件错误，建议手动审查'
    };
  }

  /**
   * 熔断（将 Δ 移入 banned/）
   */
  ban(deltaId: string, meta: { reason: string; suggestion: string }): void {
    const types: DeltaType[] = ['constraint', 'prompt', 'pattern'];
    for (const t of types) {
      const src = this.deltaPath(deltaId, t);
      if (fs.existsSync(src)) {
        const dest = path.join(this.config.bannedDir, `${deltaId}.yaml`);
        const data = yaml.load(fs.readFileSync(src, 'utf-8')) as any;
        data._banned = true;
        data._ban_reason = meta.reason;
        data._ban_suggestion = meta.suggestion;
        data._banned_at = new Date().toISOString();
        fs.writeFileSync(dest, yaml.dump(data), 'utf-8');
        fs.unlinkSync(src);
        return;
      }
    }
  }

  /**
   * 去重 + 冲突检测 + 震荡 Δ 自动熔断
   */
  merge(deltas: Delta[], history: { loop: number; result: string }[]): MergeResult {
    const merged: Delta[] = [];
    const conflicts: Conflict[] = [];
    const banned: string[] = [];
    const seen = new Map<string, Delta>();

    for (const d of deltas) {
      // 1. 去重：相同 ID 保留 energy_score 更高的
      if (seen.has(d.id)) {
        const existing = seen.get(d.id)!;
        if (d.energy_score > existing.energy_score) {
          seen.set(d.id, d);
        }
        continue;
      }

      // 2. 震荡检测
      const osc = this.detectOscillation(d.id, history);
      if (osc.isOscillating) {
        this.ban(d.id, { reason: osc.reason!, suggestion: osc.suggestion! });
        banned.push(d.id);
        conflicts.push({
          deltaId: d.id,
          reason: 'oscillation',
          suggestion: osc.suggestion!
        });
        continue;
      }

      seen.set(d.id, d);
    }

    merged.push(...seen.values());
    return { merged, conflicts, banned };
  }

  /**
   * 读取固化清单
   */
  loadManifest(): BaseSkillManifest {
    if (!fs.existsSync(this.config.manifestFile)) {
      return { manifest_version: 1, merged_deltas: [] };
    }
    return yaml.load(fs.readFileSync(this.config.manifestFile, 'utf-8')) as BaseSkillManifest;
  }

  /**
   * 更新固化清单（Archive 阶段由 DeltaValidator 调用）
   */
  updateManifest(manifest: BaseSkillManifest): void {
    fs.writeFileSync(this.config.manifestFile, yaml.dump(manifest), 'utf-8');
  }

  /**
   * 清理能量低于阈值的 Δ（归档到 banned/）
   * 返回被归档的 delta ID 列表
   */
  cleanup(): string[] {
    const archived: string[] = [];
    const deltas = this.loadAll();
    for (const d of deltas) {
      if (this.energySystem.shouldCleanup(d.energy_score)) {
        this.ban(d.id, {
          reason: `energy below cleanup threshold (${d.energy_score})`,
          suggestion: 'archived due to low energy score'
        });
        archived.push(d.id);
      }
    }
    return archived;
  }
}
