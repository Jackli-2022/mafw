# Voice Message Optimistic Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visual feedback indicators for voice message upload/analysis states so users see immediate confirmation when sending voice messages.

**Architecture:** Track voice message status in a reactive `Map<msgId, VoiceStatus>` signal in ChatPane. Render a `VoiceStatusIndicator` component as a sibling to each `SessionTurn` when the message has an active voice status. Preserve status through the optimistic-to-real message reconciliation in MafwShell.

**Tech Stack:** SolidJS (signals, stores, Show/For), existing MAFW UI components (Spinner, TextShimmer), CSS custom properties from mafw.css

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `opencode-dev/packages/desktop/src/renderer/mafw/components/VoiceStatusIndicator.tsx` | **Create** | Renders uploading/analyzing/done/failed status indicator |
| `opencode-dev/packages/desktop/src/renderer/mafw/components/ChatPane.tsx` | **Modify** | Add voiceStatusMap signal, populate on transitions, render indicator |
| `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx` | **Modify** | Preserve voiceStatus during optimistic-to-real reconciliation |
| `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css` | **Modify** | Add voice indicator styles |

---

### Task 1: Create VoiceStatusIndicator component

**Files:**
- Create: `opencode-dev/packages/desktop/src/renderer/mafw/components/VoiceStatusIndicator.tsx`
- Test: Manual visual verification (no unit test infrastructure for renderer components)

**Interfaces:**
- Consumes: `{ status: "uploading" | "analyzing" | "done" | "failed"; duration?: number; error?: string }`
- Produces: JSX element (standalone component, no exports needed beyond default)

- [ ] **Step 1: Create the VoiceStatusIndicator component**

```typescript
// opencode-dev/packages/desktop/src/renderer/mafw/components/VoiceStatusIndicator.tsx
import { Show, Switch, Match, type JSX } from "solid-js"

interface VoiceStatusIndicatorProps {
  status: "uploading" | "analyzing" | "done" | "failed"
  duration?: number
  error?: string
}

export function VoiceStatusIndicator(props: VoiceStatusIndicatorProps) {
  const formatDuration = (seconds: number): string => {
    if (seconds < 1) return "< 1s"
    return `${Math.round(seconds)}s`
  }

  return (
    <div class="mafw-voice-status" data-status={props.status}>
      <Switch>
        <Match when={props.status === "uploading"}>
          <span class="mafw-voice-status-spinner" />
          <span class="mafw-voice-status-text">上传中...</span>
          <Show when={props.duration}>
            <span class="mafw-voice-status-duration">{formatDuration(props.duration!)}</span>
          </Show>
        </Match>
        <Match when={props.status === "analyzing"}>
          <span class="mafw-voice-status-spinner analyzing" />
          <span class="mafw-voice-status-text">正在分析...</span>
        </Match>
        <Match when={props.status === "done"}>
          <span class="mafw-voice-status-check">✓</span>
          <span class="mafw-voice-status-text">已发送</span>
        </Match>
        <Match when={props.status === "failed"}>
          <span class="mafw-voice-status-error">✗</span>
          <span class="mafw-voice-status-text">发送失败</span>
          <Show when={props.error}>
            <span class="mafw-voice-status-error-detail">{props.error}</span>
          </Show>
        </Match>
      </Switch>
    </div>
  )
}
```

- [ ] **Step 2: Add CSS styles for the voice status indicator**

Append to `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`:

```css
/* ── Voice message status indicator ── */
.mafw-voice-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin-top: 4px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-3);
  background: color-mix(in srgb, var(--background-base) 80%, transparent);
  width: fit-content;
  max-width: 200px;
}
.mafw-voice-status[data-status="uploading"] { color: var(--accent-text); }
.mafw-voice-status[data-status="analyzing"] { color: var(--accent-text); }
.mafw-voice-status[data-status="done"] { color: var(--success); }
.mafw-voice-status[data-status="failed"] { color: var(--danger); }

.mafw-voice-status-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid var(--text-5);
  border-top-color: var(--accent);
  animation: mafw-spin 1s linear infinite;
  flex-shrink: 0;
}
.mafw-voice-status-spinner.analyzing {
  border-top-color: var(--accent);
  animation-duration: 0.8s;
}

.mafw-voice-status-check {
  font-size: 13px;
  color: var(--success);
  flex-shrink: 0;
}
.mafw-voice-status-error {
  font-size: 13px;
  color: var(--danger);
  flex-shrink: 0;
}
.mafw-voice-status-text {
  white-space: nowrap;
}
.mafw-voice-status-duration {
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
}
.mafw-voice-status-error-detail {
  color: var(--text-4);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Verify CSS variable availability**

Check that `--accent-text`, `--success`, `--danger`, `--text-3` through `--text-5` are defined in the existing CSS. These are standard MAFW design tokens already in use (confirmed by grep showing `--accent-text` in `.mafw-session-status` and `--danger` in `.mafw-task-status.failed`).

- [ ] **Step 4: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/VoiceStatusIndicator.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): add VoiceStatusIndicator component and styles"
```

