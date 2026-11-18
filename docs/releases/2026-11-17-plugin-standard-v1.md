# E14 插件标准 v1 交付记录（2026-11-17）

- 版本：gateway **4.18.0**（`4.17.0` → `4.18.0`）
- 性质：把「插件怎么写才算合规」变成**一份 agent 能照着执行的规范 + 三件可执行工具 + 两个参考包**。
- 验收口径（用户原话）：拿到东西丢给 agent，能开发出「装上」就成的包。
- spec：`docs/superpowers/specs/2026-11-17-plugin-standard-v1-design.md`
- plan：`docs/superpowers/plans/2026-11-17-plugin-standard-v1.md`
- 调研：`docs/research/2026-11-17-plugin-install-trust.md`

## 波次与提交

| commit | 任务 | 一句话 |
|---|---|---|
| `4d40249f` | E14 参考包 | 新增 `examples/plugins/{hello-plugin,kitchen-sink}` 与校验它们的真 host 测试 |
| `a73d51ec` | E14 参考包修复 | 安装命令补 `--trust`/`--permission`（v2 不补必然 400）、路径机制纠正、观察者改 canonical |
| `af69adcd` | 同上 | 观察者 filter 改 `part.updated`（`plugin:*` 永远收不到） |
| `6a4f2484` | E14 `plugin check` | 进程内 dry-run + `declared`/`registered` inventory + 可粘贴安装命令 + `--strict`/`--json` |
| `ee61b18e` | check 修复 | **修复安装命令的 shell 注入**（权限 token 只做前缀校验）、终端净化、JSON 与退出码一致、空 plane 语义 |
| `478634f9` | check 修复 | 带空格/中文的路径仍可粘贴（引号内安全），不安全路径才省略 |
| `a0336586` | check 修复 | `$`/反引号/`!` 也拒绝，避免「粘贴即在 POSIX 下展开」 |
| `6f5ff70d` | E14 `plugin init` | 生成到 `.mafw/plugin-drafts/<name>`，生成完即可 `check --strict` 通过 |
| `c6663f01` | E14 manifest schema | `MANIFEST_JSON_SCHEMA` + parity 矩阵（含 `standardVersion`）、`plugin schema`、init 名字上限 |
| `f93f6c66` | schema 修复 | `standardVersion` 上界（拒绝 `1e400`）、把「已知更松」写成文并钉住 |
| `48c64c07` | E14 规范正文 | `docs/guides/plugin-standard.md`（11 节，五个 plane 的逐字文案与上限） |
| `65c470c3` | 规范纠偏 | 11 处与代码不符的表述（`host: ""`、icon 字段、`http:true`、check 的 ctx 差异、untrusted 无法本地 dry-run 等） |
| `351fc18c` | 规范补歧义 | 首次作者实测的 11 处歧义（事件信封的两个 `at`、`check` 的判据范围、`activate()` 内 emit 会被丢弃、`--dir` 语义、BOM、行为验证路径等） |
| `6dafdffc` | 验收修复 | `next:` 回显 `--strict`、`http` 两种措辞统一、失败路径补 `apiVersion/kind/permissions`、`check` 会真跑 `activate()` 的提示、工具输入不由宿主校验、canonical 名单指向权威源 |
| 本记录 | E14 收尾 | 版本号 + 交付记录 + spec/plan 入库 |

## 现在有什么

### 三件工具

```bash
mafw plugin init my-plugin            # 生成骨架（默认 .mafw/plugin-drafts/my-plugin）
mafw plugin check --strict "<abs>"    # 自查：声明 vs 实际 + 可粘贴安装命令
mafw plugin schema                    # 打印 manifest JSON Schema
```

`check` **不需要 human token、不连网、gateway 停着也能跑**：它进程内调用
`PluginHost.checkPackage()`，与真实激活同一个判定函数。`--json` 输出**一行**可解析 JSON
（`ok` 是命令判决，另有 `verdict` / `strictFailed` / `declared` / `registered` / `warnings`）。

