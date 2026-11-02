/**
 * 共享注释剥离状态机（架构守卫用；gateway / desktop / session-ui / TUI 同一实现）。
 *
 * 为什么不能再用正则：旧实现里的块注释正则会匹配 `//` 行尾注释内部的块注释起头，
 * 一路吞到下一个块注释结尾（review C1 实证：gateway `src/index.ts` 有 ~1677 行、
 * MafwShell.tsx 有 ~285 行被整体置空，守卫假绿）。正则同样无法区分字符串/模板
 * 字面量里的斜杠组合。
 *
 * 本实现是逐字符状态机，只做一件事：**把注释替换成空格，其余字节原样保留**
 * （换行全部保留 → 行号与源文件逐行对齐）。字符串 / 模板字面量内部不当作注释；
 * 模板的 `${...}` 插值回到代码态（插值里的注释照常剥离）。
 *
 * 两个保守约定（与旧实现一致，避免新的吞行风险）：
 *  - 引号只有在**同一行内闭合**时才按字符串处理；否则按普通代码字符放行
 *    （正则字面量里的单/双引号不是字符串起点）。
 *  - 块注释起头若找不到配对的结束符，按普通代码字符放行（不吞掉文件剩余部分）。
 */

export interface StrippedSource {
  /** 注释已被空格替换的源码（换行保留，行数 == 源文件行数）。 */
  code: string;
  /** 每行是否还有「非注释代码字符」（整行注释 → false）。 */
  lineHasCode: boolean[];
}

/** 注释行前缀（用于「异常置空行」判定：这些行的空白是作者意图）。 */
const COMMENT_LINE_PREFIX = /^(\/\/|\/\*|\*|\*\/)/;

function hasCode(line: string): boolean {
  return line.trim().length > 0;
}

/**
 * 剥离注释并保留行结构。
 * 非字符串输入按空串处理（守卫场景不需要容错）。
 */
export function stripComments(source: string): StrippedSource {
  const text = typeof source === 'string' ? source : '';
  const n = text.length;
  let out = '';
  let i = 0;

  const blank = (ch: string): string => (ch === '\n' ? '\n' : ' ');

  /** 字符串体：原样保留（内部斜杠组合不是注释）。 */
  const readQuoted = (quote: string): void => {
    // 同一行内找闭合引号；找不到就当普通代码字符（正则字面量里的引号）。
    let j = i + 1;
    let closed = false;
    while (j < n) {
      const ch = text[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '\n') break;
      if (ch === quote) { closed = true; break; }
      j++;
    }
    if (!closed) {
      out += quote;
      i++;
      return;
    }
    out += quote;
    i++;
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') {
        out += ch + (text[i + 1] ?? '');
        i += 2;
        continue;
      }
      out += ch;
      i++;
      if (ch === quote) return;
    }
  };

  /** 行注释：从 `//` 到行尾（其中的块注释起头不开块）。 */
  const readLineComment = (): void => {
    out += '  ';
    i += 2;
    while (i < n && text[i] !== '\n') {
      out += blank(text[i]);
      i++;
    }
  };

  /** 块注释：找不到配对结束符时按代码放行（绝不吞掉文件剩余部分）。 */
  const readBlockComment = (): boolean => {
    const end = text.indexOf('*/', i + 2);
    if (end < 0) return false;
    for (let k = i; k < end + 2; k++) out += blank(text[k]);
    i = end + 2;
    return true;
  };

  /** 代码态；`stopAtBrace` 用于模板插值 `${...}`。 */
  const readCode = (stopAtBrace: boolean): void => {
    let depth = 0;
    while (i < n) {
      const ch = text[i];
      if (ch === '/' && text[i + 1] === '/') { readLineComment(); continue; }
      if (ch === '/' && text[i + 1] === '*') {
        if (readBlockComment()) continue;
        out += ch;
        i++;
        continue;
      }
      if (ch === "'" || ch === '"') { readQuoted(ch); continue; }
      if (ch === '`') { readTemplateLoop(); continue; }
      if (stopAtBrace) {
        if (ch === '{') { depth++; out += ch; i++; continue; }
        if (ch === '}') {
          out += ch;
          i++;
          if (depth === 0) return;
          depth--;
          continue;
        }
      }
      out += ch;
      i++;
    }
  };

  /** 模板字面量：正文原样保留，`${...}` 回代码态（内部注释照常剥离）。 */
  const readTemplateLoop = (): void => {
    out += '`';
    i++;
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') {
        out += ch + (text[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === '`') {
        out += '`';
        i++;
        return;
      }
      if (ch === '$' && text[i + 1] === '{') {
        out += '${';
        i += 2;
        readCode(true);
        continue;
      }
      out += ch;
      i++;
    }
  };

  readCode(false);

  const lines = out.split('\n');
  return { code: out, lineHasCode: lines.map(hasCode) };
}

/** 便捷形态：只要剥离后的文本。 */
export function stripCommentsText(source: string): string {
  return stripComments(source).code;
}

export interface BlankRun {
  /** 1-based 起始行（含）。 */
  start: number;
  /** 1-based 结束行（含）。 */
  end: number;
  count: number;
}

/**
 * 「异常置空段」：剥离后为空、但原文既非空行也不是注释行的连续行。
 *
 * 正常源码里这种行只可能出现在注释块内部（散文前缀通常是 `*`，已排除）；
 * 连续出现超过 `maxRun` 行说明状态机（或旧正则）跑飞了——review C1 正是这种
 * 整段失明。返回空数组表示没有异常置空。
 */
export function longBlankRuns(source: string, stripped: StrippedSource, maxRun = 20): BlankRun[] {
  const rawLines = (typeof source === 'string' ? source : '').split('\n');
  const codeLines = stripped.code.split('\n');
  const runs: BlankRun[] = [];
  let start = -1;
  let count = 0;
  const flush = (): void => {
    if (count > maxRun) runs.push({ start, end: start + count - 1, count });
    start = -1;
    count = 0;
  };
  for (let index = 0; index < codeLines.length; index++) {
    const raw = (rawLines[index] ?? '').trim();
    const blanked = (codeLines[index] ?? '').trim() === '';
    const suspicious = blanked && raw.length > 0 && !COMMENT_LINE_PREFIX.test(raw);
    if (suspicious) {
      if (start < 0) start = index + 1;
      count++;
    } else {
      flush();
    }
  }
  flush();
  return runs;
}
