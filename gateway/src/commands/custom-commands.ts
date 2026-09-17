/**
 * 用户自定义命令（opencode/Gemini CLI 对齐）：
 * - 目录：用户级 ~/.mafw/commands/ + 项目级 <project>/.mafw/commands/
 * - 文件名即命令名；子目录即命名空间（git/commit.md → git:commit）
 * - frontmatter：description / argument-hint
 * - 模板：$ARGUMENTS、$1..$N、!`shell`（块内参数 shell 转义）、@file 注入
 */
import * as fs from 'fs';
import * as path from 'path';

export interface CustomCommandSpec {
  name: string;
  description: string;
  argumentHint?: string;
  template: string;
  sourceFile: string;
}

/** 解析 markdown 命令文件；空模板返回 null。 */
export function parseCommandFile(content: string, name: string, sourceFile: string): CustomCommandSpec | null {
  let description = '';
  let argumentHint: string | undefined;
  let body = content;
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const value = kv[2].trim().replace(/^["']|["']$/g, '');
      if (kv[1] === 'description') description = value;
      if (kv[1] === 'argument-hint') argumentHint = value;
    }
    body = content.slice(m[0].length);
  }
  const template = body.trim();
  if (!template) return null;
  if (!description) description = template.split(/\r?\n/)[0].slice(0, 60);
  return { name, description, argumentHint, template, sourceFile };
}

/** 双引号感知分词："a b" 视为一个参数。 */
export function splitArgs(args: string): string[] {
  const out: string[] = [];
  for (const m of args.matchAll(/"([^"]*)"|(\S+)/g)) {
    out.push(m[1] ?? m[2]);
  }
  return out;
}

/** shell 块内参数转义（防注入，对齐 Gemini {{args}} 在 !{} 内的语义）。 */
function shellEscape(arg: string): string {
  return arg.replace(/(["`\\$])/g, '\\$1');
}

function substituteArgs(text: string, args: string[], rawArgs: string, escape: boolean): string {
  const val = (s: string) => (escape ? shellEscape(s) : s);
  return text
    .replace(/\$ARGUMENTS/g, () => val(rawArgs))
    .replace(/\$(\d+)/g, (_, n) => val(args[parseInt(n, 10) - 1] ?? ''));
}

export interface TemplateDeps {
  exec(cmd: string): Promise<string>;
  readFile(relPath: string): Promise<string>;
}

async function replaceAsync(text: string, re: RegExp, fn: (...m: any[]) => Promise<string>): Promise<string> {
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return text;
  const replacements = await Promise.all(matches.map((m) => fn(...m)));
  let out = '';
  let last = 0;
  for (let i = 0; i < matches.length; i++) {
    out += text.slice(last, matches[i].index) + replacements[i];
    last = matches[i].index! + matches[i][0].length;
  }
  return out + text.slice(last);
}

/** 渲染模板：@file → shell → 参数（参数内容不二次展开）。 */
export async function renderTemplate(template: string, rawArgs: string, deps: TemplateDeps): Promise<string> {
  const args = splitArgs(rawArgs);
  let out = await replaceAsync(template, /@([\w./\\-]+)/g, async (_m, p) => {
    try {
      return await deps.readFile(p);
    } catch {
      return `[无法读取文件: ${p}]`;
    }
  });
  out = await replaceAsync(out, /!`([^`]+)`/g, async (_m, cmd) => {
    const resolved = substituteArgs(cmd, args, rawArgs, true);
    try {
      return await deps.exec(resolved);
    } catch (err: any) {
      return `[命令失败: ${String(err?.message || err).slice(0, 200)}]`;
    }
  });
  return substituteArgs(out, args, rawArgs, false);
}

export interface CommandDir {
  dir: string;
  scope: 'user' | 'project';
}

/** 扫描目录（递归 .md）；project 覆盖同名 user。坏文件跳过（fail-open）。 */
export async function scanCommandDirs(dirs: CommandDir[]): Promise<CustomCommandSpec[]> {
  const byName = new Map<string, CustomCommandSpec>();
  for (const { dir } of dirs) {
    if (!fs.existsSync(dir)) continue;
    const walk = (cur: string, prefix: string): void => {
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, entry.name);
        if (entry.isDirectory()) {
          walk(full, prefix ? `${prefix}:${entry.name}` : entry.name);
        } else if (entry.name.endsWith('.md')) {
          const base = entry.name.replace(/\.md$/, '');
          const name = prefix ? `${prefix}:${base}` : base;
          try {
            const spec = parseCommandFile(fs.readFileSync(full, 'utf-8'), name, full);
            if (spec) byName.set(name, spec);
          } catch { /* 坏文件跳过 */ }
        }
      }
    };
    walk(dir, '');
  }
  return [...byName.values()];
}

/** 监听目录变更（300ms 防抖），触发时重扫并回调全量清单。返回 dispose。 */
export function watchCommandDirs(dirs: CommandDir[], onChange: (specs: CustomCommandSpec[]) => void): () => void {
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  for (const { dir } of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      watchers.push(fs.watch(dir, { recursive: true }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void scanCommandDirs(dirs).then(onChange).catch(() => { /* fail-open */ });
        }, 300);
      }));
    } catch { /* 不支持的目录跳过 */ }
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
