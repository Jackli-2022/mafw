import { subjectKey, type Lens, type Scope, type SubjectRef, type WorldId } from "./focus-model"
import type { RecentContentEntry } from "../recent-content"

export type PickerKind = "file" | "recent" | "goal" | "change" | "review" | "command"

export type PickerItem = {
  id: string
  kind: PickerKind
  label: string
  detail?: string
  scope: Scope
  subject: SubjectRef
  lens?: Lens
}

function fileItem(
  kind: "file" | "recent",
  scope: Scope,
  root: string,
  rel: string,
  detail?: string,
): PickerItem {
  const subject: SubjectRef = { kind: "file", root, rel }
  const key = subjectKey(subject)
  return { id: `${kind}:${key}`, kind, label: rel, detail, scope, subject }
}

export function buildFilePickerItems(input: {
  worldId: WorldId
  files: readonly string[]
  /** Root that `files` and project recents are relative to (normally the project root). */
  filesRoot: string
  recent: readonly RecentContentEntry[]
  root: string
  scope: Scope
  projectScope: Scope
}): PickerItem[] {
  const out: PickerItem[] = []
  const seen = new Set<string>()

  for (const entry of input.recent) {
    if (entry.scopeKind === "project") {
      const item = fileItem("recent", input.projectScope, input.filesRoot, entry.rel, entry.scopeLabel)
      const key = subjectKey(item.subject)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
      continue
    }

    if (!entry.goalId || !entry.revision || !entry.worktreeDir) continue
    const scope: Scope = {
      kind: "goal",
      worldId: input.worldId,
      goalId: entry.goalId,
      revision: entry.revision,
      worktreeDir: entry.worktreeDir,
    }
    const item = fileItem("recent", scope, entry.worktreeDir, entry.rel, entry.scopeLabel)
    const key = subjectKey(item.subject)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }

  const detail = input.scope.kind === "goal" ? `rev ${input.scope.revision}` : "项目文件"
  const canListFiles = input.scope.kind === "world" || input.filesRoot === input.root
  for (const rel of canListFiles ? input.files : []) {
    const item = fileItem("file", input.scope, input.root, rel, detail)
    const key = subjectKey(item.subject)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }

  return out
}

export function buildCommandPickerItems(scope: Scope): PickerItem[] {
  return [
    {
      id: "command:browser",
      kind: "command",
      label: "打开浏览器",
      detail: "新建浏览器对象",
      scope,
      subject: { kind: "web", url: "about:blank" },
      lens: "interact",
    },
    {
      id: "command:terminal",
      kind: "command",
      label: "打开终端",
      detail: "新建终端对象",
      scope,
      subject: { kind: "terminal", id: "local" },
      lens: "interact",
    },
  ]
}

export function filterPickerItems(items: readonly PickerItem[], query: string): PickerItem[] {
  const q = query.trim().toLowerCase()
  const matched = q
    ? items.filter((item) => `${item.label}\n${item.detail ?? ""}`.toLowerCase().includes(q))
    : items
  return matched.slice(0, 50)
}

/** 把命令固定在 cap 内，避免文件结果把浏览器/终端挤出列表。 */
export function withCommandItems(
  items: readonly PickerItem[],
  commands: readonly PickerItem[],
  max = 50,
): PickerItem[] {
  const room = Math.max(0, max - commands.length)
  return [...items.slice(0, room), ...commands]
}
