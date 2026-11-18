# Orcalore Mobile（Android）开发与调测指南

> 面向：无真机/有真机两种场景下的移动端开发、调试与连通性排查。
> 涉及：`mobile/`（Flutter 工程）、`gateway/src/mobile/*`（配对/推送/媒体代理/mDNS）。
> 2026-11-06 品牌修订：产品名 **Orcalore**；appId `ai.orcalore.mobile`、深链 `orcalore://pair`、pubspec `orcalore_mobile`（旧 `ai.mafw.mafw_mobile` / `mafw://pair` 仅存在于历史记录）。

---

## 1. 环境准备

Flutter 引擎固定在 `C:\dev\flutter\bin`（`mobile/build-apk.bat` 已配好 JDK17 + Android SDK 路径）：

```bash
# 统一注入环境（所有 flutter/adb 命令都建议带这套 PATH）
set JAVA_HOME=C:\dev\jdk17\jdk-17.0.20+8
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
set PATH=C:\dev\flutter\bin;C:\Program Files\Git\cmd;C:\Windows\System32;%PATH%

# 依赖 / 检查
cd mobile
flutter pub get
flutter doctor        # 确认 Flutter/Android toolchain
flutter devices       # 列出可运行目标（Windows/Chrome/Edge/模拟器/真机）
```

> 注意：`flutter` 不在系统 PATH，PowerShell 直接敲 `flutter` 会报“不是内部或外部命令”。必须显式带上 `C:\dev\flutter\bin`。

## 2. 无手机调测的三条路径

### 路径 A：安卓模拟器（最接近真机，推荐）

本机已预装 **Pixel 9a AVD**（`~/.android/avd/Pixel_9a.avd`）。

```bash
# 启动模拟器
flutter emulators --launch Pixel_9a
adb wait-for-device

# 部署 + 运行 + 热重载（r=重载 R=重启 q=退出）
cd mobile && flutter run -d emulator-5554

# 脱离调试直接安装运行
flutter install -d emulator-5554
adb shell am start -n ai.mafw.mafw_mobile/.MainActivity
```

**关键：模拟器 → 宿主机网关（3000）的三种可达方式**

| 方式 | 地址 | 场景 |
|---|---|---|
| `adb reverse tcp:3000 tcp:3000` | `http://127.0.0.1:3000` | **推荐**，最省事，绕开网络发现 |
| 模拟器专用网关 | `http://10.0.2.2:3000` | 模拟器访问宿主机 LAN 的标准别名 |
| Tailscale IP | `http://100.99.122.83:3000` | 模拟器也接入同一 tailnet 时 |

### 路径 B：Flutter Windows/Web 桌面目标（无模拟器也能跑）

`flutter devices` 已识别 `Windows (desktop)` 与 `Chrome (web)`，可在本机直接跑业务逻辑：

```bash
cd mobile
flutter run -d windows    # 原生窗口（热重载最快）
flutter run -d chrome     # 浏览器（mobile_scanner 支持 web）
```

**局限**：本项目的移动专属插件在桌面端会降级/缺失 —— `mobile_scanner` 不支持 Windows；`firebase_messaging`/`workmanager` 在桌面仅占位。桌面端只适合测**业务逻辑、网关 HTTP/WS 连接、配对码解析、UI 布局**，不适合测扫码/推送/后台真实行为。

### 路径 C：云真机（发布前回归）

Firebase Test Lab / BrowserStack / AWS Device Farm 上传 APK 跑真机矩阵；`Gradle Managed Devices` 供 CI 自动拉起虚拟设备跑 instrumented test。业界共识：单元/UI 逻辑 70-80% 用模拟器，性能/硬件/OEM 适配发布前用真机。

---

## 3. 本工程连通性架构（截至 2026-08）

```
[Android App: Flutter]
  Dart: GatewayClient/WsClient/SecureConfigStore/SessionCache
  Platform Channel: FCM, WorkManager, 扫码, 录音/播放, 压缩
        ↕  Tailscale / LAN / adb reverse
[Gateway 3000] — /api/mobile/* + mDNS(_mafw._tcp) + WS /api/ws
```

- **配对**：`v=2` 链接为 `orcalore://pair?url&v=2&exp&nonce`（无凭据）；App 以稳定 `deviceId`（SharedPreferences `mafw_device_id`，32 hex）调 `POST /api/mobile/pairing/verify` 换可撤销设备 token（`dev_…`）并存 `ConnectionConfig`；`v=1` 旧链接仍解析并要求内嵌 `token`（手动 url+token 回退同样保留）。一次性、TTL 300s、5/min/IP 限频、nonce 哈希存储（2026-11-06 改名；旧 `mafw://pair` 仅历史）。重配对（本地已有任一 token，与 baseUrl 无关）带 `rotate:true`；WorkManager 后台明文副本（`mafw_bg_*`）在保存时同步为同一设备 token。`GET /api/mobile/pairing-code` 是 **human-only**（desktop/TUI 带 human token；service/local → 403），否则可铸 nonce 再换设备 token 越权。
- **连接**：Tailscale 优先（https/wss）> LAN http（仅 192.168/10.x 放行）> 手动；`MAFW_SERVER_API_TOKEN` 三通道鉴权（Bearer/x-api-token/?token）；human-only 动作需设备/人类凭据，旧共享 token 仅能普通 API（E5a）
- **发现（P1）**：网关 `bonjour-service` 广播 `_mafw._tcp`（TXT 含 port/auth）；App `multicast_dns` 扫描，配对页自动列出同网网关
- **配对 URL 自动探测**：网关按 环境变量 `MAFW_MOBILE_TAILSCALE_URL` > Tailscale IP > LAN IP > 127.0.0.1 生成，杜绝“手机连自己 localhost”
- **远程配对（P0，2026-11-18）**：`mafw pair --remote` 在 gateway 内启动 **Cloudflare Quick Tunnel**
  （出站，无入站端口/域名/Tailscale），解析 `https://<random>.trycloudflare.com` 后临时覆盖
  `PairingService` 的 base URL；`mafw pair` 打印一次性 `orcalore://pair?...` 链接并生成
  `~/.mafw/pair-qr.png`。手机扫码后仍走 pairing v2（nonce → device token）。`mafw pair --stop`
  关闭隧道并恢复配置的 LAN/Tailscale URL。`/api/mobile/remote-access` 的 start/stop/status
  全部 human-only。

---

## 4. 本次根因与修复记录（2026-08 调测）

