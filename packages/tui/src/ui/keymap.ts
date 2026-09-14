import { matchesKey, Key } from '@earendil-works/pi-tui'
import type { AppModel } from './app-model.ts'
import type { InteractionStateMachine } from './interaction-state.ts'
import type { TabId } from './tab-strip.ts'

/**
 * 声明式键位表（P1 地基）：app 级按键收敛为 binding 列表，app.ts 注入动作实现。
 * 动作名对齐 opencode 键位词汇（app_exit/session_interrupt/editor_open/...），
 * 结构上为将来读 tui.json 式配置留门。
 *
 * 派发顺序即优先级：quit → session_interrupt → memory blur → editor_open →
 * tab 切换（数字/Alt+数字）→ q 退出 → help。
 */

export interface KeyActions {
  quit(): void
  switchTab(id: TabId): void
  toggleHelp(): void
  abortTurn(): void
  openExternalEditor(): void
  blurMemorySearch(): void
  openTranscriptSearch(): void
}

export interface KeyDispatchContext {
  model: AppModel
  interaction: InteractionStateMachine
  actions: KeyActions
  queries: {
    activeTab(): TabId
    editing(): boolean
    overlayOpen(): boolean
    streaming(): boolean
    memoryInputFocused(): boolean
  }
}

interface KeyBinding {
  invoke(ctx: KeyDispatchContext): void
  match(data: string): boolean
  when(ctx: KeyDispatchContext): boolean
}

const TAB_IDS: TabId[] = ['chat', 'goals', 'memory', 'triage']
const ALT_DIGITS = [Key.alt('1'), Key.alt('2'), Key.alt('3'), Key.alt('4')]

const BINDINGS: KeyBinding[] = [
  {
    invoke: (ctx) => ctx.actions.quit(),
    match: (d) => matchesKey(d, Key.ctrl('c')),
    when: () => true,
  },
  {
    invoke: (ctx) => ctx.actions.abortTurn(),
    match: (d) => matchesKey(d, Key.escape),
    when: (ctx) => ctx.interaction.is('busy'),
  },
  {
    invoke: (ctx) => ctx.actions.blurMemorySearch(),
    match: (d) => matchesKey(d, Key.escape),
    when: (ctx) => ctx.queries.activeTab() === 'memory' && ctx.queries.memoryInputFocused(),
  },
  {
    invoke: (ctx) => ctx.actions.openExternalEditor(),
    match: (d) => matchesKey(d, Key.ctrl('g')),
    when: (ctx) => ctx.queries.activeTab() === 'chat' && ctx.queries.editing() && !ctx.queries.overlayOpen(),
  },
  ...TAB_IDS.map((id, i) => ({
    invoke: (ctx: KeyDispatchContext) => ctx.actions.switchTab(id),
    match: (d: string) => d === String(i + 1),
    when: (ctx: KeyDispatchContext) => !ctx.queries.editing(),
  })),
  ...TAB_IDS.map((id, i) => ({
    invoke: (ctx: KeyDispatchContext) => ctx.actions.switchTab(id),
    match: (d: string) => matchesKey(d, ALT_DIGITS[i]),
    when: () => true,
  })),
  {
    invoke: (ctx) => ctx.actions.openTranscriptSearch(),
    match: (d) => matchesKey(d, Key.ctrl('o')),
    when: (ctx) => ctx.queries.activeTab() === 'chat' && !ctx.queries.overlayOpen(),
  },
  {
    invoke: (ctx) => ctx.actions.quit(),
    match: (d) => d === 'q',
    when: (ctx) => !ctx.queries.editing(),
  },
  {
    invoke: (ctx) => ctx.actions.toggleHelp(),
    match: (d) => d === '?',
    when: (ctx) => !ctx.queries.editing(),
  },
]

/** 返回 true = 已消费（app 层据此不再转发给焦点组件）。 */
export function dispatchKey(data: string, ctx: KeyDispatchContext): boolean {
  // 派发前从活查询刷新交互状态（overlay 开关无事件钩子，按键时拉取）
  ctx.interaction.update({
    overlayOpen: ctx.queries.overlayOpen(),
    streaming: ctx.queries.streaming(),
  })
  for (const b of BINDINGS) {
    if (b.match(data) && b.when(ctx)) {
      b.invoke(ctx)
      return true
    }
  }
  return false
}