---

### Task 2: Add voiceStatusMap signal to ChatPane and render indicator

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/ChatPane.tsx:343-463` (voice capture + upload), `:1485-1514` (render loop)
- Test: Manual — record a voice segment, verify indicator appears

**Interfaces:**
- Consumes: `VoiceStatusIndicator` component (Task 1)
- Produces: `voiceStatusMap` signal (Map<string, VoiceStatus>), accessible in render

- [ ] **Step 1: Add voiceStatusMap signal after the recorder setup**

In `ChatPane.tsx`, after the `uploadAndSendVoice` function definition (around line 464), add:

```typescript
  // ── Voice status tracking (separate from store to survive reconciliation) ──
  type VoiceStatusInfo = { status: "uploading" | "analyzing" | "done" | "failed"; duration?: number; error?: string }
  const [voiceStatusMap, setVoiceStatusMap] = createSignal(new Map<string, VoiceStatusInfo>())
```

- [ ] **Step 2: Populate voiceStatusMap in onSegment handler**

In the `onSegment` callback (around line 352), after creating the optimistic message, add the status map update:

```typescript
      // Track voice status for UI indicator
      setVoiceStatusMap(prev => {
        const next = new Map(prev)
        next.set(tempMsgId, { status: "uploading", duration })
        return next
      })
```

- [ ] **Step 3: Update voiceStatusMap on transition to "analyzing"**

In `uploadAndSendVoice`, after the store update that changes to `voiceStatus: "analyzing"` (around line 397-422), add:

```typescript
        // Update voice status map with real message ID
        setVoiceStatusMap(prev => {
          const next = new Map(prev)
          next.delete(tempMsgId)
          next.set(realMsgId, { status: "analyzing", duration })
          return next
        })
```

- [ ] **Step 4: Update voiceStatusMap on "done"**

After the store update that changes to `voiceStatus: "done"` (around line 438-448), add:

```typescript
        setVoiceStatusMap(prev => {
          const next = new Map(prev)
          const entry = next.get(realMsgId)
          if (entry) next.set(realMsgId, { ...entry, status: "done" })
          return next
        })
```

- [ ] **Step 5: Update voiceStatusMap on "failed"**

In the catch block (around line 450-463), add:

```typescript
        setVoiceStatusMap(prev => {
          const next = new Map(prev)
          const existing = next.get(tempMsgId)
          if (existing) next.set(tempMsgId, { ...existing, status: "failed", error: err.message || String(err) })
          return next
        })
```

- [ ] **Step 6: Render VoiceStatusIndicator in the turn loop**

In the render loop at line 1485-1514, add the indicator before `SessionTurn` for each user message. Import `VoiceStatusIndicator` at the top of the file.

```typescript
import { VoiceStatusIndicator } from "./VoiceStatusIndicator"
```

Then modify the render loop (around line 1503):

```typescript
                <Show when={voiceStatusMap().get(msg.id)}>
                  {(vs) => (
                    <VoiceStatusIndicator
                      status={vs().status}
                      duration={vs().duration}
                      error={vs().error}
                    />
                  )}
                </Show>
                <SessionTurn
                  sessionID={sidProp()}
                  messageID={msg.id}
                  classes={{ root: "min-w-0 w-full relative", content: "!overflow-visible", container: "w-full" }}
                />
```

- [ ] **Step 7: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "feat(desktop): wire voiceStatusMap into ChatPane render loop"
```

---

