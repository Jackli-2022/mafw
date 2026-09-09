// @ts-nocheck
import { For, Show } from "solid-js"
import { ToolRegistry, type ToolProps } from "@mafw/session-ui/message-part"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import { Icon } from "@mafw/ui/icon"

function safeJson(text: string): any {
  try { return JSON.parse(text) } catch (e) { console.warn("[mafw]", e); return [] }
}

function tryJson(obj: any, fallback = ""): string {
  if (typeof obj === "string") return obj
  try { return JSON.stringify(obj, null, 2) } catch (e) { console.warn("[mafw]", e); return fallback || String(obj) }
}

function MafwSearchCard(props: ToolProps) {
  const results = () => safeJson(props.output || "[]")
  return (
    <BasicTool
      icon="magnifying-glass-menu"
      trigger={{ title: "MAFW Hybrid Search", subtitle: props.input?.query, args: [`topK: ${props.input?.topK || 20}`] }}
      status={props.status}
      defaultOpen
    >
      <div class="mafw-tool-results">
        <For each={results()}>{(r: any) => (
          <div class="mafw-tool-result">
            <span class="mafw-tool-tag" classList={{
              "mafw-tag-semantic": r.type === "semantic",
              "mafw-tag-procedural": r.type === "procedural",
              "mafw-tag-episodic": r.type === "episodic",
              "mafw-tag-delta": r.source === "parametric",
            }}>{r.source === "parametric" ? "Δ" : r.type?.[0]?.toUpperCase()}</span>
            <span class="mafw-tool-result-text">{r.primary_abstraction || r.content}</span>
            <span class="mafw-tool-energy">E:{typeof r.energy === "number" ? r.energy.toFixed(1) : r.energy}</span>
          </div>
        )}</For>
        <Show when={results().length === 0 && props.status === "completed"}>
          <div class="mafw-tool-empty">No results</div>
        </Show>
      </div>
    </BasicTool>
  )
}

function MafwAddMemoryCard(props: ToolProps) {
  return (
    <BasicTool
      icon="brain"
      trigger={{ title: "MAFW Add Memory", subtitle: props.input?.primary_abstraction }}
      status={props.status}
    >
      <div class="mafw-tool-meta-grid">
        <div class="mafw-tool-meta"><span class="mafw-tool-meta-label">Type</span>{props.input?.memory_type}</div>
        <div class="mafw-tool-meta"><span class="mafw-tool-meta-label">Energy</span>{props.input?.energy}</div>
        <div class="mafw-tool-meta"><span class="mafw-tool-meta-label">Salience</span>{props.input?.salience ?? props.input?.salience === 0 ? props.input.salience : "-"}</div>
      </div>
      <Show when={props.input?.cue_anchors?.length}>
        <div class="mafw-tool-anchors">
          <span class="mafw-tool-meta-label">Anchors</span>
          {(props.input?.cue_anchors || []).map((a: string) => (
            <span class="mafw-tool-chip">{a}</span>
          ))}
        </div>
      </Show>
    </BasicTool>
  )
}

function MafwDeltasCard(props: ToolProps) {
  const deltas = () => {
    const raw = props.output || "[]"
    const parsed = safeJson(raw)
    return Array.isArray(parsed) ? parsed : parsed.deltas || parsed.results || []
  }
  return (
    <BasicTool
      icon="pencil-line"
      trigger={{ title: "MAFW Δ Deltas", subtitle: `${deltas().length} parametric constraint(s)` }}
      status={props.status}
    >
      <For each={deltas()}>{(d: any) => (
        <div class="mafw-delta-row">
          <span class="mafw-tool-tag mafw-tag-delta">{d.type?.startsWith("C") ? "C" : "P"}</span>
          <div class="mafw-delta-content">
            <div class="mafw-delta-text">{d.content || d.constraint || d.prompt || ""}</div>
            <Show when={d.priority}><span class="mafw-delta-priority">prio: {d.priority}</span></Show>
          </div>
        </div>
      )}</For>
    </BasicTool>
  )
}

