export interface TuiLeadSessionApi {
  lookup(projectDir: string): Promise<{ pod: { id: string } }>
  ensureLead(podID: string): Promise<{ sessionId: string }>
}

/**
 * TUI startup session: explicit --session wins; otherwise a Pod project
 * explicitly ensures its current Lead. A Pod-less project remains sessionless
 * (no implicit Pod/Lead creation), and failures degrade to sessionless.
 */
export async function resolveTuiLeadSession(
  api: TuiLeadSessionApi,
  projectDir: string | null,
  explicitSessionID?: string,
): Promise<string | null> {
  if (explicitSessionID) return explicitSessionID
  if (!projectDir) return null
  const detail = await api.lookup(projectDir).catch(() => null)
  if (!detail?.pod?.id) return null
  const lead = await api.ensureLead(detail.pod.id).catch(() => null)
  return lead?.sessionId ?? null
}
