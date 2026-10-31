/**
 * 写类工具输入 → 目标文件（插件侧，写前快照用）。
 * 与 gateway/src/core/file-history/file-history-service.ts 的 writeToolPaths 保持同构；
 * 插件包不能 import gateway 源码，故保留一份纯函数并各自测试。
 */
export function writeToolPaths(tool: string, input: any): string[] {
  const t = String(tool ?? '').toLowerCase();
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim());
  };
  if (t === 'write' || t === 'edit' || t === 'multiedit' || t === 'write_file' || t === 'edit_file') {
    push(input?.path);
    push(input?.filePath);
    push(input?.file_path);
    push(input?.filename);
    return out;
  }
  if (t === 'apply_patch' || t === 'patch') {
    const patch = typeof input?.patchText === 'string'
      ? input.patchText
      : typeof input?.patch === 'string' ? input.patch : typeof input?.input === 'string' ? input.input : '';
    if (patch) {
      const re = /^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$/gm;
      for (const m of patch.matchAll(re)) push(m[1]);
    }
  }
  return out;
}