| 症状 | 根因 | 修复 commit |
|---|---|---|
| 点击设置/扫码无反应（实际崩溃） | `_MafwMobileAppState` 的 `Navigator.of(context)` —— State context 在 `MaterialApp` 之上，找不到内部的 `Navigator`，抛 `Unhandled Exception: Navigator operation...` | `fd050c7a` 改用 `GlobalKey<NavigatorState>` + `MaterialApp(navigatorKey:)` |
| 启动 `HiveError: need to initialize Hive` | `SessionCache.init()` 打开 box 前未调 `Hive.init()` | `b8a7fafe` 在 `main()` 里 `Hive.init((await getApplicationDocumentsDirectory()).path)` |
| 连不上网关 | App 存储的 baseUrl 是旧默认 `http://192.168.1.100:3000`（模拟器/真机都不可达） | 用 `adb reverse` + 写入正确地址（见 §5） |
| 配对 URL 是 `http://localhost:3000` | 网关默认 `tailscaleUrl = localhost`，手机连的是自己 | `2e06348b` 自动探测真实 IP |
| 旧版 `workmanager 0.5.2` 编不过 | 用废弃 v1 embedding API | `43664ac1` 升级 0.10.7 + API 迁移 |

**排查手法（可复用）**：

```bash
# 1. 实时日志（flutter run 时 / 脱离后）
adb logcat -s flutter            # 只看 Flutter/Dart 层
adb logcat *:E                   # 崩溃堆栈

# 2. 抓一次完整启动日志
adb logcat -c && adb logcat > mafw.log &
adb shell am force-stop ai.mafw.mafw_mobile
adb shell am start -n ai.mafw.mafw_mobile/.MainActivity
# ... 复现后 Ctrl+C，grep mafw.log

# 3. 连通性从底层往上验
adb shell ping 10.0.2.2              # 模拟器→宿主机 通？
adb reverse --list                   # reverse 是否建立
# 宿主侧：网关是否监听 0.0.0.0:3000
netstat -ano | findstr ":3000"
# 网关 API 是否正常
Invoke-WebRequest http://127.0.0.1:3000/health
# pairing-code 是 human-only：带上 human token（desktop/TUI 自动带）
Invoke-WebRequest -Headers @{'X-MAFW-Human-Token'=(Get-Content "$env:USERPROFILE\.mafw\human.token")} http://127.0.0.1:3000/api/mobile/pairing-code
```

---

## 5. 模拟器连通宿主机网关的标准流程

```bash
# 1) 启动模拟器并等待
flutter emulators --launch Pixel_9a
adb wait-for-device

# 2) 反向映射宿主机 3000 → 模拟器 127.0.0.1:3000（一次性，模拟器重启需重做）
adb reverse tcp:3000 tcp:3000
adb reverse --list          # 确认: host-xx tcp:3000 tcp:3000

# 3) 写入正确 baseUrl + token 到 App 存储（模拟器 debug 包可用 run-as）
#    包名：ai.orcalore.mobile（2026-11-06 改名后；旧 ai.mafw.mafw_mobile 仅历史）
#    文件: /data/data/ai.orcalore.mobile/shared_prefs/FlutterSharedPreferences.xml
#    flutter.mafw_conn_base_url = http://127.0.0.1:3000
#    flutter.mafw_bg_api_token  = <MAFW_SERVER_API_TOKEN 值>
adb push prefs.xml /data/local/tmp/prefs.xml
adb shell run-as ai.orcalore.mobile cp /data/local/tmp/prefs.xml \
  /data/data/ai.orcalore.mobile/shared_prefs/FlutterSharedPreferences.xml

# 4) 重启 App 生效（SharedPreferences 有内存缓存）
adb shell am force-stop ai.orcalore.mobile
adb shell am start -n ai.orcalore.mobile/.MainActivity

# 5) 截图确认（无红色横幅 + 出现会话列表 = 连通成功）
adb exec-out screencap -p > screen.png
```

> token 值：`MAFW_SERVER_API_TOKEN`（网关 config，旧共享 token）。E5a 起 `GET /api/mobile/pairing-code` 只返回 `orcalore://pair?url&v=2&exp&nonce`（不再带 token）——扫码后由 `/api/mobile/pairing/verify` 发放设备 token；手工注入时也可填一个已签发的 `dev_…` token。

---

## 6. 常见问题速查

| 现象 | 处理 |
|---|---|
| 按钮点了没反应（日志无报错） | 检查是不是 `Navigator.of(context)` 在 State 层 —— 改用 `navigatorKey` |
| 一直转圈不消失 | 启动时 `Firebase.initializeApp()` 被占位 `google-services.json` 阻塞 → 已 catchError 降级；若复现查 `adb logcat -s flutter` |
| 红色横幅只在后台显示 | 横幅绑定 `_wsConnected` 会被生命周期 disconnect 干扰（已回退该屏蔽）；以真实 WS 状态为准 |
| 扫码后连不上 | 确认配对 URL 非 `localhost`；模拟器用 `adb reverse` 或 `10.0.2.2`；真机用 Tailscale/LAN IP |
| `flutter` 不是命令 | 显式加 `C:\dev\flutter\bin` 到 PATH |
| Firebase 相关报错 | 占位 `google-services.json` → FCM 不可用但 WS/配对/媒体/TTS 正常（预期） |
| mDNS 扫不到 | 确认网关已重启（`[mDNS] advertising _mafw._tcp` 日志）；模拟器与宿主须在同一网络/或 adb reverse 后手动填 |

---

## 7. 调试与排障（Orcalore Mobile v1）

### 7.1 分层调试策略（先问在哪一层复现）

| 层 | 工具 | 适用 | 限制 |
|---|---|---|---|
| 纯逻辑/协议 | `flutter test`（unit/widget）+ fixture 回放 | 解析、状态机、SendRouter、事件效果表 | — |
| 本机快速循环 | `flutter run -d windows` / `-d chrome` | 业务逻辑、布局、HTTP/WS 连接、配对码解析 | scanner/FCM/workmanager 缺失 |
| 模拟器 | Pixel 9a AVD + `adb reverse` | 全插件行为、热重载、扫码（虚拟摄像头） | 网络走 loopback，不覆盖 Tailscale/电池策略 |
| 真机 + Tailscale（目标） | 装 APK + 扫码 | 配对扫码、MagicDNS、真网 WS、Android 网络/电池策略 | 需日志获取手段（§7.4） |

**Fixture 回放约定**：真机/网关问题复现后，用调试面板（§7.2）导出 WS 帧/HTTP 响应，裁剪成 `mobile/test/fixtures/*.json` 写回归测试——**先把手机问题降级成 Dart 单测，再修**（与仓库「一次性备份会被后续迁移覆盖」的教训一致：别只靠手测）。

### 7.2 应用内调试面板（dev-only，Plan B Task 2 落地）

