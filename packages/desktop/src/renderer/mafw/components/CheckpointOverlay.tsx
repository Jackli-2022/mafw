// Checkpoint / rewind 时间线模态（B3）。
// 只展示已加载窗口的 user 回合；对话回滚与代码回滚都走二次确认。
// 代码回滚仅在 runtime 提供完整、可安全反转的回合级 patch 时出现（当前 opencode 2.1 无 summary → 隐藏）。
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { buildCheckpoints, type Checkpoint } from "./checkpoint-model"
import { canRewindCode, checkpointsToRewind, revertWarning } from "./checkpoint-revert"

export function CheckpointOverlay(props: {
  sessionID: string
  messages: any[]
  parts: Record<string, any[]>
  runtimeName?: string
  caps?: Record<string, boolean>
  busy?: boolean
  onClose: () => void
  onRevert: (messageID: string) => Promise<boolean>
  onRevertCode: (targets: Checkpoint[]) => Promise<boolean>
}) {
  const checkpoints = createMemo(() => buildCheckpoints(props.messages, props.parts, Date.now()))
  const [confirming, setConfirming] = createSignal<{ mode: "revert" | "code"; messageID: string } | null>(null)
  const [working, setWorking] = createSignal(false)

  const busy = () => props.busy === true || working()
  const conversationAvailable = () => props.caps?.sessionBranchApi !== false
  const filesDataAvailable = () => checkpoints().some((cp) => cp.filesKnown)
  const canCode = (cp: Checkpoint) => props.caps?.diffApi === true && canRewindCode(checkpoints(), cp.messageID)
  const modeOf = (messageID: string) => {
    const c = confirming()
    return c && c.messageID === messageID ? c.mode : null
  }

  const close = () => {
    if (!working()) props.onClose()
  }

  const timeLabel = (cp: Checkpoint) =>
    cp.createdAt === null
      ? "时间未知"
      : new Date(cp.createdAt).toLocaleString(undefined, {
          month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
        })
  const baseName = (path: string) => path.split(/[\\/]/).pop() || path

  const request = (cp: Checkpoint, mode: "revert" | "code") => {
    if (busy() || modeOf(cp.messageID)) return
    setConfirming({ mode, messageID: cp.messageID })
  }

  const confirm = async (cp: Checkpoint, mode: "revert" | "code") => {
    if (busy()) return
    const current = confirming()
    if (!current || current.messageID !== cp.messageID || current.mode !== mode) return
    setWorking(true)
    try {
      const ok = mode === "revert"
        ? await props.onRevert(cp.messageID)
        : await props.onRevertCode(checkpointsToRewind(checkpoints(), cp.messageID))
      if (ok) props.onClose()
    } finally {
      setWorking(false)
      setConfirming(null)
    }
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopImmediatePropagation()
      close()
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  return (
    <div class="mafw-checkpoint-backdrop" onClick={close}>
      <div
        class="mafw-checkpoint-panel"
        role="dialog"
        aria-modal="true"
        aria-label="时间线"
        data-session-id={props.sessionID}
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <div class="mafw-checkpoint-head">
          <div>
            <div class="mafw-checkpoint-title">时间线</div>
            <div class="mafw-checkpoint-sub">已加载的历史（最多 30 天）</div>
          </div>
          <ButtonV2 variant="ghost" size="small" disabled={working()} onClick={close} aria-label="关闭时间线">关闭</ButtonV2>
        </div>

        <Show when={props.caps && props.caps.diffApi === false}>
          <div class="mafw-checkpoint-note">当前 runtime 的回滚只影响对话，不改文件。</div>
        </Show>
        <Show when={props.caps?.diffApi === true && !filesDataAvailable()}>
          <div class="mafw-checkpoint-note">当前 runtime 未提供回合级文件摘要，代码回滚不可用。</div>
        </Show>
        <Show when={!conversationAvailable() && props.caps?.diffApi !== true}>
          <div class="mafw-checkpoint-note">当前 runtime 不支持回滚。</div>
        </Show>
        <Show when={props.busy}>
          <div class="mafw-checkpoint-note">会话运行中，结束后可回滚。</div>
        </Show>
        <Show when={working()}>
          <div class="mafw-checkpoint-note">正在回滚……</div>
        </Show>

        <div class="mafw-checkpoint-list">
          <Show when={checkpoints().length > 0} fallback={<div class="mafw-checkpoint-empty">本会话还没有可回滚的检查点</div>}>
            <For each={checkpoints()}>
              {(cp, index) => (
                <div class="mafw-checkpoint-row">
                  <div class="mafw-checkpoint-row-head">
                    <span class="mafw-checkpoint-time">{timeLabel(cp)}</span>
                    <Show when={index() === 0}>
                      <span class="mafw-checkpoint-latest">最新回合</span>
                    </Show>
                  </div>
                  <div class="mafw-checkpoint-prompt" aria-label={cp.prompt}>{cp.prompt}</div>
                  <div class="mafw-checkpoint-files">
                    <Show
                      when={cp.filesKnown}
                      fallback={<span class="mafw-checkpoint-no-files">文件记录不可用（当前 runtime 不提供回合级摘要）</span>}
                    >
                      <Show when={cp.files.length > 0} fallback={<span class="mafw-checkpoint-no-files">无文件改动</span>}>
                        <For each={cp.files.slice(0, 5)}>
                          {(f) => <span class="mafw-checkpoint-chip" aria-label={f.file}>{baseName(f.file)}</span>}
                        </For>
                        <Show when={cp.files.length > 5}>
                          <span class="mafw-checkpoint-chip">+{cp.files.length - 5}</span>
                        </Show>
                      </Show>
                    </Show>
                  </div>
                  <div class="mafw-checkpoint-actions">
                    <Show when={conversationAvailable()}>
                      <ButtonV2
                        variant="outline"
                        size="small"
                        disabled={busy() || modeOf(cp.messageID) !== null}
                        onClick={() => request(cp, "revert")}
                      >回到这里</ButtonV2>
                    </Show>
                    <Show when={canCode(cp)}>
                      <ButtonV2
                        variant="ghost"
                        size="small"
                        disabled={busy() || modeOf(cp.messageID) !== null}
                        onClick={() => request(cp, "code")}
                      >只回滚代码</ButtonV2>
                    </Show>
                  </div>
                  <Show when={modeOf(cp.messageID)}>
                    {(mode) => (
                      <div class="mafw-checkpoint-confirm">
                        <div class="mafw-checkpoint-confirm-text">
                          {mode() === "revert"
                            ? revertWarning(props.runtimeName, props.caps?.revertUndoApi === true, props.caps?.diffApi === true)
                            : `将撤销这条消息所在的回合及之后 ${checkpointsToRewind(checkpoints(), cp.messageID).length} 个回合的文件改动；对话保留。不可自动撤销；patch 冲突时可能停在中间态。`}
                        </div>
                        <div class="mafw-checkpoint-confirm-actions">
                          <ButtonV2 variant="ghost" size="small" disabled={working()} onClick={() => setConfirming(null)}>取消</ButtonV2>
                          <ButtonV2
                            variant="contrast"
                            size="small"
                            disabled={working()}
                            onClick={() => void confirm(cp, mode())}
                          >确认</ButtonV2>
                        </div>
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>

        <div class="mafw-checkpoint-foot">更早的检查点请先在聊天中加载更早历史。</div>
      </div>
    </div>
  )
}
