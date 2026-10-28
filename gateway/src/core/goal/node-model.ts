// gateway/src/core/goal/node-model.ts
// W1/W5a：goal 编排节点（plan/execute/review）模型解析——可配置覆盖优先，
// 身份内置模型兜底；空/半空对视为未配置。纯函数（供 index.ts bindModel 与测试复用）。
export interface GoalNodeModelRef {
  providerID: string;
  modelID: string;
}

function isComplete(ref: any): ref is GoalNodeModelRef {
  return !!ref && typeof ref.providerID === 'string' && ref.providerID.length > 0
    && typeof ref.modelID === 'string' && ref.modelID.length > 0;
}

export function resolveNodeModel(
  identityModel: GoalNodeModelRef | undefined | null,
  configModel: GoalNodeModelRef | undefined | null,
): GoalNodeModelRef | null {
  if (isComplete(configModel)) return { providerID: configModel.providerID, modelID: configModel.modelID };
  if (isComplete(identityModel)) return { providerID: identityModel.providerID, modelID: identityModel.modelID };
  return null;
}
