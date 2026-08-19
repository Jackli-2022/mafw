/**
 * 存量回填：从 OKF 文件读取 merged_from / cue_anchors，回填 .harmonic_index.json。
 * 修复历史 bug（file-store addEntry 未传 merged_from）导致的 index 缺失，
 * 让 A2 合并降权在生产立即生效。
 *
 * 用法: node gateway/scripts/backfill-index.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const mafwDir = process.env.MAFW_DIR || path.join(os.homedir(), '.mafw');
const indexPath = path.join(mafwDir, 'memory', '.harmonic_index.json');
const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

let mergedBackfilled = 0;
let anchorsBackfilled = 0;
let total = idx.entries.length;

// 提取 cue_anchors（与 harmonic-file-store.ts 的 extractAnchors 一致）
const STOP = new Set(['with', 'this', 'that', 'from', 'have', 'must', 'should', 'when', 'into', 'will', 'also', 'they', 'them', 'then', 'than', 'which', 'their', 'there']);
function extractAnchors(abstraction) {
  if (!abstraction) return [];
  const words = abstraction.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const anchors = sorted.filter(([w]) => !STOP.has(w)).map(([w]) => w);
  if (anchors.length < 2) {
    const cjk = abstraction.match(/[\u4e00-\u9fff]/g) || [];
    for (const c of [...new Set(cjk)].slice(0, 3)) anchors.push(c);
  }
  return anchors.slice(0, 5);
}

function parseOKFFrontmatter(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const body = m[1];
    const res = {};
    // 简单 key: value 解析（yaml 子集，够用 merged_from/cue_anchors）
    const mergedMatch = body.match(/merged_from:\s*\n((?:\s*-\s*\S+\n?)+)/);
    if (mergedMatch) {
      res.merged_from = mergedMatch[1].split('\n').map(l => l.trim().replace(/^-\s*/, '')).filter(Boolean);
    }
    const anchorsMatch = body.match(/cue_anchors:\s*\[([^\]]*)\]/);
    if (anchorsMatch) {
      res.cue_anchors = anchorsMatch[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    }
    return res;
  } catch { return {}; }
}

for (const entry of idx.entries) {
  if (!entry.filePath) continue;
  const fullPath = path.join(mafwDir, entry.filePath);
  if (!fs.existsSync(fullPath)) continue;
  const fm = parseOKFFrontmatter(fullPath);

  // 1. merged_from 回填
  if (fm.merged_from && fm.merged_from.length && !(entry.merged_from && entry.merged_from.length)) {
    entry.merged_from = fm.merged_from;
    mergedBackfilled++;
  }
  // 2. cue_anchors 回填（空则从 abstraction 提取）
  if ((!entry.cue_anchors || entry.cue_anchors.length === 0) && fm.cue_anchors && fm.cue_anchors.length) {
    entry.cue_anchors = fm.cue_anchors;
    anchorsBackfilled++;
  } else if (!entry.cue_anchors || entry.cue_anchors.length === 0) {
    const auto = extractAnchors(entry.primary_abstraction);
    if (auto.length) {
      entry.cue_anchors = auto;
      anchorsBackfilled++;
    }
  }
}

idx.updated_at = new Date().toISOString();
const tmp = indexPath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(idx, null, 2), 'utf8');
fs.renameSync(tmp, indexPath);

console.log(`total=${total} merged_from backfilled=${mergedBackfilled} anchors backfilled=${anchorsBackfilled}`);
