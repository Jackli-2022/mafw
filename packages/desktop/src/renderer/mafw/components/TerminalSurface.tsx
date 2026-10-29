// Terminal L2 surface: session tabs + xterm views + host drawer/dialogs.
// `active` means the surface is truly visible (dock open + workbench + terminal).
import { For, Index, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { DropdownMenu } from "@mafw/ui/dropdown-menu"
import { Icon } from "@mafw/ui/icon"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import type { SshHostProfile, SshHostProfileInput, SshSecretInput } from "../../../shared/ssh-host"
import type { TerminalSessionInfo } from "../../../shared/terminal-session"
import { terminalStore } from "../terminal/terminal-store"
import { statusTone } from "../terminal/terminal-model"
import { DockEmpty } from "./dock-panel"
import { TerminalView } from "./TerminalView"
import { TerminalHostDrawer } from "./TerminalHostDrawer"
import { SshHostDialog } from "./SshHostDialog"
import { HostKeyDialog } from "./HostKeyDialog"
import { TerminalPromptDialog } from "./TerminalPromptDialog"
import { TerminalStatusBar } from "./TerminalStatusBar"

export function TerminalSurface(props: { directory: string | null; active: boolean }) {
  const store = terminalStore()
  const [ready, setReady] = createSignal(false)
  const [sizes, setSizes] = createSignal<Record<string, { cols: number; rows: number }>>({})

  const activeSession = (): TerminalSessionInfo | null => {
    const id = store.activeId()
    return store.sessions().find((s) => s.id === id) ?? null
  }
  const activeSize = () => {
    const id = store.activeId()
    return id ? sizes()[id] : undefined
  }

  const focusTab = (index: number) => {
    const list = store.sessions()
    const next = list[index]
    if (!next) return
    store.setActive(next.id)
    queueMicrotask(() => {
      const el = document.querySelector<HTMLElement>(`[data-terminal-tab-index="${index}"]`)
      el?.focus()
    })
  }

  const onTabKeyDown = (event: KeyboardEvent, index: number) => {
    const list = store.sessions()
    if (!list.length) return
    if (event.key === "ArrowRight") {
      event.preventDefault()
      focusTab((index + 1) % list.length)
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      focusTab((index - 1 + list.length) % list.length)
    } else if (event.key === "Home") {
      event.preventDefault()
      focusTab(0)
    } else if (event.key === "End") {
      event.preventDefault()
      focusTab(list.length - 1)
    }
  }

  const notifyLimit = () => {
    if (store.sessions().length >= 10) {
      showToastV2({ description: "最多同时打开 10 个终端", duration: 2200 })
      return true
    }
    return false
  }

  const openSsh = async (hostId: string) => {
    if (notifyLimit()) return
    const info = await store.openSsh(hostId)
    if (!info) showToastV2({ description: "创建 SSH 会话失败", duration: 2600 })
  }

  const connectHost = async (hostId: string) => {
    const tabs = store.sessions().filter((s) => s.hostId === hostId)
    const last = tabs.at(-1)
    if (last) store.setActive(last.id)
    else await openSsh(hostId)
  }

  const saveHost = async (input: SshHostProfileInput, secret?: SshSecretInput) => {
    const saved = await store.saveHost(input, secret)
    if (!saved) showToastV2({ description: "保存主机失败", duration: 2600 })
  }

  const testHost = (input: SshHostProfileInput, secret?: SshSecretInput) => store.testHost(input, secret)

  const requestKill = (session: TerminalSessionInfo) => {
    if (session.kind !== "local") return
    if (window.confirm(`结束本地终端「${session.title}」？`)) void store.killLocal(session.id)
  }

  const openExternal = (session: TerminalSessionInfo) => {
    if (session.directory) void window.api.mafw.terminal.openExternal(session.directory)
  }

  onMount(() => {
    void store.init().then(() => setReady(true)).catch((err: any) => {
      showToastV2({ description: `终端初始化失败：${err?.message ?? err}`, duration: 3200 })
      setReady(true)
    })
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (store.hostKey()) {
        void store.respondHostKey("reject")
      } else if (store.prompt()) {
        void store.respondPrompt([])
      } else if (store.hostDialog().open) {
        store.closeHostDialog()
      } else if (store.drawerOpen()) {
        store.setDrawerOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  createEffect(() => {
    if (!ready()) return
    store.setVisible(props.active)
    store.ensureLocal(props.directory)
  })

  return (
    <div class="mafw-terminal-surface" data-active={props.active}>
      <div class="mafw-terminal-tabbar" role="tablist" aria-label="终端会话">
        <div class="mafw-terminal-tabs">
          <For each={store.sessions()}>
            {(session, index) => (
              <div class="mafw-terminal-tab-wrap" classList={{ "is-active": store.activeId() === session.id }}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  role="tab"
                  aria-selected={store.activeId() === session.id}
                  tabIndex={store.activeId() === session.id ? 0 : -1}
                  data-terminal-tab-index={index()}
                  class="mafw-terminal-tab"
                  onClick={() => store.setActive(session.id)}
                  onKeyDown={(event: KeyboardEvent) => onTabKeyDown(event, index())}
                >
                  <span class={`mafw-terminal-tab-dot is-${statusTone(session)}`} aria-hidden="true" />
                  <span class="mafw-terminal-tab-title">{session.title}</span>
                </ButtonV2>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-terminal-tab-close"
                  aria-label={`关闭 ${session.title}`}
                  onClick={(event: MouseEvent) => {
                    event.stopPropagation()
                    void store.closeTab(session.id)
                  }}
                >
                  <Icon name="close" size="small" />
                </ButtonV2>
              </div>
            )}
          </For>
        </div>

        <div class="mafw-terminal-tabbar-actions">
          <TooltipV2 value="新建终端" openDelay={300}>
            <DropdownMenu>
              <DropdownMenu.Trigger as={ButtonV2} variant="ghost" size="small" aria-label="新建终端">
                <Icon name="plus" size="small" />
                <Icon name="chevron-down" size="small" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="mafw-terminal-new-menu">
                  <DropdownMenu.Item onSelect={() => store.openLocal()}>
                    <DropdownMenu.ItemLabel>本地终端</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => store.openHostDialog(null)}>
                    <DropdownMenu.ItemLabel>新建 SSH 连接</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => store.setDrawerOpen(true)}>
                    <DropdownMenu.ItemLabel>主机列表</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </TooltipV2>

          <Show when={store.sessions().length > 0}>
            <TooltipV2 value="全部终端" openDelay={300}>
              <DropdownMenu>
                <DropdownMenu.Trigger as={ButtonV2} variant="ghost" size="small" aria-label="全部终端">
                  <Icon name="menu" size="small" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="mafw-terminal-all-menu">
                    <For each={store.sessions()}>
                      {(session) => (
                        <DropdownMenu.Item onSelect={() => store.setActive(session.id)}>
                          <DropdownMenu.ItemLabel>{session.title}</DropdownMenu.ItemLabel>
                          <Show when={store.activeId() === session.id}>
                            <Icon name="check-small" size="small" />
                          </Show>
                        </DropdownMenu.Item>
                      )}
                    </For>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </TooltipV2>
          </Show>

          <TooltipV2 value="SSH 主机" openDelay={300}>
            <ButtonV2
              variant="ghost"
              size="small"
              aria-label="SSH 主机"
              aria-pressed={store.drawerOpen()}
              onClick={() => store.setDrawerOpen(!store.drawerOpen())}
            >
              <Icon name="server" size="small" />
            </ButtonV2>
          </TooltipV2>
        </div>
      </div>

      <div class="mafw-terminal-body">
        <Show
          when={store.sessions().length > 0}
          fallback={
            <div class="mafw-terminal-empty">
              <DockEmpty
                icon="console"
                text="还没有终端会话"
                hint="本地终端跟随当前目录；SSH 会话独立于目录。"
              />
              <div class="mafw-terminal-empty-actions">
                <ButtonV2 variant="outline" size="small" icon="plus" onClick={() => store.openLocal()}>
                  打开本地终端
                </ButtonV2>
                <ButtonV2 variant="contrast" size="small" icon="server" onClick={() => store.openHostDialog(null)}>
                  新建 SSH 连接
                </ButtonV2>
              </div>
            </div>
          }
        >
          <div class="mafw-terminal-views">
            <Index each={store.sessions()}>
              {(session) => (
                <div class="mafw-terminal-pane" classList={{ "is-active": store.activeId() === session().id }}>
                  <TerminalView
                    session={session()}
                    active={store.activeId() === session().id}
                    visible={props.active}
                    onRequestClose={() => void store.closeTab(session().id)}
                    onRequestKill={() => requestKill(session())}
                    onOpenExternal={() => openExternal(session())}
                    onSize={(cols, rows) =>
                      setSizes((prev) => ({ ...prev, [session().id]: { cols, rows } }))
                    }
                  />
                </div>
              )}
            </Index>
          </div>
          <Show when={activeSession()}>
            {(session) => (
              <TerminalStatusBar
                session={session()}
                cols={activeSize()?.cols}
                rows={activeSize()?.rows}
              />
            )}
          </Show>
        </Show>
      </div>

      <TerminalHostDrawer
        open={store.drawerOpen()}
        hosts={store.hosts()}
        sessions={store.sessions()}
        onClose={() => store.setDrawerOpen(false)}
        onConnect={(hostId) => void connectHost(hostId)}
        onNew={() => store.openHostDialog(null)}
        onEdit={(host: SshHostProfile) => store.openHostDialog(host)}
        onRemove={(hostId) => void store.removeHost(hostId)}
        onNewSession={(hostId) => void openSsh(hostId)}
      />

      <SshHostDialog
        open={store.hostDialog().open}
        initial={store.hostDialog().initial}
        hosts={store.hosts()}
        onCancel={() => store.closeHostDialog()}
        onSave={(input, secret) => void saveHost(input, secret)}
        onTest={testHost}
      />

      <HostKeyDialog request={store.hostKey()} onRespond={(action) => void store.respondHostKey(action)} />
      <TerminalPromptDialog request={store.prompt()} onRespond={(answers) => void store.respondPrompt(answers)} />
    </div>
  )
}
