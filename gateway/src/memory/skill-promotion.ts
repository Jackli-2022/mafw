// W2: 记忆 → skill 物化通道。闸门（evaluatePromotion）+ 渲染（renderSkillMd）+
// 扫描管线（scanPromotionCandidates）。全部确定性——抽象在 curator 写记忆时已完成，
// 此处零 LLM。判据依据：脑（一致映射 Schneider&Shiffrin / 练习 ACT-R / 习惯稳定性）
// + 业界（JIT 热点编译 / Voyager 自验证 / AWM 复用频率 / Self-RAG 自适应）。

export const DEFAULT_PROMOTION_GATES = {
  minNeed7d: 3,
  minEnergy: 0.5,
  minStableDays: 7,
  maxConditionals: 1,
  minSteps: 2,
  maxSkills: 30,
} as const;

export interface PromotionSignals {
  need7d: number;
  energy: number;
  body: string;
  verified: boolean;
  daysSinceRevision: number;
  existingSkillCount: number;
}

/** G2：一致映射——确定性步骤序列才配固化；条件分支丛保持陈述性（可变映射）。 */
export function isConsistentMapping(body: string, cfg: typeof DEFAULT_PROMOTION_GATES = DEFAULT_PROMOTION_GATES): boolean {
  const conditionals = (body.match(/如果|否则|取决于|\bif\b|\belse\b/g) || []).length;
  const steps = (body.match(/^\s*(\d+[.、)]|[-*]\s)/gm) || []).length;
  return conditionals <= cfg.maxConditionals && steps >= cfg.minSteps;
}

export function evaluatePromotion(
  s: PromotionSignals,
  cfg: typeof DEFAULT_PROMOTION_GATES = DEFAULT_PROMOTION_GATES,
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (s.need7d < cfg.minNeed7d) reasons.push(`G1 need7d=${s.need7d}<${cfg.minNeed7d}`);
  if (s.energy < cfg.minEnergy) reasons.push(`G1b energy=${s.energy}<${cfg.minEnergy}`);
  if (!isConsistentMapping(s.body, cfg)) reasons.push('G2 条件分支体（可变映射保持陈述性）');
  if (!s.verified) reasons.push('G3 未验证（缺 verified: 锚点）');
  if (s.daysSinceRevision < cfg.minStableDays) reasons.push(`G4 漂移中（${s.daysSinceRevision}d<${cfg.minStableDays}d）`);
  if (s.existingSkillCount >= cfg.maxSkills) reasons.push(`G5 skill 列表已满（${s.existingSkillCount}≥${cfg.maxSkills}）`);
  return { eligible: reasons.length === 0, reasons };
}
