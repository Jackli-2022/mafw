import type { MafwModelRef, MafwProvider } from "@mafw/sdk"

/**
 * 消息所属模型的展示名。
 *
 * View DTO 的 provider `models` 恒为数组（spec §5.3），不再按 opencode 的
 * `models[modelID]` 对象映射读取；未知 provider/model 回退到 modelID 本身。
 */
export function modelName(
  providers: ReadonlyMap<string, MafwProvider> | undefined,
  model: MafwModelRef | undefined,
): string {
  if (!model?.modelID) return ""
  const provider = model.providerID ? providers?.get(model.providerID) : undefined
  return provider?.models.find((entry) => entry.id === model.modelID)?.name ?? model.modelID
}
