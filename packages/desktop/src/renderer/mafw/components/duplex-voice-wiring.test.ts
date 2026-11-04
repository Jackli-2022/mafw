// Task 8 design contract: the duplex ASR UI must be wired behind `voice.duplexV1`
// and must not duplicate the microphone branch logic between the composer
// toolbar and the narrow "more" menu. Source-level assertions match the other
// design-contract suites in this package (no jsdom renderer here).
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"

const chatPane = readFileSync(new URL("./ChatPane.tsx", import.meta.url), "utf8")
const hook = readFileSync(new URL("../chat/use-duplex-voice.ts", import.meta.url), "utf8")
const bar = readFileSync(new URL("./DuplexVoiceBar.tsx", import.meta.url), "utf8")

describe("duplex voice wiring", () => {
  test("ChatPane gates duplex through the hook and renders the partial bar", () => {
    // Plan 2 起第三参注入 onFinal（final → 自动发送控制器）。
    expect(chatPane).toContain("useDuplexVoice(() => sidProp(), () => props.gwReady, {")
    expect(chatPane).toContain("voiceMicAction")
    expect(chatPane).toContain("<DuplexVoiceBar")
  })

  test("the hook only enables duplex when the gateway flag is true", () => {
    expect(hook).toMatch(/config\?\.duplexV1\s*===\s*true/)
  })

  test("both microphone entry points share one handler", () => {
    expect(chatPane).toContain("function handleMicClick()")
    // definition + toolbar `onClick={handleMicClick}` + "more" menu item
    const refs = chatPane.match(/handleMicClick/g) ?? []
    expect(refs.length).toBeGreaterThanOrEqual(3)
    // no duplicated legacy branch logic outside the shared handler
    const legacyStarts = chatPane.match(/voiceSession\.startRecording\(\)/g) ?? []
    expect(legacyStarts.length).toBe(1)
    const legacyStops = chatPane.match(/voiceSession\.stopRecording\(\)/g) ?? []
    expect(legacyStops.length).toBe(1)
  })

  test("the bar reports connecting and listening as different states", () => {
    // The gateway cannot answer `ready` until it has started/adopted the ASR
    // sidecar (`startupTimeoutMs = 180_000`), so the bar must not claim it is
    // listening during the connecting phase.
    expect(chatPane).toContain("listening={duplexVoice.listening()}")
    expect(bar).toMatch(/props\.listening\s*\?\s*"正在听…"\s*:\s*"正在连接语音识别…"/)
    // 正在听 may only appear inside that guarded branch.
    expect((bar.match(/正在听…/g) ?? []).length).toBe(1)
  })

  test("the bar is an accessible status region built from v2 components", () => {
    expect(bar).toContain('role="status"')
    expect(bar).toContain('aria-live="polite"')
    expect(bar).toContain("mafw-duplex-voice-bar")
    expect(bar).toContain("ButtonV2")
    // Accessible name must match the visible action (label-in-name): the error
    // state shows 关闭, the listening state shows 停止.
    expect(bar).toContain('aria-label={props.error ? "关闭语音输入提示" : "停止语音输入"}')
    expect(bar).toContain('{props.error ? "关闭" : "停止"}')
    expect(bar).not.toMatch(/<button[\s>]/)
    expect(bar).not.toMatch(/<input[\s>]/)
    expect(bar).not.toMatch(/\stitle=/)
  })
})

describe("duplex voice auto-send wiring（Plan 2）", () => {
  test("ChatPane wires the auto-send controller with the config gate", () => {
    expect(chatPane).toContain("createDuplexAutoSendController")
    expect(chatPane).toContain("voice.duplexAutoSend")
    // deferred minor：onFinal 经显式转接变量转发（控制器依赖 sendMessage，声明在下方）
    expect(chatPane).toContain("relayFinalToAutoSend")
    expect(chatPane).toContain("onFinal: (text) => relayFinalToAutoSend(text)")
    // deferred minor：配置解析走纯函数 + signal（启动竞态：解析前不自动发送）
    expect(chatPane).toContain("resolveDuplexAutoSend")
    expect(chatPane).toContain("setDuplexAutoSendEnabled")
    expect(chatPane).toContain('sendMessage("send", { voiceOrigin: true })')
    // deferred minor：自动发送后清字幕条 final
    expect(chatPane).toContain("duplexVoice.clearFinal()")
  })

  test("partial / manual input / TTS playback cancel the pending auto-send", () => {
    expect(chatPane).toContain("voiceAutoSend.handlePartial()")
    expect(chatPane).toContain("voiceAutoSend.handleManualInput()")
    expect(chatPane).toMatch(/ttsSpeaking\(\)\) voiceAutoSend\.handleStop/)
    // deferred minor：所有 composer 变异路径都取消挂起发送
    const quote = chatPane.slice(chatPane.indexOf("const insertQuote = () =>"), chatPane.indexOf("const insertQuote = () =>") + 700)
    expect(quote).toContain("voiceAutoSend.handleManualInput()")
    const recall = chatPane.slice(chatPane.indexOf("history.up(input())"), chatPane.indexOf("history.up(input())") + 400)
    expect(recall).toContain("voiceAutoSend.handleManualInput()")
  })

  test("TTS playback suppresses duplex transcript in the bar (deferred minor)", () => {
    expect(chatPane).toContain("suppressTranscript: () => ttsSpeaking()")
  })

  test("stopping duplex shares one path that also stops TTS playback (D6)", () => {
    expect(chatPane).toContain("function stopDuplexVoice()")
    // 定义 + 麦克风入口 + 字幕条「停止」至少三处引用
    const refs = chatPane.match(/stopDuplexVoice\(\)/g) ?? []
    expect(refs.length).toBeGreaterThanOrEqual(3)
    expect(chatPane).toMatch(/function stopDuplexVoice\(\)[\s\S]{0,200}stopActivePlayback\(\)/)
  })

  test("the bar exposes the pending-send hint (D2 文本可见窗口)", () => {
    expect(chatPane).toContain("pendingSend={voicePendingSend()}")
    expect(bar).toContain("pendingSend")
    expect(bar).toContain("将自动发送")
  })
})
