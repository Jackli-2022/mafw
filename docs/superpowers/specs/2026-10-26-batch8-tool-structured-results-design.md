# Batch 8 — MCP Structured Tool Results 收尾（Design）

> 日期：2026-10-26 · 状态：已实施（v4.36.0）
> 上游：Tier 1 #4（工具注解 + 结构化工具结果）。首批 3 个工具已有 bespoke schema；本批补齐其余工具的 structuredContent/outputSchema 通道。

## 1. 意图

MCP 2025-06-18+ 的 `outputSchema` + `structuredContent` 双载荷此前只覆盖 `mafw_search_hybrid` / `mafw_get_memory` / `mafw_list_goals`。其余工具虽有 JSON text，但程序化消费方只能再解析字符串。

## 2. 方案

1. `call-result.ts` 单一出口自动提升：
   - handler 显式 `structuredContent` 优先；
   - 否则取首个 text content，JSON.parse；
   - object 直接作为 structuredContent；array → `{items}`；标量 → `{value}`；
   - 非 JSON 文本保持原样（错误/自然语言结果不变）。
2. `createToolRegistry()` 给所有缺少 `outputSchema` 的定义补 `{type:'object', additionalProperties:true}`；首批 3 个保留 bespoke schema。
3. 不改变 text content；老消费方向后兼容。

## 3. 非目标

- 不为每个工具手写 bespoke outputSchema（generic envelope 已保证 MCP 双载荷合法；后续可按需细化）。
- 不改 handler 返回形状、不改 `/api/tools`。
- 不做 UI。

## 4. 验收

- `toCallToolResult` 单测：object/array/primitive/非 JSON。
- 注册表所有工具都有 object outputSchema；首批 3 个仍是 bespoke。
- 全量 gateway 测试；本机部署 v4.36.0。
