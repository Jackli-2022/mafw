# 业界插件安装的信任模型（为 E14「谁来装」提供依据）

> 2026-11-17 调研。问题：插件能执行任意代码时，业界**允不允许 agent 自己装**？装之前给什么、装时谁授权？

## 1. 结论先行

**没有任何一家允许 agent 自主安装可执行代码的插件。** 通行做法是三条：

1. **安装必须由人发起**（终端交互、UI 点击、或显式的脚本调用）；
2. **装之前给人一份可读清单**（这个包会加什么、能做什么）；
3. **危险子步骤单独授权**（构建脚本、外部命令、下载 header 命令），而不是「整包一次同意」。

agent 的角色是**生产者**：生成包、跑校验、给出安装命令。它不被授予安装权。

## 2. 各家证据

### Claude Code

- 安装入口是 `claude plugin install <plugin>` 或会话内 `/plugin`，且**非 TTY 时未显式 `-y` 直接拒绝安装**。
- 最关键的一条：**「If Claude runs the command through its Bash tool: `-y` is ignored. Run the command from your own terminal instead.」** —— 即模型在会话里跑安装命令时，`-y` 被忽略并拒绝执行。这是明确把 agent 排除在安装动作之外。
- 安装前有 `claude plugin details <name>`：打印 **Component inventory**（skills / agents / hooks / MCP / LSP）与 **Projected token cost**，让人读。
- `claude plugin validate <path>`：CI 可用的 manifest/组件校验，`--strict` 把 warning 当错，`--json` 出结构化结果，退出码 0/1/2。**这就是「agent 自查」的官方位置**。
- `claude plugin init <name> [--with skills hooks …]`：脚手架，并**立即校验自己写出来的东西**。
- 安全页明确写：插件以你的用户权限执行任意代码；Anthropic 不审查第三方 marketplace；提供组织级 allowlist / 强制启用 / 关闭 `--plugin-dir`。
- 来源：`code.claude.com/docs/en/plugins/cli-reference.md`（install / validate / init / details）、`.../plugins/security.md`。

### dsh（DeepSeek Harness）

- 安装是 `dsh plugin --profile <profile> add <pkg>`，由人执行；桌面端由 **plugin manager UI** 持有 profile 与包管理器。
- 危险子步骤用 scoped 授权：`--allow-build=@scope/pkg` 只放行**这个包的构建脚本**，不是全局 `--allow-scripts`。
- 来源：DSH 文档 `dsh plugin`、第三方插件 README 示例。

### VS Code

- 安装入口是 UI 或 `code --install-extension`（人发起），1.97 起对第三方 publisher 展示信任提示；企业用 `extensions.allowed` 策略白名单。
- 来源：`code.visualstudio.com/docs/configure/extensions/extension-runtime-security`、`/docs/enterprise/extensions`。

## 3. 抽出的模式

| 环节 | 业界做法 | 对应我们应该有的东西 |
|---|---|---|
| 谁能装 | 人（TTY / UI / 人写的脚本） | 保持 human principal，**不给 agent 安装权** |
| 装之前看什么 | component inventory + token/权限成本 | `mafw plugin check` 输出「声明 vs 实际」清单 |
| agent 怎么自查 | `validate --strict --json` | 同形：`mafw plugin check --strict --json` |
| 怎么开始写 | `init` 脚手架 + 立即校验 | `mafw plugin init` + 生成后自检 |
| 危险子步骤 | 单独、按作用域授权 | 目前无对应（我们的包没有 build script），暂不需要 |
| 组织控制 | allowlist / 强制启用 | 已有 safe mode / quarantine / kill |

## 4. 对 E14 的结论

采用**方案 A**：

- agent 的交付物是「一个 `check --strict` 通过的包目录 + 一份 inventory + 一条可直接粘贴的安装命令」；
- 安装由人执行（CLI 或 Desktop），沿用现有 human-token 与 v2 consent；
- **不新增面向 agent 的安装通道**，也**不给 agent human token**。

理由不只是「跟业界一致」：把 human token 交给 agent，等于同时解锁验收、审批、quota、rollback
这些本就设计为人类专属的动作（AGENTS.md 的硬不变量），代价远大于省下的一次人工点击。

若将来确实需要「agent 自动装到本地开发目录」，正确形态是**第二条受限通道**（只允许装到 dev 作用域、只能启用、不能改安全设置），而不是复用 human token。那是独立一轮的事，不在 E14。
