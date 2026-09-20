// hunk 级反向 patch 纯函数（切片 2）：客户端传原 patch + 选中 hunk 下标，
// gateway 反转选中 hunks 得到反向 patch，交给 opencode vcs.apply 落回工作区。
// 无状态——不缓存 diff、不读文件系统；下标 0-based，对 splitPatch().hunks。

export interface PatchHunk {
  header: string;
  lines: string[];
}

export interface SplitPatch {
  header: string[];
  hunks: PatchHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** 解析 unified diff：header（首个 @@ 前的行）+ hunk 列表。 */
export function splitPatch(patch: string): SplitPatch {
  const header: string[] = [];
  const hunks: PatchHunk[] = [];
  if (!patch) return { header, hunks };
  let current: PatchHunk | null = null;
  for (const line of patch.split('\n')) {
    const m = HUNK_RE.exec(line);
    if (m) {
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else header.push(line);
  }
  return { header, hunks };
}

/** 反转一个 hunk 的行：+↔-、context 不动、`\ No newline` 保留。 */
function invertLines(lines: string[]): { lines: string[]; oldCount: number; newCount: number } {
  const out: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  for (const line of lines) {
    const c = line[0];
    if (c === '+') { out.push('-' + line.slice(1)); oldCount++; }
    else if (c === '-') { out.push('+' + line.slice(1)); newCount++; }
    else { out.push(line); if (c === ' ') { oldCount++; newCount++; } }
    // '\\'（no-newline 标记）不计数
  }
  return { lines: out, oldCount, newCount };
}

/**
 * 反转选中 hunks → 单文件反向 patch。无命中/越界下标 → null。
 * 子集反转的行号偏移由 git apply 的 offset fuzz 兜底。
 */
export function invertHunks(patch: string, hunkIndices: number[]): string | null {
  if (!patch || !Array.isArray(hunkIndices) || hunkIndices.length === 0) return null;
  const { header, hunks } = splitPatch(patch);
  const selected = hunkIndices
    .filter((i) => Number.isInteger(i) && i >= 0 && i < hunks.length)
    .map((i) => hunks[i]);
  if (selected.length === 0) return null;
  const out: string[] = [...header];
  for (const hunk of selected) {
    const m = HUNK_RE.exec(hunk.header);
    if (!m) return null;
    const [, , , newStart] = m;
    const { lines, oldCount, newCount: invNewCount } = invertLines(hunk.lines);
    const rest = hunk.header.replace(/^@@[^@]*@@/, '');
    // 反转后 old 侧起点 = 原 new 侧起点；计数用反转后实算值
    out.push(`@@ -${newStart},${oldCount} +${newStart},${invNewCount} @@${rest ?? ''}`);
    out.push(...lines);
  }
  return out.join('\n');
}

/** 多文件合并：每文件段独立反转拼接；任一文件无有效 hunk → 整体 null。 */
export function buildRevertPatch(
  entries: Array<{ patch: string; hunkIndices: number[] }>,
): string | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const segments: string[] = [];
  for (const e of entries) {
    const inverted = invertHunks(e?.patch ?? '', e?.hunkIndices ?? []);
    if (!inverted) return null;
    segments.push(inverted);
  }
  return segments.join('\n');
}
