// packages/desktop/src/renderer/mafw/components/McpServerDialog.tsx
// B4：添加/覆盖 MCP 服务器（表单 → preview → confirm apply）。
// 持久化与安全边界在 runtime 适配器；这里只负责收集输入与展示 preview。
import { createSignal, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { validateMcpServerForm, type McpFormValues } from "../mcp-config-form"

interface PreviewState {
  token: string
  target: string
  diff: string
  backup?: string
  preserved?: string[]
  warnings?: string[]
}

export function McpServerDialog(props: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = createSignal("")
  const [type, setType] = createSignal<"remote" | "local">("remote")
  const [url, setUrl] = createSignal("")
  const [command, setCommand] = createSignal("")
  const [overwrite, setOverwrite] = createSignal(false)
  const [replace, setReplace] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [errors, setErrors] = createSignal<string[]>([])
  const [preview, setPreview] = createSignal<PreviewState | null>(null)

  function reset() {
    setName("")
    setType("remote")
    setUrl("")
    setCommand("")
    setOverwrite(false)
    setReplace(false)
    setBusy(false)
    setErrors([])
    setPreview(null)
  }

  function close() {
    if (busy()) return
    reset()
    props.onClose()
  }

  function formValues(): McpFormValues {
    return {
      name: name(),
      type: type(),
      url: url(),
      command: command(),
      ...(overwrite() ? { overwrite: true } : {}),
      ...(replace() ? { replace: true } : {}),
    }
  }

  async function startPreview() {
    setErrors([])
    const v = validateMcpServerForm(formValues())
    if (!v.ok) {
      setErrors(v.errors)
      return
    }
    setBusy(true)
    try {
      const p = await window.api.mafw.mcp.previewServer(v.input)
      setPreview(p as PreviewState)
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      setErrors([msg])
      // 常见冲突：给出可勾选项，用户重试即可
      if (/already exists/i.test(msg)) setOverwrite(true)
      if (/type is/i.test(msg)) setReplace(true)
    }
    setBusy(false)
  }

  async function confirmApply() {
    const v = validateMcpServerForm(formValues())
    if (!v.ok) {
      setErrors(v.errors)
      return
    }
    const p = preview()
    if (!p) return
    setBusy(true)
    try {
      const r = await window.api.mafw.mcp.applyServer({ ...v.input, token: p.token, confirm: true })
      showToastV2({
        description: r.runtimeApplied
          ? `已写入并生效：${v.input.name}`
          : `已写入 ${p.target}（运行时未生效，重启 agent 后加载）`,
        duration: 4000,
      })
      props.onSaved()
      reset()
      props.onClose()
    } catch (err: any) {
      setErrors([String(err?.message ?? err)])
      setPreview(null)
    }
    setBusy(false)
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div
          style={{
            position: "fixed",
            inset: "0",
            background: "rgba(0,0,0,0.45)",
            "z-index": "2000",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
          }}
          onPointerDown={(e) => { if (e.target === e.currentTarget) close() }}
        >
          <div
            class="mafw-config-section"
            style={{
              width: "min(720px, calc(100vw - 48px))",
              "max-height": "calc(100vh - 64px)",
              overflow: "auto",
              background: "var(--bg-elevated, var(--bg-overlay))",
              "border-radius": "12px",
              padding: "16px",
            }}
          >
            <div class="mafw-config-section-header">
              <span class="mafw-config-section-title">{preview() ? "确认写入" : "添加 MCP 服务器"}</span>
            </div>
            <div class="mafw-config-section-body" style={{ "padding-top": "12px", display: "grid", gap: "10px" }}>
              <Show when={!preview()}>
                <label class="mafw-config-hint">名称</label>
                <TextInputV2 value={name()} placeholder="例如 sentry" onInput={(e) => setName(e.currentTarget.value)} />
                <label class="mafw-config-hint">类型</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <ButtonV2 variant={type() === "remote" ? "contrast" : "outline"} size="small" onClick={() => setType("remote")}>remote</ButtonV2>
                  <ButtonV2 variant={type() === "local" ? "contrast" : "outline"} size="small" onClick={() => setType("local")}>local</ButtonV2>
                </div>
                <Show when={type() === "remote"} fallback={
                  <>
                    <label class="mafw-config-hint">命令（含参数，一行）</label>
                    <TextInputV2 value={command()} placeholder='npx -y server-filesystem "C:/Docs"' onInput={(e) => setCommand(e.currentTarget.value)} />
                  </>
                }>
                  <label class="mafw-config-hint">URL</label>
                  <TextInputV2 value={url()} placeholder="https://example.com/mcp" onInput={(e) => setUrl(e.currentTarget.value)} />
                </Show>
                <div style={{ display: "flex", gap: "14px" }}>
                  <label class="mafw-config-hint">
                    <input type="checkbox" checked={overwrite()} onChange={(e) => setOverwrite(e.currentTarget.checked)} /> 覆盖同名
                  </label>
                  <label class="mafw-config-hint">
                    <input type="checkbox" checked={replace()} onChange={(e) => setReplace(e.currentTarget.checked)} /> 类型冲突时替换
                  </label>
                </div>
              </Show>

              <Show when={preview()}>
                <div class="mafw-config-hint">目标：{preview()!.target}</div>
                <Show when={preview()!.backup}>
                  <div class="mafw-config-hint">备份：{preview()!.backup}</div>
                </Show>
                <Show when={preview()!.preserved?.length}>
                  <div class="mafw-config-hint">将保留字段：{preview()!.preserved!.join(", ")}</div>
                </Show>
                <Show when={preview()!.warnings?.length}>
                  <div class="mafw-config-hint">{preview()!.warnings!.join("；")}</div>
                </Show>
                <pre
                  class="mafw-ext-content"
                  style={{ "max-height": "320px", overflow: "auto", "white-space": "pre-wrap", "font-size": "11px" }}
                >{preview()!.diff}</pre>
              </Show>

              <Show when={errors().length}>
                <div class="mafw-config-error-row" style={{ display: "grid", gap: "2px" }}>
                  {errors().map((e) => <span>{e}</span>)}
                </div>
              </Show>

              <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "padding-top": "6px" }}>
                <ButtonV2 variant="ghost" size="small" disabled={busy()} onClick={close}>取消</ButtonV2>
                <Show when={!preview()} fallback={
                  <>
                    <ButtonV2 variant="ghost" size="small" disabled={busy()} onClick={() => setPreview(null)}>返回</ButtonV2>
                    <ButtonV2 variant="contrast" size="small" disabled={busy()} onClick={() => void confirmApply()}>确认写入</ButtonV2>
                  </>
                }>
                  <ButtonV2 variant="contrast" size="small" disabled={busy()} onClick={() => void startPreview()}>预览</ButtonV2>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
