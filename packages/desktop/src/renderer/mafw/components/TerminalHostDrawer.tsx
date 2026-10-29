// SSH host drawer: grouped hosts + search + session counts (spec §8.1).
import { For, Show, createSignal } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { Icon } from "@mafw/ui/icon"
import type { SshHostProfile } from "../../../shared/ssh-host"
import type { TerminalSessionInfo } from "../../../shared/terminal-session"
import { groupHosts, type HostStatus } from "../terminal/host-drawer-model"

const statusLabel: Record<HostStatus, string> = {
  connected: "已连接",
  reconnecting: "重连中",
  disconnected: "未连接",
}

export function TerminalHostDrawer(props: {
  open: boolean
  hosts: SshHostProfile[]
  sessions: TerminalSessionInfo[]
  onClose: () => void
  onConnect: (hostId: string) => void
  onNew: () => void
  onEdit: (host: SshHostProfile) => void
  onRemove: (hostId: string) => void
  onNewSession: (hostId: string) => void
}) {
  const [query, setQuery] = createSignal("")
  const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null)
  const groups = () => groupHosts(props.hosts, props.sessions, query())

  return (
    <Show when={props.open}>
      <div class="mafw-host-drawer-backdrop" onClick={props.onClose}>
        <aside
          class="mafw-host-drawer"
          role="dialog"
          aria-label="SSH 主机"
          onClick={(e) => e.stopPropagation()}
        >
          <header class="mafw-host-drawer-head">
            <div>
              <div class="mafw-host-drawer-title">SSH 主机</div>
              <div class="mafw-host-drawer-sub">保存主机、跳板机与密码，连接不出工作台</div>
            </div>
            <ButtonV2 variant="ghost" size="small" aria-label="关闭主机抽屉" onClick={props.onClose}>
              <Icon name="close" size="small" />
            </ButtonV2>
          </header>

          <div class="mafw-host-drawer-tools">
            <div class="mafw-host-search">
              <Icon name="magnifying-glass" size="small" />
              <TextInputV2
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                placeholder="搜索主机名 / 地址 / 用户"
                aria-label="搜索主机"
              />
            </div>
            <ButtonV2 variant="outline" size="small" icon="plus" onClick={props.onNew}>
              新建主机
            </ButtonV2>
          </div>

          <div class="mafw-host-drawer-list">
            <Show
              when={groups().length > 0}
              fallback={
                <div class="mafw-host-drawer-empty">
                  <Icon name="server" size="large" />
                  <div>{query() ? "没有匹配的主机" : "还没有保存的主机"}</div>
                  <div class="mafw-host-drawer-empty-hint">保存一次，之后从抽屉直接开新会话。</div>
                </div>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <section class="mafw-host-group">
                    <div class="mafw-host-group-head">
                      <span>{group.group}</span>
                      <span class="mafw-host-group-count">{group.hosts.length}</span>
                    </div>
                    <For each={group.hosts}>
                      {(entry) => (
                        <div class={`mafw-host-row is-${entry.status}`}>
                          <ButtonV2
                            variant="ghost"
                            class="mafw-host-row-main"
                            aria-label={`${entry.host.name}，${statusLabel[entry.status]}`}
                            onClick={() =>
                              entry.sessionCount > 0
                                ? props.onConnect(entry.host.id)
                                : props.onNewSession(entry.host.id)
                            }
                          >
                            <span class={`mafw-host-status-dot is-${entry.status}`} aria-hidden="true" />
                            <span class="mafw-host-row-text">
                              <span class="mafw-host-name">{entry.host.name}</span>
                              <span class="mafw-host-addr">
                                {entry.host.username}@{entry.host.host}:{entry.host.port}
                                <Show when={entry.host.jumpHostId}>
                                  <span class="mafw-host-jump"> · 跳板</span>
                                </Show>
                              </span>
                            </span>
                            <Show when={entry.sessionCount > 0}>
                              <span class="mafw-host-count" aria-label={`${entry.sessionCount} 个会话`}>
                                {entry.sessionCount}
                              </span>
                            </Show>
                          </ButtonV2>
                          <div class="mafw-host-row-actions">
                            <ButtonV2
                              variant="ghost"
                              size="small"
                              aria-label={`为 ${entry.host.name} 开新会话`}
                              onClick={() => props.onNewSession(entry.host.id)}
                            >
                              <Icon name="plus" size="small" />
                            </ButtonV2>
                            <ButtonV2
                              variant="ghost"
                              size="small"
                              aria-label={`编辑 ${entry.host.name}`}
                              onClick={() => props.onEdit(entry.host)}
                            >
                              <Icon name="edit" size="small" />
                            </ButtonV2>
                            <Show
                              when={confirmRemove() === entry.host.id}
                              fallback={
                                <ButtonV2
                                  variant="ghost"
                                  size="small"
                                  aria-label={`删除 ${entry.host.name}`}
                                  onClick={() => setConfirmRemove(entry.host.id)}
                                >
                                  <Icon name="close" size="small" />
                                </ButtonV2>
                              }
                            >
                              <ButtonV2
                                variant="danger"
                                size="small"
                                onClick={() => {
                                  setConfirmRemove(null)
                                  props.onRemove(entry.host.id)
                                }}
                              >
                                确认删除
                              </ButtonV2>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </section>
                )}
              </For>
            </Show>
          </div>

          <footer class="mafw-host-drawer-foot">
            <span>密码与口令由系统钥匙串加密保存</span>
            <ButtonV2 variant="ghost" size="small" onClick={props.onNew} icon="plus">
              新主机
            </ButtonV2>
          </footer>
        </aside>
      </div>
    </Show>
  )
}