入口：「我的」→ 调试；`kDebugMode` 或 `--dart-define=ORCALORE_DEBUG_PANEL=true` 才显示，release 包默认隐藏。

- **连接诊断卡**：baseUrl（token 掩码）、apiToken 是否存在、WS 状态（连接/退避档位/重连次数/最后帧时间）、`GET /health` 实时探测；
- **事件检查器**：最近 200 帧原始 JSON + 解析判定（canonical / flat / 丢弃原因）+ 命中的效果（`refreshWork` 等）——移动版 EventInspector（桌面对应 Ctrl+Shift+E），Pod/讨论/事件问题的主排查工具；
- **HTTP 日志**：方法/路径/状态/耗时/错误体（最近 100 条，`GatewayClient` 拦截器采集）；
- **一键复制诊断包**：整包 JSON 文本，可直接贴会话/issue；无 USB 场景的日志出口。

数据源必须**注入式**（环形缓冲），widget 测试可喂 fixture 断言渲染，不依赖真实网络。

### 7.3 日志约定

- Dart：`debugPrint('[Orcalore][<subsystem>] ...')`，subsystem ∈ `{ws, http, pair, events, pod, ui}`；release 只保留 warn/error（`kReleaseMode` 门控）；启动日志 `[MAFW]` 随改名统一为 `[Orcalore]`（Dart 内部类名不动）；
- 服务端对照：`mafw logs` / `~/.mafw/logs/mafw.log`；关键前缀 `[SSE] broadcast`、`[PushGateway]`、`[Pod]`、`[Recall] timing`。

### 7.4 真机日志取得（有 USB / 无 USB）

```bash
# USB 实时日志
adb logcat -s flutter                 # Flutter/Dart 层
adb logcat *:E                        # 崩溃堆栈
# 抓完整启动序列
adb logcat -c && adb logcat > orcalore.log &
adb shell am force-stop ai.orcalore.mobile
adb shell am start -n ai.orcalore.mobile/.MainActivity

# Wi-Fi / tailnet（手机先 USB 执行 adb tcpip 5555，之后可拔线）
adb tcpip 5555
adb connect <phone-tailnet-ip>:5555   # 同一 tailnet 即可
adb logcat -s flutter

# 安装（appId 改名后先卸载旧包，否则两个应用并存）
adb uninstall ai.mafw.mafw_mobile
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

**无 USB/无 adb**：用调试面板「复制诊断包」（§7.2）经系统分享发出——这是 v1 真机联调的标准日志出口。

### 7.5 网关侧排查（对照面）

```powershell
# 健康与在线态
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/api/presence
Invoke-RestMethod http://127.0.0.1:3000/api/mobile/devices   # WS 在线设备
# 鉴权二分：loopback 通 + LAN 401 → token 未配/不匹配；LAN 也通 → config 未生效（远端应全拒）
curl.exe -s -o NUL -w "%{http_code}" http://<lan-ip>:3000/health
curl.exe -s -o NUL -w "%{http_code}" -H "Authorization: Bearer <token>" http://<lan-ip>:3000/health
# 日志
mafw logs
```

- **事件回放（E5b，移动端默认恢复路径）**：gateway 的 `GET /api/events/replay?since=&limit=` 按 seq **升序分页**返回 `events` 与 `headSeq/oldestSeq/hasMore/nextSince/reset/truncated`（internal，普通 API 鉴权，不要求 human）。App 用 SharedPreferences 持久化 `mafw_event_seq` + `mafw_event_instance`：
  - **首次连接**：用 `connected` greeting 的 `headSeq` 建立 baseline（不 replay；`instanceId` 一并落盘）；
  - **重连 / 冷启动**：`RecoveryCoordinator` 先 `await EventRecoveryService.recover()` 从持久游标逐页补齐（每页 500，上限 100 页），按 `seq` 去重（`seq <= 游标` 丢弃；recovered 帧经 `WsClientV2.emitRecovered` 回到与 live 相同的 stream，带 `recovered` provenance，Chat / Tech Lead 只用它刷新历史、不驱动当前发送的 `_sending` / `_phase`），**补完之后**才刷新工作 tab 与已打开页面；`main.dart` 在 `recovery.init()` 后复检 `mounted`，已销毁的 State 不再接线；
  - **缺口无法补齐**：`reset` / `truncated` / replay 请求失败 / 旧网关 404·503 / **`hasMore` 页
    `nextSince <= since`（协议违约，E7-5）** → 全量重拉（reset/truncated 把游标钉到 `headSeq`，
    显式 reset 即使 `headSeq` **低于**当前游标也照落——同实例事件日志重启后旧游标属于死 seq 空间，
    只抬不降会无限 reset-loop，E8-4 收口；非 reset 的 live 帧 `observe` 仍单调。
    protocol 违约把游标留在最后已应用 seq，临时失败保留旧游标下次重试）；greeting 的 `instanceId`
    与存档不同 = 事件日志换纪元 → 丢弃游标、按新 head 重建 baseline 并全量重拉（换纪元的 greeting
    不排队：在途 replay 属于旧纪元，直接重建更安全）；
  - **busy greeting（E8-4）**：replay 在途时到达的 greeting 最多挂起**一个**，等在途 recover
    `settled` 后立即重跑一次（replay → refresh）；第二个并发 greeting 冗余、直接丢弃
    （`GatewayReadyResult{busy:true, queued:false}`）。intentional disconnect / 后台交接的 greeting
    仍由 `WsClientV2._notifyGatewayReady` 在入口丢弃，不进入协调器。
  - `part.delta` 等 seq 缺失帧不持久、不推进游标，其丢失仍靠 REST 对账；`onReconnected` 钩子保留但 `main.dart` 已不用（配置 `onGatewayReady` 时被抑制，避免与 `RecoveryCoordinator` 重复恢复）。
  - **已知残留**（E5b 接受，E7-5 已收口 `nextSince<=since` 短缺口，E8-4 已收口同实例 reset 降 head 与 busy greeting 丢弃）：桌面接入 replay 已在 E6 完成。`hasMore` 页不能前进现在是 `protocol` fallback（绝不假报 `recovered`），游标停在最后已应用 seq。
- **配对**：`GET /api/mobile/pairing-code` 是 **human-only**（需 desktop/TUI 的 human token；service/local/旧客户端 → 403 `human_principal_required`），生成的 URL 必须含 `orcalore://pair`（改名后）且 host 不是 `127.0.0.1`；`POST /api/mobile/pairing/verify` 400 = nonce 过期/已消费或 deviceId 越界，404 = 老网关没有该路由（v1 链接 + 手动回退），**409 `device_already_paired`** = 该 `deviceId` 已有凭据但未带 `rotate:true`（重新配对必须显式轮换）。