### Task 3: Preserve voiceStatus during optimistic-to-real reconciliation

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx:1036-1062` (user message reconciliation)
- Test: Manual — send voice, verify indicator persists through server echo

**Interfaces:**
- Consumes: `voiceStatusMap` from ChatPane (same signal)
- Produces: voice status preserved on real message ID after reconciliation

**Problem:** When SSE `message.updated` arrives, the optimistic message (with `temp-voice-*` or `user-*` ID) is replaced by the real server message ID. The `voiceStatus` field on the message object is lost. The `voiceStatusMap` in ChatPane still has the old ID, so the indicator disappears.

**Solution:** Pass `voiceStatusMap` setter to MafwShell as a callback prop, or use a shared signal. The simplest approach: since ChatPane and MafwShell share the same store, and the voiceStatusMap is local to ChatPane, we need to bridge the gap.

**Alternative (simpler):** Instead of bridging signals, store `voiceStatus` on the message object itself AND keep the voiceStatusMap. In MafwShell's reconciliation, preserve the `voiceStatus` field when copying from optimistic to real message.

- [ ] **Step 1: Ensure voiceStatus is on the optimistic message object**

Already done in Task 2 Step 1 — the `onSegment` handler creates the message with `voiceStatus: "uploading"`.

- [ ] **Step 2: Preserve voiceStatus during reconciliation in MafwShell**

In `MafwShell.tsx` around line 1044-1058, when replacing the optimistic message with the real one, copy over the `voiceStatus` field:

```typescript
            const optIdx = sessionMsgs.findIndex(m => m.role === "user" && m.id.startsWith("user-"))
            if (optIdx >= 0) {
              const opt = sessionMsgs[optIdx]
              sessionMsgs[optIdx] = {
                ...info,
                id: msgId,
                sessionID: sid,
                time: info.time || opt.time || { created: Date.now() },
                // Preserve voice status from optimistic message
                voiceStatus: (opt as any).voiceStatus,
                voiceDuration: (opt as any).voiceDuration,
              }
```

Also handle the `temp-voice-*` prefix (created by `onSegment` before `uploadAndSendVoice` assigns a `user-*` ID):

```typescript
            const optIdx = sessionMsgs.findIndex(m => m.role === "user" && (m.id.startsWith("user-") || m.id.startsWith("temp-voice-")))
```

- [ ] **Step 3: Update voiceStatusMap in ChatPane when reconciliation happens**

Add a callback prop to ChatPane from MafwShell. In `MafwShell.tsx`, pass the callback:

```typescript
// In the ChatPane component invocation (around line 1623)
onVoiceStatusReconcile={(oldId, newId) => {
  setVoiceStatusMap(prev => {
    const next = new Map(prev)
    const entry = next.get(oldId)
    if (entry) {
      next.delete(oldId)
      next.set(newId, entry)
    }
    return next
  })
}}
```

In `ChatPane.tsx`, add the prop to the props interface and call it in `uploadAndSendVoice` when transitioning from temp ID to real ID:

```typescript
// Add to ChatPane props interface
onVoiceStatusReconcile?: (oldId: string, newId: string) => void
```

And in `uploadAndSendVoice`, after updating the voiceStatusMap with realMsgId:

```typescript
        // Notify parent of ID transition
        props.onVoiceStatusReconcile?.(tempMsgId, realMsgId)
```

- [ ] **Step 4: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx opencode-dev/packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "feat(desktop): preserve voice status through message reconciliation"
```

---

### Task 4: Clean up voiceStatusMap entries after completion

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/ChatPane.tsx`

**Problem:** The voiceStatusMap accumulates entries. After "done" status, the entry should be cleaned up after a short delay to free memory and remove the indicator from the UI.

- [ ] **Step 1: Auto-cleanup "done" entries after 3 seconds**

In `uploadAndSendVoice`, after setting status to "done":

```typescript
        // Auto-cleanup after 3s
        setTimeout(() => {
          setVoiceStatusMap(prev => {
            const next = new Map(prev)
            next.delete(realMsgId)
            return next
          })
        }, 3_000)
```

- [ ] **Step 2: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "feat(desktop): auto-cleanup voice status entries after completion"
```

---

### Task 5: Handle multi-segment voice (walkie-talkie mode)

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/ChatPane.tsx`

**Problem:** In walkie-talkie mode, multiple voice segments are captured in sequence. Each creates its own optimistic message with its own status. The current design handles this correctly (each segment is independent), but we need to verify that:

1. Multiple indicators don't stack confusingly
2. The send flow handles multiple pre-uploaded segments

- [ ] **Step 1: Verify multi-segment behavior**

The current `onSegment` handler creates a new message per segment and calls `sendMessage()` if not already sending. Each segment gets its own `temp-voice-*` ID and independent `voiceStatusMap` entry. This is correct behavior — no code changes needed.

- [ ] **Step 2: Add visual separator for consecutive voice segments**

If multiple segments arrive in quick succession, consider collapsing them into a single indicator. For MVP, this is not needed — each segment shows its own indicator independently.

- [ ] **Step 3: Commit (no-op if no changes)**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "chore(desktop): verify multi-segment voice status handling"
```

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | VoiceStatusIndicator component + CSS | New file + mafw.css |
| 2 | voiceStatusMap signal + render in ChatPane | ChatPane.tsx |
| 3 | Preserve status through reconciliation | MafwShell.tsx + ChatPane.tsx |
| 4 | Auto-cleanup done entries | ChatPane.tsx |
| 5 | Multi-segment verification | ChatPane.tsx (likely no-op) |

**Dependencies:** Task 1 → Task 2 → Task 3 → Task 4 → Task 5

**Estimated effort:** ~1-2 hours for an engineer familiar with the codebase.

## Self-Review

1. **Spec coverage:** User wants immediate display (✅ already exists), upload indicator (✅ Task 1-2), analyzing indicator (✅ Task 1-2), done indicator (✅ Task 1-2), failed indicator (✅ Task 1-2). All covered.

2. **Placeholder scan:** No TBD/TODO found. All code blocks are complete.

3. **Type consistency:** `VoiceStatusInfo` type defined once in Task 2, used consistently. Props interface matches component signatures.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-21-voice-optimistic-display.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
