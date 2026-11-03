#!/usr/bin/env node
/**
 * Stage the built `@mafw/plugin-contract` package for consumers that resolve it
 * by name outside the npm workspace.
 *
 * The gateway imports `@mafw/plugin-contract` at runtime (validators used by
 * PluginHost, action/event registries and the REST routes), but the package is
 * private and must never be fetched from the public registry. Four layouts need
 * their own copy:
 *
 *   1. the repo workspace        → `node_modules/@mafw/plugin-contract` symlink
 *                                  (created by npm workspaces; left untouched)
 *   2. a packed global install   → `<pkg>/node_modules/@mafw/plugin-contract`
 *                                  (root postinstall; `packages/plugin-contract`
 *                                  ships in the tarball)
 *   3. `mafw deploy-local`       → `<gateway target>/node_modules/@mafw/plugin-contract`
 *   4. Desktop gateway bundle    → `gateway-bundle/node_modules/@mafw/plugin-contract`
 *                                  (`packages/desktop/scripts/stage-gateway.ts`)
 *
 * The copy contains only `package.json` + `dist/`, which is exactly the
 * published `files` set of the contract package. Copies are written to a temp
 * directory and renamed into place so a failed stage cannot leave a half
 * package behind.
 *
 * Usage:
 *   node scripts/stage-plugin-contract.mjs [--source <dir>] [--node-modules <dir>] [--allow-missing]
 *   node scripts/stage-plugin-contract.mjs --verify <entry-file>
 *   node scripts/stage-plugin-contract.mjs --selftest
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..");
export const defaultSourceDir = path.join(repoRoot, "packages", "plugin-contract");
export const PACKAGE_NAME = "@mafw/plugin-contract";

function logLine(message) {
  console.log(`[plugin-contract] ${message}`);
}

function packageParts() {
  return PACKAGE_NAME.split("/");
}

/**
 * Copies the built contract package into `nodeModulesDir/@mafw/plugin-contract`.
 *
 * @param {object} options
 * @param {string} [options.sourceDir] Built contract package (`package.json` + `dist/`).
 * @param {string} options.nodeModulesDir Destination `node_modules` directory.
 * @param {boolean} [options.allowMissing] Skip (with a warning) when `dist/` is absent
 *   instead of throwing. Used by the root postinstall, which runs before the
 *   first build on a fresh checkout.
 * @param {(message: string) => void} [options.log]
 * @returns {{ staged: boolean, reason?: "missing" | "link", target: string, sourceDir: string }}
 */
