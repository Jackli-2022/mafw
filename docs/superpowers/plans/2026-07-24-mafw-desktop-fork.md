# MAFW Desktop Fork 计划（opencode-dev monorepo）

日期：2026-07-24
状态：已确认，待执行

## 背景

现有 `mafw-desktop/` 是自建 Electron + SolidJS 壳（6 个 MAFW 页面直连 Gateway REST/SSE），主进程功能薄弱（无 updater/window-state/deep-links）。`opencode-dev/packages/desktop` 是官方桌面应用，主进程成熟（sidecar/updater/window-registry/store/onboarding/WSL），但渲染层是纯壳（UI 在 `@opencode-ai/app`），强耦合 monorepo（bun workspace + catalog）。

决策：**fork 进 opencode-dev monorepo，在 `packages/desktop` 上改造**。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| Gateway 接入 | 双 sidecar 并存（opencode server sidecar 保留，新增 MAFW Gateway sidecar） |
| MAFW 页面位置 | desktop renderer 自建（不动 `packages/app`） |
| Gateway 产物来源 | 运行时解析已安装产物（不打包 gateway 源码进安装包） |
| 旧 mafw-desktop/ | 保留不维护，README 加迁移说明 |
| 分支策略 | 不建分支，直接在 opencode-dev master 上改 |
| sidecar 通信 | 使用 `packages/gateway-sdk`（workspace 内已有，提供 GatewayClient + SSEConnection） |

## 架构

```
Renderer (MAFW 页面, /mafw/*)
  → window.api.mafw.* (preload，类型安全)
    → main/ipc.ts handlers
      → GatewayClient (gateway-sdk, "workspace:*" 依赖)
        → HTTP/SSE → MAFW Gateway 进程 (utilityProcess, 运行时解析产物)
```

关键约束（来自 `opencode-dev/packages/desktop/AGENTS.md`）：
- Renderer 只能调 `window.api`（preload 暴露）→ renderer 不直接 fetch gateway
- IPC handlers 只注册在 `src/main/ipc.ts`

关键约束（来自 `opencode-dev/AGENTS.md`）：
- 代码风格：无 else（early return）、无 any、点号访问优先于解构、const 优先、Bun API 优先
- import 不别名、不 star import
- 测试不能从仓库根跑，只能从包目录跑
- typecheck 用 `bun typecheck`（包目录内），不直接跑 tsc

## gateway-sdk 能力（复用，不再移植旧 MafwClient）

`opencode-dev/packages/gateway-sdk`（name: `gateway-sdk`，被 `packages/*` workspace glob 覆盖，当前无其他包引用）：

- `session`: create / prompt / promptAsync / delete / list / get
- `project`: list / current（打 `/health`，可复用为就绪探测）/ setCurrent
- `event`: subscribe（SSEConnection，通配 `*` 事件）
- `goals` / `memory`（search / energy-distribution / l5-axioms）/ `approvals` / `triage` / `automations`
- `config`: get/set 抛 MethodNotSupportedError（Config 页需注意）

## 任务分解

### Task 1 — 构建基线验证（最高风险，先行）
- 根目录 `bun install`
- `packages/desktop` 内 `bun typecheck` + `bun run build`
- 验证 `virtual:opencode-server` prebuild 链路在本机可用
- 失败则整个方案需重议

### Task 2 — desktop 依赖接线
- `packages/desktop/package.json` 加 `"gateway-sdk": "workspace:*"`
- 确认 electron-vite 主进程 bundle 能解析 gateway-sdk 的 `dist/`

### Task 3 — Gateway 解析器 + sidecar
- `src/main/mafw-gateway-resolver.ts`：`resolveGatewayEntry(): string | null`，候选顺序：
  1. `MAFW_GATEWAY_ENTRY` 环境变量
  2. `~/.mafw/gateway/dist/gateway/src/index.js`
  3. 全局 npm 插件安装位置