### 7.6 故障速查（v1 场景补充）

| 现象 | 排查 |
|---|---|
| `401 unauthorized`（远端） | `server.apiToken` 未设（空 token 远端全拒）或只带共享 token；v2 配对后的 App 应改用 `dev_…` 设备 token（`ConnectionConfig.apiToken` 存的就是它）。设备 token 被删除/轮换后旧值立即 401 → 重新扫码配对（带 `rotate:true`） |
| `CLEARTEXT communication not permitted` | 原生网络栈（TTS/ExoPlayer 等）受 NSC 约束：`network_security_config.xml` 的 ts.net 域必须带 `includeSubdomains="true"`（否则子域回落到 base-config），或用的是裸 `100.x` IP（域条目只匹配主机名 → 改用 MagicDNS 主机名）；Dart/`package:http` 请求不走 NSC，公网明文由应用层 `UrlCheck.publicPlaintext` 拒绝 |
| `SocketException` / 连接拒绝 | 手机 Tailscale 未连/被省电杀掉；MagicDNS 解析失败（「Use Tailscale DNS」关闭）；gateway 未启动（`mafw status`） |
| 扫码无反应 | 深链 scheme 不匹配（`orcalore://` vs 旧 `mafw://`）；nonce 过期（5min）或已被消费 |
| 事件不驱动 UI | 调试面板看帧是否到达 + 解析判定；seq gap（重连）→ E5b 先 `replay` 补页，`reset`/`truncated`/失败才 refetch；`pod.event` 无 projectId → 按当前项目反查归属 |
| 「upgrade gateway」错误 | 历史 flat DTO 全解析失败——gateway 版本过旧或中间代理改写了响应 |
| WS 反复断 | Tailscale 网络抖动（退避表 1/2/5/10/15/30s）；v1 明确不做后台常驻，息屏断连是预期 |
| 讨论页 409 | revision 已终态（预期）→ 显示归档 transcript；plan-approval 409 `stale_plan` → 重拉计划 |
| appId 改名后旧数据丢失 | 换 appId = 全新应用：`adb uninstall ai.mafw.mafw_mobile` 后装 `ai.orcalore.mobile`，重新扫码配对（pre-release 预期） |

### 7.7 调试门禁（每个任务）

- TDD 门禁不变：`flutter analyze` 零告警 + `flutter test` 全绿；
- P1 起每阶段末按 Plan B「阶段末真机冒烟」执行；调试面板导出的诊断包可存档 `.mafw/qa/` 供复盘。

### 7.8 模拟器自动冒烟配方（2026-11-09 实证）

目标：无真机时用 AVD + `adb reverse` 让 App 连本机 gateway，并用 adb 驱动 UI/截图做可重复冒烟。

```powershell
# 0) 环境（每段命令都带上）
$env:JAVA_HOME='C:\dev\jdk17\jdk-17.0.20+8'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:PATH="C:\dev\flutter\bin;$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:PATH"

# 1) 启动 AVD 并等 boot
flutter emulators --launch Pixel_9a
adb wait-for-device
# 等 sys.boot_completed=1

# 2) loopback 反代：App 连 127.0.0.1:3000 即到宿主机 gateway
adb reverse tcp:3000 tcp:3000

# 3) 构建 + 安装（appId ai.orcalore.mobile；旧 ai.mafw.mafw_mobile 会并存，建议先卸载）
cd mobile; flutter build apk --debug
adb install -r build/app/outputs/flutter-apk/app-debug.apk

# 4) 免 UI 注入配置（debug 包可 run-as；adb reverse 走 loopback → 无需 apiToken）
adb shell am force-stop ai.orcalore.mobile
adb push orcalore-smoke-prefs.xml /data/local/tmp/orcalore-prefs.xml
adb shell run-as ai.orcalore.mobile mkdir -p /data/data/ai.orcalore.mobile/shared_prefs
adb shell run-as ai.orcalore.mobile cp /data/local/tmp/orcalore-prefs.xml \
  /data/data/ai.orcalore.mobile/shared_prefs/FlutterSharedPreferences.xml
# prefs 内容（SharedPreferences 前缀 flutter.）：
#   flutter.mafw_conn_base_url        = http://127.0.0.1:3000
#   flutter.orcalore_active_project   = <项目绝对路径>

# 5) 免通知弹窗（否则每次启动都会弹 POST_NOTIFICATIONS）
adb shell pm grant ai.orcalore.mobile android.permission.POST_NOTIFICATIONS
adb shell am start -n ai.orcalore.mobile/.MainActivity

# 6) 观察：截图 + UI 树 + 日志
adb shell screencap -p /sdcard/s.png; adb pull /sdcard/s.png s.png
adb shell uiautomator dump /sdcard/ui.xml; adb pull /sdcard/ui.xml ui.xml
# Flutter 文本在 content-desc（多行用 &#10; 连接）；UI 树是单行长 XML，建议按正则取 content-desc+bounds
adb logcat -d --pid=<pid> | Select-String flutter

# 7) 驱动：点击/长按/返回
adb shell input tap <x> <y>
adb shell input swipe <x> <y> <x> <y> 900   # 长按 900ms
adb shell input keyevent 4                    # 返回（root 页再按会退出 App）
```

注意：
- 截图坐标 = 设备像素（Pixel_9a `1080x2424`）；`screencap` 图可能被缩放显示，按 UI 树 bounds 点。
- Flutter 的 `ListView` 语义节点可滚动；长按会话行可验证「交给 Lead」菜单（Lead 会话会被守卫拒绝并提示）。
- 事件检查器里可看到 `connected`、`pod.updated`、`pod.event` 的原始帧与 `seq`——冒烟时让 gateway 产生真实事件（如 `POST /api/pods/:podId/messages`）即可验证 WS 全链。
- App 重启后通知授权可能再次提示（系统策略），用第 5 步 grant 可避免。

### 7.9 会话列表增量（E6-4，2026-11-13）

聊天 tab 的会话列表不再只靠显式动作/重连全量拉取：`SessionsPage` 可选接收 `Stream<MafwEvent>? events`
（`main.dart` 传 `_ws?.events`，WS 重建 → 新 stream → `didUpdateWidget` 重订阅，`dispose` 取消），
事件由纯函数 `lib/src/models/session_list_events.dart#applySessionListEvent(current, event)` 应用。

- **只吃 canonical 内层名**（`MafwEvent.innerType`）：`session.created/updated/deleted`；flat / legacy /
  未知帧原样返回**同一 list 实例**（不重建、不 setState）。
