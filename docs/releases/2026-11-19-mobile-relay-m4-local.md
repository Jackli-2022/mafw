# 2026-11-19 · Mobile Relay M4（本地：SQLite + 容器）

- **分支**：`main`
- **提交**：`6bd79608a`（SQLite room claim）、`687161098`（Docker/compose/Caddy）
- **范围**：`packages/relay` 的持久化、容器/反代配置、运维文档；未部署 443
- **前置**：M1 core、M2 gateway client、M3 mobile 双端点

## 交付

- **SQLite room claim**：新增 `RoomStore` / `MemoryRoomStore` / `SqliteRoomStore`；
  使用 Node 内置 `node:sqlite`（Node 22.5+，镜像用 Node 24），没有原生依赖。
  `RoomRegistry` 可注入 store，claim/authenticate/attach/detach/release 都会持久化；
  `close()` 后迟到的 WS 事件不会写已关闭的 DB。
- **Relay server**：`createRelayServer({ dbPath })`；未传 dbPath 仍为内存（测试）；
  `RELAY_DB` 环境变量启用持久化；server stop 时关闭自己创建的 store。
- **Docker**：`packages/relay/Dockerfile`（多阶段、非 root、/data volume）、
  `docker-compose.yml`（443 raw / 8444 control / 127.0.0.1:8080 health + healthcheck）。
- **Caddy**：`Caddyfile` 在 8443 终止 control TLS 并反代 `relay:8444`，`auto_https off`
  （443 必须留给裸 TLS；证书由 operator 提供）。
- **文档**：`packages/relay/README.md`、`docs/guides/operations.md` 自建 relay 段。

## 验证

- `npm run test -w @mafw/relay` → **29/29 pass**（含 SQLite 重启恢复、server 重启 claim、
  首连 claim、SNI/router/quota）。
- `npm run build -w @mafw/relay` rc=0。
- `npm run test:e2e -w @mafw/relay` → **PASS**（M1 relay + M2 gateway + 真实 TLS/指纹）。
- 本机**没有 Docker**，Dockerfile/compose/Caddy 未实际构建；仅静态配置，部署前需在服务器
  上 `docker compose config` + 起容器验证。

## 限制 / 下一步

- `Quota` 已单测但尚未接入 byte path；先观察官方实例真实流量再接限速。
- 没有 `/metrics`；目前只有 `/health`。
- 腾讯云 443 部署等 ICP 备案；备案前只本地 9443/9444 验证。
- 手机真机 relay pinning 仍未验收（M3 遗留）。
