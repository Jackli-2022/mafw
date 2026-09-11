# MAFW Desktop

The MAFW desktop app — an Electron shell for the MAFW gateway (harmonic
memory, goal orchestration and agent sessions), built with Electron + SolidJS.

## Development

```bash
bun install
bun dev
```

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.
`package` first stages the MAFW gateway into `gateway-bundle/` via
`scripts/stage-gateway.ts` (the app ships its own gateway and spawns it when
no gateway is already running).

```bash
bun run build && bun run package
```
