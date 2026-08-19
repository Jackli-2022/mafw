#!/usr/bin/env node
/**
 * Backfill merged_from into .harmonic_index.json from OKF frontmatter.
 *
 * The index entries written by older versions of addEntry() omitted merged_from.
 * This script reads each OKF file, extracts merged_from from the frontmatter,
 * and patches the corresponding index entry. Safe to run multiple times (idempotent).
 *
 * Usage: node scripts/backfill-merged-from.js [mafwDir]
 *   mafwDir defaults to ~/.mafw
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const mafwDir = process.argv[2] || path.join(os.homedir(), '.mafw');
const indexPath = path.join(mafwDir, 'memory', '.harmonic_index.json');

if (!fs.existsSync(indexPath)) {
  console.error('Index not found:', indexPath);
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
let patched = 0;
let alreadyOk = 0;
let missing = 0;

for (const entry of index.entries) {
  if (entry.merged_from && entry.merged_from.length > 0) {
    alreadyOk++;
    continue;
  }
  if (!entry.filePath) { missing++; continue; }

  const fullPath = path.join(mafwDir, entry.filePath);
  if (!fs.existsSync(fullPath)) { missing++; continue; }

  const content = fs.readFileSync(fullPath, 'utf8');
  // Extract merged_from from YAML frontmatter
  const match = content.match(/^merged_from:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (!match) { missing++; continue; }

  const ids = match[1]
    .split('\n')
    .filter(l => l.trim().startsWith('-'))
    .map(l => l.replace(/^\s*-\s+/, '').trim())
    .filter(Boolean);

  if (ids.length > 0) {
    entry.merged_from = ids;
    patched++;
  } else {
    missing++;
  }
}

if (patched > 0) {
  const tmpPath = indexPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf-8');
  fs.renameSync(tmpPath, indexPath);
}

console.log(`Backfill done: ${patched} patched, ${alreadyOk} already OK, ${missing} no merged_from`);
