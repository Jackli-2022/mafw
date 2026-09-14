# GitHub CI 搭建设计

日期：2026-09-14
状态：已批准（用户确认方案 A + 四节设计）
仓库：Jackli-2022/mafw（main，公开，此前无 .github/）

## 目标

为 mafw 仓库搭建 GitHub Actions CI，覆盖三个职责：

1. **验证**：push/PR 时 build + gateway jest + TUI node --test
2. **Desktop 制品**：tag `v*` 时出 Windows（nsis）+ Linux（AppImage/deb/rpm）安装包并挂 draft Release
3. **npm 发布（留接口）**：手动触发，NPM_TOKEN 未配置时优雅 skip

非目标（v1 明确不做）：

- macOS 制品（需 Apple 开发者账号 + 公证 secrets，暂不碰；electron-builder 配置需加 env 开关跳过 notarize 才能出 mac，留待后续）
- desktop typecheck（tsgo）、mobile/（flutter）、evaluation/（需外部 API key）
- root jest（root jest.config.js 是 stale 配置，测试统一走 gateway）
- electron 下载瘦身（root `npm ci` 连带安装 desktop workspace 的 electron ~100MB，缓存后可接受）
- electron-updater 自动更新 feed 的 finalize-latest-json 流程（draft release 人工发布后另行处理）

## 结构：三个独立 workflow（方案 A）

```
.github/workflows/
  ci.yml               # push(main) + PR → 验证
  desktop-release.yml  # tag v* + 手动 → Win/Linux 制品 → draft Release
  npm-publish.yml      # 仅手动 dispatch → npm publish
```

选择理由：触发语义解耦（验证/发布互不牵连），单文件迭代，重跑范围小。
备选方案 B（单 workflow 多 job + if 守卫）被否——触发矩阵纠缠；方案 C（A + composite action
抽象安装）被否——三个 workflow 安装需求各异（verify 不需要 bun/electron-builder），过早抽象。
workflow 数量超过 4-5 个或安装步骤趋同时再演进为 C。

## 1. ci.yml（验证）

- **触发**：`push: branches: [main]` + `pull_request`
- **concurrency**：`ci-${{ github.ref }}`，`cancel-in-progress: true`
- **矩阵**：`os: [ubuntu-latest, windows-latest]` × `node: [22]`
  - Node 22 最新 ≥22.19，满足 TUI engines（type stripping）与 gateway 测试
  - 双 OS 覆盖 Windows 专属路径（taskkill/tray.ps1）的真实回归
