# MAFW Desktop

The MAFW desktop app — an Electron shell for the MAFW gateway (harmonic
memory, goal orchestration and agent sessions), built with Electron + SolidJS.

## Development

```bash
npm install
npm run dev
```

## Build

Run the root build first (gateway `dist` + SDK are required), then build and
package the desktop app. `package` stages the MAFW gateway into
`gateway-bundle/` via `scripts/stage-gateway.ts`.

```bash
cd ../.. && npm run build && cd packages/desktop
npm run build && npm run package
```

The desktop ships a managed gateway as an application resource. On first run
it verifies the bundled payload, installs it under
`<userData>/gateway/versions/<version>-<digest>/`, and starts it with the
Electron Node runtime (`ELECTRON_RUN_AS_NODE=1`). No system Node, npm or
network is required for the gateway itself.

### Gateway source and updates

Packaged Desktop defaults to the **managed** gateway from its own release.
A running global CLI gateway is not adopted silently. Use Config → Gateway to
switch explicitly. An unversioned external gateway is available only for the
current session via “仅本次使用未验证外部 gateway”.

Managed restart tokens exit with code 75 and are restarted by the Desktop
supervisor, not by a detached takeover process. State lives at:

```text
<userData>/gateway/versions/
<userData>/gateway/current.json
<userData>/gateway/previous.json
<userData>/gateway/quarantine.json
~/.mafw/runtime/desktop-gateway/<channel>/
```

A failed payload is quarantined by version + digest. Retry it explicitly from
Config; a new digest proceeds automatically. A `schemaEpoch` change blocks
automatic rollback instead of running old code against new data.

Desktop updates use the prod/beta channel, forbid downgrade, and require valid
Windows code signatures. Signing credentials are not configured in this
branch, so production auto-install remains gated. Linux auto-update is
AppImage-only; deb/rpm are package-manager artifacts.

### Packaged smoke

```bash
# local staged bundle + Electron ABI native modules
npm run smoke:packaged-gateway -- --payload-only

# packaged unpacked app (CI)
npm run smoke:packaged-gateway -- --app-root dist/win-unpacked
```

The smoke starts the packaged gateway with a temporary HOME and free port,
waits for `/health`, and asserts `gatewayVersion`, `experienceVersion`,
`schemaEpoch`, `instanceId` and `distribution: "desktop-managed"`, then verifies
the port is released on shutdown. The old NSIS npm updater is retired; the
installer no longer needs Node, npm or network.