function MafwRuleCard(props: ToolProps) {
  const toolName = () => props.tool?.replace(/^mafw_/, "") || ""
  const isTriage = () => toolName().includes("triage")
  const rules = () => {
    const parsed = safeJson(props.output || "[]")
    return Array.isArray(parsed) ? parsed : parsed.rules || parsed.items || []
  }
  return (
    <BasicTool
      icon={isTriage() ? "warning" : "sliders"}
      trigger={{ title: `MAFW ${toolName()}`, subtitle: props.input?.rule_id || props.input?.id || props.input?.triage_id || `${rules().length} item(s)` }}
      status={props.status}
    >
      <For each={rules()}>{(r: any) => (
        <div class="mafw-card" style={{ "margin-bottom": 4 }}>
          <div style={{ flex: 1 }}>
            <div class="mafw-tool-result-text">{r.name || r.id || r.goalId || r.reason}</div>
            <Show when={r.trigger?.schedule}>
              <div class="mafw-tool-meta" style="font-size:11px">{r.trigger.schedule}{r.trigger.timezone ? ` (${r.trigger.timezone})` : ""}</div>
            </Show>
            <Show when={r.action?.type}>
              <div class="mafw-tool-meta" style="font-size:11px">{r.action.type}</div>
            </Show>
            <Show when={r.reason}>
              <div class="mafw-tool-meta" style="font-size:11px">{r.reason}</div>
            </Show>
          </div>
          <Show when={r.enabled !== undefined}>
            <span class="mafw-tool-tag" style={{
              background: r.enabled ? "var(--accent-bg)" : "transparent",
              color: r.enabled ? "var(--accent)" : "var(--text-muted)",
              border: "0.5px solid var(--border-base)",
            }}>{r.enabled ? "ON" : "OFF"}</span>
          </Show>
          <Show when={r.severity}>
            <span class="mafw-tool-tag" style={{
              background: r.severity === "high" ? "rgba(232,99,107,0.15)" : r.severity === "medium" ? "rgba(232,184,75,0.15)" : "rgba(118,152,253,0.15)",
              color: r.severity === "high" ? "#e8636b" : r.severity === "medium" ? "#e8b84b" : "#7698fd",
            }}>{r.severity}</span>
          </Show>
        </div>
      )}</For>
    </BasicTool>
  )
}

import { type JSX } from "solid-js"

function MafwGenericCard(props: ToolProps & { icon?: string; label?: string }) {
  return (
    <BasicTool
      icon={(props.icon || "mcp") as any}
      trigger={{
        title: props.label || `MAFW ${props.tool.replace(/^mafw_/, "")}`,
        subtitle: Object.values(props.input || {}).filter(v => typeof v === "string").slice(0, 2).join(", "),
      }}
      status={props.status}
    >
      <Show when={props.output}>
        <pre class="mafw-tool-output">{tryJson(props.output, "")}</pre>
      </Show>
    </BasicTool>
  )
}

// ── Python kernel card ────────────────────────────────────────────────

interface PythonCardData {
  status?: string
  durationMs?: number
  truncated?: boolean
  stdout?: string
  stderr?: string
  result?: string
  error?: { ename?: string; evalue?: string; traceback?: string[] }
  images?: Array<{ mimeType?: string; data?: string }>
  kernelRestarted?: boolean
}

/** Pull the structured python payload from part metadata; fall back to parsing output text. */
function pythonData(props: ToolProps): PythonCardData {
  const meta = (props.metadata || {}) as Record<string, any>
  const direct = meta.python || meta.pythonCard || meta
  if (direct && (typeof direct.stdout === "string" || typeof direct.status === "string" || Array.isArray(direct.images))) {
    return direct as PythonCardData
  }
  // Fallback: parse the plain-text output into stdout / result / stderr sections.
  const out = props.output || ""
  const lines = out.split("\n")
  const stderrIdx = lines.findIndex(l => l.trim() === "stderr:")
  const stdout = stderrIdx >= 0 ? lines.slice(0, stderrIdx).join("\n") : out
  const stderr = stderrIdx >= 0 ? lines.slice(stderrIdx + 1).join("\n") : ""
  return { status: "ok", stdout, stderr, images: [] }
}

function PythonImageGrid(props: { images?: Array<{ mimeType?: string; data?: string }> }) {
  const images = () => props.images || []
  return (
    <Show when={images().length > 0}>
      <div class="mafw-python-images">
        <For each={images()}>
          {(img) => (
            <a
              class="mafw-python-image"
              href={`data:${img.mimeType || "image/png"};base64,${img.data}`}
              target="_blank"
              rel="noreferrer"
              title="点击查看大图"
            >
              <img src={`data:${img.mimeType || "image/png"};base64,${img.data}`} alt="matplotlib figure" />
            </a>
          )}
        </For>
      </div>
    </Show>
  )
}

