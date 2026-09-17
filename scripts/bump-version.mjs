#!/usr/bin/env node
// Single source of truth for the repo version: root package.json.
// All workspace package.json files are derived — never edit them by hand.
//
// Usage:
//   node scripts/bump-version.mjs <version>   Set root version + sync workspaces
//   node scripts/bump-version.mjs --check     Verify all versions match root (exit 1 on drift)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeJsonPreservingEol(p, data) {
  const raw = fs.readFileSync(p, 'utf-8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + eol);
}

// Discover workspace package.json files from the root "workspaces" globs (e.g. "packages/*").
function workspacePackageFiles() {
  const { workspaces = [] } = readJson(path.join(repoRoot, 'package.json'));
  const files = [];
  for (const pattern of workspaces) {
    const base = path.join(repoRoot, pattern);
    if (fs.existsSync(base) && fs.statSync(base).isDirectory() && fs.existsSync(path.join(base, 'package.json'))) {
      files.push(path.join(base, 'package.json'));
      continue;
    }
    const parent = path.dirname(base);
    if (!fs.existsSync(parent)) continue;
    for (const dir of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const pkg = path.join(parent, dir.name, 'package.json');
      if (fs.existsSync(pkg)) files.push(pkg);
    }
  }
  return [...new Set(files)].filter((f) => f !== path.join(repoRoot, 'package.json'));
}

function check() {
  const rootVersion = readJson(path.join(repoRoot, 'package.json')).version;
  const drifted = [];
  for (const file of workspacePackageFiles()) {
    const v = readJson(file).version;
    if (v !== rootVersion) drifted.push(`${path.relative(repoRoot, file)}: ${v} (root: ${rootVersion})`);
  }
  if (drifted.length > 0) {
    console.error(`version drift detected:\n  ${drifted.join('\n  ')}`);
    console.error(`run: npm run version:set -- ${rootVersion}`);
    process.exit(1);
  }
  console.log(`all versions in sync: ${rootVersion}`);
}

function setVersion(target) {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(target)) {
    console.error(`invalid semver: ${target}`);
    process.exit(1);
  }
  const rootPkgPath = path.join(repoRoot, 'package.json');
  const rootPkg = readJson(rootPkgPath);
  rootPkg.version = target;
  writeJsonPreservingEol(rootPkgPath, rootPkg);
  const files = workspacePackageFiles();
  for (const file of files) {
    const pkg = readJson(file);
    pkg.version = target;
    writeJsonPreservingEol(file, pkg);
  }
  console.log(`version ${target} written to root + ${files.length} workspace package.json`);
}

const arg = process.argv[2];
if (arg === '--check') check();
else if (arg) setVersion(arg);
else {
  console.error('usage: node scripts/bump-version.mjs <version> | --check');
  process.exit(1);
}
