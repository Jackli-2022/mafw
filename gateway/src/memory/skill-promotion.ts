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

/**
 * OKF 记忆 → SKILL.md 渲染（md-to-md 通道）。name 取 id 尾 6 位保证 ascii 安全；
 * description 是 skill 发现性的命门（primary_abstraction + 触发词）。
 */
export function renderSkillMd(unit: {
  id: string;
  primary_abstraction: string;
  memory_value: string;
  cue_anchors?: string[];
}): { name: string; content: string } {
  const name = `ms-${unit.id.slice(-6)}`;
  const triggers = (unit.cue_anchors ?? []).filter((a) => !a.includes(':')).slice(0, 5).join(' / ');
  const content = `---
name: ${name}
description: ${unit.primary_abstraction}。触发词：${triggers}
---

${unit.memory_value}

> 物化自记忆 ${unit.id}（记忆为索引，本文件为真相源；修订请改本文件后由 curator 回写）。
`;
  return { name, content };
}

export interface ScanDeps {
  getIndex(): { entries: any[] };
  readUnit(id: string): Promise<{ id: string; memory_value: string; cue_anchors?: string[] } | null>;
  needFor: (id: string) => number;
  existingSkillCount: () => number;
  writeStaging: (name: string, content: string) => void;
  createTriageItem: (item: { summary: { skillDraft: { name: string; memoryId: string } } }) => void;
  now: Date;
  gates?: typeof DEFAULT_PROMOTION_GATES;
}

/**
 * W2 扫描管线：遍历 procedural 记忆，过 G1-G5 闸门，合格者渲染 SKILL.md 写入
 * staging 目录并建 triage 草稿（人审后安装）。幂等：已带 `skill:` 锚点的跳过。
 * 全 fail-open——单个候选读失败不影响其余。
 * @returns 本次提升的候选数
 */
export async function scanPromotionCandidates(deps: ScanDeps): Promise<number> {
  const cfg = deps.gates ?? DEFAULT_PROMOTION_GATES;
  let promoted = 0;
  const existing = deps.existingSkillCount();
  for (const entry of deps.getIndex().entries) {
    if (entry.type !== 'procedural' || entry.superseded_by) continue;
    if ((entry.cue_anchors ?? []).some((a: string) => a.startsWith('skill:'))) continue;
    try {
      const unit = await deps.readUnit(entry.id);
      if (!unit) continue;
      const anchors: string[] = unit.cue_anchors ?? entry.cue_anchors ?? [];
      const updatedMs = Date.parse(entry.updated_at ?? entry.created_at ?? 0);
      const daysSinceRevision = updatedMs > 0
        ? Math.floor((deps.now.getTime() - updatedMs) / 86400e3)
        : 0;
      const decision = evaluatePromotion(
        {
          need7d: deps.needFor(entry.id),
          energy: entry.energy ?? 0,
          body: unit.memory_value,
          verified: anchors.some((a) => a.startsWith('verified:')),
          daysSinceRevision,
          existingSkillCount: existing + promoted,
        },
        cfg,
      );
      if (!decision.eligible) continue;
      const { name, content } = renderSkillMd({
        id: unit.id,
        primary_abstraction: entry.primary_abstraction ?? unit.id,
        memory_value: unit.memory_value,
        cue_anchors: anchors,
      });
      deps.writeStaging(name, content);
      deps.createTriageItem({ summary: { skillDraft: { name, memoryId: unit.id } } });
      promoted++;
    } catch {
      // fail-open: skip this candidate
    }
  }
  return promoted;
}
