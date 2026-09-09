// 用户工具卡代理：把 ToolRegistry 中"用户插件可接管"的工具替换为代理卡。
// pending/running → 委托原注册卡（或 GenericTool）；completed/error → 经 IPC
// 请求 main 执行插件 render，用内置解释器渲染声明式 Widget 树；失败 fail-open。
// 优先级语义见 docs/superpowers/specs/2026-09-09-ui-plugins-tool-cards-design.md §3。
import { For, Show, createResource } from "solid-js"
import type { JSX } from "solid-js"
import { ToolRegistry, type ToolProps, type ToolComponent } from "@mafw/session-ui/message-part"
import { BasicTool, GenericTool } from "@mafw/session-ui/basic-tool"
import type { Widget } from "../../../shared/ui-plugins"

// original = undefined 表示该工具本来没有注册卡（默认链是 GenericTool）
const proxied = new Map<string, ToolComponent | undefined>()

function UserPluginProxy(props: ToolProps & { pluginTool: string; original?: ToolComponent }) {
  const settled = () => props.status === "completed" || props.status === "error"
  const [result] = createResource(
    () => (settled() ? { tool: props.pluginTool, input: props.input, output: props.output, metadata: props.metadata, status: props.status ?? "completed" } : null),
    (req) => window.api.mafw.uiPlugins.render(req),
  )
  const card = () => (result()?.ok ? result()?.card : undefined)

  return (
    <Show
      when={settled() ? card() : undefined}
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
