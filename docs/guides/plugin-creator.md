# 插件 Creator 指南（让 Agent 创建插件）

> 面向**用 Agent 生成/迭代统一插件包**的用户与维护者。
> 包的契约、widget、slot、action/event 细节仍以 [统一插件包编写指南](./plugin-authoring.md) 和仓库内
> `skills/plugin-creator/SKILL.md` 为准；本指南只说明入口、路径、审批、测试、安装与限制。
>
> 设计文档：`docs/superpowers/specs/2026-11-03-unified-declarative-plugin-packages-design.md` §15
> 计划：`docs/superpowers/plans/2026-11-03-agent-create-mode.md`

## 1. 这是什么

Creator 不是新的插件安装通道，也不是新的会话类型。它是：

- 一个普通的空白 Session；
- 会话 agent 切换为 `mafw-create`（普通 primary agent，权限受限）；
- Agent 先读真实宿主契约（`mafw_plugin_inspect`），再在**当前项目**的
  `.mafw/plugin-drafts/<packageName>/` 里写包；
- 检查、测试、安装都只能经 `mafw_plugin_manager`，每次执行/写入都要一次原生人工审批；
- 安装仍然走既有的 Phase 1 `PackageManager` / Plugins 页面接口。

没有专用的 Creator Session API、没有 gateway 侧草稿 kv、没有第二套安装路径。草稿就是项目里的文件；
关掉会话、重启 Desktop/gateway 后仍然存在，另一个 Creator Session 也能接着改同一个目录。

## 2. 入口与可用条件

Desktop：`Config → Plugins → 让 Agent 创建插件`。

点按后：

1. 如果当前 session 是**已经加载完成且没有消息**的空白会话，复用它；
2. 否则创建一个新的持久化 Session（不会退回本地假会话）；
3. 把 agent 切到 `mafw-create`，打开会话；
4. **不发送任何消息**——你在输入框里描述要做的插件。

另一个会话里尚未发送的输入草稿不会被清空；普通的「新建会话」默认行为也不变。

入口在以下情况禁用，并在按钮旁显示原因：

| 原因 | 文案 | 说明 |
|---|---|---|
| Agent 列表为空或尚未加载 | 正在加载 Agent 列表… | 代码按列表长度判定（`agentsData().length > 0`），没有独立的 fetched 标志；空列表也归入 loading |
| 当前 runtime 没有 `mafw-create` | 当前 runtime 未提供 mafw-create | 只有物化了该 primary agent 的 runtime 可用（见下） |
| 当前是并行 worktree 会话 | 并行 worktree 会话不提供创建入口 | 草稿必须留在项目里，worktree 清理不能带走它 |

> **本阶段仅 OpenCode**：Creator 的 `mafw_plugin_inspect` / `mafw_plugin_manager` 工具与随包
> `plugin-creator` 技能都由 OpenCode 插件宿主提供，因此 `mafw-create` 只在声明
> `pluginCreatorApi` 的 runtime（当前=OpenCode）上物化。pi 等 runtime 上该身份不物化，
> `/api/agents` 不返回它，入口显示中性的「当前 runtime 未提供 mafw-create」而不是给一个
> 没有工具的空身份。其他 runtime 的支持是后续阶段的事，不要手工切 agent 绕过。
>
> **复用空白会话的前置条件**：只有「历史已加载完成且为空」的**普通项目会话**会被复用。
> Lead/manager 会话（协调对话）与目录不在项目根内的会话一律不复用——后者常见于内部会话的
> hash 目录，复用会让草稿落到承诺的项目路径之外。
>
> **worktree 限制**：`benchRoot()` 与项目根不一致时入口一律禁用。需要 Creator 时请在项目本身的会话里操作。
> 工具本身仍以会话目录为根；worktree 会话中手工调用会落到 worktree 的 `.mafw`，不受支持。

## 3. 一次完整流程

```text
1. mafw_plugin_inspect({ query: "slots" })
   mafw_plugin_inspect({ query: "widgetSchema" })
   （可选 package / clientDescriptors / actions / events / experience）
2. Agent 在 <project>/.mafw/plugin-drafts/<packageName>/ 写：
     plugin.json
     index.js
     index.test.js
3. mafw_plugin_manager({ operation: "check", draft: "<packageName>" })
4. mafw_plugin_manager({ operation: "test", draft: "<packageName>" })
5. mafw_plugin_manager({ operation: "install", draft: "<packageName>", overwrite: false, requestId: "<新的随机 id>" })
6. 用户在真实 Desktop 的 panel / config page / tool card / message window 里确认效果
7. 有修改 → 改草稿 → 新的 requestId 重新 check / test / install（覆盖时 overwrite: true）
```

