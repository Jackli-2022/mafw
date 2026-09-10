# 仓库根目录中度整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理仓库根目录 38 个杂项文件、gateway/src 构建产物，归档历史文档，删除零引用 legacy 前端，并补 .gitignore 防复发。

**Architecture:** 纯 `git mv` / `git rm` 操作，分 3 个独立可回滚 commit：①文档归档与脚本归位 ②垃圾/运行时数据/legacy 前端出仓 ③构建产物出仓 + .gitignore 防复发 + 构建与全量测试验证。不改任何活代码。

**Tech Stack:** git（Windows PowerShell 环境）、npm/tsc 构建、jest 测试。

## Global Constraints

- 平台 Windows，shell 为 PowerShell 5.1；所有命令须在仓库根 `C:\work\work-loop\opencode-plugin-mafw` 执行
- **不动**：`mobile/`（在役 Flutter 客户端，配套 `gateway/src/mobile/` 活端点）、`gateway/src/dashboard/public/`（dashboard server 构建期拷贝源）、`gateway/src/core/types/*.d.ts` 与 `gateway/src/types/sdk.d.ts`（**手写声明文件**，无 `.ts`  sibling，删除会破坏构建）
- 规格文档：`docs/superpowers/specs/2026-09-10-repo-cleanup-design.md`
- 本次纯移动/删除，预期新增测试 0 个；完成后须汇报全量测试通过数
- 文件名含中文与空格/括号，所有路径必须引号包裹

---

### Task 1: 历史文档归档 + 调试脚本归位

**Files:**
- Create: `docs/archive/architecture/`、`docs/archive/ui/`、`docs/archive/prototypes/`、`evaluation/longmemeval/scripts/`（目录，经 git mv 自动创建）
- Modify: 无代码改动
- Move: 根目录 19 份 md + 1 份 html + 4 个 py（见下方命令）

**Interfaces:**
- Consumes: 无
- Produces: `docs/archive/{architecture,ui,prototypes}/`、`evaluation/longmemeval/scripts/` 供 Task 3 验证引用完整性

- [ ] **Step 1: 创建目标目录并 git mv 架构文档**

```powershell
New-Item -ItemType Directory -Force docs/archive/architecture, docs/archive/ui, docs/archive/prototypes, evaluation/longmemeval/scripts | Out-Null
git mv mafw_6.0.md mafw_6.3.md mafw_6.4.md mafw_6.6.md mafw_6.7.md mafw_6.8.md MAFW_Architecture_Detailed_v5.0.md MAFW_Architecture_v4.1_FINAL.md MAFW_Memory_Tools_v5.0.md docs/archive/architecture/
git mv "MAFW v7 架构：OKF × Memora（v6.8 已实施基线）.md" docs/archive/architecture/
```

- [ ] **Step 2: git mv UI 文档与 DEGRADED.md、原型 html**

```powershell
git mv "MAFW界面美化-开发文档.md" "MAFW界面美化-开发文档 (1).md" "MAFW界面美化-开发文档 (3).md" "MAFW界面美化-整改文档.md" "MAFW界面美化-整改文档 (2).md" "任务列表面板组件-开发文档.md" "权限询问卡片组件-开发文档.md" "询问卡片组件-开发文档.md" docs/archive/ui/
git mv DEGRADED.md docs/archive/DEGRADED.md
git mv mafw-dashboard-prototype.html docs/archive/prototypes/
```

- [ ] **Step 3: git mv Python 调试脚本**

```powershell
git mv context_diff.py get_gold_sessions.py record_regression.py test_scan_3questions.py evaluation/longmemeval/scripts/
```

- [ ] **Step 4: 验证移动结果**

```powershell
git status --short
```

Expected: 全部显示为 `R`（rename）条目，共 25 个文件；根目录不再含上述文件。

- [ ] **Step 5: 验证无残留引用**

```powershell
Select-String -Path AGENTS.md,README.md,package.json,gateway/package.json,jest.config.js -Pattern 'DEGRADED|mafw_6\.|MAFW_Architecture|界面美化|开发文档|dashboard-prototype|context_diff|get_gold_sessions|record_regression|test_scan' 
```

