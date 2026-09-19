// Config 页「审批 Approvals」区块：持久白名单编辑器（gateway /api/approvals/allowlist）。
// 条目语义：裸工具名（整工具放行）或 tool:prefix（命令前缀放行）——评估顺序第 2 步：
// 内部会话拒绝 → 持久白名单 → 会话模式（manual/auto）→ 人工。
import { createSignal, onMount, For, Show } from "solid-js";
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2";
import { ButtonV2 } from "@mafw/ui/v2/button-v2";
import { showToastV2 } from "@mafw/ui/v2/toast-v2";

export interface AllowlistEntryUi { tool: string; prefix?: string }

/** 排序纯函数（可测）：tool 字典序；同 tool 无 prefix 在前。 */
export function sortAllowlistEntries(entries: AllowlistEntryUi[]): AllowlistEntryUi[] {
  return [...entries].sort((a, b) => {
    const byTool = a.tool.localeCompare(b.tool);
    if (byTool !== 0) return byTool;
    if (!a.prefix && b.prefix) return -1;
    if (a.prefix && !b.prefix) return 1;
    return (a.prefix ?? "").localeCompare(b.prefix ?? "");
  });
}

export function ApprovalsSection() {
  const [entries, setEntries] = createSignal<AllowlistEntryUi[]>([]);
  const [tool, setTool] = createSignal("");
  const [prefix, setPrefix] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const refresh = () =>
    window.api.mafw.permissions.listAllowlist()
      .then((r: any) => setEntries(sortAllowlistEntries(r?.entries ?? [])))
      .catch(() => { /* gateway 未就绪 fail-open */ });
  onMount(refresh);

  const add = async () => {
    const t = tool().trim();
    if (!t) { showToastV2({ description: "工具名不能为空", duration: 2000 }); return }
    const entry = prefix().trim() ? { tool: t, prefix: prefix().trim() } : { tool: t };
    setBusy(true);
    try {
      await window.api.mafw.permissions.addAllowlist(entry);
      setTool(""); setPrefix("");
      await refresh();
    } catch { showToastV2({ description: "添加失败", duration: 2000 }) }
    finally { setBusy(false) }
  };

  const remove = async (e: AllowlistEntryUi) => {
    try {
      await window.api.mafw.permissions.removeAllowlist(e);
      await refresh();
    } catch { showToastV2({ description: "删除失败", duration: 2000 }) }
  };

  return (
    <div class="mafw-config-panel">
      <header class="mafw-config-panel-header">
        <h2>审批 Approvals</h2>
        <p class="mafw-config-panel-desc">
          持久白名单：条目在评估顺序第 2 步生效（内部会话拒绝 → 持久白名单 → 会话模式 manual/auto → 人工）。
          裸工具名放行整个工具；「工具名 + 命令前缀」只放行匹配前缀的命令。会话内的 🛡 模式切换在聊天界面。
        </p>
      </header>

      <div class="mafw-allowlist-add">
        <div class="mafw-allowlist-add-fields">
          <TextInputV2
            placeholder="工具名（如 bash、read）"
            value={tool()}
            onInput={e => setTool(e.currentTarget.value)}
          />
          <TextInputV2
            placeholder="命令前缀（可选，如 git status）"
            value={prefix()}
            onInput={e => setPrefix(e.currentTarget.value)}
          />
        </div>
        <ButtonV2 variant="contrast" size="small" disabled={busy()} onClick={() => void add()}>
          添加
        </ButtonV2>
      </div>

      <Show
        when={entries().length > 0}
        fallback={<p class="mafw-allowlist-empty">暂无白名单条目。权限卡上选「持久允许」也会写入这里。</p>}
      >
        <ul class="mafw-allowlist-list">
          <For each={entries()}>
            {(e) => (
              <li class="mafw-allowlist-row">
                <span class="mafw-allowlist-tool">{e.tool}</span>
                <span class="mafw-allowlist-prefix">{e.prefix ? `前缀：${e.prefix}` : "整工具放行"}</span>
                <ButtonV2 variant="ghost" size="small" onClick={() => void remove(e)}>
                  删除
                </ButtonV2>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
