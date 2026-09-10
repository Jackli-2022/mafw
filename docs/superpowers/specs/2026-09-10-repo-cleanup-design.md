# 仓库根目录中度整理设计（方案 A）

日期：2026-09-10
状态：已与用户确认（力度=中度整理；frontend 删除、mobile 保留原位；Python 脚本移动；3 个 commit）

## 背景

仓库根目录有 38 个被 git 跟踪的杂项文件（历史文档、调试脚本、误提交的数据库/日志/tgz），
`gateway/src/` 混入 47 个编译产物（`.d.ts`/`.js.map`）及嵌套的 `gateway/src/src/` 构建输出目录，
顶层 `frontend/`（旧 React Web Dashboard，已被 `packages/desktop` 取代）零引用。

已验证事实：
- `frontend/` 在 package.json / jest.config.js / tsconfig.json / gateway 源码中零引用（仅 gateway 自身的 `gateway/src/mobile/` 模块含 "mobile" 字样，与顶层 `frontend/`、`mobile/` 目录无关）。
- 顶层 `mobile/` 是 Flutter 客户端，配套 `gateway/src/mobile/` 的活端点（push/pairing/TTS/media-proxy）——**在役，保留原位，不标 legacy**。
- 4 个根目录 Python 脚本（LongMemEval 调试用）无任何跨文件引用，可安全移动。
- `DEGRADED.md` 已过时：引用的 `src/compression`、`src/engine`、`src/memory` 路径已不存在（现位于 `gateway/src/core/`），且引用已删除的 AGENTS.md §3.2 → 归档。
- `langchain-mcp-adapters-0.6.0.tgz` 是 vendored 副本，package.json 依赖走 npm `^0.6.0` 正常解析，tgz 本体是垃圾。
- `scheduler/registered-projects.json` 是运行时数据（权威数据应在 `~/.mafw`，见 AGENTS.md §5.13a），不应跟踪。
- `.mafw/logs/mafw.log`、`Usersm24.mafwmemorygateway.db`（疑似 `C:\Users\m24\.mafw\memory\gateway.db` 路径拷贝事故产物）为误提交。

## 设计

### 1. 归档与归位（`git mv`，保留历史）

| 源 | 目标 |
|---|---|
| `mafw_6.0.md`、`mafw_6.3.md`、`mafw_6.4.md`、`mafw_6.6.md`、`mafw_6.7.md`、`mafw_6.8.md`、`MAFW_Architecture_Detailed_v5.0.md`、`MAFW_Architecture_v4.1_FINAL.md`、`MAFW_Memory_Tools_v5.0.md`、`MAFW v7 架构：OKF × Memora（v6.8 已实施基线）.md` | `docs/archive/architecture/` |
| `MAFW界面美化-开发文档.md`、`MAFW界面美化-开发文档 (1).md`、`MAFW界面美化-开发文档 (3).md`、`MAFW界面美化-整改文档.md`、`MAFW界面美化-整改文档 (2).md`、`任务列表面板组件-开发文档.md`、`权限询问卡片组件-开发文档.md`、`询问卡片组件-开发文档.md` | `docs/archive/ui/` |
| `DEGRADED.md`（已过时） | `docs/archive/DEGRADED.md` |
| `mafw-dashboard-prototype.html` | `docs/archive/prototypes/` |
| `context_diff.py`、`get_gold_sessions.py`、`record_regression.py`、`test_scan_3questions.py` | `evaluation/longmemeval/scripts/` |

保留根目录：`AGENTS.md`、`AGENTS.md.runtime`（活文档）、`README.md`、`LICENSE`、`package*.json`、`tsconfig.json`、`jest.config.js`、`opencode.json.example`、`.gitignore`、`.npmignore`。

### 2. 出仓与删除（`git rm`）

- 运行时数据/垃圾：`.mafw/logs/mafw.log`、`Usersm24.mafwmemorygateway.db`、`scheduler/registered-projects.json`、`tools/css_block_delete.py`（一次性脚本）
- 打包产物：`opencode-plugin-mafw-4.1.0.tgz`、`langchain-mcp-adapters-0.6.0.tgz`
- legacy 前端：`frontend/` 整目录（35 个文件，零引用已验证；git 历史可找回）
- 构建产物：`gateway/src/**/*.d.ts` 与 `gateway/src/**/*.js.map` 中被跟踪的 47 个文件、`gateway/src/src/` 嵌套构建输出目录

### 3. 防复发与验证

`.gitignore` 增补：

```gitignore
# 构建产物（tsc 就地输出事故防复发）
gateway/src/**/*.d.ts
gateway/src/**/*.js.map
gateway/src/src/

# 运行时数据
scheduler/
*.db
```

（`*.tgz`、`.mafw/` 已有规则；被跟踪文件移除后即生效。）

**不动的**：`mobile/`（在役）、`gateway/` 内部结构、`packages/`、`src/`、`evaluation/` 本体、`docs/` 现有结构。

**AGENTS.md 同步**：检查 §6.4 等处是否引用被移动文件路径，如有则更新；无则不动。

**验证**：`npm run build` 通过 + 全量 jest 测试通过（按用户偏好汇报新增测试数与全量通过数；本次纯移动/删除，预期新增 0 个测试）。

### 4. Commit 划分（3 个，便于独立回滚）

1. `chore(repo): archive historical docs + relocate eval debug scripts`（第 1 节全部 git mv）
2. `chore(repo): untrack runtime data, pack artifacts and legacy frontend`（第 2 节 git rm）
3. `chore(gateway): untrack tsc build artifacts from source tree`（构建产物 + .gitignore 增补 + 构建/测试验证）

## 风险与回滚

- 全部为 `git mv`/`git rm`，历史完整保留，任何一步可 `git revert` 单独回滚。
- `frontend/` 删除前已验证零引用；若后续发现遗漏引用，从 git 历史恢复即可。
- 构建产物出仓后需确认 `npm run build` 不依赖这些文件（它们是 tsc 输出，应为纯产物）。
