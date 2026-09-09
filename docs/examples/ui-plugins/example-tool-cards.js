// 示例：用户工具卡插件。复制到 ~/.mafw/ui-plugins/ 后桌面自动热加载。
// my_tool 未被任何内置卡注册 → 直接生效；bash 覆盖内置卡 → 需要 override: true。
module.exports = {
  name: "example-tool-cards",
  tools: {
    my_tool: {
      render(ctx) {
        const d = ctx.json(ctx.output) || {}
        return {
          title: "My Tool",
          subtitle: d.summary,
          defaultOpen: true,
          body: [
            { type: "kv", rows: [["status", String(d.status ?? "—")], ["duration", d.durationMs != null ? `${d.durationMs}ms` : "—"]] },
            { type: "tags", items: d.tags || [] },
            { type: "code", text: ctx.pretty(d), language: "json" },
          ],
        }
      },
    },
    bash: {
      override: true,
      render(ctx) {
        return {
          title: "Bash (custom)",
          subtitle: ctx.input && ctx.input.command ? String(ctx.input.command).slice(0, 80) : undefined,
          body: [{ type: "code", text: ctx.output || "(no output)" }],
        }
      },
    },
  },
}
