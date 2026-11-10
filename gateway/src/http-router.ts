/**
 * HTTP router facade (D3 Task 8, spec §5.1 `http-router.ts`).
 *
 * The spec names this module as the home of the gateway's HTTP surface. The
 * implementation stayed split across `http/` because D3 extracted it leaf-first
 * (Tasks 3/4) and that split is the reviewed, test-pinned shape:
 *
 *   - `http/transport.ts`  — `createRequestListener(deps)`: the request listener
 *                            (CORS/OPTIONS → auth → registry dispatch → plugin web
 *                            → file history → transport branches → dashboard →
 *                            register/control/health → reverse proxy → 500).
 *   - `http/ws-upgrade.ts` — `createWsHub(server, deps)`: the WebSocket server(s),
 *                            the `upgrade` handler, ping + push maintenance and
 *                            `dispose()`.
 *   - `http/http-util.ts`  — `readBody` / `normalizeDir` / `isPortHealthy` helpers.
 *
 * This module exists so code and docs can depend on ONE spec-named entry
 * (`src/http-router`) instead of the `http/*` layout, which is free to change.
 * It is a pure re-export shim: no logic, no state, and — per ruling D3-R2 — no
 * URL dispatch of any kind. Keep it that way; route selection belongs to the
 * RouteRegistry, URL parsing to `http/transport.ts`.
 *
 * Cycle safety: type-only deps re-exported below, never a runtime import of the
 * kernel/entry (CJS TDZ rule, `CANONICAL_TYPE_SET` precedent in kernel.ts).
 */

export {
  createRequestListener,
  matchArtifactId,
  type RequestListener,
  type TransportDeps,
  type TransportCorsHeaders,
  type RegisterIntakePort,
  type ControlPort,
  type HealthPort,
} from './http/transport';

export {
  createWsHub,
  type WsHub,
  type WsHubDeps,
} from './http/ws-upgrade';
