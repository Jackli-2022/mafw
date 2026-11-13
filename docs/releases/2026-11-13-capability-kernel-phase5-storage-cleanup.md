# Capability Kernel Phase 5 / Storage Cleanup 交付记录

- 日期：2026-11-13
- 版本：5.1.0（未 bump、未发布）
- 范围：删除未使用的 `StorageBackend` 实现
- 相关：`docs/research/2026-11-13-phase5-remaining-scope.md`

## 交付内容

删除：

- `gateway/src/core/storage/types.ts`
- `gateway/src/core/storage/file-storage.ts`
- `gateway/src/core/storage/sqlite-storage.ts`

原因：

- `StorageBackend` 是 async 接口，`FileStorage` / `SQLiteStorage` 有实现但**没有消费者**。
- gateway 实际使用同步 `better-sqlite3`；把 gateway.db 异步 port 化会破坏 100ms recall。
- 保留死接口会误导后续“存储后端插件”设计。

新增守卫：

- `gateway/tests/unit/architecture/storage-backend-retired.test.ts`
- 断言 `gateway/src/core/storage` 不存在，且源码不再出现 `StorageBackend` / `FileStorage` / `SQLiteStorage` 引用。

## 验证

- gateway 定向：`storage-backend-retired` 1/1 pass。
- gateway 全量：**7141 passed / 1 skipped / 7142 total**（912 suites，`--testTimeout=20000`）。
- gateway typecheck：`npx tsc --noEmit -p tsconfig.json` 退出 0。

## 明确未做

- 不提供通用 storage provider。
- 不迁移 gateway.db / memory 数据。
- `gateway/dist` 与 desktop 打包产物里的旧文件不手工删除；下一次构建会重建。

## Rollback

- 需要恢复时从 git 还原 `gateway/src/core/storage/` 三个文件即可；没有数据迁移或运行时状态。
- 守卫测试会随着文件恢复而失败，需同时删除或调整。

## 关键 commit

- `6b892e1f` chore(storage): remove unused StorageBackend implementation

## Next

Phase 5 剩余：GoalEval hook（可选）。