- **`session.updated`**：只 merge `properties.info` 里**存在**的 title/directory/projectID/metadata/
  `time.created` / `time.updated`（缺失字段永不清空，广播补丁是部分的）；不存在该 id 时忽略。
  带**新的 `time.updated`** 的补丁会按 `compareSessionRows`（Lead 先，再 `timeUpdated ??
  timeCreated` newest-first）重排，让刚收到一轮对话的会话冒到顶部；只改标题等字段的补丁保持原顺序
  （E7-5 起 `time.updated` 已建模；旧 gateway 行没有该字段时回退 `timeCreated`）。
- **`session.deleted`**：按 `info.id`（delete 帧可省 info，回退信封 `sessionID`）移除。
- **`session.created`**：要求 `info.id` + 非空 title，替换/追加后按
  `compareSessionRows`（Lead 先、再按最近活动 newest-first；全量拉取与增量插入/重排共用这一比较器）重排；
  不完整 info 返回原列表，页面置 dirty 并**合并 250ms 一次**全量拉取（id-only 幽灵行比延迟更糟；
  信封 `sessionID` 故意不作为 created 的 id 兜底，契约要求 `properties.info.id`）。
- **隐藏会话镜像**：`isHiddenSessionRow` 逐条镜像 gateway `session-visibility.ts#isHiddenSession`
  （非空 `parentID`；标题前缀 `# Memory Index` / `{` / 代码围栏 / `标题：`；agent ∈
  `memory-curator|mafw-tech-lead|mafw-execute|mafw-review`；`metadata.mafw.role` ∈
  `lead|tech-lead|tech_lead`；`manager` 保持可见）。gateway 的 `roleFor` kv 查询不镜像（服务端知识）。
  页面在完整性判定**之前**用同一判定丢弃隐藏 created——这是完整判定，不置 dirty、不触发刷新；
  纯函数侧 `_completeRowOf` 再兜一次，增量列表因此不会与下一次全量拉取不一致。
- **项目范围守卫**：active 项目存在时，`created` 的 `projectID`/`directory`/`event.directory` 若可证明
  属于别的项目 → 直接忽略且不置 dirty；比较规范化 `\`↔`/`、大小写与尾部斜杠；目录未知则交给
  全量刷新判定（不过早过滤）。选择「全部项目」时无过滤。
- **dirty / 在途修正**：dirty 在**拉取开始**时兑现（`_chatDirty = false` + `_chatDirtyGen` 快照），
  事件到达走 `_markChatDirty()` 递增代数；请求结束时若代数变化 → 再排一次合并 250ms 拉取
  （成功/失败路径一致），所以飞行期间新建的话题不会丢。普通父级 rebuild 仍不自动重试——
  离线「不形成重试环」的契约保留。
- **兼容**：`events == null`（旧壳 / 未连接）完全保持「显式动作才拉取」的老行为；未加载时
  `updated/deleted` 直接忽略（进 tab 本来就会全量拉取）。
- 测试：`session_list_events_test.dart` 38（矩阵：update/delete/create/缺字段/隐藏/排序/类型噪声 +
  `time.updated` 建模与重排 8，E7-5）、`sessions_page_test.dart` 11（fake stream：更新不触发全量、
  单次 debounce、项目/路径守卫、`events:null` 旧路径、重订阅、dispose），两文件合计 49。工作 tab
  未改版（已有 `goalId` 局部更新 `WorkRefreshBus.consumeEvent`）；E9-1 起 flat 的
  `pod.updated` / `pod.event` / `run.updated` 也能触达它（§7.10）。

### 7.10 工作 tab 的 flat pod/run 事件保真（E9-1，2026-11-13）

`pod.updated` / `pod.event` / `run.updated` 是 gateway 的**顶层 flat 广播**（`{type, properties}`，
名字同时是 canonical 词汇）。此前 mobile 把它们当未知帧：`MafwEvent.fromJson` 把 `data` 置空、
`shouldRefreshWork` 也不命中 → 工作 tab 收不到刷新信号。

- `kMafwDualShapeEventTypes`（`lib/src/models/mafw_models.dart`）声明这三个名字，并 spread 进
  `kMafwFlatEventTypes`：flat 帧把 `properties` 保留在 `data`；canonical 帧仍走内层 `data`。
  契约零改动——`vocabulary_parity_test.dart` 用「`events.ts` 有序前缀 + 恰好这三个 dual-shape 尾巴」钉住。
- `kWorkRefreshFlatEventTypes`（`event_effects.dart`）纳入同三项 → `shouldRefreshWork` 对 flat 帧
  返回 true（canonical 分支不变）。
- `MafwEvent.goalId` / `podId`：先读 `properties.goalId`，再回退 `data.goalId`（canonical / flat
  两种形状都适用）。flat `pod.updated {properties.goalId}` 因此能命中 `WorkRefreshBus.consumeEvent`
  的按 Goal 局部 patch：只更新该 Goal 卡，不发布刚出现的 queued Goal；无 `goalId`（目前
  `pod.updated` 的多数帧，见 E9-3 won't-do）时沿用整页快照。
- 修复点全在模型与效果表，`WorkTab` / `WorkRefreshBus` 代码零改动；测试直接证明两条路径
  （partial patch / full snapshot）。
- 测试：`event_envelope_test.dart` / `event_effects_test.dart` / `vocabulary_parity_test.dart` /
  `work_tab_test.dart` 合计 64 → 71。

### 7.11 工作 tab 的 work.overview 契约（E10-2，2026-11-13）

gateway 给 `work.overview`（`GET /api/projects/:projectId/work`）加了 200 response schema
（`gateway/src/routes/schemas/work.ts#WorkOverviewResponse`，gateway 侧见 `gateway.md` §「E10 契约覆盖第一批」）。
**mobile 零代码改动**：`lib/src/models/pod_models.dart` 的 `WorkOverview.fromJson` 与 schema 逐字段对齐——

- 只读 `projectDir` / `podId` / `groups{bucket → []}` / `counts{bucket → n}` / `total`，与 schema 的五个
  必填字段一一对应；
- 五个 bucket 名（`needs_you` / `queued` / `in_progress` / `result_ready` / `ended`）来自
  `workBuckets`，schema 按 handler 的严格五桶建模（`groups` 与 `counts` 是同一 `views()` 数组的两个投影，
  handler 不截断）；
- `counts[bucket]` 缺失时用 `groups[bucket].length` 兜底，`rawGroups` / `rawCounts` 里出现**未知 bucket**
  也会被读出来（向前兼容，不丢弃），所以未来加桶不需要先改 mobile；`PodGoalView.fromJson` 只读取它实际
  用到的字段，`PodGoalSchema` 的必填面更宽不影响解析。
