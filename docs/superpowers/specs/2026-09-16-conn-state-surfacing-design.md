# Gateway 连接状态多界面真实反映设计（指示灯 + 各处占位）

日期：2026-09-16
状态：已批准（对话中用户确认：指示灯+各处占位形态；模块级单例共享信号）

## 背景与问题

连接感知的基础设施已存在且可靠（2026-09-15「gateway 重启前端无感知」批次落地）：

- `connection-state.ts`：四相位状态机 `initial / connected / reconnecting / down`，双信号源（renderer SSE onopen/onerror + main 进程 `mafw-gateway-health` 推送）折叠，转换事件恰好触发一次
- 唯一消费者：`MafwShell.tsx:1262` 的 toast（断开/重连/恢复）；WelcomeHome 初版连接页有自己的断连横幅

**缺口**：相位信息不进任何常驻 UI——Rail、Goals / Usage / Quota / Triage 各 Dock、模型选择器、发送路径在断连时要么转圈、要么静默展示旧数据，用户无从分辨"这是实时数据还是残影"。

## 设计

**1. 共享信号（模块级单例，非 Solid Context）**

```typescript
// connection-state.ts 追加
export const conn = createConnectionState()
export function useConnPhase(): Accessor<ConnPhase> { … 组件内 createSignal 镜像 + conn.subscribe … }
```

- MafwShell 改用单例（`conn.report(...)` 调用点 :1291/:1299/:2173/:2174/:2181 不变）
- 选择单例而非 Context：规避 context 断链/双实例类问题（第一方源码单 bundle 无副本风险，2026-09-09 排查法记录的教训）
- 现有 `connection-state.test.ts` 用自建实例，不受影响

**2. 指示灯（Rail 常驻）**——新组件 `components/ConnDot.tsx`

- 位置：Rail 顶部项目切换器行（搜索按钮旁）
- 三态：connected=绿点 / reconnecting=黄点脉动 / down=红点（CSS 动画，连接态无动效）
- Tooltip（openDelay 300）："Gateway 已连接" / "Gateway 正在重连（第 N 次尝试）" / "Gateway 已断开，正在自动重启…"
- initial 相位不渲染（避免启动期误报）

**3. 横幅 + 数据区占位（down 相位）**——新组件 `components/ConnBanner.tsx`

- 红底细横幅：`Gateway 已断开，正在自动重启…`（down 时渲染，否则 null）
- 挂载点：Rail 会话列表顶部、Goals / Usage / Quota / Triage 四个 Dock 内容区顶部
- **数据区占位**：down 时 Dock 内容区显示居中空态（断开图标 + "Gateway 已断开——数据将在恢复后自动刷新"），替代陈旧数据；恢复 connected 后既有轮询（10-15s）自动回填

**4. 发送禁用（ChatPane）**

- down 相位：发送按钮禁用（title 提示"Gateway 已断开"）；输入框不动
- reconnecting 不禁用（EventSource 自动重试中，HTTP 发送可能仍可达）

**5. 不动**

- connection-state 相位机逻辑（已验证可靠）
- main 侧 gateway-health 推送与有界自动重启
- WelcomeHome 初版连接页横幅

## 改动面

| 文件 | 改动 |
|---|---|
| `renderer/mafw/connection-state.ts` | 导出模块级单例 `conn` + `useConnPhase()` helper |
| `renderer/mafw/components/ConnDot.tsx` | 新建：三态圆点 + tooltip |
| `renderer/mafw/components/ConnBanner.tsx` | 新建：down 横幅 |
| `renderer/mafw/components/Rail.tsx` | 切换器行挂 ConnDot；会话列表顶部挂 ConnBanner + down 占位 |
| `renderer/mafw/MafwShell.tsx` | 改用单例 conn（删局部实例）；Goals/Usage/Quota/Triage tab 内容挂 ConnBanner + down 占位 |
| `renderer/mafw/components/ChatPane.tsx` | down 相位禁用发送按钮 |

## 验证

- desktop 无测试框架：`npx electron-vite build` 门禁
- 人工验证：①杀 gateway 进程 → 各 tab 出现横幅+占位、Rail 圆点变红脉动转红、发送禁用、toast 恰好一次；②重启 gateway（自动重启链）→ 圆点回绿、横幅消失、轮询自动回填、恢复 toast 一次；③短暂网络抖动 → reconnecting 黄点 → 自愈回绿
