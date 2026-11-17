# hello-plugin

The smallest useful MAFW gateway plugin package: **one action** (`now`) and
**one event** (`plugin:hello-plugin:tick`) — nothing else.

Copy this package when the plugin only needs to answer a call from the UI
(`action`) and/or tell the UI that something happened (`event`).

## Check it

The gateway validates a candidate directory without installing it (load, dry
`activate()`, contract validation, then dispose):

```bash
mafw plugin check <absolute path to this folder>
```

Requires `mafw plugin check` (plugin standard v1, same delivery). Exit 0 with
`actions` and `events` in the reported inventory means the package activates and
stays inside its declared bounds; install consent and name collisions are
checked at install time. Relative paths are rejected — pass an absolute path.

## Install it

**A human runs this** — an `apiVersion: 2` package needs explicit trust and
permission consent, and `mafw plugins install` reads the human credential
(`MAFW_HUMAN_TOKEN` or `~/.mafw/human.token`):

```bash
mafw plugins install "<absolute path to hello-plugin>" --trust trusted \
  --permission actions --permission events
mafw plugins doctor hello-plugin   # full diagnosis after install
```

`--trust` must equal `plugin.json`'s `kind`, and the `--permission` list must
match `plugin.json`'s `permissions` exactly; any mismatch is rejected with
`permission_consent_required`. Relative paths are rejected too.

Installed packages live in `~/.mafw/plugins/<name>/`; remove one from the
desktop Plugin Center (or delete that directory while the gateway is stopped).

## What the two files show

- `plugin.json` — `apiVersion: 2`, `kind: "trusted"`, `permissions` naming the
  planes the package uses, and `contributes.gateway` listing the exact action
  and event registered at runtime. **The declaration is the upper bound**:
  registering an action or event that is not listed fails the whole package.
- `index.js` — `activate(ctx)` returns `actions` and `events`. The interval is
  cleaned up through `ctx.effect(...)`, which is the only supported way to
  release timers/listeners; it runs on unload, replace, disable and after a
  failed/offline check.

Event types must stay inside the package namespace
(`plugin:<package-name>:<event>`), so this package's event is
`plugin:hello-plugin:tick`.
