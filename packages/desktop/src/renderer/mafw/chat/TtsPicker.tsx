// TTS 音色选择器（逐字迁移自 ChatPane.tsx TTS picker 逻辑 + PopoverShell JSX）。
// 受控组件：ttsVoiceSel/ttsEngine 由宿主持有（voice hook 消费 defaultVoice），
// 音色/引擎列表、风格输入、试听态由组件自管。
import { createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { PopoverShell } from "../components/pickers/PopoverShell"

const TTS_ENGINE_SOURCE_LABEL: Record<string, string> = {
  builtin: "内置引擎",
  legacy: "本地插件（~/.mafw/tts-plugins/）",
  package: "插件包",
}

const VOICE_GRADIENTS = [
  "linear-gradient(135deg,#f6d365,#fda085)",
  "linear-gradient(135deg,#a8edea,#fed6e3)",
  "linear-gradient(135deg,#d299c2,#fef9d7)",
  "linear-gradient(135deg,#89f7fe,#66a6ff)",
  "linear-gradient(135deg,#ff9a9e,#fecfef)",
  "linear-gradient(135deg,#a1c4fd,#c2e9fb)",
  "linear-gradient(135deg,#fbc2eb,#a6c1ee)",
  "linear-gradient(135deg,#84fab0,#8fd3f4)",
]

export function TtsPicker(props: {
  open: boolean
  trigger: HTMLElement | null
  onClose: () => void
  ttsVoiceSel: string | null
  onVoiceSelect: (id: string, label: string) => void
  onVoiceReset: () => void
  onDefaultVoice: (id: string) => void
  ttsEngine: string | null
  onEngineChange: (name: string) => void
  ttsSpeaking: boolean
  speakText: () => void
  stopActivePlayback: () => void
  previewSpeak: (text: string, voice: string) => Promise<void>
}) {
  const [ttsVoices, setTtsVoices] = createSignal<{ id: string; label: string; lang: string }[]>([])
  const [ttsEngines, setTtsEngines] = createSignal<{ name: string; source: string }[]>([])
  const [ttsStyle, setTtsStyle] = createSignal("")
  const [previewing, setPreviewing] = createSignal<string | null>(null)

  onMount(async () => {
    try {
      const cfg: any = await window.api.mafw.config.get("media.tts")
      if (cfg?.style) setTtsStyle(cfg.style)
    } catch { /* ignore */ }
  })

  // 打开时拉取音色/引擎列表（引擎来自 gateway /api/tts/voices）
  createEffect(() => {
    if (!props.open) return
    void loadVoices()
  })

  const loadVoices = async (force = false) => {
    if (!force && ttsVoices().length > 0) return
    try {
      const data: any = await window.api.mafw.tts.voices()
      if (data?.voices) setTtsVoices(data.voices)
      if (data?.defaultVoice) props.onDefaultVoice(data.defaultVoice)
      if (Array.isArray(data?.engines)) setTtsEngines(data.engines)
    } catch (e) { console.warn("[mafw] tts voices fetch:", e) }
  }

  // TTS 引擎切换：持久化 + 重载该引擎的音色表（音色随引擎不同）
  const selectTtsEngine = async (name: string) => {
    if (name === props.ttsEngine) return
    try {
      await window.api.mafw.config.set("media.tts.engine", name)
      props.onEngineChange(name)
      props.onVoiceReset()
      try {
        const data: any = await window.api.mafw.tts.voices()
        if (data?.voices) setTtsVoices(data.voices)
        if (data?.defaultVoice) props.onDefaultVoice(data.defaultVoice)
      } catch { /* 保留旧列表，fail-open */ }
      showToastV2({ description: `TTS 引擎：${name}`, duration: 2000 })
    } catch (e: any) {
      showToastV2({ description: `引擎切换失败: ${e?.message || String(e)}`, duration: 3000 })
    }
  }

  const selectTtsVoice = async (id: string, label: string) => {
    props.onVoiceSelect(id, label)
    try {
      await window.api.mafw.config.set("media.tts.defaultVoice", id)
      showToastV2({ description: `默认音色：${label}`, duration: 2000 })
    } catch (e: any) {
      console.warn("[mafw] tts voice save:", e)
      showToastV2({ description: `音色保存失败: ${e?.message || String(e)}`, duration: 3000 })
    }
  }

  const saveTtsStyle = async () => {
    try {
      await window.api.mafw.config.set("media.tts.style", ttsStyle().trim())
    } catch (e: any) {
      console.warn("[mafw] tts style save:", e)
      showToastV2({ description: `风格保存失败: ${e?.message || String(e)}`, duration: 3000 })
    }
  }

  const previewTtsVoice = async (voice: string, label: string) => {
    if (previewing() === voice) { props.stopActivePlayback(); setPreviewing(null); return }
    props.stopActivePlayback()
    setPreviewing(voice)
    try {
      await props.previewSpeak(`你好，我是${label}。`, voice)
    } catch { /* preview errors ignored */ }
    finally {
      setPreviewing(null)
    }
  }

  onCleanup(() => setPreviewing(null))

  return (
    <PopoverShell open={props.open} trigger={props.trigger} anchor="below-center" width={340} onClose={() => { if (props.open) props.onClose() }}>
      <div class="mafw-tts-picker">
        <div class="mafw-tts-speak-section">
          <span class="mafw-tts-speak-label">播报最后一条回复</span>
          <ButtonV2
            variant="contrast"
            size="small"
            class="mafw-tts-speak-btn"
            disabled={props.ttsSpeaking}
            onClick={() => { console.log("[voice] speak from picker"); props.speakText() }}
          >{props.ttsSpeaking ? "播报中…" : "🔊 播报"}</ButtonV2>
        </div>
        <Show when={ttsEngines().length > 0}>
          <div class="mafw-picker-group-label">引擎</div>
          <div class="mafw-tts-engines">
            <For each={ttsEngines()}>
              {(e) => (
                <TooltipV2 value={TTS_ENGINE_SOURCE_LABEL[e.source] ?? e.source} openDelay={300}>
                  <ButtonV2
                    variant={props.ttsEngine === e.name ? "contrast" : "ghost"}
                    size="small"
                    class="mafw-tts-engine-chip"
                    onClick={() => void selectTtsEngine(e.name)}
                  >{e.name}</ButtonV2>
                </TooltipV2>
              )}
            </For>
          </div>
        </Show>
        <div class="mafw-picker-title">语音音色</div>
        <Show when={ttsVoices().length > 0} fallback={<div class="mafw-picker-empty">正在加载音色…</div>}>
          <div class="mafw-tts-list">
            <For each={ttsVoices()}>
              {(v, i) => (
                <div
                  class="mafw-tts-row"
                  classList={{ sel: props.ttsVoiceSel === v.id, playing: previewing() === v.id }}
                  onClick={() => void selectTtsVoice(v.id, v.label)}
                >
                  <span class="mafw-tts-avatar" style={{ background: VOICE_GRADIENTS[i() % VOICE_GRADIENTS.length] }}>{v.label[0]}</span>
                  <span class="mafw-tts-name">{v.label}</span>
                  <span class="mafw-tts-lang">{v.lang === "zh" ? "中文" : v.lang === "en" ? "EN" : v.lang || "auto"}</span>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    class="mafw-tts-preview"
                    aria-label={`试听 ${v.label}`}
                    disabled={previewing() !== null && previewing() !== v.id}
                    onClick={(e: MouseEvent) => { e.stopPropagation(); void previewTtsVoice(v.id, v.label) }}
                  >{previewing() === v.id ? <span class="mafw-tts-eq"><i/><i/><i/></span> : "▶"}</ButtonV2>
                  <Show when={props.ttsVoiceSel === v.id}>
                    <span class="mafw-picker-row-check">✓</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        <div class="mafw-tts-divider" />
        <div class="mafw-picker-group-label">默认风格（可选）</div>
        <div class="mafw-picker-search mafw-tts-style">
          <span class="mafw-picker-search-icon">✨</span>
          <input
            class="mafw-picker-search-input"
            placeholder="如：用轻快上扬的语调，语速稍快…"
            value={ttsStyle()}
            onInput={e => setTtsStyle(e.currentTarget.value)}
            onBlur={() => void saveTtsStyle()}
            onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void saveTtsStyle() } }}
          />
        </div>
        <div class="mafw-tts-hint">支持音频标签：(风格)文本 · [标签] · (唱歌)歌词</div>
        <div class="mafw-picker-hint">点击选择 · ▶ 试听 · Esc 关闭</div>
      </div>
    </PopoverShell>
  )
}