`check` 只证明 candidate 能激活；`test` 只证明包自测通过。两者都不安装、不发布 revision。
只有 `install` 会把草稿复制成 `~/.mafw/plugins/<name>` 并提交新 revision。

## 4. 草稿目录与允许内容

固定路径：

```text
<project>/.mafw/plugin-drafts/<packageName>/
  plugin.json          # 唯一的 manifest
  index.js             # 入口（默认 main = index.js）
  index.test.js        # 零依赖自测
  lib/…                # 可选：包内 Host 模块
```

- 目录名、`plugin.json` 的 `name`、`module.exports.name` 必须完全一致。
- 包名必须是单个路径段：`^[A-Za-z0-9][A-Za-z0-9._-]*$`；不能含 `:`、空格、`..`、路径分隔符。
- `main` 必须在包目录内。
- 草稿根固定为 `.mafw/plugin-drafts`；`..`、绝对路径、符号链接/junction 逃逸都会被拒绝。
- 指纹/path 检查的实际上限：5000 个文件、50 MiB。

**会被拒绝（不是跳过）的内容**：

| 内容 | 原因 |
|---|---|
| `.git` / `node_modules` | 安装会复制整个目录；不能出现审批指纹没覆盖的字节 |
| `.DS_Store` / `Thumbs.db` / `desktop.ini` | OS 垃圾文件 |
| `*.tmp` / `*.swp` / `*.swo` / `*~` | 临时/编辑器文件 |
| 任何符号链接 | 可能把草稿外内容带入安装，也可能形成环 |
| 其他非文件/非目录条目 | 同上 |

安装复制集合与审批指纹集合一致：草稿里出现这些内容时，删除后重试，不要试图让工具忽略它们。
草稿也不支持依赖安装、原生模块或构建步骤；包必须是零依赖源文件。

## 5. 工具、权限与审批

### 5.1 身份与工具边界

`mafw-create` 只放行：

- 读：`read` / `grep` / `glob` / `list`
- 写草稿：`edit` / `write`（普通编辑审批）
- 规划与提问：`todowrite` / `question`
- Creator：`skill` / `mafw_plugin_inspect` / `mafw_plugin_manager`
- 记忆：`mafw_add_memory` / `mafw_search_hybrid` / `mafw_get_memory`

**没有 shell**：`bash` 被 deny；`test` 也不是 `bash`，只运行固定的 `node --test`。
所有 `check` / `test` / `install` / `enable` / `disable` / `remove` / `reload` 只能经
`mafw_plugin_manager`，不能手写安装目录、不能直接用 HTTP 绕过审批。

### 5.2 逐次原生审批

| 操作 | 是否审批 | 说明 |
|---|---|---|
| `list` / `status` / `descriptor` | 否 | 只读，不执行包方法 |
| `check` / `test` | 是 | 执行草稿代码 |
| `install` | 是 | 复制并激活包 |
| `enable` / `disable` / `remove` / `reload` | 是 | 修改已安装包状态/文件 |

- 审批走宿主原生 `ctx.ask`，权限键是 `mafw_plugin_manager`。
- **`always: []`**：一次批准只批准这一次操作。UI 无法把它沉淀成可复用规则，也不会提升会话权限。
- **`metadata.forceHuman: true`**：审批载荷显式标记为人工决策，gateway 审批钩子
  （`gateway/src/core/approval/hook.ts`）见到该标记就让路——否则 `auto` 档会把权限请求自动答复
  （内部会话则自动拒绝），全程没有人看到。`forceHuman` 是既有契约，不是第二套审批系统。
- 会话模式为 `full-access` 时按既有策略直接执行；`auto` / `read-only` 仍会要求人工确认。
- 审批通道不可用、模式读取失败 → **失败关闭**，不会变成隐式批准；不要用 MCP question 冒充。
- `install` / `overwrite` 的审批文本包含包名、草稿名、`overwrite` 与内容 fingerprint。批准后、执行前会重新计算
  fingerprint；如果草稿在审批期间被改动，操作中止并报 `draft changed during approval`。**不要在等待审批时改文件。**

### 5.3 `requestId`

`install` 的 `requestId` 表示一次真实的安装意图：