- 门禁：`pod_models_test.dart` + `work_tab_test.dart` 51 条与 `dart analyze lib test` 均绿（本波无 mobile
  代码变更，只做契约对齐核对）。
- **E10j §3 won't do（2026-11-16）**：不再为任务 / 消息做**按实体的增量 patch**——work overview 只有
  「整页快照」一个接口，没有按 goal 取 task/message 增量的端点，为局部 patch 造新端点属于新 API 设计。
  现行一致性策略保留：flat 帧带 `goalId` 时局部替换该 Goal 卡，否则（含任务 / 消息变化）由 15s 全量
  轮询兜底（`WorkRefreshBus` 不变）。


---

### 7.12 Triage 渲染对齐真实 wire（E10f-E，2026-11-14）

gateway 的 `triage.list` 200 schema（`gateway/src/routes/schemas/human-gate.ts#TriageItemSchema`，gateway 侧见
`gateway.md` §「E10f 全量读表面收口」）是磁盘 wire 的真形状：`{ id, automationId, discoveredAt, source,
summary, proposedGoal?, state, userAction, deadline, llmSuggestions?, updatedAt? }`。desktop 在 E10b-3 已
改读它，mobile 的 `pages/triage_page.dart` 仍在读 phantom 字段（`reason` / `type` / `kind` / `origin` /
`title` / `name` / `question` / `description` / `detail`）——这些键**没有任何 writer**，恒为空 → 卡片只有
占位文本。E10f-E 收口：

- 新增纯 Dart helper `lib/src/models/triage_card_model.dart`（无 Flutter import，可单测），与 desktop
  `packages/desktop/src/renderer/mafw/triage-model.ts` **同一条链**：
  - `titleOf`：`proposedGoal.title` → `summary.title` → `summary.skillDraft.name` →
    `summary.axiomDraft.name` → `id` → `未命名待决项`（空白串视为缺失）；
  - `metaOf`：`source · <discoveredAt> · 截止 <deadline>`；`localizedTimestamp` 只输出
    `YYYY-MM-DD HH:mm`，缺失 / 不可解析一律返回 `null`（**绝不出现 `Invalid Date`**）；
  - `badgeOf`：真实 `state`（`PENDING_CONFIRMATION` / `CONFIRMED` / `REJECTED` → 待确认 / 已确认 / 已拒绝，
    tone = warn / neutral / danger），并在有 `llmSuggestions` 时只追加**最高优先级**（high > medium > low）
    的一条；未知 state 原样显示 + 中性 tone（不猜、不造 severity）；
  - 页面唯一入口 `triageCardModel(item)`。
- `TriagePage` 不再读上述 phantom 字段：状态 badge 取代 phantom `type` chip，`meta` 取代 phantom 描述行；
  tone → 主题 token（无字面颜色）。
- 测试 `test/triage_card_model_test.dart` **12 例**：proposedGoal 标题、summary 标题、两个 draft name 回退、
  phantom 字段存在时的 `id` 回退、空条目占位、meta 组合、缺日期、不可解析日期、三种 state 标签 / tone、
  未知 state、最高优先级建议、空建议列表。
- 门禁：`flutter test test/triage_card_model_test.dart`（12/12）+ triage 相关四文件 32/32 +
  `dart analyze lib test`（0）。全量 `flutter test` 在负载下会随机报 "did not complete"（并行 / 环境，
  单文件恒过），故以定向门禁为准。

### 7.13 UI 高级化（U 批，2026-11-16）

> 注意：本节的卡片式视觉已被 §7.14 的 Editorial Ink 重做取代；`MafwType` / `MafwSpace` /
> `MafwRadius` 令牌名继续有效。

功能打磨（F 批，commit `61cbbaf2`）之后的一轮纯视觉 / 可达性收口，不改业务契约：

- **令牌化**：`theme.dart` 新增 `MafwType`（6 级字阶）/ `MafwSpace`（4pt 网格）/ `MafwRadius`（8/14/18/999），
  UI 不再散落裸字号与魔数；`onError` 改为黑色（error 红上 5.4:1，cream 只有 3.9:1）。
- **工作 tab**：首屏 loading 由 spinner 换成与 Goal 卡片同构的静态骨架（`work-loading-skeleton`）；
  品牌行 24px Lore + 字标 + 独立语义节点（`container` + `onTap`）的项目 pill；五桶标题改为「小标题 + 计数 + hairline」；
  Goal 卡片用 ink + hairline + 按压态 + chevron，进行中保留唯一 mint 圆点；「需要你」图标加 mint 弱底方框；
  「结果待查看」从纯文本行变为可点的 surface 条；空态改为圆形 ink 徽标 + 居中说明 + 描边 CTA。
- **我的 tab**：顶部加 Lore 40px + `Orcalore` 字标 + 定位语；底部新增「关于」区（`config/app_info.dart`，
  `kAppVersion` 由 `test/theme_tokens_test.dart` 读 `pubspec.yaml` 校验，避免版本漂移）；装饰性入口
  图标统一 `badgeBg` 底 + `dim` 图标（mint 只留给激活态/CTA）。
- **聊天 / 讨论**：composer 改为顶部 hairline 分隔、继承 14dp 输入框圆角、附件/语音降为 dim、发送仍为唯一
  mint CTA；用户气泡加 hairline + 尾角 6dp（`MafwMessageBubble`），assistant 保持全宽文档排版。
- **色彩纪律**：连接设置的 URL 提示（warn → dim，阻断错误 → 主题 error）、Triage / 会话空态、配对页 AppBar
  （`inversePrimary` mint 底 + cream 字 → 真黑）全部回到 token；移动端 `lib` 不再有 `Colors.*` 语义色残留
  （相机 overlay 的 black54/white 与透明色除外）。
- 门禁：新增 **8 例**（主题 5 / 骨架 1 / 我的 1 / 项目 pill 语义 1），主题 23/23、work_tab 35/35、
  tab_shell 8/8、sessions 11/11、pairing 45/45、chat render 6/6、tech lead 12/12、plan 18/18、
  lead entry 13/13、lead handoff 20/20、goal detail 29/29；`flutter analyze` 0。聚合 `flutter test`
  仍有既有 flutter_tester 原生崩溃，逐文件为门禁。

### 7.14 Editorial Ink 视觉重做（2026-11-16）

对照 Grok / Claude / Linear 的公开设计资料后的结论：上一版显丑的根因不是配色，而是
“每个条目都是带边框卡片 + mint 装饰 + 字号层级扁平”。本次把主界面改成编辑式排版：

- **画布 / 令牌**：暖近黑 `#0A0A0B`、ink `#141416`、hairline `#232326`、cream `#F4EFE6`、
  三档中性灰、唯一 mint `#63E6A4`；`MafwType` 6 级字阶（40/28/17/15/12/10）；
  `MafwFonts.serif = InstrumentSerif`（OFL，随包 70KB），中文与正文继续系统 sans。
