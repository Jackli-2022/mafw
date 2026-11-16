# 2026-11-16 · Composer `@web` / `@docs`

- **版本**：desktop `5.1.0`（未 bump）
- **Commit**：`8535f965`
- **范围**：Desktop Chat composer 的 `@` 提及

## 交付

- `@docs`：`@` 选择器把 `docs/**`、根 `README.md`、任意 `AGENTS.md` / `CLAUDE.md`
  标记为 Docs 来源，使用书本图标；选中后仍走现有文件提及（agent 用自己的 read 工具读取）。
- `@web`：输入 `@web` 打开 `WebUrlDialog`，校验并规范化 http/https URL；选中后成为
  Web chip。发送时在 prompt 前追加 `Web context:` 块，列出 URL。
- Web 链接随即时发送、忙时网关队列、本地队列和 enriched send 全路径传递；发送后清空。
- `@` 选择器新增 Web / Docs 图标，不再只有 file / agent 两类。

## 设计边界

- `@web` **不在 Desktop 抓取网页**：网络访问继续由 agent 自己的 webfetch/websearch 工具
  和既有权限审批处理，避免在 Desktop 复制 SSRF / HTML 提取 / 网络权限链。
- `@docs` 是项目文档的文件提及，不是语义索引；真正的 docs RAG / external docs 仍待后续。

## 验证

- desktop 全量：**3923 / 3923**（744 suites）
- 本轮新增测试：**7**
  - `chat/mention-sources.test.ts`：4（docs 路径、URL 规范化、Web context 格式）
  - `tests/web-docs-mention-wiring.test.ts`：3（mention 来源、dialog v2、三条发送路径）
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 边界

- 未新增 gateway 路由或 runtime contract。
- 未实现网页正文抓取、docs 语义检索、外部 docs 索引。
