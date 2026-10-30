import { For, Show, createEffect, createSignal } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"

type MemoryFile = "POD" | "MEMORY" | "GLOSSARY"

const FILES: { id: MemoryFile; label: string }[] = [
  { id: "POD", label: "POD" },
  { id: "MEMORY", label: "MEMORY" },
  { id: "GLOSSARY", label: "GLOSSARY" },
]

export function PodMemoryPanel(props: { podId: string }) {
  const [active, setActive] = createSignal<MemoryFile>("POD")
  const [cache, setCache] = createSignal<Partial<Record<MemoryFile, string>>>({})
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  let seq = 0
  let loadedPod = ""

  createEffect(() => {
    const podId = props.podId
    if (!podId) return
    if (loadedPod !== podId) {
      loadedPod = podId
      setCache({})
      setEditing(false)
      setError(null)
    }
    const file = active()
    if (cache()[file] !== undefined) {
      setLoading(false)
      return
    }
    const my = ++seq
    setLoading(true)
    setError(null)
    void window.api.mafw.pod.readMemoryFile(podId, file)
      .then((result) => {
        if (my !== seq) return
        setCache((prev) => ({ ...prev, [file]: result.content ?? "" }))
      })
      .catch((err: any) => {
        if (my !== seq) return
        setError(String(err?.message ?? err))
      })
      .finally(() => {
        if (my === seq) setLoading(false)
      })
  })

  const content = () => cache()[active()] ?? ""

  const startEdit = () => {
    setDraft(content())
    setEditing(true)
  }

  const save = async () => {
    if (saving()) return
    const file = active()
    const content = draft()
    setSaving(true)
    try {
      await window.api.mafw.pod.writeMemory(props.podId, { file, content })
      setCache((prev) => ({ ...prev, [file]: content }))
      setEditing(false)
      showToastV2({ description: `${file} 已保存`, duration: 1600 } as any)
    } catch (err: any) {
      showToastV2({ description: `保存失败：${String(err?.message ?? err).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div class="mafw-pod-memory">
      <div class="mafw-pod-section-head">
        <span>记忆</span>
        <div class="mafw-pod-memory-actions">
          <Show when={!editing()}>
            <ButtonV2 variant="ghost" size="small" disabled={loading()} onClick={startEdit}>编辑</ButtonV2>
          </Show>
          <Show when={editing()}>
            <ButtonV2 variant="ghost" size="small" disabled={saving()} onClick={() => setEditing(false)}>取消</ButtonV2>
            <ButtonV2 variant="outline" size="small" disabled={saving()} onClick={() => void save()}>
              {saving() ? "保存中…" : "保存"}
            </ButtonV2>
          </Show>
        </div>
      </div>

      <div class="mafw-pod-memory-tabs">
        <For each={FILES}>
          {(file) => (
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-pod-memory-tab"
              aria-pressed={active() === file.id}
              disabled={saving()}
              onClick={() => {
                setActive(file.id)
                setEditing(false)
              }}
            >
              {file.label}
            </ButtonV2>
          )}
        </For>
      </div>

      <Show when={error()}>
        <div class="mafw-pod-empty-line">读取失败：{error()}</div>
      </Show>
      <Show when={loading()} fallback={
        <Show when={editing()} fallback={
          <pre class="mafw-pod-memory-view">{content() || "（空）"}</pre>
        }>
          <textarea
            class="mafw-pod-memory-editor"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
        </Show>
      }>
        <div class="mafw-pod-memory-loading"><LoaderV2 width={16} height={16} /></div>
      </Show>
    </div>
  )
}
