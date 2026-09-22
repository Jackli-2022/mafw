import { For, Show } from "solid-js"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"

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

export function MafwPythonCard(props: ToolProps) {
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

export function MafwPythonRestartCard(props: ToolProps) {
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
