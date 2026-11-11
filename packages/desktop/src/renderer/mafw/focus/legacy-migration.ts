// 把旧的 content scope 状态迁移成焦点栈：只做纯转换，不读存储。
import {
  createWorkbenchState,
  keepSubject,
  openSubject,
  updatePlace,
  type Place,
  type Scope,
  type WorkbenchState,
} from "./focus-model"
import type { ContentScopeState } from "../content-scope-state"

export function migrateContentScopeState(input: {
  worldId: string
  root: string
  scope: Scope
  state: ContentScopeState
}): WorkbenchState {
  const active = input.state.activeFile
  if (!active) return createWorkbenchState(input.worldId)

  let next = openSubject(
    createWorkbenchState(input.worldId),
    input.scope,
    { kind: "file", root: input.root, rel: active },
    "read",
  )

  const place: Place = {}
  const scroll = input.state.readingPositions[active]
  if (scroll !== undefined) place.scroll = scroll
  const selection = input.state.selections[active]
  if (selection) place.selection = { anchor: selection.anchor, head: selection.head }
  if (place.scroll !== undefined || place.selection) next = updatePlace(next, place)

  for (const rel of input.state.openFiles) {
    next = keepSubject(next, { kind: "file", root: input.root, rel })
  }

  return next
}
