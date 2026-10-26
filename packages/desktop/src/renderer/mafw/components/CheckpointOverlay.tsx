// Checkpoint / rewind 时间线模态（B3）。
// 只展示已加载窗口的 user 回合；对话回滚与代码回滚都走二次确认。
// 代码回滚仅在 runtime 提供完整、可安全反转的回合级 patch 时出现（2.1 从 snapshot 树计算）。
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { CheckpointRestoreResult, CheckpointScope, SessionCheckpoint } from "@mafw/sdk"
import { checkpointsWithTurnDiffs, type Checkpoint } from "./checkpoint-model"
import { canRewindCode, checkpointsToRewind, revertWarning } from "./checkpoint-revert"
import { leftoverNotice, restoreWarning, toServerRows } from "./server-checkpoints"
import { collectTurnDiffCandidates, loadTurnDiffs } from "./turn-diffs"
import type { FileDiffEntry } from "./DiffReviewPanel"

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
  /** T2-1：服务端检查点模式（caps.checkpointApi=true 时启用）。 */
  serverCheckpoints?: SessionCheckpoint[]
  onRestoreCheckpoint?: (checkpointId: string, scope: CheckpointScope) => Promise<CheckpointRestoreResult | null>
  onCreateCheckpoint?: () => Promise<boolean>
}) {
  const [turnFiles, setTurnFiles] = createSignal<Record<string, FileDiffEntry[] | null>>({})
  const [loadingTurnFiles, setLoadingTurnFiles] = createSignal(false)
  const [restoring, setRestoring] = createSignal<{ checkpointId: string; scope: CheckpointScope } | null>(null)
  const [notices, setNotices] = createSignal<string[] | null>(null)
  const checkpoints = createMemo(() =>
    checkpointsWithTurnDiffs(props.messages, props.parts, Date.now(), turnFiles()),
  )
  const serverMode = () => props.caps?.checkpointApi === true
  const serverRows = createMemo(() => toServerRows(props.serverCheckpoints ?? []))
  const [confirming, setConfirming] = createSignal<{ mode: "revert" | "code"; messageID: string } | null>(null)
  const [working, setWorking] = createSignal(false)

  let lastTurnDiffKey = ""
  let disposed = false
  createEffect(() => {
    const sid = props.sessionID
    if (!sid) return
    // 服务端检查点模式：列表来自 gateway，不需要逐回合拉 diff（B3 本地时间线仅作旧会话回退）。
    if (serverMode()) {
      setLoadingTurnFiles(false)
      return
    }
    if (props.caps?.diffApi !== true) return
    // busy 时排除最后一个（在飞）回合：其 snapshot 每 step 变化会导致全量重拉。
    const candidates = collectTurnDiffCandidates(props.messages, { excludeLastTurn: props.busy === true })
    if (candidates.length === 0) {
      // 上一轮请求可能被 cancel（其 finally 因 cancelled 跳过）——这里必须收掉 loading，
      // 否则 banner 永远转圈（B3.1 历史 minor：overlay loading 卡住）。
      lastTurnDiffKey = ""
      setLoadingTurnFiles(false)
      return
    }
    const key = sid + "|" + candidates.map(c => c.messageID + ":" + c.snapshotKey).join(",")
    if (key === lastTurnDiffKey) return
    lastTurnDiffKey = key
    setLoadingTurnFiles(true)
    let cancelled = false
    onCleanup(() => { cancelled = true })
    void loadTurnDiffs(sid, props.messages, (s, m) => window.api.mafw.sessions.diff(s, m), 4, { excludeLastTurn: props.busy === true })
      .then((map) => { if (!cancelled && !disposed) setTurnFiles(map) })
      .catch(() => { if (!cancelled && !disposed) lastTurnDiffKey = "" }) // 意外失败：允许下次重试
      .finally(() => { if (!cancelled && !disposed) setLoadingTurnFiles(false) })
  })
  onCleanup(() => { disposed = true })

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

  // ── T2-1 服务端检查点（三态） ─────────────────────────────────
  const requestRestore = (checkpointId: string, scope: CheckpointScope) => {
    if (busy()) return
    setNotices(null)
    setRestoring({ checkpointId, scope })
  }

  const confirmRestore = async (checkpointId: string, scope: CheckpointScope) => {
    if (busy()) return
    const current = restoring()
    if (!current || current.checkpointId !== checkpointId || current.scope !== scope) return
    setWorking(true)
    try {
      const result = await props.onRestoreCheckpoint?.(checkpointId, scope)
      if (result) setNotices(leftoverNotice(result))
      setRestoring(null)
    } finally {
      setWorking(false)
    }
  }

  const createServerCheckpoint = async () => {
    if (busy() || !props.onCreateCheckpoint) return
    setWorking(true)
    try { await props.onCreateCheckpoint() } finally { setWorking(false) }
  }

  const ScopeButton = (p: {
    checkpointId: string
    scope: CheckpointScope
    label: string
    disabled?: boolean
  }) => (
    <ButtonV2
      variant="outline"
      size="small"
      disabled={busy() || p.disabled}
      onClick={() => requestRestore(p.checkpointId, p.scope)}
    >{p.label}</ButtonV2>
  )

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
            <div class="mafw-checkpoint-sub">
              {serverMode() && serverRows().length > 0 ? "服务端检查点（自动记录 + 手动）" : "已加载的历史（最多 30 天）"}
            </div>
          </div>
          <div class="mafw-checkpoint-head-actions">
            <Show when={serverMode()}>
              <ButtonV2
                variant="outline"
                size="small"
                disabled={working() || props.busy === true}
                onClick={() => void createServerCheckpoint()}
              >立即检查点</ButtonV2>
            </Show>
            <ButtonV2 variant="ghost" size="small" disabled={working()} onClick={close} aria-label="关闭时间线">关闭</ButtonV2>
          </div>
        </div>

        <Show when={props.caps && props.caps.diffApi === false}>
          <div class="mafw-checkpoint-note">当前 runtime 的回滚只影响对话，不改文件。</div>
        </Show>
        <Show when={!serverMode() && loadingTurnFiles()}>
          <div class="mafw-checkpoint-note">正在加载回合级文件数据…</div>
        </Show>
        <Show when={!serverMode() && !loadingTurnFiles() && props.caps?.diffApi === true && !filesDataAvailable()}>
          <div class="mafw-checkpoint-note">当前会话没有可用的回合级文件数据（需要 git 仓库快照）。</div>
        </Show>
        <Show when={!serverMode() && !conversationAvailable() && props.caps?.diffApi !== true}>
          <div class="mafw-checkpoint-note">当前 runtime 不支持回滚。</div>
        </Show>
        <Show when={props.busy}>
          <div class="mafw-checkpoint-note">会话运行中，结束后可回滚。</div>
        </Show>
        <Show when={working()}>
          <div class="mafw-checkpoint-note">正在回滚……</div>
        </Show>
        <Show when={notices()}>
          {(lines) => (
            <div class="mafw-checkpoint-note">
              <For each={lines()}>{(line) => <div>{line}</div>}</For>
            </div>
          )}
        </Show>

        <div class="mafw-checkpoint-list">
          <Show
            when={serverMode() && serverRows().length > 0}
            fallback={
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
                          fallback={<span class="mafw-checkpoint-no-files">文件记录不可用（本回合未取得快照数据）</span>}
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
            }
          >
            <Show when={serverRows().length > 0} fallback={<div class="mafw-checkpoint-empty">本会话还没有检查点（回合结束后自动记录，或点「立即检查点」）</div>}>
              <For each={serverRows()}>
                {(row, index) => (
                  <div class="mafw-checkpoint-row">
                    <div class="mafw-checkpoint-row-head">
                      <span class="mafw-checkpoint-time">{row.timeLabel}</span>
                      <span class="mafw-checkpoint-kind">{row.kindBadge}</span>
                      <Show when={index() === 0}>
                        <span class="mafw-checkpoint-latest">最新</span>
                      </Show>
                    </div>
                    <div class="mafw-checkpoint-prompt" aria-label={row.checkpoint.anchorMessageID}>
                      检查点 {row.checkpoint.id.slice(-6)} · {row.filesLabel}
                    </div>
                    <div class="mafw-checkpoint-actions">
                      <Show when={conversationAvailable() && row.checkpoint.kind !== "manual"}>
                        <ScopeButton checkpointId={row.checkpoint.id} scope="session" label="只回对话" />
                      </Show>
                      <ScopeButton
                        checkpointId={row.checkpoint.id}
                        scope="files"
                        label="只回代码"
                        disabled={!row.filesAvailable}
                      />
                      <Show when={conversationAvailable() && row.checkpoint.kind !== "manual"}>
                        <ScopeButton checkpointId={row.checkpoint.id} scope="both" label="全部恢复" />
                      </Show>
                    </div>
                    <Show when={restoring()?.checkpointId === row.checkpoint.id ? restoring() : null}>
                      {(current) => (
                        <div class="mafw-checkpoint-confirm">
                          <div class="mafw-checkpoint-confirm-text">
                            {restoreWarning(current().scope, props.runtimeName, props.caps?.revertUndoApi === true)}
                          </div>
                          <div class="mafw-checkpoint-confirm-actions">
                            <ButtonV2 variant="ghost" size="small" disabled={working()} onClick={() => setRestoring(null)}>取消</ButtonV2>
                            <ButtonV2
                              variant="contrast"
                              size="small"
                              disabled={working()}
                              onClick={() => void confirmRestore(row.checkpoint.id, current().scope)}
                            >确认</ButtonV2>
                          </div>
                        </div>
                      )}
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>

        <div class="mafw-checkpoint-foot">
          {serverMode() && serverRows().length > 0
            ? "检查点由 gateway 记录；untracked 文件只报告不自动删除。"
            : "更早的检查点请先在聊天中加载更早历史。"}
        </div>
      </div>
    </div>
  )
}
