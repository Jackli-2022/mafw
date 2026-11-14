import { createMemo, createSignal, For, Show, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { PageHeader } from "../components/PageHeader"
import { EmptyState } from "../components/EmptyState"
import { SkeletonRows } from "../components/Skeleton"
import { McpServerDialog } from "../components/McpServerDialog"
import { experienceStore } from "../experience-store"
import { authCommandFor, mcpConfigWritable, mcpManageEnabled } from "./mcp-experience"
import {
  mcpFilterMatches,
  mcpStatusLabel,
  mcpStatusTone,
  summarizeMcpServers,
  type McpFilter,
} from "./mcp-page-model"

const FILTERS: { id: McpFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "connected", label: "已连接" },
  { id: "attention", label: "需要处理" },
]

type McpServer = {
  name: string
  status: string
  detail?: string
  type?: "local" | "remote"
  url?: string
  command?: string[]
  source?: string
  disabled?: boolean
}

export function McpPage() {
  const [servers, setServers] = createSignal<McpServer[]>([])
  const [loading, setLoading] = createSignal(true)
  const [err, setErr] = createSignal("")
  const [busy, setBusy] = createSignal<Record<string, boolean>>({})
  const [dialogOpen, setDialogOpen] = createSignal(false)
  const [filter, setFilter] = createSignal<McpFilter>("all")

  const actions = () => experienceStore.state().actions
  const manageVisible = () => experienceStore.state().status !== "ready" || mcpManageEnabled(actions())
  const configWritable = () => mcpConfigWritable(actions())
  const summary = createMemo(() => summarizeMcpServers(servers()))
  const visible = createMemo(() => servers().filter((s) => mcpFilterMatches(s.status, filter())))
  const attentionCount = () => summary().needsAuth + summary().failed

  async function load() {
    setLoading(true)
    setErr("")
    try {
      const list = await window.api.mafw.mcp.servers()
      setServers(Array.isArray(list) ? list : [])
    } catch (e: any) {
      setErr(e?.message ?? String(e))
      setServers([])
    }
    setLoading(false)
  }

  onMount(() => { void load() })

  async function act(name: string, action: "connect" | "disconnect") {
    setBusy((prev) => ({ ...prev, [name]: true }))
    try {
      if (action === "connect") await window.api.mafw.mcp.connect(name)
      else await window.api.mafw.mcp.disconnect(name)
      showToastV2({
        description: action === "connect" ? `已连接 ${name}` : `已断开 ${name}`,
        duration: 2500,
      })
      await load()
    } catch (e: any) {
      showToastV2({ description: `操作失败: ${e?.message ?? e}`, duration: 4000 })
    }
    setBusy((prev) => ({ ...prev, [name]: false }))
  }

  async function copyAuth(name: string) {
    try {
      const command = authCommandFor(actions(), name)
      if (!command) {
        showToastV2({ description: "当前 runtime 未提供认证命令", duration: 3000 })
        return
      }
      await navigator.clipboard.writeText(command)
      showToastV2({ description: `已复制：${command}`, duration: 3000 })
    } catch (e: any) {
      showToastV2({ description: `复制失败: ${e?.message ?? e}`, duration: 3000 })
    }
  }

  async function remove(name: string) {
    try {
      const preview = await window.api.mafw.mcp.previewRemoveServer(name)
      const ok = window.confirm(
        `删除 MCP 服务器「${name}」？\n目标文件：${preview.target}\n备份：${preview.backup ?? "(无)"}`,
      )
      if (!ok) return
      const result = await window.api.mafw.mcp.removeServer(name, { token: preview.token, confirm: true })
      showToastV2({
        description: result.runtimeApplied ? `已删除 ${name}` : `已删除 ${name}（运行时未同步，重启 agent 后生效）`,
        duration: 3500,
      })
      await load()
    } catch (e: any) {
      showToastV2({ description: `删除失败: ${e?.message ?? e}`, duration: 4000 })
    }
  }

  return (
    <div class="mafw-mcp-page">
      <PageHeader
        title="MCP"
        subtitle="MCP 服务器连接与状态"
        actions={
          <>
            <ButtonV2 variant="ghost" size="small" onClick={() => void load()}>刷新</ButtonV2>
            <Show when={configWritable()}>
              <ButtonV2 variant="outline" size="small" onClick={() => setDialogOpen(true)}>添加服务器</ButtonV2>
            </Show>
          </>
        }
      />

      <Show
        when={manageVisible()}
        fallback={
          <EmptyState
            glyph="🔌"
            title="当前 runtime 不支持 MCP 管理"
            hint="需要 runtime 声明 mcpApi；MCP 服务器仍可由 runtime 自身配置。"
          />
        }
      >
        <div class="mafw-mcp-summary">
          <div class="mafw-mcp-summary-card">
            <div class="mafw-mcp-summary-value">{summary().total}</div>
            <div class="mafw-mcp-summary-label">服务器总数</div>
          </div>
          <div class="mafw-mcp-summary-card">
            <div class="mafw-mcp-summary-value mafw-mcp-summary-value--ok">{summary().connected}</div>
            <div class="mafw-mcp-summary-label">已连接</div>
          </div>
          <div class="mafw-mcp-summary-card">
            <div class="mafw-mcp-summary-value mafw-mcp-summary-value--warn">{attentionCount()}</div>
            <div class="mafw-mcp-summary-label">需要处理</div>
          </div>
          <div class="mafw-mcp-summary-card">
            <div class="mafw-mcp-summary-value">{summary().offline}</div>
            <div class="mafw-mcp-summary-label">未连接 / 已禁用</div>
          </div>
        </div>

        <div class="mafw-mcp-filters">
          <For each={FILTERS}>
            {(f) => (
              <ButtonV2
                variant={filter() === f.id ? "contrast" : "ghost"}
                size="small"
                aria-selected={filter() === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </ButtonV2>
            )}
          </For>
        </div>

        <Show
          when={!err()}
          fallback={
            <div class="mafw-config-error-row">
              <span>{err()}</span>
              <ButtonV2 variant="outline" size="small" onClick={() => void load()}>重试</ButtonV2>
            </div>
          }
        >
          <Show when={!loading()} fallback={<SkeletonRows rows={4} h="56px" />}>
            <Show
              when={visible().length > 0}
              fallback={
                <EmptyState
                  glyph="🔌"
                  title={servers().length === 0 ? "未配置 MCP 服务器" : "没有匹配的服务器"}
                  hint={servers().length === 0 ? "在配置或 runtime 中添加 MCP 服务器后，这里会显示连接状态。" : "换一个筛选条件看看。"}
                />
              }
            >
              <div class="mafw-ext-list">
                <For each={visible()}>
                  {(srv) => {
                    const status = () => srv.status ?? "unknown"
                    const tone = () => mcpStatusTone(status())
                    return (
                      <div class="mafw-ext-row">
                        <div class="mafw-ext-main">
                          <div class="mafw-ext-name">
                            <span>{srv.name}</span>
                            <span class="mafw-ext-badge">{srv.type === "remote" ? "remote" : srv.type ? "local" : "runtime"}</span>
                            <span class={`mafw-mcp-status mafw-mcp-status--${tone()}`}>{mcpStatusLabel(status())}</span>
                          </div>
                          <div class="mafw-config-hint mafw-ext-desc">
                            {srv.type === "remote" ? (srv.url ?? "") : (Array.isArray(srv.command) ? srv.command.join(" ") : "")}
                            {srv.source ? ` · 来源 ${srv.source}` : ""}
                            {srv.disabled ? " · 配置中 disabled" : ""}
                            {srv.detail ? ` · ${srv.detail}` : ""}
                          </div>
                        </div>
                        <div class="mafw-ext-actions">
                          <Show when={status() === "needs_auth" && !!authCommandFor(actions(), srv.name)}>
                            <ButtonV2 variant="outline" size="small" onClick={() => void copyAuth(srv.name)}>复制认证命令</ButtonV2>
                          </Show>
                          <Show
                            when={status() === "connected"}
                            fallback={
                              <ButtonV2 variant="ghost" size="small" disabled={!!busy()[srv.name]} onClick={() => void act(srv.name, "connect")}>连接</ButtonV2>
                            }
                          >
                            <ButtonV2 variant="ghost" size="small" disabled={!!busy()[srv.name]} onClick={() => void act(srv.name, "disconnect")}>断开</ButtonV2>
                          </Show>
                          <Show when={configWritable() && !!srv.source}>
                            <ButtonV2 variant="ghost" size="small" onClick={() => void remove(srv.name)}>删除</ButtonV2>
                          </Show>
                          <Show when={busy()[srv.name]}>
                            <LoaderV2 width={12} height={12} />
                          </Show>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>

      <McpServerDialog
        open={dialogOpen()}
        onClose={() => setDialogOpen(false)}
        onSaved={() => { void load() }}
      />
    </div>
  )
}