- 网络重试可以复用同一个随机 id（相同 id 会重放第一次结果）；
- **新的迭代必须用新的 id**，否则会拿回旧结果、revision 不前进；
- 重放缓存是 **gateway 进程内**的（`PackageManager` 的内存表，最多 50 条）；gateway 重启后同一个 id 不再重放，会重新执行安装；
- 不要用 `(operation, draft, overwrite)` 的确定性哈希代替随机 id。

## 6. 固定测试命令

`mafw_plugin_manager({ operation: "test", draft })` 等价于在草稿目录运行：

```bash
cd <project>/.mafw/plugin-drafts/<packageName>
node --test
```

运行器契约（不可配置）：

| 项 | 值 |
|---|---|
| 命令 | 当前 gateway 的 `process.execPath --test` |
| cwd | 草稿目录 |
| shell | `false` |
| 超时 | 60s，超时会杀死整个进程树（Windows `taskkill /F /T`；POSIX 进程组） |
| 测试文件 | `node --test` 默认发现规则（`*.test.js` 等） |
| 包 scripts | **不执行**；没有自定义测试命令 |
| 环境 | 只继承 PATH/SystemRoot/HOME/TMP/LANG 等基础变量，并设 `NODE_ENV=test` |
| 返回给模型 | stdout+stderr 合计 ≤ 64 KiB，超出截断 |
| 完整日志 | `<project>/.mafw/plugin-drafts/.logs/<draft>.log`，上限 8 MiB |

测试必须零依赖、用 fake ctx 覆盖每个 slot/action/event，并验证 view 可序列化。测试通过不等于沙箱隔离，
也不等于已安装。

## 7. 安装与覆盖

```text
mafw_plugin_manager({ operation: "install", draft: "acme", overwrite: false, requestId: "..." })
  → 复制草稿到 ~/.mafw/plugins/acme
  → 激活 candidate / 提交 revision
```

- 首次安装不需要 `overwrite`；同名已安装包必须显式 `overwrite: true`。
- 源是项目草稿，安装是**复制**。之后继续改草稿不会自动更新已安装副本；需要重新 `check` / `test` / `install`。
- **非 runtime 包**安装成功会热提交 revision，Desktop 局部更新，不需要重启 Desktop；拥有当前 active runtime 的包不热替换，整包进入 pending（见 §8）。
- 安装返回的 `activeRevision` / `pendingRevision` 是唯一权威，不要自行推断。
- `install` 失败时旧 revision 保持不变；**首次安装激活失败时没有 active 残留，但复制到 `~/.mafw/plugins/<name>` 的包目录会留在磁盘**。修复后重试需要 `overwrite: true`，或先 `remove` 再安装。

## 8. pending：active runtime 包

如果变更包拥有 gateway 当前正在使用的 runtime：

- 整包进入 **pending**；旧 revision 继续服务；
- 工具返回 `application: "pending"`、`pendingRevision` 与 `nextStep` 等 install 结果字段；被刻意隐藏的是 `applyPending` 操作本身，不是这些结果字段；
- **模型没有 `applyPending`**。必须由用户在 `Config → Plugins` 对应行点「应用」；
- 应用时 gateway 会走既有的 runtime switch 编排（事件重订阅、身份重新物化）。失败会报告
  `runtimeSwitch: failed`，旧 revision 仍保留。

不要在 pending 时声称「已生效」。新安装或重新启用 runtime 包也不会静默抢占 active runtime。

## 9. 状态词

| 词 | 含义 |
|---|---|
| `saved` | 草稿文件已写入项目 |
| `tested` | 固定 `node --test` 通过 |
| `installed` | 已复制到 `~/.mafw/plugins/<name>` |
| `active` | 当前正在服务的 revision |
| `pending` | 新 revision 已提交到磁盘，等待用户「应用」 |

规则：draft 保存 ≠ tested；tested ≠ installed；installed ≠ active（pending 时）。

## 10. 失败恢复

