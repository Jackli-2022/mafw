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

- **配对**：`orcalore://pair?url&token&v&exp&nonce` 一次性、TTL 300s、5/min/IP 限频、nonce 哈希存储（2026-11-06 改名；旧 `mafw://pair` 仅历史）
- **连接**：Tailscale 优先（https/wss）> LAN http（仅 192.168/10.x 放行）> 手动；`MAFW_SERVER_API_TOKEN` 三通道鉴权（Bearer/x-api-token/?token）
- **发现（P1）**：网关 `bonjour-service` 广播 `_mafw._tcp`（TXT 含 port/auth）；App `multicast_dns` 扫描，配对页自动列出同网网关
- **配对 URL 自动探测**：网关按 环境变量 `MAFW_MOBILE_TAILSCALE_URL` > Tailscale IP > LAN IP > 127.0.0.1 生成，杜绝“手机连自己 localhost”

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
Invoke-WebRequest http://127.0.0.1:3000/api/mobile/pairing-code
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

> token 值：`MAFW_SERVER_API_TOKEN`（网关 config）或 `GET /api/mobile/pairing-code` 返回的 `token` 字段。

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

- **事件回放**：SSE 支持 `Last-Event-ID`/`?since`；**移动端 WS 无回放**——重连后必须 refetch（Plan B Task 5 的 `onReconnected` 信号，缺失即「事件凭空丢失」类 bug 的根因）；
- **配对**：`GET /api/mobile/pairing-code` 生成的 URL 必须含 `orcalore://pair`（改名后）且 host 不是 `127.0.0.1`；`POST /api/mobile/pairing/verify` 404/400 = nonce 过期或已消费。

### 7.6 故障速查（v1 场景补充）

| 现象 | 排查 |
|---|---|
| `401 unauthorized`（远端） | `server.apiToken` 未设（空 token 远端全拒）或 App token 不匹配；配对码 token 取自生成时刻配置——改 token 后必须重新配对 |
| `CLEARTEXT communication not permitted` | `network_security_config.xml` 未含 `ts.net` 域；或用了裸 `100.x` IP（域条目只匹配主机名 → 改用 MagicDNS 主机名） |
| `SocketException` / 连接拒绝 | 手机 Tailscale 未连/被省电杀掉；MagicDNS 解析失败（「Use Tailscale DNS」关闭）；gateway 未启动（`mafw status`） |
| 扫码无反应 | 深链 scheme 不匹配（`orcalore://` vs 旧 `mafw://`）；nonce 过期（5min）或已被消费 |
| 事件不驱动 UI | 调试面板看帧是否到达 + 解析判定；seq gap（重连）→ refetch；`pod.event` 无 projectId → 按当前项目反查归属 |
| 「upgrade gateway」错误 | 历史 flat DTO 全解析失败——gateway 版本过旧或中间代理改写了响应 |
| WS 反复断 | Tailscale 网络抖动（退避表 1/2/5/10/15/30s）；v1 明确不做后台常驻，息屏断连是预期 |
| 讨论页 409 | revision 已终态（预期）→ 显示归档 transcript；plan-approval 409 `stale_plan` → 重拉计划 |
| appId 改名后旧数据丢失 | 换 appId = 全新应用：`adb uninstall ai.mafw.mafw_mobile` 后装 `ai.orcalore.mobile`，重新扫码配对（pre-release 预期） |

### 7.7 调试门禁（每个任务）

- TDD 门禁不变：`flutter analyze` 零告警 + `flutter test` 全绿；
- P1 起每阶段末按 Plan B「阶段末真机冒烟」执行；调试面板导出的诊断包可存档 `.mafw/qa/` 供复盘。

---

## 8. 已知待办（roadmap）

- **P2** Tailscale DNS 自动检测：App 启动探测 `*.ts.net` 可达性，自动切换 Tailscale/局域网，真机免填 baseUrl
- **P3** FCM 中继 + 后台推送：需真实 `google-services.json` + OAuth2 service account（spec 标 v2 / WS-only beta）
- 桌面端（Windows/web）运行：部分移动插件缺失，如要支持需加条件编译/桌面适配
