#!/usr/bin/env node
// 本地 dist 拷贝部署：把 gateway/dist、共享运行时资产与缺失的生产依赖同步到
// 全局安装目录。资产清单与 Desktop staging 共用 scripts/gateway-package-assets.mjs，
// 防止 skills/Office/voice 在两条发布路径中漂移。
// 背景：`npm install -g` 会按 package.json 自动装依赖，但开发期「只拷 dist」的方式
// 会在新增运行时依赖（如 jsonc-parser）时漏拷 node_modules，导致 daemon 启动
// MODULE_NOT_FOUND。本脚本把缺失的生产依赖一并补上。
//
// 用法：
//   node gateway/scripts/deploy-local.mjs            # 默认目标：<npm prefix -g>/node_modules/@jack200714/mafw/gateway
//   node gateway/scripts/deploy-local.mjs <target>   # 自定义 gateway 目标目录（需已存在）
// 注意：这是全局 npm/开发安装的同步工具，不参与 Desktop 受管 payload 更新。
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PACKAGE_NAME as CONTRACT_PACKAGE,
  resolvePluginContract,
  stagePluginContract,
} from "../../scripts/stage-plugin-contract.mjs";
import { gatewayAssetPlan } from "../../scripts/gateway-package-assets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewayRoot = path.resolve(here, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(gatewayRoot, "package.json"), "utf-8"));
const prodDeps = Object.keys(pkg.dependencies ?? {});

function defaultTarget() {
  const prefix = execSync("npm prefix -g", { encoding: "utf-8" }).trim();
  return path.join(prefix, "node_modules", "@jack200714", "mafw", "gateway");
}

const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultTarget();
if (!fs.existsSync(target)) {
  console.error(`[deploy] target not found: ${target}`);
  process.exit(1);
}

// 1) Runtime assets: one shared plan with desktop staging. Global targets are
// relative to the npm package root (dist/office live under gateway/, CLI and
// skills at the package root).
const pkgRoot = path.dirname(target);
for (const asset of gatewayAssetPlan({
  repoRoot: path.resolve(gatewayRoot, ".."),
  gatewayRoot,
  profile: "global",
})) {
  if (!fs.existsSync(asset.from)) {
    console.error(`[deploy] required asset missing: ${asset.from}`);
    process.exit(1);
  }
  const dst = path.join(pkgRoot, asset.to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(asset.from, dst, { recursive: true, force: true });
  console.log(`[deploy] ${asset.to} → ${dst}`);
}

// 2) 缺失的生产依赖
const targetModules = path.join(target, "node_modules");
let copied = 0;
for (const dep of prodDeps) {
  const src = path.join(gatewayRoot, "node_modules", dep);
  const dst = path.join(targetModules, dep);
  if (!fs.existsSync(src)) continue; // optional/native 由目标侧已有版本负责
  if (fs.existsSync(dst)) continue;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
  copied++;
  console.log(`[deploy] dep + ${dep}`);
}

// 2b) 私有 workspace 包按名解析：gateway/dist 运行时 require('@mafw/plugin-contract')。
// 它不在 npm registry 上，也不是 gateway 的安装依赖，必须在 dist 拷贝后显式
// stage 到目标 gateway 的 node_modules（workspace symlink 在全局安装里不存在）。
const bundled = pkg.mafw?.bundledPackages ?? {};
for (const [dep, relative] of Object.entries(bundled)) {
  if (dep !== CONTRACT_PACKAGE) continue;
  stagePluginContract({
    sourceDir: path.resolve(gatewayRoot, relative),
    nodeModulesDir: targetModules,
  });
}
const contract = resolvePluginContract(path.join(target, "dist", "index.js"));
console.log(`[deploy] ${CONTRACT_PACKAGE} resolves from dist → ${contract.resolved}`);

console.log(`[deploy] done (${copied} dependency dirs copied) → ${target}`);
