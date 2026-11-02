// The SDK `plugins.invoke(name, action, input?, sessionID?)` wraps the third
// argument itself. A panel `viewAction` therefore receives `{}` as its raw
// input; passing `{ input: {}, sessionID }` here would validate against the
// action schema as the wrong shape and fail with HTTP 400.

export type PluginInvoke = (
  name: string,
  action: string,
  input?: unknown,
  sessionID?: string,
) => Promise<unknown>

export function invokePanelViewAction(
  invoke: PluginInvoke,
  name: string,
  action: string,
  sessionID: string | null,
): Promise<unknown> {
  return invoke(name, action, {}, sessionID ?? undefined)
}
