# 文件打开默认形态调研：图片/SVG 打开即看 vs 点击预览

日期：2026-10-27
背景：用户反馈「图片等文件应该可以直接看的，不需要点击预览」。上一轮我们按 Zed 形态把 SVG 默认成源码 + 显式「预览」动作；本轮核实业界打开默认值，回答：**哪些文件打开即渲染、哪些需要显式动作、回源码的机制是什么**。

## 一、业界默认值

| 产品 | 位图（png/jpg/webp…） | SVG | HTML | 回源码机制 |
|---|---|---|---|---|
| **VS Code** | 打开即**只读图片预览** | **1.97+ 默认预览**（此前文本） | 无内置预览（Live Preview 扩展/外抛） | 「Reopen With…」/ 右键 Configure default editor（藏得深，issue #239844 抱怨过） |
| **Zed** | 打开即 image viewer | **默认文本**；预览是显式动作（quick action bar 眼睛图标 / `svg: open preview` / 面板右键） | 无内置 | 反过来的：文本就是默认，无需切换 |
| **JetBrains** | 打开即内置图片查看器 | **SVG 编辑器 = 文本 + 实时 Preview 面板**（2017.3 起） | 内建 preview 图标/外抛 | 同屏并列，无需来回切 |
| **Kimi Code Desktop** | 右栏文件预览自动渲染图片 | 渲染 | **渲染**（官方文档：文件预览支持 HTML） | 预览面板为主，源码另开 |
| **Codex desktop** | 非代码文件 rich previews（含图片查看/编辑） | 渲染 | 网页预览（VentureBeat 2026 大更新） | — |
| **dsh-file-viewer（插件）** | 通用只读预览自动渲染 | 渲染 | — | — |
| **opencode desktop** | 无内置图片预览（社区自建） | 无 | 无 | — |
| **Claude Desktop** | 无通用图片预览（聊天内图片内联是 open request） | 无 | Browser pane（dev server/app 预览） | — |

## 二、收敛规律

1. **位图打开即看是全体共识**（VS Code/Zed/JetBrains/Kimi/Codex/dsh 一致）——不存在「点一下预览」的设计。
2. **SVG 存在两种流派**：
   - **打开即看**（VS Code 1.97+、JetBrains 预览面板、Kimi/Codex）——主流方向；
   - **默认文本**（Zed）——但 Zed 社区正开着「preview mode as default for SVGs」的请求（discussion #52255），即默认文本并非终态共识。
3. **回源码必须一步可达**：VS Code 是「Reopen With」（入口深、被吐槽）；JetBrains 是文本与预览同屏；我们已有 tab 头「源码/预览」一键切换——比 VS Code 更轻、比 Zed 更直观。
4. 结论（对用户诉求的映射）：**图片/SVG 打开即渲染；「源码」作为一键动作保留**（编辑需求不丢）。

## 三、本轮落地（rev）

- SVG 默认从源码改为**预览**（`svgPreview[rel]` 缺省 = 预览；显式 `false` 才是源码态），tab 头按钮在预览态显示「源码」、源码态显示「预览」——与图片的「打开即看」一致，较上一轮（Zed 形态）按用户裁决 + VS Code 主流修订。
- 图片不变（本就打开即看）。

## 来源

- VS Code 1.97 SVG 预览默认 + Reopen With：SO #79363302、GitHub issue #239844、r/vscode 1ibntfy
- Zed：`svg: open preview` 动作与「Open SVG Preview」右键（all-actions / preview releases）、discussion #52255（preview default 请求）、issue #10403
- JetBrains：SVG 编辑器 Preview 面板（2017.3 博客）、Images 文档
- Kimi：桌面「文件预览」官方文档（Markdown/JSON/HTML/PDF/CSV/图片/代码）
- Codex：VentureBeat 2026 大更新（rich previews for non-code files）
- dsh / opencode / Claude：上一轮 `2026-10-27-workbench-file-preview-research.md` §2.1
