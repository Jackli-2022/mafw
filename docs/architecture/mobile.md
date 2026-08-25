# MAFW Mobile（Android）开发与调测指南

> 面向：无真机/有真机两种场景下的移动端开发、调试与连通性排查。
> 涉及：`mobile/`（Flutter 工程）、`gateway/src/mobile/*`（配对/推送/媒体代理/mDNS）。

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

- **配对**：`mafw://pair?url&token&v&exp&nonce` 一次性、TTL 300s、5/min/IP 限频、nonce 哈希存储
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
#    文件: /data/data/ai.mafw.mafw_mobile/shared_prefs/FlutterSharedPreferences.xml
#    flutter.mafw_conn_base_url = http://127.0.0.1:3000
#    flutter.mafw_bg_api_token  = <MAFW_SERVER_API_TOKEN 值>
adb push prefs.xml /data/local/tmp/prefs.xml
adb shell run-as ai.mafw.mafw_mobile cp /data/local/tmp/prefs.xml \
  /data/data/ai.mafw.mafw_mobile/shared_prefs/FlutterSharedPreferences.xml

# 4) 重启 App 生效（SharedPreferences 有内存缓存）
adb shell am force-stop ai.mafw.mafw_mobile
adb shell am start -n ai.mafw.mafw_mobile/.MainActivity

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

## 7. 已知待办（roadmap）

- **P2** Tailscale DNS 自动检测：App 启动探测 `*.ts.net` 可达性，自动切换 Tailscale/局域网，真机免填 baseUrl
- **P3** FCM 中继 + 后台推送：需真实 `google-services.json` + OAuth2 service account（spec 标 v2 / WS-only beta）
- 桌面端（Windows/web）运行：部分移动插件缺失，如要支持需加条件编译/桌面适配
