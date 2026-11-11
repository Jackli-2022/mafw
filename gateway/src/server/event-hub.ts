/**
 * Event hub — broadcast / SSE fan-out / WS fan-out / eventBus wiring
 * (D3 Task 7, ruling D3-R4).
 *
 * Extracted from `MafwScheduler` (index.ts): the bodies of `broadcast()` and
 * `setupEventBus()` moved verbatim, and the `sseClients` / `wsClients`
 * containers moved with them. The kernel keeps one-line delegating methods
 * (`broadcast(e) { return this.eventHub.broadcast(e) }` /
 * `setupEventBus() { return this.eventHub.setupEventBus() }`) so the 70+
 * internal call sites and the `BootKernel` port stay untouched.
 *
 * Ownership:
 *  - `sseClients` / `wsClients` live here. Identity is load-bearing: the WS hub
 *    (`http/ws-upgrade.ts`) and the plugin event stream (`attachEventStream`)
 *    join the SAME Set/Map that `broadcast()` iterates — they were kernel
 *    fields before, and they are never reassigned.
 *  - `eventStore` is NOT created here. The kernel lazy-initialises it inside
 *    `getGatewayDb()` (after the data-dir migration, gated by
 *    `config.events.persist`) and hands the live value over through
 *    `getEventStore()`; the hub never opens the DB (G7: startup is never
 *    blocked by the event log — null = live-only, fail-open).
 *
 * Deps are live getters (D1 discipline): the kernel reassigns `pushGateway` /
 * `goalDriver` / `milestonePush` after startup and hot-switches the runtime at
 * runtime, so nothing may be captured by value at construction time.
 */

import * as http from 'http';
import { WebSocket } from 'ws';
import type { Config } from '../config';
import { eventBus } from '../event-bus';
import { shouldAutoStartGoalEvent } from '../core/goal/goal-intake';
import type { NodeDriver } from '../core/goal/driver';
import type { MilestonePushNotifier } from '../core/manager/milestone-push';
import { enrichBroadcastFrame } from '../events/broadcast-frame';
import type { EventStore } from '../events/event-store';
import type { PushGateway } from '../mobile/push-gateway';
import { FLAT_EMITTERS } from '../runtime/flat-emit-registry';

/** Structural logger surface (core/utils/logger `log`). */
export interface EventHubLog {
  info(message: string): void;
  warn(message: string): void;
}

export interface EventHubDeps {
  /** Live persistent event log (null = 纯直播 fail-open; created by the kernel). */
  getEventStore(): EventStore | null;
  /** Live config singleton (hot reload mutates it in place). */
  config(): Config;
  log: EventHubLog;
  getPushGateway(): PushGateway | undefined;
  /** `goal_created` → /goal 自动启动（setImmediate，与旧实现一致）。 */
  startGoal(goalId: string, projectDir?: string): Promise<void> | void;
  /** `state_change` → legacy /goal skill 链唤醒（driver.advance 幂等）。 */
  getGoalDriver(): NodeDriver | null;
  /** `phase_transition` → milestone push（懒构造，需 live getter）。 */
  getMilestonePush(): MilestonePushNotifier | undefined;
  /** P2.4 event layer ingress for internal domain events (inert when disabled). */
  ingestInternalEvent(kind: string, data: any): void;
}

export class EventHub {
  /** Mode A SSE 连接：per-connection write 闭包（attachGlobalSse 返回——回放/直播统一入口）。 */
  readonly sseClients = new Map<http.ServerResponse, (frame: string, seq: number | null) => void>();
  /** WebSocket clients (mobile app): same events as SSE, JSON frames. */
  readonly wsClients: Set<WebSocket> = new Set();

  constructor(private readonly deps: EventHubDeps) {}

  /** 持久事件日志（spec 2026-10-22；null = 纯直播 fail-open）。惰性初始化在 kernel.getGatewayDb。 */
  private get eventStore(): EventStore | null {
    return this.deps.getEventStore();
  }

