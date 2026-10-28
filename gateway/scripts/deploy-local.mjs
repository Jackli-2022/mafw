#!/usr/bin/env node
// 本地 dist 拷贝部署：把 gateway/dist 与生产依赖同步到全局安装目录。
// 背景：`npm install -g` 会按 package.json 自动装依赖，但开发期「只拷 dist」的方式
// 会在新增运行时依赖（如 jsonc-parser）时漏拷 node_modules，导致 daemon 启动
// MODULE_NOT_FOUND。本脚本把缺失的生产依赖一并补上。
//
// 用法：
//   node gateway/scripts/deploy-local.mjs            # 默认目标：<npm prefix -g>/node_modules/@jack200714/mafw/gateway
//   node gateway/scripts/deploy-local.mjs <target>   # 自定义 gateway 目标目录（需已存在）
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// 1) dist
const distSrc = path.join(gatewayRoot, "dist");
const distDst = path.join(target, "dist");
if (!fs.existsSync(distSrc)) {
  console.error(`[deploy] dist missing (run npm run build first): ${distSrc}`);
  process.exit(1);
}
fs.cpSync(distSrc, distDst, { recursive: true, force: true });
console.log(`[deploy] dist → ${distDst}`);

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
console.log(`[deploy] done (${copied} dependency dirs copied) → ${target}`);