Expected: 无输出（已预先验证零引用，此为复核）。

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "chore(repo): archive historical docs + relocate eval debug scripts"
```

---

### Task 2: 运行时数据/打包产物/legacy 前端出仓

**Files:**
- Delete: `.mafw/logs/mafw.log`、`Usersm24.mafwmemorygateway.db`、`scheduler/registered-projects.json`、`tools/css_block_delete.py`、`opencode-plugin-mafw-4.1.0.tgz`、`langchain-mcp-adapters-0.6.0.tgz`、`frontend/`（35 文件）

**Interfaces:**
- Consumes: 无（与 Task 1 独立）
- Produces: `scheduler/`、`tools/` 目录变空并被移除；`frontend/` 从工作区消失

- [ ] **Step 1: git rm 杂项文件**

```powershell
git rm ".mafw/logs/mafw.log" "Usersm24.mafwmemorygateway.db" "scheduler/registered-projects.json" "tools/css_block_delete.py" "opencode-plugin-mafw-4.1.0.tgz" "langchain-mcp-adapters-0.6.0.tgz"
```

- [ ] **Step 2: git rm legacy 前端**

```powershell
git rm -r frontend/
```

Expected: 输出 35 个 `rm 'frontend/...'` 行。

- [ ] **Step 3: 清理空目录并验证**

```powershell
Remove-Item -Recurse -Force tools, scheduler -ErrorAction SilentlyContinue
git status --short
```

Expected: 全部 `D` 条目；`tools/`、`scheduler/`、`frontend/` 不再存在于工作区。

- [ ] **Step 4: 复核 frontend 零引用（删除前已验证，此为删除后确认构建配置无残留引用）**

```powershell
Select-String -Path package.json,gateway/package.json,jest.config.js,tsconfig.json,gateway/tsconfig.json -Pattern 'frontend'
```

Expected: 无输出。

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "chore(repo): untrack runtime data, pack artifacts and legacy frontend"
```

---

### Task 3: 构建产物出仓 + .gitignore 防复发 + 全量验证

**Files:**
- Delete: `gateway/src/src/`（3 文件）、`gateway/src/` 下 42 个生成的 `.d.ts`/`.d.ts.map`/`.js.map`（清单见 Step 1）
- Modify: `.gitignore`（追加防复发规则）

**Interfaces:**
- Consumes: Task 1/2 的清理结果
- Produces: 干净的 `gateway/src/` 源码树；更新的 `.gitignore`

**保留白名单（不得删除）**：`gateway/src/core/types/compression.d.ts`、`config.d.ts`、`parametric.d.ts`、`state.d.ts`、`gateway/src/types/sdk.d.ts`（手写，无 `.ts` sibling）

- [ ] **Step 1: 用确定性守卫删除生成产物（仅当有同名 .ts sibling 或是 map 文件）**

```powershell
# map 文件全是生成物
git ls-files gateway/src | Where-Object { $_ -match '\.(js\.map|d\.ts\.map)$' } | ForEach-Object { git rm -q $_ }
# .d.ts 仅当存在同名 .ts sibling 时删除（保护 types/ 下手写声明）
git ls-files gateway/src | Where-Object { $_ -match '\.d\.ts$' } | ForEach-Object {
  $sibling = $_ -replace '\.d\.ts$', '.ts'
  if (git ls-files --error-unmatch $sibling 2>$null) { git rm -q $_ } else { Write-Output "KEEP (hand-written): $_" }
}
git rm -r -q gateway/src/src/
```

Expected: 输出恰好 5 行 `KEEP (hand-written):`（core/types 4 个 + types/sdk.d.ts）；共删除 42 个产物文件 + gateway/src/src/ 3 个文件。

- [ ] **Step 2: 追加 .gitignore 防复发规则**

在 `.gitignore` 末尾追加：

```gitignore

# tsc in-place compile 事故产物（types/ 下手写声明文件经 negation 保留）
gateway/src/**/*.d.ts
!gateway/src/**/types/*.d.ts
gateway/src/**/*.d.ts.map
gateway/src/**/*.js.map
gateway/src/src/

# 运行时数据
scheduler/
*.db
```

- [ ] **Step 3: 验证 gitignore 生效且未误伤白名单**

```powershell
git check-ignore gateway/src/index.d.ts; git check-ignore gateway/src/types/sdk.d.ts
```

Expected: 第一行输出路径（被 ignore），第二条命令无输出（白名单生效）。

- [ ] **Step 4: 构建验证**

```powershell
npm run build
```

Expected: exit 0；`dist/` 与 `gateway/dist/` 正常产出；gateway build 末尾 `[copy] ...dist\dashboard\public` 日志出现。

- [ ] **Step 5: 全量测试**

```powershell
npx jest
```

Expected: 全部测试通过（与清理前基线一致；本次新增测试 0 个）。若个别测试因环境（如 kernel 集成）在本机本就失败，与 `git stash` 前的基线对比确认无新增失败。

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "chore(gateway): untrack tsc build artifacts from source tree"
```

---

## Self-Review 记录

- **Spec 覆盖**：spec §1（归档归位）→ Task 1；§2（出仓删除）→ Task 2 + Task 3 构建产物部分；§3（防复发+验证）→ Task 3 Step 2-5；§4（3 commit）→ 每 Task 末尾各 1 commit。全覆盖。
- **Placeholder 扫描**：无 TBD/TODO；所有命令为完整可执行 PowerShell。
- **一致性**：Task 3 Step 1 的白名单与 Global Constraints 一致（5 个手写 .d.ts）；`gateway/src/dashboard/public/` 明确保留（构建拷贝源）。
- **类型/路径**：所有路径经 `git ls-files` 实际核对存在。