- `src/main/mafw-sidecar.ts`：
  - `utilityProcess.fork(entry)`（Electron 42 支持 ESM；fallback：`ELECTRON_RUN_AS_NODE` spawn）
  - env 注入 `MAFW_SERVER_API_PORT`
  - 健康轮询用 `GatewayClient.project.current()`（打 `/health`）
  - 状态机 `stopped/starting/ready/failed`，日志走现有 `logging.ts`
  - `main/index.ts` 初始化中启动，失败不阻塞 opencode sidecar
  - app quit 时 kill；不自动重启（renderer 手动 restart）

### Task 4 — IPC + preload（SDK 代理）
- `main/ipc.ts`：
  - `mafw:request`（namespace/method/args → GatewayClient 调用）
  - `mafw:gateway:info` / `mafw:gateway:restart`
  - `mafw:event:subscribe` → SSE 事件转发为 `mafw:event` IPC 消息
- `preload/index.ts` + `preload/types.ts`：类型化 `window.api.mafw.{goals,memory,approvals,triage,automations,session,event,gateway}`，内部汇聚到通用通道

### Task 5 — Renderer 路由分流 + 入口
- `renderer/index.tsx` DesktopRoot 层：location 以 `/mafw` 开头 → `<MafwShell>`，否则 `<AppInterface>`
  - 分流必须在 AppInterface **之外**（其内部 `/:dir` 路由会吞路径）
- `main/menu.ts` 追加原生 "MAFW" 菜单项 → 发 `navigate-mafw` 到窗口 → renderer 监听后 `history.set('/mafw')`
- MafwShell 提供"返回"链接回 `/`

### Task 6 — 移植 6 页面
- 从 `mafw-desktop/src/renderer/pages/` 复制到 `src/renderer/mafw/`
- 数据层全部改走 `window.api.mafw`（旧 `gateway/client.ts` 废弃）
- Chat 页改用 `session.promptAsync` + event 流（替代旧 `/api/chat`）
- Config 页注意 SDK config.get/set 不支持（MethodNotSupportedError）→ 走 `mafw:request` 直连 `/api/config` 或页面降级
- 去 Tailwind（desktop 包无 tailwind），用 `@opencode-ai/ui` 组件 + 主题变量
- gateway 未就绪时显示安装/排查指引页而非崩溃

### Task 7 — 测试（desktop 包目录内跑）
- `mafw-gateway-resolver.test.ts`：候选顺序、env 优先、全缺失返回 null
- `mafw-sidecar.test.ts`：状态机转换（mock SDK）
- IPC 代理转发测试

### Task 8 — 验证收尾
- `bun typecheck` + `bun run build` 绿
- `bun dev` 手动冒烟：菜单开 MAFW、双 sidecar 并存、gateway 缺失时指引页
- mafw 仓库 `mafw-desktop/README.md` 加"已迁移至 opencode-dev fork"说明

## 风险

1. **bun 全量构建本机可用性**（Task 1 先验证）
2. gateway `/health` 端点形状（gateway-sdk `project.current()` 已依赖它，相对可靠）
3. Electron utilityProcess ESM 兼容性 → spawn fallback
4. `menu.ts` 条目类型来自 `@opencode-ai/app` desktop-menu → 追加原生 item，不改 app 包

## 参考文件

- `opencode-dev/packages/desktop/src/main/sidecar.ts` — opencode sidecar 范本
- `opencode-dev/packages/desktop/src/main/ipc.ts` — IPC 注册点
- `opencode-dev/packages/desktop/src/preload/index.ts` / `types.ts` — window.api 暴露点
- `opencode-dev/packages/desktop/src/renderer/index.tsx` — AppInterface 挂载点（分流插入处）
- `opencode-dev/packages/gateway-sdk/src/client.ts` — GatewayClient
- `mafw-desktop/src/main/sidecar.ts` — 旧 gateway 拉起逻辑（entry 路径参考）
- `mafw-desktop/src/renderer/pages/` — 6 页面移植源
