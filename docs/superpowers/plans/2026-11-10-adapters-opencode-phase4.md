# Phase 4 — opencode native driver + neutral-kernel guards

## Context

Plan 6 moved the opencode driver into `adapters/opencode` and fixed the
minors/follow-ups. Phase 4 finishes the neutral-runtime migration:

- opencode stops using the legacy `toRuntimeDefinition` bridge;
- the adapter builds a real `defineRuntime` definition (native transport,
  channels, host surface, adapter-emitted `AdapterEvent`);
- the gateway keeps only the package binding, generic registration and the
  Phase 4.1 legacy-plugin shim;
- the five spec guards land.

Inputs:
- Spec: `docs/superpowers/specs/2026-11-09-neutral-runtime-driver-architecture-design.md` §5–§7, §9 Phase 4/4.1.
- Scope report: `.superpowers/sdd/2026-11-10-adapters-opencode-phase4/scope.md` (file:line map, risks, wave breakdown).
- Base: `main` after the follow-ups closeout.

## Rulings (binding for this plan)

1. **Adapter-internal canonical seam is accepted.** The dialect tables keep
   producing canonical envelopes inside the adapter; a new adapter-local
   emitter converts them to validated `AdapterEvent`. The gateway never sees a
   native envelope or a canonical intermediate from opencode. The W1 golden
   must pin `AdapterEvent.data` payloads, not just types. Direct row-level
   emission remains a Phase 5 cleanup only if a guard requires it.
2. **Legacy shim is one file** `gateway/src/runtime/legacy-plugin-bridge.ts`
   (no `runtime/legacy/` directory; the existing guard asserting that directory
   does not exist stays).
3. **Registration descriptors are adapter-exported** (`REGISTRATION` data:
   names/aliases/variant/tooling); one generic
   `gateway/src/runtime/builtin-adapters.ts` aggregates them. No protocol
   branches in `index.ts`.
4. **All four variants stay** (`adaptive/v1/v2/v21`) and `transport.steer` is
   implemented natively via 2.1 `delivery:'steer'`. v1/v2 retirement is Phase 5.
