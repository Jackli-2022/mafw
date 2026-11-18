# 2026-11-18 · Turn marker spike

## 问题

回执需要把一次 recall 挂到正确的用户回合。桌面发送使用本地 `user-<ts>` id；runtime 真实 user message id 在 live 不一定拿得到。原计划用一条 synthetic part `id=turn_<uuid>` 作为锚点。

## 方法

通过 `POST /api/chat/enriched` 向临时会话发送：

```json
{
  "message": "Reply with exactly: ok",
  "parts": [
    { "type": "text", "id": "turn_spike2_...", "text": "[[turn:turn_spike2_...]]", "synthetic": true }
  ]
}
```

随后用 `GET /api/sessions/:id/messages` 检查持久化历史。

## 结果

- runtime **不保留**额外的 synthetic part id。
- runtime 会把该 part 的文本**拼进持久化的 user message 文本**：
  `... Reply with exactly: ok\n[[turn:turn_spike2_...]]`
- reload 后 marker 仍在文本里。

## 决定

- marker 改为**文本哨兵** `[[turn:turn_<uuid>]]`。
- hook 从最后一条真实 user message 的文本/parts 里正则提取 key；构建 recall query 前剥掉。
- 桌面展示层同样剥掉；回执按 key 挂到回合。
- 如果未来 runtime 不再拼接文本，回退到 send 返回 `userMessageID`。

## 影响

- `packages/desktop/src/renderer/mafw/chat/turn-marker.ts`
- `src/hooks/turn-marker.ts`
- `src/hooks/session-recall.ts`（Task 0.3）
- `packages/desktop/src/renderer/mafw/ingest/messages.ts`（Task 4.1/4.2）
