# 桌面安装包安装时更新全局 Gateway — 设计

- 日期：2026-09-17
- 状态：已批准（用户确认三个决策点 + 调研修正后的方案 A）
- 关联记忆：#mem-929cmb（桌面 UI 更新入口，另行规划）、#mem-lhzhuw（复用已验证更新原语原则）、#mem-g85zzz（探测底座；其 PID 路径记载有误，以本文为准）

## 1. 问题

MAFW gateway 在用户机器上存在两个独立来源：desktop 安装包内置副本（`resources/gateway/`，版本冻结于打包时刻）与全局 npm 安装（`npm install -g @jack200714/mafw`）。desktop 启动是 adopt 优先，装新 exe 不会替换已在跑的旧 gateway，版本脱节是常态。用户决策：**安装包安装时检测全局 CLI 版本，落后于内置版本就更新全局包，并停掉旧 daemon**。

## 2. 决策记录（用户确认）

| 决策点 | 选择 |
|---|---|
| 更新对象 | 全局 CLI 安装（终端里的 `mafw` 同步更新） |
| 触发时机 | Windows NSIS 安装器安装阶段（非 desktop 启动时、非手动检查） |
| 运行中旧 daemon | 停止（效果：本次安装结束后 daemon 不在运行；因 Windows 文件锁实际顺序为先停后装，见 §3 修正①与 §5） |

## 3. 业界调研结论

| 模式 | 代表 | 启示 |
|---|---|---|
| 单一制品 | Ollama / Tailscale / Docker Desktop | 安装器拥有 daemon+CLI，版本脱节结构性不可能 |
| 应用自管版本目录 | Claude Code native | 后台自更新 + **永不降级**（minimumVersion 下限） |
| 应用调包管理器 | Claude Code `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1` | 制品归包管理器时，由应用跑包管理器升级命令（本设计即此模式，触发点在安装器） |
| CLI 即 shim | VS Code `code` | 全局命令指向应用资源，天然单版本 |

采纳的三条修正：① **停 daemon 必须在 `npm install -g` 之前**（Windows 运行中进程锁 `better-sqlite3.node`，先装后停会 EBUSY；Tailscale/Ollama 安装器均先停服务再换文件）；② **永不降级**（仅 global < bundled 才动）；③ **fail-open + 可诊断**（失败不阻塞安装，日志留手动命令）。

## 4. 架构

| 组件 | 位置 | 职责 |
|---|---|---|
| 更新脚本 | `packages/desktop/resources/gateway-update/update-global-gateway.js`（CJS，零 npm 依赖，随 extraResources 进安装包） | 检测比较 + 停 daemon + npm 更新 |
| NSIS 钩子 | `packages/desktop/build/installer.nsh`（electron-builder `nsis.include`，`customInstall` 宏） | 探测 node → nsExec 同步执行更新脚本，输出进安装日志 |
| 打包接线 | `packages/desktop/electron-builder.config.ts` | `extraResources` 增加 `gateway-update/` → `resources/gateway-update/`；`nsis.include` 指向 installer.nsh |

版本真相源（均已存在，零新端点）：
- 内置：`resources/gateway/package.json` 的 `version`（`stage-gateway.ts` 从 gateway/package.json 拷入；脚本按 `__dirname` 相对定位 `../gateway/package.json`）
- 全局：`<npm config get prefix>/node_modules/@jack200714/mafw/package.json` 的 `version`
- PID 文件：`~/.config/mafw/gateway.pid`（`bin/mafw.js:11`、gateway takeover `index.ts:390`、desktop `mafw-pid-file.ts` 三方同源——**注意：`~/.mafw/gateway.pid` 是错误路径**）

## 5. 执行流程（customInstall，全路径 fail-open，任何失败 exit 0 不阻塞安装）

```
node 不在 PATH → exit 0（无全局 CLI 可言，desktop 自身走 bundle）
global 包不存在 → exit 0（未装 CLI，跳过）
compareVersions(global, bundled) ≥ 0 → exit 0（永不降级）
落后 →
  ① 读 ~/.config/mafw/gateway.pid：
       文件缺失 / PID 不在运行 → 跳过停止
       tasklist 校验该 PID 镜像为 node.exe（防 PID 复用误杀）→ taskkill /F /T /PID → 等 1s 释放文件锁
  ② execFileSync npm install -g @jack200714/mafw@<bundled>（timeout 120s）
       成功 → 日志 OK；daemon 保持停止
       失败 → 日志留手动补救命令：npm install -g @jack200714/mafw@<bundled>
```

日志：脚本输出逐行进 NSIS 安装详情（nsExec），含每步 skip/ok/fail 原因。

## 6. 为什么不用 pending-restart 令牌 + MAFW_TAKEOVER

`#mem-lhzhuw` 原则：gateway 更新/重启复用已验证机制，不发明新路径。本设计复用的是**同一批原语**——安装命令与 self-update 的最终步完全一致（`npm install -g`）、停止语义与 `mafw stop` 同源（PID 文件），仅组合顺序不同。不用令牌的原因是硬约束：TAKEOVER 交接期间旧进程存活且新进程从**同一磁盘文件**启动，而 `npm install -g` 恰恰要替换这些文件（Windows 原生模块文件锁）——"停机换盘"与"不停机交接"在安装器场景不相容。无活跃 daemon 时令牌也无处消费。

## 7. 错误处理

| 情形 | 行为 |
|---|---|
| node/npm 不在 PATH（安装器上下文） | 跳过，日志注明 |
| 全局包缺失 / 版本相同 / 全局更新 | 跳过 |
| npm 源无此版本（desktop 领先 npm 发布）或网络失败 | 日志留手动命令，exit 0 |
| PID 文件指向已死/非 node 进程 | 跳过停止（不误杀） |
| taskkill 失败 | 日志警告，继续 npm（可能因文件锁失败→走失败分支） |
| npm 超时 120s | kill 子进程，走失败分支 |

Windows 细节：npm 必须以 `npm.cmd` 调用（win32 无 shell 时裸 `npm` 不解析）；脚本整体自限时 ~150s，防止安装器卡住。

## 8. 测试

- 单测（纯函数，副作用注入）：`compareVersions`（三段 semver 比较、预发布段）、`decide(bundled, global) → 'skip' | 'update'`、PID 守卫判定（缺失/死/非 node）。进 desktop 既有测试套件。
- 手动安装矩阵（Windows NSIS）：
  1. 全局落后 + daemon 运行中 → 全局被更新、daemon 停止、重开 desktop 拉起新版
  2. 未装 CLI/node → 秒过不报错
  3. 全局 = bundled / 全局更新 → 不动
  4. 断网 → 安装正常完成，日志有手动命令
- CI：`desktop-release.yml` 零改动（extraResources 自动随包）。

## 9. 非目标

- mac dmg / Linux deb/rpm 等价钩子（Windows NSIS 先行）
- desktop 内 UI 更新入口（#mem-929cmb 另行规划）
- dev 机 repo 来源更新（`mafw update` 自更新继续负责）
- 卸载 desktop 时卸载全局 CLI
