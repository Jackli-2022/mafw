# MAFW Loop Agent — OpenCode Plugin v4.1

> MAFW (Memory-Augmented Framework for Work) — Phase Relay + TMEM + Dynamic Compression

## 安装

```bash
# 全局安装（推荐，多项目复用）
npm install -g opencode-plugin-mafw

# 本地安装（单项目）
npm install --save-dev opencode-plugin-mafw
```

## 配置

编辑 `opencode.json`，在 `plugin` 数组中添加 `"opencode-plugin-mafw"`：

```json
{
  "plugin": [
    "superpowers@latest",
    "opencode-plugin-mafw"
  ]
}
```

## 启动 Gateway

```bash
# 前台启动
npx mafw-gateway start

# 后台守护模式
npx mafw-gateway daemon

# 注册系统服务（开机自启）
npx mafw-gateway service-register

# 查看状态
npx mafw-gateway status
```

## 使用

```bash
# 启动 OpenCode TUI
opencode

# 提交 Goal
/goal design a login system

# 查看状态
/status

# TUI 可以关闭，Goal 在后台自动运行
```

## 架构

- **Plugin**: OpenCode 插件，提供 Skill、命令、Tool、Hook
- **Gateway**: 系统级常驻进程，负责 Phase 调度、Session 管理、自动化引擎
- **State File**: 共享契约，Gateway 读 nextAction 做调度，Agent 调用 Tool 写状态

## 文档

详见架构文档。

## 许可

MIT
