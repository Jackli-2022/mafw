import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import * as path from "node:path"
import type { GatewayReleaseManifest } from "../src/main/gateway-release-manifest"
import { createGatewayPayloadManifest } from "../src/main/gateway-release-manifest"
import {
  PACKAGE_NAME as PLUGIN_CONTRACT_PACKAGE,
  resolvePluginContract,
  stageContractPackage,
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
  stageContractPackage({
    packageName: name,
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

async function walkFiles(root: string, rel = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await walkFiles(root, child))
    else files.push(child)
  }
  return files
}

// ---------------------------------------------------------------------------
// Shipping hygiene (2026-11-09 installer smoke):
// electron-builder's app-builder copies extraResources with a Win32 MAX_PATH
// walker and silently drops binaries for non-target platforms/arches. The
// payload manifest is generated from this directory, so anything app-builder
// refuses to copy makes first-run verification fail on every machine. Prune
// exactly what the runtime never needs BEFORE hashing, then enforce a path
// budget so a future deep dependency pin fails the build loudly instead of
// shipping a payload that can never verify.
// ---------------------------------------------------------------------------
const PRUNED_SUFFIXES = [".d.ts", ".d.ts.map", ".js.map", ".mjs.map", ".cjs.map", ".ts", ".ts.map"]
const PRUNED_TEST_DIRS = new Set(["test", "tests", "__tests__", "__mocks__"])
const MAX_PAYLOAD_RELATIVE_PATH = 170

function isForeignNativeDir(segments: string[]): boolean {
  const binIndex = segments.lastIndexOf("bin")
  if (binIndex < 2 || segments[binIndex - 1] !== "onnxruntime-node") return false
  const platform = segments[binIndex + 2]
  const arch = segments[binIndex + 3]
  if (!platform || !arch) return false
  if (platform !== process.platform) return true
  // macOS keeps x64 + arm64 (Rosetta / universal builds); other hosts only
  // need their own arch.
  return process.platform !== "darwin" && arch !== process.arch
}

/** True when runtime JS outside the package imports it (then it must stay). */
async function payloadReferences(root: string, specifier: string): Promise<boolean> {
  const roots = [
    path.join(root, "dist"),
    path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist"),
  ]
  const needle = Buffer.from(specifier)
  const visit = async (dir: string): Promise<boolean> => {
    if (!existsSync(dir)) return false
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (await visit(child)) return true
      } else if (entry.name.endsWith(".js") || entry.name.endsWith(".cjs")) {
        if ((await readFile(child)).includes(needle)) return true
      }
    }
    return false
  }
  for (const dir of roots) {
    if (await visit(dir)) return true
  }
  return false
}

async function prunePayload(root: string): Promise<{ files: number; dirs: number }> {
  // @mistralai/mistralai is a shrinkwrapped transitive dependency of
  // pi-coding-agent whose generated operation filenames blow past MAX_PATH.
  // It is only safe to drop when no shipped JS imports it (verified by scan).
  const keepMistral = await payloadReferences(root, "@mistralai/mistralai")
  let files = 0
  let dirs = 0
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await readdir(path.join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name
      const segments = child.split("/")
      if (entry.isDirectory()) {
        const inNodeModules = segments.includes("node_modules")
        const drop =
          (inNodeModules && PRUNED_TEST_DIRS.has(entry.name)) ||
          isForeignNativeDir(segments) ||
          (!keepMistral && child.endsWith("node_modules/@mistralai/mistralai"))
        if (drop) {
          await rm(path.join(root, child), { recursive: true, force: true })
          dirs += 1
          continue
        }
        await walk(child)
        continue
      }
      if (segments.includes("node_modules") && PRUNED_SUFFIXES.some((suffix) => child.endsWith(suffix))) {
        await rm(path.join(root, child), { force: true })
        files += 1
      }
    }
  }
  await walk("")
  return { files, dirs }
}

const pruned = await prunePayload(outDir)
const payloadFiles = await walkFiles(outDir)
const deepest = payloadFiles.reduce((worst, rel) => (rel.length > worst.length ? rel : worst), "")
if (deepest.length > MAX_PAYLOAD_RELATIVE_PATH) {
  throw new Error(
    `gateway payload path exceeds ${MAX_PAYLOAD_RELATIVE_PATH} chars (${deepest.length}): ${deepest}`,
  )
}
console.log(
  `[stage-gateway] pruned payload: ${pruned.dirs} dirs / ${pruned.files} files; ` +
    `${payloadFiles.length} files remain, deepest relative path ${deepest.length}`,
)

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex")
const { manifest: payloadManifest, digest } = await createGatewayPayloadManifest(outDir, {
  walk: async () => payloadFiles,
  read: async (rel) => readFile(path.join(outDir, rel)),
  stat: async (rel) => {
    const value = await stat(path.join(outDir, rel))
    return { size: value.size }
  },
  sha256,
})

const releaseJson = JSON.parse(await readFile(path.join(outDir, "dist", "release.json"), "utf8"))
const requireBuilt = createRequire(import.meta.url)
const experience = requireBuilt(path.join(outDir, "dist", "experience", "experience-contract.js"))
if (releaseJson.experienceVersion !== experience.EXPERIENCE_VERSION) {
  throw new Error("release.json Experience version disagrees with compiled experience-contract")
}
if (releaseJson.minimumClientExperienceVersion !== experience.MIN_CLIENT_EXPERIENCE_VERSION) {
  throw new Error("release.json minimum client Experience disagrees with compiled contract")
}
if (!releaseJson.gatewayVersion || releaseJson.gatewayVersion !== releaseJson.productVersion) {
  throw new Error("release.json gatewayVersion must equal productVersion")
}

const releaseManifest: GatewayReleaseManifest = {
  schemaVersion: 1,
  productVersion: releaseJson.productVersion,
  gatewayVersion: releaseJson.gatewayVersion,
  desktopMinimumGatewayVersion: releaseJson.gatewayVersion,
  experienceVersion: releaseJson.experienceVersion,
  minimumClientExperienceVersion: releaseJson.minimumClientExperienceVersion,
  schemaEpoch: releaseJson.schemaEpoch,
  payloadManifestSha256: digest,
}
await writeFile(
  path.join(outDir, "payload-manifest.json"),
  `${JSON.stringify(payloadManifest, null, 2)}\n`,
  "utf8",
)
await writeFile(
  path.join(outDir, "release-manifest.json"),
  `${JSON.stringify(releaseManifest, null, 2)}\n`,
  "utf8",
)
console.log(`[stage-gateway] payload manifest: ${payloadManifest.files.length} files, digest ${digest.slice(0, 12)}`)
console.log("[stage-gateway] done")