- **导航**：删除 Material `NavigationBar`，改 `widgets/mafw_bottom_nav.dart`：
  64px、细线图标 19px + 9px 标签 + 激活项 3px mint 点；三个 tab 都不再使用 AppBar / FAB。
- **工作 tab**：masthead = Lore 18 + `ORCALORE` 9px overline + 日期 + 新建＋；40px serif 字标；
  项目名是文字选择器。需要你 = 10px mint overline + 2px mint 竖线 + hairline 行；
  五桶只渲染非空桶，Goal 行无卡片 / 无 chip（title 15 + 一行 meta + 右侧 verdict）；历史折叠为
  `work-history-row` sheet；首屏是 hairline 骨架屏。
- **聊天**：`CHATS` overline + 28px「会话」+ 页头扫码 / 设置 / 新话题；会话列表是无头像的
  hairline 索引（LEAD/SUB 8px mono）；聊天页 composer 顶部 hairline，发送按钮 cream（不再 mint），
  用户气泡 20dp + 6dp 尾角、无边框。
- **我的**：`ORCALORE / PROFILE` + 32px serif 字标；记忆 / 连接 / 关于全部 hairline 行，
  装饰图标 18px dim，无卡片、无 mint 圆底。
- **Goal 详情**：`GOAL` overline + 26px 标题 + 单行 meta；时间线 / 版本 / 结果去掉 Card，
  done 节点改为灰描边勾（不再白实心）；结果 verdict 用 28px serif；需要你槽位改为 mint 竖线。
- **系统 chrome**：`debugShowCheckedModeBanner=false`；`SystemUiOverlayStyle` 把状态栏 / 导航栏
  设为 app 黑底浅色图标。
- 契约更新：work_tab 的“非空桶 / 历史 sheet / 页头新建”、tab_shell 的“无 FAB + 自定义底栏”、
  sessions 的“无头像索引”、goal detail 的“灰描边 done / 单行 meta”均已有测试；
  全量逐文件数字见 `docs/releases/2026-11-16-mobile-editorial-ink.md`。

### 7.15 远程配对：Cloudflare Quick Tunnel（P0，2026-11-18）

目标：没有域名、没有 Tailscale、没有入站端口，也能让手机扫码接入。

- `mafw pair --remote` → gateway `POST /api/mobile/remote-access {enabled:true}` →
  spawn `cloudflared tunnel --url http://127.0.0.1:3001 --no-autoupdate --protocol http2`
  （`3001` = loopback tunnel terminator，见 §7.16）；
  解析随机 `https://*.trycloudflare.com`，临时 `PairingService.setBaseUrlOverride(url)`。
- `GET /api/mobile/pairing-code` 随后返回 `orcalore://pair?url=<tunnel>&v=2&exp&nonce`；
  CLI 生成 `~/.mafw/pair-qr.png` 并打开，手机扫码即可（pairing v2 协议不变）。
- `mafw pair --stop` → `POST {enabled:false}` → kill cloudflared + clear override；配对链接恢复
  到 `MAFW_MOBILE_TAILSCALE_URL` / `mobile.tailscaleUrl` / LAN 探测。
- `mafw pair --status` 查看；`mafw pair`（无 `--remote`）只出本地/LAN 配对码。
- 安全：start/stop/status 全部 human-only；隧道 URL 不是认证，仍靠 5 分钟单次 nonce + 设备 token；
  gateway 不监听公网端口。
- P0 限制：Quick Tunnel 随机 URL、重启变化、无 SSE、200 in-flight、无 uptime 保证；
  MAFW mobile 用 WS，不受 SSE 限制。生产应换 named tunnel + Access 或自建 relay。
- 依赖：`cloudflared` 在 PATH，或 `MAFW_CLOUDFLARED_PATH`。

### 7.16 隧道信任边界（M0，2026-11-18）

修复的漏洞：cloudflared 转发到 `127.0.0.1:3000` 时，gateway 曾把请求判成
`local`（loopback），不需要任何 token。现在：

- cloudflared 只连 loopback terminator `127.0.0.1:3001`（`MAFW_TUNNEL_TERMINATOR_PORT`
  可覆盖）；terminator 先剥离客户端自带的 `x-mafw-tunnel`，再注入进程内随机 secret。
- `resolvePrincipal` 把 marker 或 `cf-connecting-ip` 请求标记为 `tunneled`；没有凭证时
  是 `relay` principal。
- `tunneled` 请求只能走 **method + path 的 mobile allowlist**；带 device token 的 tunneled 请求仍是
  `human`，但仍受 allowlist 限制（不能借设备 token 访问 terminal/python/tools 等桌面面）。
- allowlist 拒绝 `.` / `..` / `%2e` / `%2f` / 反斜杠；未匹配的 tunneled 请求不会落到 runtime
  反代（避免 `/api/mobile/../../api/pty` 这类规范化绕过）。
- 匿名 relay 只允许 `GET /health` 与 `POST /api/mobile/pairing/verify`；其余 API 401。
  匿名 `/health` 只返回 `{status:"ok"}`，不含项目路径 / Goal ID。
- 明确拒绝：设备列表/删除（只允许 `POST /api/mobile/devices/register`）、approvals 规则与 allowlist、
  `goals/control`、session permission-mode/data/revert、非 mobile 的 media upload、terminal / python /
  tools / A2A / cognition / plugins / admin。
- terminal / voice / plugin WS 403；`/api/ws` 必须带 device token。
- 真正的本机 loopback 请求仍是 `local`，行为不变；`tunneled` 是传输标记，不是新的信任级别。

---

## 8. 已知待办（roadmap）

- **P2** Tailscale DNS 自动检测：App 启动探测 `*.ts.net` 可达性，自动切换 Tailscale/局域网，真机免填 baseUrl
- **P3** FCM 中继 + 后台推送：需真实 `google-services.json` + OAuth2 service account（spec 标 v2 / WS-only beta）
- 桌面端（Windows/web）运行：部分移动插件缺失，如要支持需加条件编译/桌面适配

---

## AGENTS.md 归档：Mobile / Tailscale（2026-11-10 迁移）

> 原文搬迁（未改写），保留当时的决策与验证记录。

#### Mobile + Tailscale 接入（2026-11-05 起）