### 一份规范 + 两个参考包

`docs/guides/plugin-standard.md` 是唯一规范正文；`plugin-authoring.md` 降为细节参考。
参考包：`examples/plugins/hello-plugin`（1 action + 1 event）、`kitchen-sink`（五面齐全 + ui panel）。

### 声明即上界（延续 E12/E13）

`contributes.gateway` 的五个 plane 各自是上界；越界整包激活失败；声明的 plane 没注册合法；
未声明的 plane 不受约束；`http: false` 时任何路由注册都失败。

## 安装权：由人执行（本波的核心决策）

调研结论见 `docs/research/2026-11-17-plugin-install-trust.md`：**没有一家允许 agent 自主安装可执行插件**，
Claude Code 甚至在模型会话内执行 `plugin install -y` 时忽略 `-y` 并拒绝。

因此 agent 的完成标准是：**`check --strict` 通过 + 交出安装命令**，安装由人执行：

```bash
mafw plugins install "<abs path>" --trust trusted --permission actions --permission events
```

（v2 包必须带 `--trust` 与逐项 `--permission`，否则 `permission_consent_required`。）

## 验证

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json` | **exit 0** |
| 契约包 | `npm run test:plugin-contract` | **47 pass / 0 fail** |
| gateway 全量 | `npx jest --runInBand --forceExit` | **1028 suites / 8182 tests**：8155 passed、2 skipped、**25 failed**（见下，全部非本波） |
| 本波相关面 | `npx jest --runInBand --forceExit tests/unit/plugins tests/unit/cli` | **44 suites / 493 tests 全绿** |
| 参考包冒烟 | `node bin/mafw.js plugin check --strict <examples/...>` | 两个示例均 `ok`，exit 0 |

全量那 25 条红与 E14 无关，逐项归因：

- 4 个契约台账套件（`api-contract` / `request-coverage` / `schema-coverage` / `write-response-coverage`）：
  另一会话新增了一个带 body 的写操作，台账期望 192、实际 193（收到的数组里是 `pod.events.seen*`）。
- `plugin-package-e2e`：已知 env-red（缺 `@anthropic-ai/claude-agent-sdk`）。
- `runtime/uncaught-exit`：runtime 套件；E14 的 13 个 commit 没有一个触碰 `gateway/src/runtime/**`。

核验方式：逐个 `git show --name-only` 检查本波 13 个 commit，均未触碰 `routes/`、`gateway-sdk/`、`http/`、`runtime/`。

**新增可执行 test case：79**（`plugin-standard-command` 47、`manifest-schema-parity` 13、`standard-doc` 8、`package-check-inventory` 6、`example-packages` 3、`package-manifest` +2）。

## 验收（三个脚本化场景，各用一个无上下文子代理）

| 场景 | 任务 | 结果 |
|---|---|---|
| A 最小包 | 「写 `clock`：`now` action + 每秒 `plugin:clock:tick` 事件」 | **首次 `check --strict` 即 `ok`，零告警**；子代理只读规范 + 两个示例，未读任何 `gateway/` 源码；自行用假 ctx 验证了行为 |
| B 全 plane | 「写 `probe`：`stats` action + `echo` tool + `audit` observer + `GET /status` 路由」 | **首次 `check --strict` 即 `ok`**；四面对齐（`http true` / `1 route(s)`） |
| C 反例 | 故意让 manifest 只声明 `ping`、`activate()` 返回 `ping` + `pong` | **安装前拒绝**（exit 1），逐字报 `action "pong" is not declared…`，打印 declared/registered 差集，**不打印 `install:`**；`--json` 单行可解析且与退出码一致 |

场景 A/B 的子代理都**没有安装**（安装是人类的动作），也都没有接触 human token。验收过程照出 6 处真缺陷，已由 `6dafdffc` 修复并在同一天重跑 C 确认：

- `next:` 重跑提示会丢掉 `--strict`（照它重跑会静默降级）；
- `declared:` 与 `registered:` 对 `http` 用了两套措辞（`opted out` vs `0`），而这两行正是让人对比的；
- 失败路径丢掉了 `apiVersion` / `kind` / `permissions`（最需要排障时反而看不到）；
- 没有提示「`check` 不是沙箱、`activate()` 真的跑过」；
- 规范 §8 对 check host 的 ctx 描述不全（漏了 `ctx.http`）；
- 规范未说明工具 `input` 不由宿主校验、canonical 名单的权威来源。

## 已知边界

1. **`check` 无法 dry-run `untrusted` 包**：本地 host 没有 worker factory，返回 `worker_unavailable: no worker host factory`。规范 §0/§7/§10 已写明绕行（按受限形状写、交给人安装验证）。若要给 untrusted 作者完整自查环，需要给 CLI 接一个 worker host。
2. **`check` 的 ctx 不是真实 host 的 ctx**：`ctx.config.update` / `ctx.terminal.*` 会抛错，`ctx.apiKey` 为 `null`，`gatewayPort` 是 3000 占位；`check` 不是沙箱（`ctx.fetch` 是真的）。
3. **manifest schema 可能更松、永不更严**：JSON Schema 的 `maxLength` 数码点，契约数 UTF-16 单元；已用 parity 测试钉住这一条已知更松的边缘。
4. ~~`PluginCheckResultSchema` / SDK / Desktop 类型尚未补 `declared`/`registered`/`warnings`~~ —— **已由 E15 关闭**（HTTP 契约与 SDK 现在都带 `declared` / `registered` / `warnings` / `code` / `evaluated`）。
5. **`standardVersion` 目前只定义 `1`**：解析要求正整数，不做语义分支。
6. `~/.mafw/plugins/README.md` 只在目录首次创建时写入，存量安装看不到新增的边界说明。
7. **所有失败都退 1，没有机器可读的 `code`**：区分「manifest 解析失败 / 身份不符 / 越界」只能匹配 `error` 字符串。已列入后续；当前 `next:` 已能指名修法。
8. **失败输出没有逐项 delta 标记**：声明的 40 个 action 里多出一个时，只能靠人对比两行列表；`error` 会点名越界条目，但没有 `+pong` 这类标记。
9. **`check` 会真的执行 `activate()`**（不是沙箱，`ctx.fetch` 是真的），CLI 已加 `note:` 提示；不要把 `check` 当作安全隔离手段。

## E15 收口（2026-11-18）

把上面第 4-7 条遗留做完，共 5 个 commit：

| commit | 内容 |
|---|---|
| `1ff98c652` | host 侧失败分类 `code`（7 值）+ `evaluated` |
| `fb6a2454b` | 修正：`evaluated` 在「拿到贡献集合」时置真（不再等价于 `!ok`）；manifest 归一化提到 entry 检查之前；`http: false` / 无 manifest 边界 / web surface 归入 `contribution_bound`；新增 `candidate_missing` |
| `3046bf4e9` | CLI：`error[<code>]:`、行内 `+name`/`-name` 差集（仅已声明 plane）、重名去重 |
| `7dac853db` | HTTP 契约 + SDK 类型补 `code`/`evaluated`/`declared`/`registered`/`warnings`，OpenAPI 与 `api-schema.gen.ts` 用仓库脚本重生成（diff 仅限 `plugins.check`） |
| `be44ed267` | 修正：`evaluated:false` 时渲染 `(not evaluated)`，不打印 `-` 标记与「声明了没注册」，把「没评估」与「没注册」彻底分开 |

**新增 25 条用例**（`package-check-inventory` 6→21、`plugin-standard-command` 47→57），另 1 条断言翻转。
定向门禁：`package-check-inventory` 21、`plugin-standard-command` 57、`api-contract` 262、SDK 245，全部通过；两个包的 `tsc -p` 均 exit 0。

**仍未做**：`untrusted` 包的本地 dry-run 需要给 CLI 接 worker host；失败输出仍无逐项 `+/-` 之外的定位信息（不给 file:line）。
