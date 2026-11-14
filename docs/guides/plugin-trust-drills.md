# Plugin Trust Drills

Phase 6 的回滚 / 隔离演练入口。

## 运行

```bash
npm run drill:plugin-trust
```

Jest 在临时目录构造包、状态和 last-good，不写真实 `~/.mafw`，不启动完整 gateway。报告写入 `artifacts/plugin-trust-drill.json`，包含：

- `startedAt` / `node`
- `scenarios[]`：`id`、`ok`、`durationMs`

## 场景

| id | 验证 |
|---|---|
| `update-rollback-before-commit` | 覆盖安装前快照；坏版本失败后恢复上一版本 |
| `update-rollback-in-window` | 新版本 commit 后健康窗口未确认 → boot 恢复 last-good |
| `boot-loop-rollback` | 进程在窗口内退出，下次 boot 先恢复再激活 |
| `integrity-mismatch` | manifest 声明 hash 不匹配 → 拒绝 |
| `safe-mode-persist` | kill 后新 store 仍为 safe mode |
| `auto-quarantine` | 连续 3 次失败 → quarantine |
| `corrupt-state` | 状态文件损坏 → safe mode |
| `unsupported-api` | apiVersion 3 只跳过该包 |
| `worker-crash-loop` | worker 3 次崩溃 → quarantine |
| `version-skew` | host range 不匹配 → 拒绝 |

## 读报告

- `ok: true`：该场景通过。
- `ok: false`：场景失败；先看 `durationMs` 是否超时，再单跑：

```bash
cd gateway
npx jest --runInBand tests/integration/plugin-trust-drill.test.ts
```

## 恢复

- **quarantine**：`mafw plugins unquarantine <name>`（human token），或桌面插件页由人类确认。
- **safe mode**：`mafw plugins resume`（human token）。
- **last-good 回滚失败**：保留现场，不要删除包目录；用 `mafw plugins doctor <name>` 看原因，再重装。
- **状态文件损坏**：gateway 自动进入 safe mode；修复/删除 `~/.mafw/plugin-package-state.json` 后由人类 resume。

## 降级

`plugin-package-state.json` 是 v2。旧版本只读取 `disabled`，不理解 `safeMode` / `quarantined`。降级到 5.2 之前必须先 `resume` 并清理 quarantine，或在 release notes 中明确接受隔离失效。