function MafwPythonCard(props: ToolProps) {
  const data = () => pythonData(props)
  const codeArg = () => {
    const code = (props.input?.code || "") as string
    return code.length > 40 ? code.slice(0, 40) + "…" : code
  }
  return (
    <BasicTool
      icon="terminal"
      trigger={{
        title: "Python 执行",
        subtitle: data().error ? `出错 ${data().error?.ename || ""}` : data().durationMs != null ? `${data().durationMs}ms` : undefined,
        args: codeArg() ? [`code: ${codeArg()}`] : undefined,
      }}
      status={props.status}
      defaultOpen
    >
      <div class="mafw-python-card">
        <Show when={data().kernelRestarted}>
          <div class="mafw-python-warn">内核已重启，之前的变量/导入已丢失，请重新定义。</div>
        </Show>
        <Show when={data().error}>
          {(err) => (
            <div class="mafw-python-error">
              <div class="mafw-python-error-title">{err().ename}: {err().evalue}</div>
              <Show when={err().traceback?.length}>
                <pre class="mafw-python-traceback">{(err().traceback || []).slice(-8).join("\n")}</pre>
              </Show>
            </div>
          )}
        </Show>
        <Show when={data().stdout}>
          <pre class="mafw-python-stdout">{data().stdout}</pre>
        </Show>
        <Show when={data().result}>
          <div class="mafw-python-result">
            <span class="mafw-python-result-label">结果</span>
            <pre class="mafw-python-result-value">{data().result}</pre>
          </div>
        </Show>
        <Show when={data().stderr}>
          <pre class="mafw-python-stderr">{data().stderr}</pre>
        </Show>
        <PythonImageGrid images={data().images} />
        <Show when={data().truncated}>
          <div class="mafw-python-warn">输出已截断（超过 64KB）。</div>
        </Show>
        <Show when={!data().stdout && !data().result && !data().error && !data().images?.length}>
          <div class="mafw-tool-empty">(无输出)</div>
        </Show>
      </div>
    </BasicTool>
  )
}

function MafwPythonRestartCard(props: ToolProps) {
  const out = () => props.output || ""
  return (
    <BasicTool
      icon="rotate-ccw"
      trigger={{ title: "Python 内核重启", subtitle: out() ? out().slice(0, 60) : undefined }}
      status={props.status}
      defaultOpen
    >
      <pre class="mafw-tool-output">{out() || "(无输出)"}</pre>
    </BasicTool>
  )
}

const TOOL_ICONS: Record<string, string> = {
  mafw_create_goal: "checklist",
  mafw_update_state: "edit",
  mafw_load_state: "folder",
  mafw_commit_heuristic: "archive",
  mafw_get_axioms: "glasses",
  mafw_get_model_route: "models",
  mafw_ask_user: "help",
  mafw_record_feedback: "comment",
  mafw_merge_memory: "branch",
  mafw_resolve_merge: "branch",
  mafw_list_automation_rules: "sliders",
  mafw_get_automation_rule: "magnifying-glass",
  mafw_list_triage_items: "bullet-list",
  mafw_get_triage_item: "magnifying-glass",
  mafw_get_automation_history: "menu",
  mafw_run_automation: "enter",
  mafw_validate_rule: "check",
  mafw_propose_triage_decision: "edit",
  mafw_draft_automation_rule: "edit",
}

export function registerMafwToolCards() {
  ToolRegistry.register({ name: "mafw_search_hybrid", render: MafwSearchCard })
  ToolRegistry.register({ name: "mafw_add_memory", render: MafwAddMemoryCard })
  ToolRegistry.register({ name: "mafw_get_deltas", render: MafwDeltasCard })
  ToolRegistry.register({ name: "mafw_python", render: MafwPythonCard })
  ToolRegistry.register({ name: "mafw_python_restart", render: MafwPythonRestartCard })

  const autoTools = [
    "mafw_list_automation_rules", "mafw_get_automation_rule",
    "mafw_list_triage_items", "mafw_get_triage_item",
    "mafw_get_automation_history", "mafw_run_automation",
    "mafw_validate_rule", "mafw_propose_triage_decision",
    "mafw_draft_automation_rule",
  ]

  for (const name of autoTools) {
    ToolRegistry.register({
      name,
      render: (props) => MafwRuleCard({ ...props, tool: name }),
    })
  }

  for (const [name, icon] of Object.entries(TOOL_ICONS)) {
    if (name !== "mafw_search_hybrid" && name !== "mafw_add_memory" && name !== "mafw_get_deltas" && !autoTools.includes(name)) {
      ToolRegistry.register({
        name,
        render: (props) => MafwGenericCard({ ...props, tool: name, icon }),
      })
    }
  }
}