- **timeout-minutes**: 45
- **步骤**：
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4`（node 22，`cache: npm`，`cache-dependency-path: package-lock.json`）
  3. `npm ci`（root；安装 root deps + 5 个 workspaces；postinstall 自动给 gateway 装 prod deps）
  4. `npm ci`（working-directory: gateway；gateway 有独立 package-lock.json，补 jest/ts-jest/typescript 等 devDeps）
  5. `npm run build`（plugin tsc + gateway tsc/copy + tui esbuild）
  6. `npm test`（gateway jest --runInBand）
  7. `npm run test:tui`（node --test；smoke 测试默认 skip）
- **已知风险**：AGENTS.md 记载 kernel 集成套件需 `--runInBand --forceExit`（真实内核 +
  zeromq handle 残留阻塞 node 退出），gateway test script 只有 `--runInBand`。实施时先在本机
  全量跑 `npm test` 确认是否挂住；若挂，CI 命令侧改为 `npm test -- --forceExit`（不改 package.json）。

## 2. desktop-release.yml（Desktop 制品）

- **触发**：`push: tags: ['v*']` + `workflow_dispatch`
- **permissions**：`contents: write`（上传 Release 制品）
- **concurrency**：按 tag 名分组，不 cancel（防 tag 推送竞态）
- **矩阵**：`windows-latest`（nsis，x64）+ `ubuntu-latest`（AppImage + deb + rpm，x64）
- **步骤**：
  1. checkout
  2. setup-node@v4（node 22 + npm cache）
  3. `oven-sh/setup-bun@v2`（stage-gateway.ts 是 bun 脚本）
  4. `npm ci`（root）+ `npm ci`（gateway/）
  5. `npm run build`（root——gateway/dist 是 stage-gateway 的硬前置）
  6. `cd packages/desktop && npm run build`（electron-vite 三段构建，含 prebuild bun 脚本）
  7. env `OPENCODE_CHANNEL=prod` + `npm run package:win`（加 `--publish never` 尾参；
     linux 同理）——注意 OPENCODE_CHANNEL 用 step 级 `env:` 块设置（Windows runner 不支持
     bash 内联 `VAR=x cmd` 语法）
     - prod channel：appName "MAFW"、appId ai.mafw.desktop、正式制品名
     - `--publish never`：CLI flag 覆盖 config 里的 GitHub publisher，防止 electron-builder
       自行上传（上传统一由汇总 job 控制）
  8. `actions/upload-artifact@v4`（packages/desktop/dist 下 *.exe/*.AppImage/*.deb/*.rpm/latest.yml 等）
- **汇总 release job**（needs 双平台）：`softprops/action-gh-release@v2` 把两平台制品挂到
  tag 对应的 **draft** release——人工检查后再 publish
- **缓存**：`ELECTRON_CACHE` + `ELECTRON_BUILDER_CACHE`（actions/cache，按 OS 分路径）
- **风险与预案**：
  - `extraResources from: "native/"` 目录在仓库不存在（已验证），electron-builder 可能报错
    → 预案：改 `electron-builder.config.ts`，用 `existsSync` 条件包含该 entry（config 本就是 TS）
  - Windows 上 stage-gateway 的 better-sqlite3 Electron ABI 重构建：prebuild-install 先试
    网络 prebuild，失败回退 node-gyp（GH Windows runner 预装 VS Build Tools + Python）
  - nsis 未签名（与本地构建一致）
  - tag 版本与 desktop/package.json 版本（1.19.0）不强制对齐：release 名用 tag，制品文件名
    含 desktop 版本；spec 在此注明该约定

## 3. npm-publish.yml（留接口）

- **触发**：仅 `workflow_dispatch`
- **permissions**：`contents: read` + `id-token: write`（--provenance 需要）
- **guard step**：`NPM_TOKEN` 为空 → 输出 "skipped: NPM_TOKEN not configured" 并 exit 0
  （workflow 绿但不误发布；token 后补即可启用）
- **步骤**：checkout → setup-node（registry-url: https://registry.npmjs.org）→ `npm ci` ×2 →
  `npm run build` → `npm publish --provenance --access public`（NODE_AUTH_TOKEN）
- 注：`npm publish` 的 `prepare` 钩子会再跑一次 build（npm 自动行为），显式 build 在前只为提前失败
- 后续自动化：改为 tag 触发只需改 `on:` 一行

## 4. 横切约定

- 三个 workflow 均有 `concurrency`；verify cancel-in-progress，release 不 cancel
- Node 22 LTS 全线统一（root engines ≥18 为历史声明，不动）
- 公开仓库 Actions 分钟免费，无成本顾虑
- 安装策略统一：root `npm ci` + gateway/ `npm ci` 两段式（gateway 不是 root workspace 成员，
  node_modules 独立；root postinstall 只装 gateway prod deps，devDeps 由 gateway/ 自己的 npm ci 补全）

## 测试与验证

- workflow 语法：`actionlint`（若本机不可用则以首次真实运行为准）
- 首个验证闭环：push 一个 PR 触发 ci.yml 双 OS 全绿
- desktop-release 首跑用 `workflow_dispatch` 手动触发 + 假 tag（或正式 tag），检查 draft release
  制品完整性与 gateway-bundle 内 better-sqlite3 的 Electron ABI 正确性
- npm-publish 首跑预期输出 "skipped"（无 token）
