<div align="center">

<img src="packages/desktop/icons/master/app-icon-1024.png" width="120" alt="MAFW — Mafu">

# MAFW

**Memory-Augmented Framework for Work**

会话结束、上下文压缩、模型更替之后——记忆依然存续的 AI Agent 工作平台

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/opencode-plugin-mafw.svg)](https://www.npmjs.com/package/opencode-plugin-mafw)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/Jackli-2022/mafw)

</div>

---

## 这是什么

MAFW 是一个以**谐波记忆（Harmonic Memory）**为核心的 AI Agent 工作平台。
它不再只是某个编辑器的插件，而是由四个部分组成的完整系统：

| 组件 | 形态 | 作用 |
|---|---|---|
| **Gateway** | 常驻进程（HTTP API :3000 + 事件流） | 记忆存取、Goal 编排、自动化引擎、全部业务中枢 |
| **Desktop** | Electron 应用 | 对话、Goal 管理、记忆看板、审批与自动化配置的完整 GUI |
| **CLI** | `mafw` 命令 | Gateway 的启动、守护、诊断与运维 |
| **opencode 插件** | 可选接入 | 在 opencode 内获得记忆注入与 `mafw_*` 工具（其一入口，非必需） |

核心命题：**让 Agent 跨会话、跨上下文压缩、跨模型更替地记住你的偏好、决策与踩过的坑。**

## 核心特性

### 🧠 谐波记忆

- **统一 HarmonicUnit 模型**：episodic / semantic / procedural / global 四类，层级只是标签，检索无视类型
- **OKF 存储**（Open Knowledge Format）：每条记忆一个 Markdown 文件（frontmatter + 正文），人可直接阅读编辑；索引是纯可推导产物，丢了可重建
- **BM25 检索**：`primary_abstraction` + `cue_anchors` 上的倒排检索 × 能量 × 显著度，1000 条记忆 ~2-3ms
- **能量系统**：检索/反馈加成、按天衰减（显著度越高衰减越慢），重要的事自然浮起，琐碎的事自然沉底
- **MinHash 合并**：跨层相似记忆自动 soft-supersede 合并，历史版本可追溯
- **Pinned 披露层 + Sticky 便签板**：身份画像每轮必见，"记下来"类提醒限时必达
- **主动记忆引导**（OptMem 式）：Agent 自主决定何时写入、何时检索，而非被动灌注

### 🤖 Goal 编排

- **Manager Agent**：拆解目标 → plan / execute / review 循环，里程碑自动推送
- **每轮目标快照**注入，compaction 免疫；`/btw` 支线问答不污染主线
- **演化观测**（RSI Phase 1）：goal 结果、会话映射、失败签名全量落库，为策略演化铺路

### 🖥️ Desktop 应用

Rail 侧边栏 + TabStrip 布局：`chat / goals / memory / approvals / triage / automation / notes` 全功能 GUI，
右 Dock 内置上下文用量、分模型成本统计与配额窗口，15s 轮询实时刷新。

### 🎬 媒体理解

图片 / 视频 / 音频经 A2A 协议接入 Media Agent，主模型原生多模态分析（非文本描述转述），
每模态可独立配置引擎与模型，支持插件扩展。

### 🐍 持久 Python 内核

会话级 Jupyter kernel（ZeroMQ wire 协议），变量与导入跨工具调用保持，matplotlib 出图直接回传。

### ⚙️ 自动化引擎

Cron 规则驱动：记忆衰减、回合聚合压缩（每小时）、反思管线；triage 队列让关键决定仍由你确认。

### 🔌 Runtime 能力契约

Gateway 与 Agent runtime 之间是能力自声明契约（Tier 0-2）：内置 opencode runtime、pi runtime 插件、
external 托管模式可热切换，无需重启。

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
 Desktop (Electron)      CLI (mafw)      opencode 插件
        │                     │                │
        └───────────── HTTP :3000 / SSE ───────┘
                          │
                   ┌──────┴───────┐
                   │    Gateway   │
                   └──────┬───────┘
        ┌──────────┬──────┴──────┬───────────┐
   谐波记忆系统   Goal 编排引擎   自动化引擎   媒体/内核/用量
   OKF + 索引    manager/plan/  cron 规则    A2A · Jupyter
   能量·合并     execute/review 衰减·压缩    provider 插件
```

数据根目录 `~/.mafw/`：记忆 OKF 文件、统一数据库、日志、配置覆盖。

## 快速开始

### 1. 启动 Gateway

```bash
npm install -g opencode-plugin-mafw

mafw start          # 前台启动
mafw daemon         # 后台守护
mafw status         # 查看状态
mafw dashboard      # 打开 Web Dashboard
```

### 2. 桌面应用（源码构建）

```bash
git clone https://github.com/Jackli-2022/mafw
cd mafw && npm install          # npm workspaces
cd packages/desktop
npx electron-vite build
```

### 3. opencode 接入（可选）

```json
{
  "plugin": ["opencode-plugin-mafw"],
  "mcp": { "mafw": { "type": "remote", "url": "http://127.0.0.1:3000/mcp", "enabled": true } }
}
```

插件激活时自动补写缺失的 MCP 接线并备份原配置（fail-open）。

## 仓库结构

```
packages/desktop/        Electron 桌面应用（main / preload / renderer）
gateway/                 Gateway 核心（HTTP API、记忆、编排、自动化、媒体、内核）
src/                     opencode 插件（hooks / tools / MCP 自接线）
evaluation/longmemeval/  LongMemEval 记忆基准
docs/                    设计文档与实施计划
```

## 文档

| 文档 | 位置 |
|---|---|
| 架构总览（AGENTS.md） | `AGENTS.md` |
| Gateway 架构 | `docs/architecture/gateway.md` |
| Plugin 架构 | `docs/architecture/plugin.md` |
| 谐波记忆 v6.3 | `docs/superpowers/specs/2026-07-02-v6.3-harmonic-memory-m1-m3.md` |
| OKF 存储迁移 v6.8 | `docs/superpowers/specs/2026-07-16-okf-migration-design.md` |
| Desktop 图标（茉芙/Mafu） | `docs/superpowers/specs/2026-09-10-desktop-icon-design.md` |
| 记忆基准 | `evaluation/README.md` |

## 声明

MAFW Desktop 应用图标「茉芙 / Mafu」由 AI 辅助生成（智谱 CogView-4）并经人工后处理。

## 参考与致谢

MAFW 的设计站在这些项目与研究的肩膀上：

| 参考 | 与 MAFW 的关系 |
|---|---|
| [opencode](https://github.com/sst/opencode) | 插件宿主平台；Desktop 端（`packages/desktop`）源自其桌面架构并深度改造（MAFW Rail/Tabs/Config、gateway sidecar 等） |
| [Memora](https://arxiv.org/abs/2602.03315)（Microsoft M365 Research, ICML 2026） | 谐波记忆系统的架构参照：`primary_abstraction` / `cue_anchors` / `memory_value` 三元数据模型与其同构；embedding 相似度合并 + LLM UPDATE/CREATE 裁判（ConsolidationService）采用其方案；其 LongMemEval-S 87.4% SOTA 是本项目记忆管线设计的方向验证 |
| OKF（Open Knowledge Format） | 记忆存储层：Markdown + frontmatter、每记忆一文件，索引视为纯可推导产物；设计见 `docs/superpowers/specs/2026-07-16-okf-migration-design.md` |

## 许可

MIT