调研：`docs/research/2026-11-05-mobile-tailscale-pod-research.md`（四路盘点 + Tailscale 方案对比 + 三诉求 gap 矩阵）。
设计：`docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`（用户拍板 D1 打开才看无离线推送 / D2 直连 tailnet /
D3 鉴权洞独立先行 / D4 沿用桌面 Goal→Tech Lead 范式 / D5 含「需要你」应答 / D6 UI 参考 Dots+Muse+Grok，配色裁定 B「Grok 单色极简」；**2026-11-06 品牌修订：产品名 Orcalore**——accent 紫→mint `#4FD388`（桌面同款）、ink `#1D1F25`/cream `#FCF8F1` 中性档、工作 tab 顶部品牌行（Lore 20px + Orcalore 字标）、技术标识现在改：applicationId `ai.orcalore.mobile`、pubspec `orcalore_mobile`、深链 `orcalore://pair`（gateway pairing.ts/mobile/Manifest 三处锁步）、FCM 通道 `orcalore_*`；env `MAFW_*` 与信封 `mafw_event`/Dart 内部类名暂留）。
计划：`plans/2026-11-05-mobile-gateway-p0.md`（已执行）+ `plans/2026-11-05-mobile-app-v1.md`（P1-P4 待执行）。

- **Mobile Gateway P0 已交付（commits `527048cf`/`4d360d5f`/`110ab302`/`d8bfc043`/`40e627cf`）**：
  ① `dispatchAuthorized`（`routes/registry-dispatch.ts`）把 registry dispatch 移到 apiToken 鉴权之后——修掉
  「pods/work/协作面 40+ 路由远端无 token 可调」的 P0（真机 LAN 面实测无 token 401、loopback 404 零回归）；
  ② `GOAL_SOURCES` 扩 `mobile`（+ `GoalAuthorization.source` union）；③ `mobile.tailscaleUrl` 配置键
  （env > config > detect，PairingService 热更；`detectReachableHost` 抽到 `mobile/tailscale-url.ts`）；
  ④ `goal.techLeadModel` 可配置（`pod-tech-lead-runtime-adapter.ts` 建会话后 fail-open bindModel，
  lazy getter 热生效——终审 I-1 修复）。测试：P0 新增 **19**；gateway 全量 **4764（603 suites）**、
  `tsc` rc=0。部署：build + deploy:local + daemon 重启，`/health` 200。
  终审（deepseek-v4.1-flash）：0 Critical / 2 Important 已修（lazy getter、`docs/guides/plugin-creator.md`
  安全文档同步）；deferred minors 见计划执行 ledger（workspace 已清理，git 历史为准）。

- **Mobile App v1 已交付（Orcalore，2026-11-09；15 tasks，commits `0bdf2c75`..`b91f08ce` + 品牌/连接/页面全链）**：
  按 `plans/2026-11-05-mobile-app-v1.md` 逐 task TDD 执行（subagent-driven：15 实现 + 15 任务审查 + 7 轮 fix + 2 次终审）。
  P1 品牌基础（MafwPalette mint/ink/cream、`Orcalore` title/label、`ai.orcalore.mobile`、`orcalore_mobile`、Lore 图标）；
  P1 连接收尾（`checkBaseUrl` 分级/`publicPlaintext` 硬拒 + `includeSubdomains` NSC、`orcalore://pair` 三处锁步、WS v2 Bearer header + SmartReconnect 持久化修复、dev-only 诊断面板（HTTP 100/WS 200 环形、`[Orcalore][subsystem]` 日志））；
  P2 工作 tab（品牌行 Lore 20px + Orcalore + 项目切换、需要你置顶/五桶/事件合并刷新/15s 权威轮询、Goal 详情 timeline/revisions/结果/打回）、flat 帧事件 + `shouldRefreshWork` + 跨项目 attention（gateway presence attention 补 podId/projectId `0427f215`）；
  P3 新建讨论（`GoalComposerPage`，objective 按服务端必填）、Tech Lead 讨论页（`SendRouter` 契约：goalBound 永不 enriched；409/空租约→归档 transcript）、Plan 批准（双 hash 绑定、`stale_plan` 提示重拉）、方向裁定/问答（`pendingQuestion` wire DTO `4ac24292` + SDK `6b3f0011`；取消问题二次确认）；
  P4 Lead 入口（`ensureLeadSessionId`→ChatPage.forSessionId）、`isLead`（lead/manager 兼容）、聊天项目过滤、新话题（显式 directory）、交给 Lead handoff（全部 text parts、4000/80 截断、ensure 流）；
  终审修复波（`b91f08ce`）：重连信号多页 refetch（`ConnectionEvents`）、`MafwMessage.displayText` 全 text parts、问答取消二次确认、结果 `markPodEventsSeenAll` 批量已读。
  测试：mobile 逐文件 **385/385**（31 文件；本机聚合跑有既有 `flutter_tester` 原生崩溃，逐文件为门禁）、`flutter analyze` 0；gateway additive pod 473/473 + api-contract 3/3 + `tsc` rc=0；SDK 199/199；desktop `tsgo -p` rc=0（类型兼容核对）。
  版本：`mobile/pubspec.yaml` 1.1.0+2。**未做**：P1-P4 真机 Tailscale 冒烟（需真实手机 + gateway + 桌面）；OS `orcalore://pair` intent 路由（无 app_links，QR 为主路径）；FCM/离线推送（D1 非目标）。

- **模拟器 GUI 冒烟（2026-11-09，commit `cadb20dd`）**：AVD Pixel_9a + `adb reverse tcp:3000` + `run-as` prefs 注入
  （baseUrl/active project；loopback 免 token）+ adb tap/uiautomator/screencap 驱动（配方见
  `docs/architecture/mobile.md` §7.8）。实证通过：工作 tab（品牌行/需要你/结果待看/五桶/Lead 入口）、聊天
  （Lead 徽标+项目过滤+新话题）、我的（记忆/连接/扫码/Triage/调试）、调试面板（WS 已连接、事件检查器、HTTP 日志）、
  Goal 详情（时间线/版本/结果/打回）、终态讨论归档 transcript（409 分支）、Lead 聊天历史、composer、
  长按「交给 Lead」守卫；真实事件 `pod.updated`+`pod.event`（member.note/p3，带 seq）被捕获；
  `markPodEventsSeenAll` 写回使「结果待查看」2→1。**冒烟发现并修复**：work FAB / 调试「复制诊断包」的
  `FloatingActionButton.extended` 被主题 `CircleBorder` 裁成圆（label 溢出）→ 改纯圆 FAB + 列表内按钮
  （`cadb20dd`；`work_tab`/`tab_shell`/`debug_page` 47/47 + analyze 0，重装真机复验）。已知：通知授权每次启动
  可能重弹（`adb shell pm grant ... POST_NOTIFICATIONS` 可规避）；模拟器上残留旧 `ai.mafw.mafw_mobile` 可卸载。

