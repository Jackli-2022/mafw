// 工作台焦点模型：一个焦点 = scope + subject + place。
// 这里只放纯函数；UI、存储、Solid 都不属于本模块。
export type WorldId = string

export type Scope =
  | { kind: "world"; worldId: WorldId }
  | { kind: "goal"; worldId: WorldId; goalId: string; revision: number; worktreeDir: string }

export type SubjectRef =
  | { kind: "world" }
  | { kind: "goal"; goalId: string }
  | { kind: "file"; root: string; rel: string; version?: string }
  | { kind: "web"; url: string }
  | { kind: "terminal"; id: string }
  | { kind: "plugin"; package: string; panel: string }
  | { kind: "changeset"; id: string; rel?: string }
  | { kind: "memory" }

export type Place = {
  scroll?: number
  selection?: { anchor: number; head: number }
  filter?: string
}

export type Focus = { scope: Scope; subject: SubjectRef; place: Place }
export type WorkbenchState = { worldId: WorldId; stack: Focus[]; kept: SubjectRef[] }

export function createWorkbenchState(worldId: WorldId): WorkbenchState {
  return { worldId, stack: [], kept: [] }
}

export function subjectKey(subject: SubjectRef): string {
  switch (subject.kind) {
    case "world":
      return "world"
    case "goal":
      return `goal:${subject.goalId}`
    case "file":
      // version 是框上的状态，不是对象身份：同一个文件换版本仍是同一个焦点。
      return `file:${subject.root}\u0000${subject.rel}`
    case "web":
      return `web:${subject.url}`
    case "terminal":
      return `terminal:${subject.id}`
    case "plugin":
      return `plugin:${subject.package}:${subject.panel}`
    case "changeset":
      return `changeset:${subject.id}`
    case "memory":
      return "memory"
  }
}

export function sameSubject(a: SubjectRef, b: SubjectRef): boolean {
  return subjectKey(a) === subjectKey(b)
}

export function openSubject(
  state: WorkbenchState,
  scope: Scope,
  subject: SubjectRef,
): WorkbenchState {
  const top = state.stack[state.stack.length - 1]
  if (top && sameSubject(top.subject, subject)) {
    const nextTop: Focus = { ...top, scope, subject }
    return { ...state, stack: [...state.stack.slice(0, -1), nextTop] }
  }
  return {
    ...state,
    stack: [...state.stack, { scope, subject, place: {} }],
  }
}

/**
 * 直接选择一个已打开对象（tab 点击）：把已有 focus 移到栈顶，不重复入栈。
 * 这样「返回上一焦点」不会在重复的 file/web 条目之间空转。
 */
export function selectFocus(
  state: WorkbenchState,
  scope: Scope,
  subject: SubjectRef,
): WorkbenchState {
  const top = state.stack[state.stack.length - 1]
  if (top && sameSubject(top.subject, subject)) return state
  const existing = state.stack.find((focus) => sameSubject(focus.subject, subject))
  const rest = state.stack.filter((focus) => !sameSubject(focus.subject, subject))
  return {
    ...state,
    stack: [...rest, { scope, subject, place: existing?.place ?? {} }],
  }
}

export function updatePlace(state: WorkbenchState, place: Place): WorkbenchState {
  const top = state.stack[state.stack.length - 1]
  if (!top) return state
  const nextPlace: Place = { ...top.place, ...place }
  const nextTop: Focus = { ...top, place: nextPlace }
  return { ...state, stack: [...state.stack.slice(0, -1), nextTop] }
}

export function popFocus(state: WorkbenchState): WorkbenchState {
  if (state.stack.length <= 1) return state
  return { ...state, stack: state.stack.slice(0, -1) }
}

export function jumpTo(state: WorkbenchState, index: number): WorkbenchState {
  if (state.stack.length === 0) return state
  const clamped = Math.max(0, Math.min(index, state.stack.length - 1))
  if (clamped === state.stack.length - 1) return state
  return { ...state, stack: state.stack.slice(0, clamped + 1) }
}

export function keepSubject(state: WorkbenchState, subject: SubjectRef): WorkbenchState {
  if (state.kept.some((item) => sameSubject(item, subject))) return state
  return { ...state, kept: [...state.kept, subject] }
}

export function unkeepSubject(state: WorkbenchState, subject: SubjectRef): WorkbenchState {
  const kept = state.kept.filter((item) => !sameSubject(item, subject))
  return kept.length === state.kept.length ? state : { ...state, kept }
}
