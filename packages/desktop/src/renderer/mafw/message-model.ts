// opencode AssistantMessage carries the model at the TOP LEVEL (modelID /
// providerID); the nested `model` object only exists on request payloads and
// local echo placeholders. Normalize both shapes so readers of store messages
// get a consistent { providerID, modelID } (null when absent/empty).
export function messageModel(info: any): { providerID: string; modelID: string } | null {
  const providerID = info?.providerID ?? info?.model?.providerID
  const modelID = info?.modelID ?? info?.model?.modelID
  if (!providerID || !modelID) return null
  return { providerID, modelID }
}