export function stagePluginContract(options) {
  const {
    sourceDir = defaultSourceDir,
    nodeModulesDir,
    allowMissing = false,
    log = logLine,
  } = options ?? {};
  if (typeof nodeModulesDir !== "string" || nodeModulesDir.length === 0) {
    throw new Error("stagePluginContract requires nodeModulesDir");
  }

  const manifestPath = path.join(sourceDir, "package.json");
  const distDir = path.join(sourceDir, "dist");
  const distIndex = path.join(distDir, "index.js");
  const target = path.join(nodeModulesDir, ...packageParts());

  if (!fs.existsSync(manifestPath) || !fs.existsSync(distIndex)) {
    const detail = `built package missing (expected ${manifestPath} and ${distIndex})`;
    if (!allowMissing) throw new Error(detail);
    log(`skip: ${detail}`);
    return { staged: false, reason: "missing", target, sourceDir };
  }

  let existing;
  try {
    existing = fs.lstatSync(target);
  } catch {
    existing = undefined;
  }

  // npm workspaces create a symlink for this package. Replacing it with a copy
  // would make edits to the workspace source invisible until the next stage.
  if (existing?.isSymbolicLink()) {
    if (fs.existsSync(target)) {
      log(`workspace link kept: ${target} -> ${fs.readlinkSync(target)}`);
      return { staged: false, reason: "link", target, sourceDir };
    }
    // Broken link: drop it and write a real copy.
    fs.rmSync(target, { force: true });
  }

  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const temp = `${target}.tmp-${suffix}`;
  const backup = `${target}.bak-${suffix}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.mkdirSync(temp, { recursive: true });
    fs.copyFileSync(manifestPath, path.join(temp, "package.json"));
    fs.cpSync(distDir, path.join(temp, "dist"), { recursive: true });
    if (!fs.existsSync(path.join(temp, "dist", "index.js"))) {
      throw new Error(`copied package is missing dist/index.js (${sourceDir})`);
    }

    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      try {
        fs.renameSync(temp, target);
      } catch (error) {
        fs.renameSync(backup, target);
        throw error;
      }
      fs.rmSync(backup, { recursive: true, force: true });
    } else {
      fs.renameSync(temp, target);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  }

  log(`staged ${PACKAGE_NAME} -> ${target}`);
  return { staged: true, target, sourceDir };
}

/**
 * Resolves and loads the contract from an entry file inside a consumer layout.
 * Throws with Node's native MODULE_NOT_FOUND error when the copy is missing.
 */
export function resolvePluginContract(fromFile) {
  if (typeof fromFile !== "string" || fromFile.length === 0) {
    throw new Error("resolvePluginContract requires an entry file");
  }
  const requireFrom = createRequire(path.resolve(fromFile));
  const resolved = requireFrom.resolve(PACKAGE_NAME);
  const contract = requireFrom(PACKAGE_NAME);
  if (typeof contract.validateClientDescriptor !== "function") {
    throw new Error(`${PACKAGE_NAME} at ${resolved} does not export validateClientDescriptor`);
  }
  return { resolved, contract };
}

function verify(fromFile) {
  const { resolved, contract } = resolvePluginContract(fromFile);
  console.log(
    `[plugin-contract] resolved ${PACKAGE_NAME} from ${path.resolve(fromFile)} -> ${resolved} ` +
      `(maxDepth=${contract.PLUGIN_UI_LIMITS.maxDepth})`,
  );
}

function writeProbe(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `const contract = require(${JSON.stringify(PACKAGE_NAME)});\n` +
      "if (typeof contract.validateClientDescriptor !== 'function') process.exit(2);\n" +
      "if (contract.PLUGIN_UI_LIMITS.maxDepth !== 12) process.exit(3);\n" +
      `process.stdout.write(require.resolve(${JSON.stringify(PACKAGE_NAME)}));\n`,
  );
}

function runProbe(file) {
  const result = spawnSync(process.execPath, [file], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`probe failed for ${file}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

/** Verifies both shipped layouts from a temporary directory. */
function selftest() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mafw-plugin-contract-"));
  try {
    const layouts = [
      {
        label: "desktop gateway bundle",
        entry: path.join(base, "gateway-bundle", "dist", "probe.cjs"),
        nodeModulesDir: path.join(base, "gateway-bundle", "node_modules"),
      },
      {
        label: "packed global install",
        entry: path.join(
          base,
          "prefix",
          "node_modules",
          "@jack200714",
          "mafw",
          "gateway",
          "dist",
          "probe.cjs",
        ),
        nodeModulesDir: path.join(
          base,
          "prefix",
          "node_modules",
          "@jack200714",
          "mafw",
          "node_modules",
        ),
      },
    ];
    for (const layout of layouts) {
      writeProbe(layout.entry);
      stagePluginContract({ nodeModulesDir: layout.nodeModulesDir, sourceDir: defaultSourceDir });
      const resolved = runProbe(layout.entry);
      const expected = path.resolve(
        path.join(layout.nodeModulesDir, ...packageParts(), "dist", "index.js"),
      );
      if (path.resolve(resolved) !== expected) {
        throw new Error(`${layout.label}: resolved ${resolved}, expected ${expected}`);
      }
      console.log(`[plugin-contract] self-test ok (${layout.label}) -> ${resolved}`);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function main(argv) {
  if (argv.includes("--selftest")) {
    selftest();
    return;
  }
  if (argv.includes("--verify")) {
    verify(readFlag(argv, "--verify"));
    return;
  }
  stagePluginContract({
    sourceDir: readFlag(argv, "--source") ?? defaultSourceDir,
    nodeModulesDir: readFlag(argv, "--node-modules") ?? path.join(repoRoot, "node_modules"),
    allowMissing: argv.includes("--allow-missing"),
  });
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[plugin-contract] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
