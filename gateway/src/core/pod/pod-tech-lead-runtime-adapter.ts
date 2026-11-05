/**
 * P0-4: Tech Lead runtime adapter。
 *
 * 背景：Tech Lead 讨论回合的模型原为身份硬编码（identity-registry.ts:180，
 * gateway/volcengine/...），config.goal.nodeModel 不覆盖它——单 provider 403
 * 会卡死 P3 冒烟。本适配器在建会话后显式 bindModel（v2 会话模型与 agent 解耦，
 * 须 switchModel），模型解析走 resolveNodeModel：config.goal.techLeadModel
 * 覆盖优先、身份内置兜底、半空对不半用；switchModel 失败 fail-open。
 *
 * 详见 docs/superpowers/plans/2026-11-05-mobile-gateway-p0.md Task 4。
 */
import { resolveNodeModel, type GoalNodeModelRef } from '../goal/node-model';
import type { PodTechLeadRuntime } from './pod-tech-lead-service';

export interface TechLeadRuntimeAdapterDeps {
  createSession(opts: { projectDir: string }): Promise<{ id: string }>;
  switchModel?(opts: { sessionID: string; model: GoalNodeModelRef }): Promise<unknown>;
  promptAsync: PodTechLeadRuntime['promptAsync'];
  messages: PodTechLeadRuntime['messages'];
  identityModel?: GoalNodeModelRef | null;
  configModel?: GoalNodeModelRef | null;
}

export function createTechLeadRuntimeAdapter(deps: TechLeadRuntimeAdapterDeps): PodTechLeadRuntime {
  return {
    createSession: async ({ projectDir }) => {
      const created = await deps.createSession({ projectDir });
      const model = resolveNodeModel(deps.identityModel, deps.configModel);
      if (model && deps.switchModel) {
        try {
          await deps.switchModel({ sessionID: created.id, model });
        } catch {
          // fail-open：模型切换失败保留身份内置模型，不阻塞讨论
        }
      }
      return created.id;
    },
    promptAsync: deps.promptAsync,
    messages: deps.messages,
  };
}