| 情况 | 处理 |
|---|---|
| `invalid draft` | 草稿名含 `..`/分隔符/绝对路径，或 realpath 逃出草稿根；改用单个安全目录名 |
| `draft not found` | 先创建 `<project>/.mafw/plugin-drafts/<name>/` 和 `plugin.json` |
| `plugin.json name must equal draft directory` | 目录名、manifest name、导出 name 三者改成一致 |
| 草稿含 `.git` / `node_modules` / 临时文件 / 符号链接 | 删除这些内容后重试（工具不会跳过它们） |
| `check` 返回 `ok:false` | 按 diagnostics 修草稿；旧的 active revision 不受影响 |
| `test` 失败 | 按测试输出/`.logs` 修草稿；此时没有任何安装发生 |
| `test` 超时 | 60s 已终止整个进程树；缩小或修复测试 |
| 审批被拒/取消 | 什么都没执行；说明原因，不要反复重试到通过 |
| `draft changed during approval` | 停止编辑，重新走一次 `check`/`test`/`install` |
| `install` 返回 `application:"failed"` | 修草稿，用**新的** `requestId` 重试；旧 revision 保留。首次安装失败时包目录已在磁盘，重试需 `overwrite: true` 或先 `remove` |
| 安装显示 pending | 请用户在 Plugins 页点「应用」，不要声称已生效 |
| 安装后界面没更新 | 检查是否 pending；必要时让用户点「重新加载」或重启 Desktop 后再验证 |
| 用户 disable/remove | 源草稿仍保留；不要自动重新启用，除非用户明确要求 |
| 草稿与安装副本不一致 | 永远以草稿为源重建：改草稿 → check/test → install（overwrite） |

## 11. 草稿保留与清理

- **草稿不会自动删除**：`install`、`enable`/`disable`、`remove`、Desktop/gateway 重启、会话关闭都不删除项目里的
  `<project>/.mafw/plugin-drafts/<name>/`。
- `remove` 只删除安装副本 `~/.mafw/plugins/<name>` 与 active 贡献；源草稿保留，便于继续迭代或重新安装。
- `test` 的完整日志在 `<project>/.mafw/plugin-drafts/.logs/<draft>.log`，同样不会被自动清理。
- 需要清理草稿时由用户自行删除目录（这是项目文件，不是 gateway 数据）。

## 12. 限制与信任边界

### 12.1 受信代码，不是沙箱

- 安装 = 在 **gateway 进程**里 `require` 并执行 `index.js`；与 gateway 同权限。
- `check` 会激活 candidate，`test` 会运行草稿里的测试代码；两者都执行**草稿作者写的受信代码**，不是隔离环境。
- 不要用 Creator 处理来源不可信的目录；只安装你信任、能读懂的草稿。
- 这些接口没有新增远程端点，但 gateway 监听所有接口（`server.listen(apiPort)`），并非只绑定 loopback。**当前 registry 分发顺序是插件路由先于鉴权**：`plugins.install/enable/disable/delete/installPackage/apply/reload` 等 handler 在 `authorizeRequest` 之前执行，因此配置 `server.apiToken` 并不能保证它们在局域网上安全（这是既有的 auth-order P0）。**在该 P0 修复前，只在本机 loopback 或主机防火墙后面运行 gateway，不要暴露到局域网/公网**；P0 修复后再按正常的 token / 默认拒绝规则处理——届时 token 等同于安装/删除权限。

### 12.2 没有视觉反馈通道

- 没有截图、renderer 回传或 DOM 检查工具；模型看不见真实渲染结果。
- 视觉正确性只以**用户在真实 Desktop 的反馈**为准。Agent 不得声称自己看见了界面。
- 渲染问题由用户描述（哪个 panel/tab/卡片、看到什么、期望什么），Agent 改草稿后重新安装验证。

### 12.3 其它限制

- `applyPending` 不暴露给模型（工具会显式拒绝），只能用户在 Plugins 页执行。
- Creator 只在项目根会话提供入口；worktree 会话禁用。
- 没有专用草稿 id / session 绑定；两个 Creator Session 可以继续同一个草稿目录，文件是唯一真相源。
- 没有自动安装依赖、构建步骤或自定义测试命令；草稿必须零依赖。
- 没有第二套安装路径；安装/删除/启用/重载仍由 `PackageManager` 与 Plugins 页负责。

## 13. 手动流程（Phase 1）仍然有效

不想用 Agent 时，完全手动的方式不变：

1. 自己创建目录包（任意可信位置，通常直接放 `~/.mafw/plugins/<name>/`）；
2. `node --test` 跑包自测；
3. 在 Desktop `Config → Plugins → 安装本地目录` 选择源目录；
4. 覆盖前确认贡献 diff；runtime 包 pending 时点「应用」。

手动安装、热重载、revision/staging、安全模型的完整说明见
[统一插件包编写指南](./plugin-authoring.md)。Creator 只是把「写草稿 → 检查 → 测试 → 安装」这一串动作交给
受限 Agent 执行，底层契约与手动流程完全相同。