  /** `goal_created` → /goal 自动启动（原 kernel.startGoal，经 dep 桥接；body 保持原样）。 */
  private startGoal(goalId: string, projectDir?: string): Promise<void> | void {
    return this.deps.startGoal(goalId, projectDir);
  }

  /** legacy /goal skill 链唤醒（live getter：热切换后 driver 会换实例）。 */
  private get goalDriver(): NodeDriver | null {
    return this.deps.getGoalDriver();
  }

  /** milestone push 懒构造在 kernel，故经 getter 取。 */
  private getMilestonePush(): MilestonePushNotifier | undefined {
    return this.deps.getMilestonePush();
  }

  /** P2.4: internal domain event → event layer (kernel decides enablement). */
  private ingestInternalEvent(kind: string, data: any): void {
    this.deps.ingestInternalEvent(kind, data);
  }

  broadcast(event: { type: string; [key: string]: any }): void {
    this.deps.log.info(`[SSE] broadcast ${event.type} clients=${this.sseClients.size}`);
    // 持久事件日志（spec 2026-10-22）：同步分配单调 seq（part.delta 不入库不占 seq）。
    // append 失败/缺席 → seq null → 无 id: 行（现状形状，fail-open）。
    const seq = this.eventStore?.append(event) ?? null;
    const enriched = enrichBroadcastFrame(event, seq, new Date().toISOString());
    const data = (seq !== null ? `id: ${seq}\n` : '') + `data: ${JSON.stringify(enriched)}\n\n`;
    for (const [client, write] of this.sseClients) {
      try { write(data, seq); } catch { this.sseClients.delete(client); }
    }
    // WebSocket clients receive the same events as JSON frames (seq additive).
    const frame = JSON.stringify(enriched);
    // E1-7: collect device IDs already served over WS. Mobile sockets register a
    // `deviceId` on the upgrade; push must not re-deliver to those devices.
    const wsDeviceIds = new Set<string>();
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(frame); } catch { this.wsClients.delete(ws); }
        const deviceId = (ws as any).deviceId;
        if (typeof deviceId === 'string' && deviceId) wsDeviceIds.add(deviceId);
      }
    }
    // Push to registered mobile devices via PushGateway (fallback channel only —
    // devices already served above are excluded; see E1-7).
    this.deps.getPushGateway()?.onBroadcast(enriched, { excludeDeviceIds: wsDeviceIds }).catch((err: any) => {
      this.deps.log.warn(`[PushGateway] broadcast failed: ${err.message}`);
    });
    // 摊销裁剪（每 pruneEveryN 次 append 检查一次；异常吞掉 fail-open）
    this.eventStore?.maybePrune(this.deps.config().events.logRetention, this.deps.config().events.pruneEveryN);
  }

  setupEventBus(): void {
    // v2：eventBus → 扁平广播的翻译收敛为注册表（flat-emit-registry.ts，
    // 发射侧不再硬编码 if 链）；特殊消费者保持独立订阅，与广播翻译正交。
    for (const [name, emit] of FLAT_EMITTERS) {
      eventBus.on(name, (data: any) => this.broadcast(emit(data)));
    }
    eventBus.on("goal_created", (data: any) => {
      this.ingestInternalEvent("goal.created", data);
      if (shouldAutoStartGoalEvent(data)) setImmediate(() => void this.startGoal(data.goalId, data.projectDir));
    });
    eventBus.on("state_change", (data: any) => {
      this.ingestInternalEvent("goal.state", data);
      // legacy /goal skill 链唤醒——driver.advance 幂等（在飞即短路）
      if (data?.goalId) setImmediate(() => void this.goalDriver?.advance(data.goalId));
    });
    eventBus.on("phase_transition", (data: any) => {
      this.ingestInternalEvent("goal.phase", data);
      this.getMilestonePush()?.onPhaseTransition(data);
    });
    // P2.4：memory 管线的内部事件同样进事件层（thread/decision 可观测）。
    for (const name of ['memory_written', 'memory_energy_changed', 'memory_distillation_complete']) {
      eventBus.on(name, (data: any) => this.ingestInternalEvent(name, data));
    }
  }
}
