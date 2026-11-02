/**
 * Which model the write-path judges (consolidation + route-write) call.
 *
 * `recall.workerModel` is shared with the session-based pipelines
 * (turnCompress / reflection), where a free-tier model is acceptable because
 * opencode attaches its own session auth. The stateless completion channel the
 * judges use has no such session: it needs a provider with both a baseURL and
 * an API key. Keeping a separate `judgeModel` lets the judges point at a
 * resolvable provider without moving every background pipeline.
 */
export interface JudgeModelRef {
  providerID?: string;
  modelID?: string;
}

export interface RecallModelConfig {
  workerModel?: JudgeModelRef | null;
  judgeModel?: JudgeModelRef | null;
}

/**
 * Explicit `judgeModel` wins; a half-filled one (only provider or only model)
 * is ignored rather than half-used; otherwise fall back to `workerModel`.
 */
export function resolveJudgeModel(
  cfg: RecallModelConfig | null | undefined,
): { providerID: string; modelID: string } | null {
  const pick = (m: JudgeModelRef | null | undefined) =>
    m && m.providerID && m.modelID ? { providerID: m.providerID, modelID: m.modelID } : null;
  return pick(cfg?.judgeModel) ?? pick(cfg?.workerModel);
}
