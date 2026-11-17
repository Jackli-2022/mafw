# kitchen-sink

The **five-plane reference package**: every gateway contribution plane a
package can own, in the smallest shape that still passes the real contracts.
Copy the fragment you need; each one is marked `(1)`…`(5)` in `index.js`.

| Plane | Where | Registered as |
|---|---|---|
| (1) `actions` | `index.js` → `actions.echo` | action `echo`, invoked from the UI |
| (2) `events` | `index.js` → `events[0]` | `plugin:kitchen-sink:ping` |
| (3) `tools` | `index.js` → `tools[0]` | agent tool `plugin:kitchen-sink:lookup` |
| (4) `observers` | `index.js` → `observers[0]` | observer `audit` (read-only) |
| (5) `http` | `index.js` → `ctx.http.route(...)` | `GET /api/plugins/kitchen-sink/api/ping` |
| UI | `index.js` → `ui.panels[0]` | desktop panel `sink`, view action `echo` |

`plugin.json` declares all five gateway planes under `contributes.gateway`
(`http: true` is the whole declaration for the http plane). **Every registered
action / event / tool / observer must appear there** — the declaration is an
upper bound and a mismatch fails activation. `permissions` repeats the planes
so install consent is meaningful.

## Check it

```bash
mafw plugin check <absolute path to this folder>
```

Expected: exit 0, with `actions`, `events`, `tools` and `observers` registered
exactly as declared and one registered `http` route. `http` has no contribution
kind of its own — the check reports the declared flag and the route count, and
the route is really served only after the package is committed. `ui.panels` has
no gateway declaration either: it travels in the activation result. Pass an
absolute path — the gateway resolves it in its own working directory.

## Install it

**A human runs this** — `apiVersion: 2` needs install consent, and
`mafw plugins install` reads the human credential (`MAFW_HUMAN_TOKEN` or
`~/.mafw/human.token`):

```bash
mafw plugins install <absolute path to this folder>
mafw plugins list
mafw plugins doctor kitchen-sink
```

## Per-plane notes

- **actions** — a package action is a UI-callable function; it may return a
  JSON value. Action names are package-local (no `:`), and `ui` slots reference
  them by that local name (`viewAction: 'echo'`).
- **events** — the type must be `plugin:<package-name>:<event>`. Only declared
  types are accepted by `ctx.emit`; emitting anything else is dropped with a
  diagnostic. This package emits its ping from `echo` so the action → event
  direction is visible without a timer.
- **tools** — `name` + `description` + `inputSchema` are mandatory both in
  `plugin.json` and in the activation result. The host exposes the tool as
  `plugin:kitchen-sink:lookup`; **the description and schema are all an agent
  sees**, so describe the shape you accept — this reference accepts any object
  (`{ "type": "object" }`). Package tools are global scope only.
- **observers** — read-only: count, sample, forward. Never mutate the event or
  write back into the session; this is the audit/inspection plane.
- **http** — routes are registered only during `activate()` and are retired
  with that revision. The public URL is host-namespaced
  (`/api/plugins/<package>/api<path>`), so a package can never reach another
  package's routes or the gateway's own.
- **cleanup** — anything you open (timer, listener, watcher) must be released
  through `ctx.effect(...)`. This package needs none, which is why there is no
  timer here.
