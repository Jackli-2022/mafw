// packages/desktop/src/main/presence-poller.test.ts
// presence 轮询：`poll()` 立即补一次（renderer 收到 pod.event 时催），stop 后不再拉。
import { test } from "node:test"
import assert from "node:assert/strict"
import { startPresencePolling, type PresencePollingHandle } from "./presence-poller"

const empty = { running: [], attention: { count: 0, items: [] }, unreadResults: { count: 0, latest: null } }

test("poll() triggers an immediate snapshot; stop() halts further polls", async () => {
  let calls = 0
  const snapshots: unknown[] = []
  const handle: PresencePollingHandle = startPresencePolling({
    getBaseUrl: () => "http://127.0.0.1:9",
    intervalMs: 60_000,
    fetchFn: (async () => {
      calls += 1
      return new Response(JSON.stringify(empty), { status: 200 })
    }) as any,
    onSnapshot: (payload) => snapshots.push(payload),
    log: () => {},
  })

  // 首次 tick 是异步的；等它落地后再催一次，必须带来一个额外的请求。
  await new Promise((resolve) => setTimeout(resolve, 20))
  const before = calls
  handle.poll()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(calls, before + 1, "poll() 立即补一次")
  assert.ok(snapshots.length >= 1)

  handle.stop()
  const afterStop = calls
  handle.poll()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(calls, afterStop, "stop 后 poll 不再发请求")
})
