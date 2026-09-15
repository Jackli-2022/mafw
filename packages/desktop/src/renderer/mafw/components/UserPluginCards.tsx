// 用户工具卡代理：把 ToolRegistry 中"用户插件可接管"的工具替换为代理卡。
// running → 每 500ms 节流快照执行插件 render（流式）；completed/error → 最终
// 渲染一次；失败 fail-open 回落默认链。
// 优先级语义见 docs/superpowers/specs/2026-09-09-ui-plugins-tool-cards-design.md §3。
import { For, Show, createResource, createEffect, onCleanup, createSignal } from "solid-js"
import type { JSX } from "solid-js"
import { marked } from "marked"
import { ToolRegistry, type ToolProps, type ToolComponent } from "@mafw/session-ui/message-part"
import { BasicTool, GenericTool } from "@mafw/session-ui/basic-tool"
import type { Widget } from "../../../shared/ui-plugins"

// original = undefined 表示该工具本来没有注册卡（默认链是 GenericTool）
const proxied = new Map<string, ToolComponent | undefined>()

function UserPluginProxy(props: ToolProps & { pluginTool: string; original?: ToolComponent }) {
  const settled = () => props.status === "completed" || props.status === "error"
  const buildReq = () => ({
    tool: props.pluginTool,
    input: props.input,
    output: props.output,
    metadata: props.metadata,
    status: props.status ?? "completed",
  })

  // Streaming: while running, snapshot the request every 500ms (tool output
  // grows continuously — unthrottled re-renders would thrash the IPC); the
  // settled state renders once, immediately.
  const [liveReq, setLiveReq] = createSignal<ReturnType<typeof buildReq> | null>(null)
  createEffect(() => {
    if (props.status !== "running") return
    setLiveReq(buildReq())
    const t = setInterval(() => setLiveReq(buildReq()), 500)
    onCleanup(() => clearInterval(t))
  })
  createEffect(() => {
    if (settled()) setLiveReq(buildReq())
  })

  const [result] = createResource(liveReq, (req) => window.api.mafw.uiPlugins.render(req))
  const card = () => (result()?.ok ? result()?.card : undefined)

  return (
    <Show
      when={card()}
      fallback={props.original ? props.original(props) : <GenericTool {...props} />}
    >
      {(c) => (
        <BasicTool
          icon={(c().icon || "mcp") as any}
          trigger={{ title: c().title || props.pluginTool, subtitle: c().subtitle }}
          status={props.status}
          defaultOpen={c().defaultOpen}
        >
          <For each={c().body}>{(w) => <WidgetNode widget={w} />}</For>
        </BasicTool>
      )}
    </Show>
  )
}

function WidgetNode(props: { widget: Widget }): JSX.Element {
  const w = props.widget
  switch (w.type) {
    case "text":
      return <div class="mafw-tool-result-text">{w.text}</div>
    case "code":
      return <pre class="mafw-tool-output">{w.text}</pre>
    case "kv":
      return (
        <div class="mafw-tool-meta-grid">
          <For each={w.rows}>{([label, value]) => (
            <div class="mafw-tool-meta"><span class="mafw-tool-meta-label">{label}</span>{value}</div>
          )}</For>
        </div>
      )
    case "tags":
      return (
        <div class="mafw-tool-anchors">
          <For each={w.items}>{(t) => <span class="mafw-tool-chip">{t}</span>}</For>
        </div>
      )
    case "list":
      return (
        <div class="mafw-tool-results">
          <For each={w.items}>{(item) =>
            typeof item === "string"
              ? <div class="mafw-tool-result"><span class="mafw-tool-result-text">{item}</span></div>
              : <WidgetNode widget={item} />
          }</For>
        </div>
      )
    case "row":
      return (
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <For each={w.children}>{(c) => <WidgetNode widget={c} />}</For>
        </div>
      )
    case "image":
      return (
        <a class="mafw-python-image" href={w.dataUrl} target="_blank" rel="noreferrer" title="点击查看大图">
          <img src={w.dataUrl} alt="plugin image" />
        </a>
      )
    case "link":
      return <a class="mafw-tool-link" href={w.href} target="_blank" rel="noreferrer">{w.text}</a>
    case "markdown": {
      // Escape raw HTML first (validateWidget guarantees a string), then let
      // marked apply md syntax — no injection surface from plugin output.
      const escaped = w.text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))
      const html = marked.parse(escaped, { async: false }) as string
      return <div class="mafw-plugin-markdown" innerHTML={html} />
    }
    case "progress":
      return (
        <div class="mafw-plugin-progress">
          <div class="mafw-plugin-progress-track"><div class="mafw-plugin-progress-fill" style={{ width: `${w.value}%` }} /></div>
          <span class="mafw-plugin-progress-label">{w.label || `${Math.round(w.value)}%`}</span>
        </div>
      )
    default:
      return <pre class="mafw-tool-output">{JSON.stringify(w)}</pre>
  }
}

async function applyUserPluginCards() {
  // 先恢复所有被代理工具的原始卡（ToolRegistry.register 是覆盖语义；
  // original 为 undefined 时注册 {name, render: undefined} → getTool 返回
  // undefined → session-ui 回落 GenericTool）
  for (const [tool, original] of proxied) {
    ToolRegistry.register({ name: tool, render: original })
  }
  proxied.clear()
  let entries: Array<{ tool: string; override: boolean }> = []
  try {
    entries = await window.api.mafw.uiPlugins.list()
  } catch {
    return // IPC 不可用 → 全部走默认链
  }
  for (const { tool, override } of entries) {
    if (proxied.has(tool)) continue
    const original = ToolRegistry.render(tool)
    if (original && !override) continue // 不覆盖已注册卡（spec §3）
    proxied.set(tool, original)
    ToolRegistry.register({
      name: tool,
      render: (props: ToolProps) => <UserPluginProxy {...props} pluginTool={tool} original={original} />,
    })
  }
}

export function registerUserPluginCards() {
  void applyUserPluginCards()
  window.api.mafw.uiPlugins.onChange(() => void applyUserPluginCards())
}
