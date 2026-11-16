# 2026-11-16 · Chat 阅读密度：正文 1.6、思考到正文 12px

- **版本**：`v5.1.0`（视觉修订，不升版本号）
- **提交**：`2a590ead`
- **范围**：desktop Chat 正文行高与 thinking block 间距；gateway / SDK / runtime 零改动
- **前置**：`docs/releases/2026-11-16-chat-message-lore.md`

## 现状

- Chat 正文（assistant Markdown 与用户气泡）统一为 **16px / 1.6**：
  - 新增 `.mafw-chat` token `--mafw-chat-leading: 1.6`；
  - assistant 与用户消息都消费同一个 token，避免两套行高。
- 段落间距保持 **16px**（约 0.59 行）：比 ChatGPT 的约 20px 更紧，不再继续压缩。
- 「已思考」摘要到下方正文从 **26px 收到 12px**：
  - `.mafw-thinking` 底距 0；
  - thinking 后紧跟的 `text-part` 顶距 0；
  - 只保留 assistant content 的 12px flex gap。

## 取值依据（2026-11-16 调研）

- ChatGPT 正文约 16 / 24–26px（1.5–1.63）；
- Claude 14–16px 正文约 1.5–1.6；
- Gemini 16px / 1.55；
- 通用 AI Chat 排版建议正文 1.5–1.65，长文可到 1.75；
- WCAG 1.4.12 的正文下限是 1.5。

原来的 1.7（27.2px）落在长文区间但比主流 AI chat 偏松；26px 的
「思考摘要 → 正文」约是常见 metadata 行距（8–12px）的两倍，是视觉上
“离得远”的主因。

## 真机验证

- assistant Markdown：`font-size: 16px`、`line-height: 25.6px`；
- 用户气泡：`font-size: 16px`、`line-height: 25.6px`；
- 段落：`margin-bottom: 16px`；
- `.mafw-thinking` 底边到下一个 `text-part` 顶边：**12px**；
- thinking `margin-bottom: 0`、text-part `margin-top: 0`、assistant content `gap: 12px`。

## 测试与门禁

- desktop 全量：**3898 / 3898** pass（738 suites）
- 新增 `chat-typography-css.test` 2 个用例：
  - 正文 1.6 token（assistant + user）；
  - thinking → 正文 12px（底距 / 顶距归零）
- 更新 `design-contract.test` 2 处旧 1.7 断言
- desktop `tsgo`：rc=0
- `npx electron-vite build`：rc=0
- 未 push、未合并远端

## 边界

- 只改 Chat 阅读面；thinking 块内部的 reasoning 正文仍沿用 session-ui 的 13px / 1.55。
- 段落间距没有跟着行高同步缩小；如果以后要再紧，优先动段距而不是行高。
- 其他面板（文件预览、记忆、Goal 详情）不受 `--mafw-chat-leading` 影响。
