import { cp, mkdir, readFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import * as path from "node:path"
import {
  PACKAGE_NAME as PLUGIN_CONTRACT_PACKAGE,
  resolvePluginContract,
  stagePluginContract,
} from "../../../scripts/stage-plugin-contract.mjs"
import { gatewayAssetPlan } from "../../../scripts/gateway-package-assets.mjs"
import { run } from "./utils"

/**
 * Stage the MAFW gateway into packages/desktop/gateway-bundle/ so electron-builder
 * can ship it as an extra resource (mode A: self-sufficient desktop).
 *
 * Layout produced:
 *   gateway-bundle/
 *     package.json        (verbatim gateway manifest, including optional deps)
 *     package-lock.json   (verbatim, npm ci is the only dependency install)
 *     dist/               (compiled output + release.json)
 *     voice_sidecars/
 *     skills/
 *     scripts/
 *     node_modules/       (npm ci --omit=dev)
 *
 * Native modules must load under the Electron runtime (ELECTRON_RUN_AS_NODE):
 *   - zeromq is a Node-API addon (node-addon-api) → ABI-stable, no action.
 *   - better-sqlite3 is a V8-ABI addon → re-fetch the electron prebuild,
 *     falling back to a source rebuild against Electron headers.
 *
 * Requires `npm run build` at the repo root first (gateway/dist must exist).
 */

const packageDir = path.resolve(import.meta.dirname, "..")
const rootDir = path.resolve(packageDir, "../..")
const gatewayDir = path.join(rootDir, "gateway")
const outDir = path.join(packageDir, "gateway-bundle")

const desktopPkg = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"))
const electronVersion: string = desktopPkg.devDependencies.electron
if (!electronVersion) throw new Error("electron version not found in desktop package.json")

if (!existsSync(path.join(gatewayDir, "dist", "index.js"))) {
  throw new Error(`${gatewayDir}/dist/index.js missing — run "npm run build" at the repo root first`)
}

console.log(`[stage-gateway] staging into ${outDir} (electron ${electronVersion})`)
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

for (const asset of gatewayAssetPlan({
  repoRoot: rootDir,
  gatewayRoot: gatewayDir,
  profile: "desktop",
})) {
  if (!existsSync(asset.from)) {
    throw new Error(`required gateway asset missing: ${asset.from}`)
  }
  const target = path.join(outDir, asset.to)
  await mkdir(path.dirname(target), { recursive: true })
  await cp(asset.from, target, { recursive: true })
  console.log(`[stage-gateway] ${asset.to}`)
}

const gatewayPkg = JSON.parse(await readFile(path.join(gatewayDir, "package.json"), "utf8"))
if (!existsSync(path.join(gatewayDir, "package-lock.json"))) {
  throw new Error("gateway/package-lock.json missing — lockfile-consistent staging is required")
}
await cp(path.join(gatewayDir, "package.json"), path.join(outDir, "package.json"))
await cp(path.join(gatewayDir, "package-lock.json"), path.join(outDir, "package-lock.json"))

console.log("[stage-gateway] installing production dependencies with npm ci...")
run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: outDir })

// Private workspace packages are resolved by name from gateway/dist. npm cannot
// fetch them and the bundle must not link to the build machine workspace.
const bundledPackages: Record<string, string> = gatewayPkg.mafw?.bundledPackages ?? {}
for (const [name, relative] of Object.entries(bundledPackages)) {
  if (name !== PLUGIN_CONTRACT_PACKAGE) continue
  stagePluginContract({
    sourceDir: path.resolve(gatewayDir, relative),
    nodeModulesDir: path.join(outDir, "node_modules"),
  })
}
const stagedContract = resolvePluginContract(path.join(outDir, "dist", "index.js"))
console.log(`[stage-gateway] ${PLUGIN_CONTRACT_PACKAGE} resolves -> ${stagedContract.resolved}`)

// better-sqlite3 must match the Electron ABI: try the published electron
// prebuild first, then rebuild from source against Electron headers.
const bsqlDir = path.join(outDir, "node_modules", "better-sqlite3")
if (existsSync(bsqlDir)) {
  console.log(`[stage-gateway] rebuilding better-sqlite3 for electron ${electronVersion}...`)
  try {
    run("npx", ["--yes", "prebuild-install", "-r", "electron", "-t", electronVersion], { cwd: bsqlDir })
  } catch {
    console.log("[stage-gateway] no electron prebuild published; compiling from source...")
    run(
      "npx",
      [
        "--yes",
        "node-gyp",
        "rebuild",
        "--release",
        "--runtime=electron",
        `--target=${electronVersion}`,
        "--dist-url=https://electronjs.org/headers",
      ],
      { cwd: bsqlDir },
    )
  }
  if (!existsSync(path.join(bsqlDir, "build", "Release", "better_sqlite3.node"))) {
    throw new Error("better-sqlite3 electron build missing after rebuild")
  }
}

console.log("[stage-gateway] done")