5. **Turn attribution stays adapter-local** (`turn-attribution.ts`, copy of
   pi's proven queue). Extracting it into `runtime-kit` is a separate follow-up.
6. **No new staged package** during Phase 4; packaging changes only if a wave
   genuinely needs one.
7. **Full test typecheck is not a Phase 4 gate**; the syntax + narrow typed
   gates from the follow-up closeout are.

## Global constraints

- `adapters/opencode/src` imports only contract/core/SDK/jsonc-parser/cross-spawn/Node/local.
- Gateway imports the adapter only through the package binding file.
- Behavior parity is the gate: all existing opencode/lifecycle/golden/route
  tests stay green; no user-visible dialect/capability/channel drop.
- Each wave is independently mergeable and reports new-test count + full totals.
- Gates per wave: targeted suites, gateway `tsc`, `test:contract`, `test:core`,
  `npm run build`; W4+ adds full gateway Jest + desktop typecheck.

## Task 1 (W1): native emission layer

**Files:**
- Create: `adapters/opencode/src/emit.ts` (canonical → validated `AdapterEvent`, lifted from `legacy-definition.ts:38-136`; stable ids, no `bridge-*` naming).
- Create: `adapters/opencode/src/turn-attribution.ts` (port of `adapters/pi/src/pi-turn-attribution.ts`; `opencode_` prefixes; promote on turn start, echo on turn-scoped events, consume one id per terminal).
- Modify: `adapters/opencode/src/events.ts`, `events-21.ts`: export `translateNative(raw, entry, hooks, attribution)` = `applyEventMappings` → per-item `toAdapterEvent` → `validateAdapterEvent`, returning `AdapterEvent[]`; preserve fan-out, suppression, 1→N, stateful tool/part helpers.
- Create: `gateway/tests/fixtures/events/opencode-native-golden.jsonl` (v1/v2/v21 matrix incl. suppression, fan-out, inbox, synthetic background, permission/question request ids).
- Create: `gateway/tests/unit/runtime/opencode-native-events.test.ts`.
- Modify: `gateway/tests/unit/runtime/opencode-neutral-golden.test.ts`: property-level (deep equal minus `id/at/turnID/native`) comparison of the native path against the legacy path.

**Acceptance:**
- Golden pins `AdapterEvent.type` **and** `data` for every emitted event; unknown native type drops + `onUnmatched`; suppression counts unchanged.
- Interleaved-turn test: three `sendTurn`s while busy → each terminal carries its own id; late frames of a retired turn cannot mint a new one.
- `queue.updated` snapshot semantics preserved (array `items` only; item-only inbox events omit it).
- Existing `opencode-events`, `opencode-21-events`, `opencode-neutral-golden` still green.

**Steps:** tests first (red), implement emit+attribution+translate, green, commit `feat(opencode): emit validated AdapterEvents natively`.

## Task 2 (W2): native transport, host and definition

**Files:**
- Create: `adapters/opencode/src/transport.ts` (createSession/sendTurn/interruptTurn/respondToRequest/steer/onEvent/stop; attribution; dialect promise; no bridge).
- Create: `adapters/opencode/src/host.ts` (config/credentials/completion/healthCheck/getBaseUrl/agentProcess/proxyHeaders/resolveProviderTransport/activeDialect/semantics).
- Create: `adapters/opencode/src/channels.ts` (v1 blocks from scope §2.3; `session.list` honours `opts.directory`).
- Modify: `adapters/opencode/src/definition.ts` to call `defineRuntime(...)` directly; keep static entry/capabilities/resolve entry; export tooling metadata + registration descriptor.
- Keep `legacy-definition.ts` unreferenced by `src` until Task 6 (tests may switch one at a time).

**Acceptance:**
- `definition.api === 1`, `eventApi === 1`, `channelApi === 2`; capabilities deep-equal `opencodeCapabilities()` for all variants.
- `opencode-lifecycle`, `opencode-definition`, `opencode-neutral-golden`, `neutral-parity` green; `RuntimeBus` output equals the W1 golden.
- `gateway/src` untouched in this task.

## Task 3 (W3): full v1/v2 channels + capability parity

**Files:**
- Extend `channels.ts` + `channelsV2`: mcp, mcp.config, discovery, instructions, pty, checkpoint, background (direct wiring).
- Add `channelsV2.discovery` skill/instruction roots + contract addition in `packages/runtime-contract/src/channels.ts`.
- Create `gateway/tests/unit/runtime/opencode-channels-v2.test.ts` driving `createNeutralRuntime` over a fake client for all six blocks.
- Retarget route tests (`mcp-config`, `terminal`, `session-checkpoints`, `instruction-sync`, `mcp-mgmt`) at the neutral definition where needed.

**Acceptance:**
- Six v2 blocks present and payload-identical; capability table unchanged per variant.
- Desktop-facing route tests stay green (spec's "v2 channels golden before deleting gateway code" gate).
- Contract/core/kit green.

## Task 4 (W4): gateway seam move

**Files:**
- Create `gateway/src/runtime/builtin-adapters.ts` (descriptor aggregator).
- `adapters/opencode/src/index.ts` exports `REGISTRATION`.
- `gateway/src/index.ts`: registration loop; drop credential/`readProvider*`/`serveAuthHeaders` fallbacks; proxy uses `host.proxyHeaders()`; external from `definition.external`.
- Rename `normalizeOpencodeEvent` → `normalizeRuntimeEvent` (+ call sites).
- Delete `gateway/src/types/sdk.d.ts`; neutralize opencode-named log/env strings; skills/instruction roots from discovery; provider id from config/list.
- Split legacy bridge into `gateway/src/runtime/legacy-plugin-bridge.ts` (Phase 4.1 shim), update imports.

**Acceptance:**
- `gateway/src` has no functional credential/serve-env/`~/.config/opencode` coupling outside the binding file.
- Media/TTS/embedding/judge/scan/watcher tests green; gateway full Jest + desktop typecheck green.

## Task 5 (W5): serve resilience + external parity

**Files:**
- `transport.ts`: resubscribe loop with backoff, re-probe on reconnect, bounded pre-probe buffer, single-flight resubscribe; `rewire()` re-arms probe + resubscribe.
- `serve-sidecar.ts` / `dialect-probe.ts`: auth headers from explicit config, not module env.
- `definition.ts`: single `external` source read by gateway.
- Tests: stream closes mid-turn → resume without duplicate/fused turns; external mode never spawns/kills; probe header injection.

## Task 6 (W6): deletions, guards, docs

**Files:**
- Delete `legacy-definition.ts`; trim `types.ts` (`RuntimeClient`, `OpencodeRuntime`); move `fullCapabilities`.
- Slim `gateway/src/runtime/opencode-adapter.ts` to the package binding (or replace with `builtin-adapters.ts`).
- Guard suite `gateway/tests/unit/runtime/runtime-protocol-guards.test.ts` (G1–G4) + frontend G5 additions; update obsolete guard allowlists.
- Docs: `docs/architecture/runtime.md`, `gateway.md`, `plugin.md`, `docs/releases/`.

**Acceptance:**
- Guard suite green with the exact allowlists in scope §5; obsolete entries removed.
- All gates: build, contract/core/kit/plugin-contract, gateway tsc + full Jest, desktop typecheck + `test:desktop`.

## Final gates

- `npm run build`
- `npm run test:contract`, `npm run test:core`, `npm run test:kit`, `npm run test:plugin-contract`
- `npm run typecheck:gateway-tests`
- gateway `tsc --noEmit -p tsconfig.json` + full Jest `--runInBand --forceExit`
- desktop `npx tsgo -b`, `npm run test:desktop`
- Merge into local `main` after all gates; no push.
