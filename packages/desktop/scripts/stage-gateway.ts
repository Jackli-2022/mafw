import { $ } from "bun"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import * as path from "node:path"

/**
 * Stage the MAFW gateway into packages/desktop/gateway-bundle/ so electron-builder
 * can ship it as an extra resource (mode A: self-sufficient desktop).
 *
 * Layout produced:
 *   gateway-bundle/
 *     package.json        (gateway deps only, no scripts/devDeps)
 *     dist/               (copied from <repo>/gateway/dist)
 *     node_modules/       (npm install --omit=dev)
 *
 * Native modules must load under the Electron runtime (ELECTRON_RUN_AS_NODE):
 *   - zeromq is a Node-API addon (node-addon-api) → ABI-stable, no action.
 *   - better-sqlite3 is a V8-ABI addon → re-fetch the electron prebuild,
 *     falling back to a source rebuild against Electron headers.
 *
 * Requires `npm run build` at the repo root first (gateway/dist must exist).
 */

const packageDir = path.resolve(import.meta.dir, "..")
const rootDir = path.resolve(packageDir, "../..")
const gatewayDir = path.join(rootDir, "gateway")
const outDir = path.join(packageDir, "gateway-bundle")

const desktopPkg = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"))
const electronVersion: string = desktopPkg.devDependencies.electron
if (!electronVersion) throw new Error("electron version not found in desktop package.json")

const gatewayDist = path.join(gatewayDir, "dist")
if (!existsSync(path.join(gatewayDist, "index.js"))) {
  throw new Error(`${gatewayDist}/index.js missing — run "npm run build" at the repo root first`)
}

console.log(`[stage-gateway] staging into ${outDir} (electron ${electronVersion})`)
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

// Copy compiled output.
await cp(gatewayDist, path.join(outDir, "dist"), { recursive: true })

// Minimal manifest: production dependencies only.
const gatewayPkg = JSON.parse(await readFile(path.join(gatewayDir, "package.json"), "utf8"))
const bundlePkg = {
  name: "mafw-gateway-bundled",
  version: gatewayPkg.version,
  private: true,
  main: "dist/index.js",
  dependencies: gatewayPkg.dependencies,
}
await writeFile(path.join(outDir, "package.json"), JSON.stringify(bundlePkg, null, 2))

console.log("[stage-gateway] installing production dependencies (this can take a while)...")
await $`npm install --omit=dev --no-audit --no-fund --loglevel=error`.cwd(outDir)

// better-sqlite3 must match the Electron ABI: try the published electron
// prebuild first, then rebuild from source against Electron headers.
const bsqlDir = path.join(outDir, "node_modules", "better-sqlite3")
if (existsSync(bsqlDir)) {
  console.log(`[stage-gateway] rebuilding better-sqlite3 for electron ${electronVersion}...`)
  try {
    await $`npx --yes prebuild-install -r electron -t ${electronVersion}`.cwd(bsqlDir)
  } catch {
    console.log("[stage-gateway] no electron prebuild published; compiling from source...")
    await $`npx --yes node-gyp rebuild --release --runtime=electron --target=${electronVersion} --dist-url=https://electronjs.org/headers`.cwd(
      bsqlDir,
    )
  }
  if (!existsSync(path.join(bsqlDir, "build", "Release", "better_sqlite3.node"))) {
    throw new Error("better-sqlite3 electron build missing after rebuild")
  }
}

console.log("[stage-gateway] done")
