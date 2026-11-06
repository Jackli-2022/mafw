<div align="center">

<img src="packages/desktop/icons/master/app-icon-1024.png" width="120" alt="MAFW — Mafu">

# MAFW

**Memory-Augmented Framework for Work**

会话结束、上下文压缩、模型更替之后——记忆依然存续的 AI Agent 工作平台

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@jack200714/mafw.svg)](https://www.npmjs.com/package/@jack200714/mafw)
[![CI](https://github.com/Jackli-2022/mafw/actions/workflows/ci.yml/badge.svg)](https://github.com/Jackli-2022/mafw/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/Jackli-2022/mafw)

</div>

---

## 这是什么

MAFW 是一个以**谐波记忆（Harmonic Memory）**为核心的 AI Agent 工作平台，
由 Gateway / Desktop / Mobile / TUI / CLI 五个部分组成（另可选接入 opencode 编辑器）：

| 组件 | 形态 | 作用 |
|---|---|---|
| **Gateway** | 常驻进程（HTTP API :3000 + 事件流） | 记忆存取、Pod/Goal 编排、自动化引擎、全部业务中枢 |
| **Desktop** | Electron 应用 | 右侧 Agent 工作台 + 聊天列：工作概览、Goal 详情、文件/浏览器/终端、审阅 |
| **Mobile** | Flutter（Android，开发中） | Tailscale 直连 Gateway：项目工作、Tech Lead 讨论、「需要你」应答 |
| **TUI** | `mafw tui` 命令 | 终端全功能界面：Chat / Goals / Memory / Triage（markdown 渲染、鼠标点选） |
| **CLI** | `mafw` 命令 | Gateway 的启动、守护、诊断与运维 |
| **opencode 插件** | 可选接入 | 在 opencode 内获得记忆注入与 `mafw_*` 工具（其一入口，非必需） |

核心命题：**让 Agent 跨会话、跨上下文压缩、跨模型更替地记住你的偏好、决策与踩过的坑。**

## 核心特性

### 🧠 谐波记忆

- **统一 HarmonicUnit 模型**：episodic / semantic / procedural / global 四类，层级只是标签，检索无视类型
- **OKF 存储**（Open Knowledge Format）：每条记忆一个 Markdown 文件（frontmatter + 正文），人可直接阅读编辑；索引是纯可推导产物，丢了可重建
- **BM25 检索**：`primary_abstraction` + `cue_anchors` 上的倒排检索 × 能量 × 显著度，1000 条记忆 ~2-3ms
- **能量系统**：检索/反馈加成、按天衰减（显著度越高衰减越慢），重要的事自然浮起，琐碎的事自然沉底
- **三层去重**（2026-10 V2；MinHash 写时合并已退役——脑的写时操作是模式分离，合并属巩固层）：写时 exact-hash 守卫（同文重投不落盘）、读时近重复折叠（检索出口呈现层去重，零数据变更）、巩固层语义合并（宽限期重访 worker 判 keep / update / merge / demote，加法式 supersede 链）
- **联想层**：共激活边（同会话 / 同 Goal / 时间邻近）+ 有界 Personalized PageRank 扩散 + 边读时衰减，检索从"词面共享"扩展到"一起出现"
- **分系统检索通道**：episodic / semantic 双通道 RRF 融合 + 分层衰减（episodic 快 / semantic 慢 / procedural、global 更慢）
- **Pinned 披露层 + Sticky 便签板**：身份画像每轮必见，"记下来"类提醒限时必达
- **主动记忆引导**（OptMem 式）：Agent 自主决定何时写入、何时检索，而非被动灌注
- **环境探测式维护**：记忆 curator 写入前用只读工具验证候选记忆（propose–probe–commit），
  每周自动重验高价值记忆、被环境证伪的走 supersedes 链更新——能量衰减管"淡忘"，探测验证管"内容有效性"
- **类脑写入路径**（2026-09 重构，2026-10 V2 深化）：写入前**路由**——精确重述 → 不落盘（non-write）；语义相近 → **整合进既有条目**而非追加；
  同题不同实体 → **强制分离**（模式分离）。配合**回放采样**（巩固时优先回放高显著回合、按语义簇交错整合进图式）、
  **编码门控**（观测捕获即打显著度标签）、**再巩固**（检索+使用反馈进入可更新窗口，预测误差门防漂移），
  直击"同主题碎片化"（实测历史库 ~21% 近似重复）。V2 追加：**verbatim dense 层**（t1 回合原文的向量检索面——
  FTT 双轨迹：近期内容查原文、gist 慢熟）、**学习率梯度**（管线首过能量封顶 0.6、48h 无冲突自动毕业 0.75——
  "不首次全额提交"）、**宽限期重访**（年轻记忆遇新证据时夜审重写，PE 失配才开窗）、**TCM 话题分段**
  （事件边界检测替代小时批，shadow 观察中）
- **写时路由自检**：`mafw route-check` 一键验证 create / dedup / update 三条路径是否健康

### 🤖 Pod / Goal 编排

- **项目鲸群（Pod）**：`Lead`（项目主对话）→ `Tech Lead`（讨论、计划、Goal Eval）→ `Builder`（实施）→
  `Reviewer`（rubric 独立评审）。计划批准绑定 `planHash`/`evalHash`，结果可打回开 revision N+1，
  旧 revision 的证据与产物永不重写
- **自适应执行**：`quick`（单任务、无独立评审、goal-eval 由验收条件派生）vs `collaborative`
  （可人工批准、独立 Reviewer）；`planReview: manual` 强制走协作
- **计划包**：`waves.json` + `goalEval` 一次产出；任务带可机械验证的 acceptance，Reviewer 逐任务
  `pass/fail/skipped` + 证据，Goal 条件漏项即 FAIL
- **回合预算**：goal 可设 `maxTurns` / `maxCostUsd`，超限自动硬停（BudgetGuard）
- **每轮目标快照**注入，compaction 免疫；`/btw` 支线问答不污染主线
- **演化观测**（RSI Phase 1）：goal 结果、会话映射、失败签名全量落库，为策略演化铺路

### 🔔 事件层与常驻存在感

- **`pod_events` 确定性分级**：p1（结果/硬失败）、p2（需要你决策）、p3（日常协作）——无 LLM 判级
- **跨项目 presence**：`GET /api/presence` 聚合 running / attention / unread results；桌面托盘三态、
  任务栏进度、OS 通知（点击直达 Goal）、鲸群 inbox「未查看」统一消费
- **Lead 唤醒**：p2 事件经闸门（暂停/忙/预算/去重）合并注入 Lead 会话；重启后 pending 自动补发
- **旧数据兼容**：`viewedResults` 只读双读，存量「已查看」不因升级消失

### 🖥️ Desktop 应用

**右侧 Agent 工作台**（工作 / 工作台 / 执行 / 审阅）+ 可拖拽聊天列（520 / 640 / 760 三档）+ Focus 模式：

- **工作**：`work.overview` 五桶（需要你 / 排队 / 进行中 / 结果 / 历史）+ Goal composer +
  统一 Goal 详情（计划审阅、方向裁定、问题回答、结果/打回、时间线）
- **工作台**：IDE 骨架（文件树 + 编辑器/浏览器 tab + 终端）；Office / PDF / CSV / JSON / Markdown /
  图片预览与就地批注，HTML 预览走 `mafw-file://`
- **执行**：概览、待办、子代理、后台、轨迹、鲸群（团队/邮箱/记忆/班底）
- **审阅**：会话 diff、逐回合 diff、检查点时间线与代码回滚

交互面：**steering**（忙碌回合 Enter 续发 / Ctrl+Enter 网关队列）、会话分支（fork / revert / unrevert）、
全局命令面板（Ctrl+P）、审批三档（只读 / 自动 / 全开）、worktree 并行会话、语音输入（VAD 自动分段）
与 TTS 播报（barge-in 可打断）、会话导出 Markdown、@file 提及、transcript 搜索（Ctrl+F）、
系统托盘三态与任务栏进度、A2A 媒体理解、持久 Python 内核；UI 工具卡插件系统支持自定义工具执行卡。

### 🎬 媒体理解

图片 / 视频 / 音频经 A2A 协议接入 Media Agent，主模型原生多模态分析（非文本描述转述），
每模态可独立配置引擎与模型，支持插件扩展。

### 🐍 持久 Python 内核

会话级 Jupyter kernel（ZeroMQ wire 协议），变量与导入跨工具调用保持，matplotlib 出图直接回传。

### ⚙️ 自动化引擎

Cron 规则驱动：记忆衰减、回合聚合压缩（每小时）、反思管线、stale 记忆重验（每周）；每条管线出口记账 + 心跳遥测（`/api/memory/stats` 的 `pipelines` 暴露 `lastRunAt / lastSuccessAt / stale`，静默失败不再隐形），triage 队列让关键决定仍由你确认。

### 🔌 Runtime 能力契约

Gateway 与 Agent runtime 之间是能力自声明契约（Tier 0-2）：内置 opencode runtime、pi runtime 插件、
external 托管模式可热切换，无需重启。契约能力面覆盖会话分支（fork / revert）、回合预算、
结果信封（usage / finish）、三值审批回复（once / always / reject）、原生 question 通道等。

**工具注册通道（Tier-0 必选）**：每个 runtime 必须实现 `tools.registerTools` / `tools.nativeTools`——
缺实现 = 激活期 hard 校验拒绝。gateway 在激活期把**六件套基础工具**（记忆写入 / Python 内核 ×2 /
语音合成 / 媒体上传 / 媒体追问）的 spec + 执行器工厂推给 runtime（execute 闭包随 spec 走，
第三方 runtime 只做 ~15 行 plumbing）；runtime 同时声明自己的原生工具语义类别
（read / write / agent… → readonly / file-edit / subagent…），即时生效于审批只读档、
身份策略与桌面渲染。out-of-process runtime 经 `GET /api/tools` + `POST /api/tools/execute` 取 spec / 执行。

**声明式事件映射**：runtime 插件用**纯数据表**把原生事件接入统一事件流，不再手写翻译层——
`eventMappings`（`{from → to, when?, fields}`，字段 = 路径 / 常量 / `{$.path}` 模板）+ 可选的
`transformEvent` 逃逸口（状态机 / 扇出 / 副作用）；gateway 侧 canonical facet 规则表化，
插件原生事件经同一管线进入 `EventFacets`。加载期静态校验（未知事件类型 / 坏路径 = 能力降级），
`POST /api/runtime/dry-event` 试衣间逐跳回显。已内置 pi 适配；新 runtime 接入只需填表。

### 🧩 统一插件包

`~/.mafw/plugins/` 下**一个插件包可同时贡献多种能力**——usage 配额、media 引擎、agent runtime、
UI 工具卡——不必按类型拆成多个文件丢进多个目录：

```js
// ~/.mafw/plugins/my-vendor.js —— 一个文件，一个厂商全家桶
module.exports = {
  name: "my-vendor",
  usage:   { name: "my-vendor", type: "api", plan: "Pro", async fetch(ctx) { /* 余额/限额 */ } },
  media:   { modalities: ["image"], engine: "pi", fixPayload(p) { /* 自定义 wire 格式 */ } },
  runtime: { capabilities: { eventStream: true }, async createRuntime(ctx) { /* 接入自有 runtime */ } },
  // 或 async activate(ctx) 拿统一 ctx 后返回贡献
};
```

- **统一上下文**：`apiKey` / `fetch` / `pluginConfig` / `projectDir` / `gatewayPort` / `usage.modelStats` /
  `emit`（向桌面/TUI/推送全通道广播自定义事件）——
  三类插件 ctx 的超集，配置收敛在 `plugins.<name>.config`
- **内置件同接口**：opencode runtime 与 media `pi` 引擎就是注册进同一体系的内置插件，
  用户同名文件/包可直接覆盖
- **优先级**：包 > legacy 目录文件 > 内置；旧 `usage-plugins/` 等四目录继续可用
- **热重载**：改动即生效（顶层 + 每包子目录双 watcher），插件中心（Desktop Config→Plugins）可见全部包状态

## 基准

LongMemEval-S（session 粒度，谐波记忆管线）：

| 指标 | 早期 | 当前 |
|---|---|---|
| L1 检索 Recall@10 | 47.4% | **94.9%** |
| L1 Recall@1 | 5.8% | **58.6%** |
| L2 端到端 QA 准确率 | 16.7% | **66.7%** |

评测代码：`evaluation/longmemeval/`（数据隔离，不污染真实记忆库）。

## 架构

```
 Desktop (Electron)   Mobile (Flutter)   CLI (mafw)   opencode 插件
        │                   │               │              │
        └────────── HTTP :3000 / SSE / MCP ────────────────┘
                            │
                     ┌──────┴───────┐
                     │   Gateway    │
                     └──────┬───────┘
      ┌────────────┬────────┴────────┬──────────────┐
  谐波记忆      Pod/Goal 编排      事件层 & 存在感   自动化 / 媒体 / 内核 / 用量
  OKF + 索引    Lead→TL→B→R        pod_events       cron · A2A · Jupyter
  能量·合并     plan/eval/review   presence/托盘     统一插件包
```

数据根目录 `~/.mafw/`：记忆 OKF 文件、统一数据库（含 `pod_events`）、Pod 记忆与事件审计、
日志、配置覆盖。

## 快速开始

### 1. 启动 Gateway

```bash
npm install -g @jack200714/mafw

mafw start          # 前台启动
mafw daemon         # 后台守护
mafw status         # 查看状态
mafw tui            # 终端界面（Chat / Goals / Memory / Triage）
mafw route-check    # 记忆写时路由自检（create / dedup / update）
mafw office setup   # Office 编辑能力（Python 内核 venv + office-editing 技能）
mafw dashboard      # 打开 Web Dashboard
```

### 2. 桌面应用

安装包内置 Gateway，开箱即用（无需先装 npm 包）。下载：
[GitHub Releases 最新版](https://github.com/Jackli-2022/mafw/releases/latest)

| 平台 | 安装包 |
|---|---|
| Windows | `mafw-desktop-win-x64.exe`（nsis，未签名） |
| Linux | `AppImage`（需 `chmod +x`）/ `.deb` / `.rpm` |

或从源码构建：

```bash
git clone https://github.com/Jackli-2022/mafw
cd mafw && npm install          # npm workspaces
cd packages/desktop
npx electron-vite build
```

### 3. 手机接入（开发中）

Android 客户端经 **Tailscale 直连** Gateway（零公网暴露）：手机装 Tailscale，
`GET /api/mobile/pairing-code` 生成一次性配对深链（`orcalore://pair?…`），扫码即得 base URL + token。
App（Flutter，`mobile/`）在 P1-P4 迭代中；连接层与 gateway 配对/鉴权已就绪。

### 4. opencode 接入（可选）

> npm 包含 **Gateway + TUI + opencode 插件入口**（`dist/plugin.js`，包内 `opencode.plugin`）。
> 插件方式：全局安装后把 `@jack200714/mafw` 加入 opencode 的 `plugin` 数组即可；
> 也可以只用下方 MCP remote 接线（无需插件）。

```json
{
  "plugin": ["@jack200714/mafw"],
  "mcp": { "mafw": { "type": "remote", "url": "http://127.0.0.1:3000/mcp", "enabled": true } }
}
```

源码构建后插件激活时会自动补写缺失的 MCP 接线并备份原配置（fail-open）。

## 仓库结构

```
packages/desktop/        Electron 桌面应用（main / preload / renderer）
packages/tui/            终端界面（pi-tui）
gateway/                 Gateway 核心（HTTP API、记忆、编排、自动化、媒体、内核）
src/                     opencode 插件（hooks / tools / MCP 自接线）
.github/workflows/       CI：双 OS 验证；tag v* 自动出桌面安装包（draft release）
evaluation/longmemeval/  LongMemEval 记忆基准
docs/                    设计文档与实施计划
```

## 文档

| 文档 | 位置 |
|---|---|
| 架构总览（AGENTS.md） | `AGENTS.md` |
| Gateway 架构 | `docs/architecture/gateway.md` |
| Mobile 开发与调测 | `docs/architecture/mobile.md` |
| Plugin 架构 | `docs/architecture/plugin.md` |
| Runtime 插件作者手册 | `docs/guides/runtime-plugin-authoring.md` |
| 统一插件包作者手册 | `docs/guides/plugin-authoring.md` / `docs/guides/plugin-creator.md` |
| 谐波记忆 v6.3 | `docs/superpowers/specs/2026-07-02-v6.3-harmonic-memory-m1-m3.md` |
| OKF 存储迁移 v6.8 | `docs/superpowers/specs/2026-07-16-okf-migration-design.md` |
| Desktop 图标（茉芙/Mafu） | `docs/superpowers/specs/2026-09-10-desktop-icon-design.md` |
| 版本发布说明 | `docs/releases/` |
| 记忆基准 | `evaluation/README.md` |

## 声明

MAFW Desktop 应用图标「茉芙 / Mafu」由 AI 辅助生成（智谱 CogView-4）并经人工后处理。

## 参考与致谢

MAFW 的设计站在这些项目与研究的肩膀上：

| 参考 | 与 MAFW 的关系 |
|---|---|
| [opencode](https://github.com/sst/opencode) | 插件宿主平台；Desktop 端（`packages/desktop`）源自其桌面架构并深度改造（MAFW Rail/Tabs/Config、gateway sidecar 等） |
| [Memora](https://arxiv.org/abs/2602.03315)（Microsoft M365 Research, ICML 2026） | 谐波记忆系统的架构参照：`primary_abstraction` / `cue_anchors` / `memory_value` 三元数据模型与其同构；embedding 相似度合并 + LLM UPDATE/CREATE 裁判（ConsolidationService）采用其方案；其 LongMemEval-S 87.4% SOTA 是本项目记忆管线设计的方向验证 |
| [Grounding Agent Memory](https://arxiv.org/abs/2609.11060)（Microsoft, 2026） | 环境探测式记忆维护（Environment-Probing Curation）的方案来源：post-task curator 以最小权限只读工具在写入前验证候选记忆（propose–probe–commit）、定期重验并刷新 stale 条目；其 CLBench/APEX 实验证明该机制同时提升正确率并降低 task-agent 成本 |
| [Dual-Layer Agentic Memory](https://arxiv.org/abs/2608.22215)（2026） | 类脑写入路径的 CLS（互补学习系统）蓝本：写时 epistemic 路由（non-write / write-new / write-update）+ 周期巩固，剪冗余同时保 QA；MAFW 写时路由（S1）与再巩固（S5）的直接参照 |
| [REALM](https://arxiv.org/abs/2609.16053)（2026） | 检索驱动再巩固：记忆作为持续生命周期、检索反馈重组记忆（消融证实持续有益）；MAFW 再巩固队列 + 预测误差门的来源 |
| [AutoViewMem](https://arxiv.org/abs/2609.21940)（2026） | 写时正交视图抗语义干扰；MAFW 模式分离（S4，同题不同实体强制区分）的轻量参照 |
| OKF（Open Knowledge Format） | 记忆存储层：Markdown + frontmatter、每记忆一文件，索引视为纯可推导产物；设计见 `docs/superpowers/specs/2026-07-16-okf-migration-design.md` |

## 许可

MIT
