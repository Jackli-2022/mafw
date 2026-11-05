# Orcalore · Lore 角色设计

状态：draft（待用户批准）
日期：2026-11-05
范围：品牌角色 / 视觉系统 / 资产生产；不包含产品改名的技术迁移（另立文档）。
前置决策：产品名 **Orcalore**；Pod 角色 **Lead / Tech Lead / Builder / Reviewer** 不改名；**Orca 不再作为主形象**，只保留 ink / cream / white 配色。

---

## 1. 意图

MAFW 更名为 Orcalore 之后，需要一个能长期承载品牌、又能落在产品界面里的角色。

旧「茉芙 / Mafu」是细节丰富的插画角色，16px 会糊，和 Pod / 鲸群叙事也不连；旧 Orca 资产本身很完整，但用户已决定**去掉虎鲸形态，只保留配色**。2026 年 AI agent 的业界做法已经收敛到「小角色 + 表情 + 配件 + 可选桌面宠物」：Meta 的 Jolly、OpenAI 的 dots、Grok Bot、Codex Pets、Kimi doodles 都是这个方向。

因此 Lore 不是一张插画，而是一套**可扩展的角色系统**：

> **Orcalore 是海，Lore 是那颗记得一切的珍珠。**

---

## 2. 目标 / 非目标 / 反目标

### 目标

- 一个在 **16px 仍可识别** 的 Lore。
- 一套 **base + 表情 + 配件 + doodle + 可选桌面宠物** 的系统，而不是一张固定图。
- 视觉上直接映射产品逻辑：记忆、检索、A2A handoff、验证。
- 可派生到 app icon / tray / favicon / onboarding / 空态 / 记忆面板 / 贴纸。
- 与 Jolly / dots / Kimi 的「小角色」气质一致，但保持 B2B 工作平台的信任感。

### 非目标

- 不做 RPG 数值、XP、签到、排行榜、抽卡。
- 不做人类 / 二次元角色。
- 不做第二个吉祥物。
- 不在本文档实现产品改名的技术迁移（appId、数据目录、工具名等）。

### 反目标

- 像 Clippy 一样打断工作流。
- 通用 AI sparkle、渐变球、发光眼睛。
- 把 Lore 套到每个 agent 头上，抹掉 Lead / Tech Lead / Builder / Reviewer 的层级。
- 过度可爱、儿童化、Tamagotchi 式 guilt。

---

## 3. 角色定位

| 层 | 名称 | 说明 |
|---|---|---|
| 产品 | **Orcalore** | 品牌 / 海 / 世界 |
| 角色 | **Lore** | 记忆珍珠；**品牌形象 / 左上品牌位**；Pod 的记忆守护者 / 信使（不是 Lead 头像） |
| 角色位 | **Lead** | 仍是 Lead，不改名；保留 L 徽标 / 首字母，不使用 Lore 头像 |
| 角色位 | **Tech Lead / Builder / Reviewer** | 不改名；保留各自角色色与字母/几何标记 |

- Lore 是**产品级角色 / 品牌形象**；**不是 Lead 的头像**；Lead 保留角色标记（L 徽标 / 首字母），不改名。
- 其他角色（Tech Lead / Builder / Reviewer）保留角色色与字母/几何标记，不使用 Lore。
- Lore 同时可作为记忆面板的 curator / 空态角色；不是第二个吉祥物。
- Orca 不再作为视觉主体；`Orcalore` 里的 Orca 作为「海 / 世界」的命名隐喻保留，视觉上只继承 ink / cream / white 配色。

---

## 4. 角色概念：记忆珍珠（Lore Pearl）

### 4.1 基础形态

- 一颗**圆润、略椭圆的珍珠**，暖白 / 奶油色（`#FCF8F1` / `#FFFFFF`）。
- 一圈**细墨色描边 / 底部阴影**（`#1D1F25`），不是粗黑轮廓。
- 两只**墨点眼**；没有嘴，或只有一条极短的线。
- 左上角一点**柔和高光**；珠面可有极轻的虹彩（低饱和，不能变成渐变球）。
- **签名元素**：一根细墨线系在珍珠上，线尾挂一个小标签 / 信笺（A2A handoff）。
- 检索时珍珠内部亮一下（accent 绿 `#4FD388`），不是永久发光。
- **没有虎鲸特征**：不要眼斑、背鳍、尾鳍、O 形蜷身、黑白鲸体。

### 4.2 表情与状态

参考 Grok Bot：**眼睛就是状态**，不靠复杂面部。

| 状态 | 眼睛 | 线 / 珠 | 用途 |
|---|---|---|---|
| idle | 两个圆点，偶尔眨眼 | 线自然垂着 | 默认 / 空态 |
| thinking | 点眼变成小转圈 / 半闭 | 线绕一圈 | 检索 / 规划 |
| happy | 弯月眼 / 高光变亮 | 线轻轻弹起 | 完成 / 保存成功 |
| sleepy | 半睁 / 闭眼 | 线松垂 | 长时间无活动 |
| blank / error | 一条扁线 | 线打结 / 松开 | 失败 / 无结果；**不放进错误弹窗** |
| focused | 点眼变窄 | 线绷直 | 正在处理长任务 |
| curious | 一只眼略大 | 线头抬起 | 新记忆 / 新消息 |
| proud | 弯月眼 + 珠光 | 线尾标签亮 | 评审通过 / 里程碑 |

### 4.3 配件

Base 不变，配件可换；不超过 10 个，全部 clip-on。

- 小挎包（A2A 信件 / artifacts）
- 围巾（季节 / 冬季 doodle）
- 贝雷帽（发布 / 节日 doodle）
- 耳机（语音 / TTS）
- 小灯笼（检索 / 夜间模式）
- 小标签（默认签名，不是配件）

配件不改变珍珠轮廓；16px 时全部省略，只保留珍珠 + 眼睛 + 高光。

### 4.4 Doodle 系统

参考 Kimi doodles：不是固定吉祥物，而是「base + 每月/事件一个小变化」。

- 12 个/年，节日、版本发布、社区事件。
- 只换一个配件 / 一个颜色 / 一个小场景，不换角色。
- 例：春节小灯笼、万圣节小南瓜、发布日小贝雷帽、冬天围巾。
- 每个 doodle 都是一次「小惊喜」，不弹窗、不打断。

### 4.5 桌面宠物（可选）

参考 Codex Pets，但**默认关闭**。

- 浮在 composer / 托盘附近，不挡操作。
- 对 approval / failure / completed 做轻反应（转头、眨眼、线动一下）。
- 可随时藏起来；不主动说话；不催任务。
- 支持 reduced motion；低配/远程桌面下自动关闭。

### 4.6 动效

- idle：轻微上下浮动 / 滚动 1–2px；4s 循环。
- blink：每 4–6s 一次，120ms。
- thinking：线绕一圈 / 珠内微光；1.2s 循环。
- retrieval：珠内亮一下，300ms，回到 idle。
- handoff：线从 Lore 延伸到下一个角色 / 消息卡；400ms。
- error：线松一下 / 眼睛变扁；不震动、不闪红。
- 全部走现有 motion tokens；`prefers-reduced-motion` 下只保留透明度变化。

### 4.7 声音与性格

- **性格**：安静的收藏家；好奇、护短、有点小狡黠；不是仆人，不是宠物，是同事。
- **说话**：短句、具体、给证据；不卖萌、不话痨、不说「主人」。
- 例：
  - “这根线是上周的。”
  - “我把它擦亮了。”
  - “这条记忆来自 Review。”
  - “先别急，我记得上次不是这样。”
- 文案语言与产品 UI 一致；中文为主，英文品牌名保留。

---

## 5. 产品逻辑映射

| 视觉 | 产品含义 |
|---|---|
| 珍珠 | pinned / 核心记忆 |
| 珠光 / 虹彩 | 记忆类型（episodic / semantic / procedural / global）或 authority |
| 细线 | A2A handoff / 会话之间的 thread |
| 线尾标签 | artifact / reference / 消息指针 |
| 珠内发光 | 检索 / recall |
| 打磨 | 验证 / review / stale-verify |
| 珍珠图鉴 | 记忆面板的 collection，不是游戏货币 |
| 桌面宠物反应 | approval / failure / completed 的轻量存在感 |

**不做**：XP、等级、签到、连续天数、排行榜、抽卡、付费皮肤。

---

## 6. 视觉系统

### 6.1 色板

| Token | 值 | 用途 |
|---|---|---|
| `--lore-cream` | `#FCF8F1` | 珍珠主体 / 暖底 |
| `--lore-white` | `#FFFFFF` | 高光 / 肚皮留白 |
| `--lore-ink` | `#1D1F25` | 描边 / 眼睛 / 线 |
| `--lore-glow` | `#4FD388` | 检索 / 成功 / 标签（沿用桌面 accent） |
| `--lore-shadow` | `rgba(29,31,37,0.12)` | 底部阴影 |

- 无渐变；虹彩只能用极低饱和的叠加，不能变成彩色球。
- 深色底：珍珠保持 cream/white，描边加深；不要反相成黑球。

### 6.2 形状语言

- 圆 / 椭圆 / 细线；没有尖角。
- 珍珠是主体；线是第二识别点；眼睛是第三识别点。
- 16px：珍珠 + 眼睛 + 高光；线可省略。
- 32px 以上：线 + 标签出现。
- 128px 以上：珠光 / 虹彩 / 配件出现。

### 6.3 字标

- 产品字标 **Orcalore** 用现有 UI 字体；不新造字体。
- 可选 lockup：Lore 珍珠在左，`Orcalore` 在右；珍珠不替代字母 O（避免和旧 Orca O 混淆）。
- 中文传播名待定（见 §10）。

### 6.4 图标网格

- 1024 master；macOS 安全区按 824/1024（约 80.5%）生成 ICNS。
- ICO：16 / 24 / 32 / 48 / 64 / 128 / 256。
- tray：monochrome template（macOS），Windows/Linux 用彩色版。
- favicon：16 / 32 / 48。

---

## 7. 使用规范

| 面 | 用法 | 频率 |
|---|---|---|
| App icon / 安装器 | Lore 珍珠主图 | 固定 |
| 托盘 | macOS 单色 template；Windows/Linux 彩色 | 固定 |
| Favicon | 珍珠 + 高光 | 固定 |
| Lead 标记 | Lead tab / 左栏资源行保持 L 徽标 / 首字母；不使用 Lore | 固定 |
| Onboarding | Lore + 线 + 第一颗珍珠 | 一次 |
| 空态 | Lore idle / sleepy | 低 |
| 记忆面板 | Lore 作为 curator；珍珠 = 记忆卡 | 中 |
| 贴纸 / merch | 表情 / 配件 / doodle | 社区 |
| 文档 / 关于页 | 透明珍珠 + 字标 | 低 |

**不要用**：

- 错误弹窗、删除确认、权限/审批阻断、法律/合规文案。
- 销售、客服、培训等需要严肃语气的场景。
- 每个 agent 的头像；不要用 Lore 替代 Lead / Tech Lead / Builder / Reviewer 的角色标记。
- 密集表格 / 终端 / diff 视图里的大图。

**频率**：像 GitHub 的 mascot 指南一样，少用、只在该出现的时候出现；不打断用户流。

---

## 8. 资产计划

### 8.1 源文件

- 手写 SVG 为源（base、表情、配件、线、标签分层）。
- 1024 master；所有导出从 SVG 生成。
- 最终插画可由人类设计师或 AI 图像模型重绘，但**保留 SVG 结构**与色板。

### 8.2 派生资产

- App icon：16 / 24 / 32 / 48 / 64 / 128 / 256 / 512 / 1024 PNG；ICO；ICNS（824 网格）。
- Tray：16 / 20 / 24 / 32 + `@2x` 单色 template；Windows/Linux 彩色。
- Favicon：16 / 32 / 48。
- Lore 当前只用于**左上品牌位**（20px 圆形，显示 18px + Orcalore 字标）；Avatar pack 15 档保留为未来品牌素材；Lead tab / 左栏资源行保持 L / 首字母，**不替换 Lead 头像**。
- companion（可选）：64 / 128。
- Character sheet：front / side / back；8 个表情；6 个配件。
- Desktop pet sprite：idle / blink / thinking / happy / sleepy / error / handoff；每状态 4–8 帧；sprite sheet。
- Doodles：12 个/年；模板化。

### 8.3 文件布局（建议）

```text
assets/brand/lore/
  source/lore-pearl.svg
  source/lore-expressions.svg
  source/lore-accessories.svg
  export/icon/...
  export/tray/...
  export/favicon/...
  export/companion/...
  export/pet/...
  export/doodles/...
```

（最终放 `packages/desktop/icons/lore/` 还是 `assets/brand/lore/`，见 §10。）

### 8.4 生产顺序

1. SVG base + 16px 剪影测试。
2. 8 个表情 + 6 个配件。
3. App icon / tray / favicon 导出。
4. Character sheet。
5. Desktop pet sprite（可选）。
6. 12 个 doodle 模板。
7. 最终插画替换（设计师 / AI，保持 SVG 结构）。

---

## 9. 验证与验收

- **16px 剪影**：珍珠 + 眼睛 + 高光可读；线可省略。
- **深/浅底**：cream/white 不消失；描边足够。
- **灰度**：眼睛、线、标签仍然可读。
- **无虎鲸特征**：无眼斑、背鳍、尾鳍、O 形蜷身。
- **一致性**：8 个表情、6 个配件、12 个 doodle 都是同一个 base。
- **对比度**：眼睛/线 vs 珍珠主体满足可读性；文字不放在珍珠上。
- **动效**：reduced motion 下不眩晕；无闪烁。
- **商标 / 域名**：`Orcalore` / `Lore` 正式检索；`Lore` 是常见词，需确认类别。
- **用户批准**：本文件批准后才进入资产生产 / 代码。

---

## 10. 风险与待决

### 风险

- **珍珠太简单**：圆形容易泛化；必须靠「线 + 标签 + 珠光」建立识别度。
- **名形张力**：产品叫 Orcalore，但视觉没有虎鲸；需要品牌故事（“Orcalore 是海，Lore 是珍珠”）和 tagline。
- **Lore 名字常见**：npm `lore` 已被占；`orcalore` 可用但不等于商标安全。
- **桌面宠物分心**：默认关闭；不做主动打扰。
- **最终插画依赖**：当前 AI 图像额度不可用；先用 SVG，最终图后补。
- **图标管线适配**：现有 `build_icons.py` 假设不透明方图；珍珠有透明边，dev/beta overlay、macOS 824 网格、tray template 都要改（详见后续实现计划）。

### 已定（builder check 收口；可被用户推翻）

1. Lore 定位为**品牌形象 / 左上品牌位**；**不替换 Lead 头像**；Lead tab / 左栏保持 L / 首字母；其他角色保留角色色 / 字母。
2. 桌面宠物默认关闭，opt-in；v1 只做应用内 SVG + motion tokens，不做 OS 级悬浮 sprite。
3. App icon = 珍珠 + 极细线/标签；16px 省略线；**墨色圆角底板**（2026-11-05 资产包实测比暖奶油底更跳；原暖奶油底为暂定）。角色本体透明。
4. 不做用户自定义命名；配件 / doodle 由品牌方控制。
5. 中文传播名暂定「洛尔」为名字、「忆珠」为描述性昵称。
6. 主视觉接受 **soft 3D / 插画感**（资产包实测更贴 Jolly/dots）；flat / mono 只用于小尺寸、tray、单色主题；SVG 源后续补。
7. 资产目录：源文件 `assets/brand/lore/`；桌面导出 `packages/desktop/icons/lore/`（由管线消费）。
8. Orca 只保留为命名 / 世界观隐喻，不做视觉彩蛋。
9. v1 不做 Lore 台词（visual-only）；语音 / 文案 v2 再定。
10. 验证：16px / 灰度 / 对比度 / 调色板用脚本；「无虎鲸特征」与角色一致性用人工评审。

### 仍需用户定

1. **第一版 Lore 的范围**：平台图标 + 左上品牌位已是既定最小集；Lead 头像不在 v1；是否再加记忆面板 / onboarding / 空态 / 桌面宠物——**待定**。
2. **图标切换时机**：**已定（2026-11-05）——等 Orcalore 改名版本一起上**。prod / dev / beta 先保持 MAFW 图标，避免品牌错位；管线可先做但不切换。

---

## 11. 业界参考

- **Meta Muse · Jolly**：圆、奶油色、黑豆眼、腮红；可换装；降低 AI 的威胁感。
- **OpenAI dots**：Pixar 感的小家伙；可命名、可自定义；always-on agents 的“crew”。
- **Grok Bot**：一个纯色形状 + 两只眼睛；眼睛就是状态；形状/颜色即身份。
- **Codex Pets**：可选桌面宠物；对 approval / failure / completed 反应；可换/可藏。
- **Kimi doodles**：节日/事件的小 doodle；每次一个小惊喜，不换主角色。
- **Octocat / Docker / Go / Rust**：动物/物件 mascot 必须从产品逻辑长出来；强剪影、少色板、可二创。
- **B2B mascot 经验**：先给 job 再给脸；少用；不打断工作流；避免 generic cutewashing。

### 我们借什么

- 圆润、少笔画、可表情、可配件、可 doodle。
- 眼睛作为状态。
- 可选桌面宠物。
- 产品逻辑驱动的视觉隐喻（珍珠 = 记忆）。

### 我们不借什么

- 不做毛绒玩具 / 3D 公仔主视觉。
- 不做人类角色。
- 不做 XP / 签到 / 排行榜。
- 不做每个 agent 一只宠物。

---

## 12. 决策记录

| 决策 | 结果 | 原因 |
|---|---|---|
| 旧 Mafu | 退役，不进主 UI | 16px 糊；和 Pod 叙事不连 |
| 旧 Orca 形态 | 去掉 | 用户决定；只保留 ink/cream/white 配色 |
| 鹦鹉螺 | 否决 | 太像“知识工具”，不够小角色 |
| 海蛇 / RPG 龙 | 否决 | 太游戏化，偏离 Jolly/dots/Kimi |
| 人类 / 二次元 | 否决 | 旧 Mafu 路线；一致性/uncanny/企业感 |
| 种子精灵 | 备选，未选 | 成长感好，但和 Orcalore 的海世界脱节 |
| **记忆珍珠** | **选定** | 海 + pinned memory + 圆润小角色 + 16px 可读 |
| Lead 改名 | 不改 | 用户决定；Lore 不抢决策 |

---

## 13. 批准与下一步

1. 用户批准本文件。
2. 进入 `writing-plans`，拆实现计划（SVG 资产生成、图标管线适配、app icon/tray/favicon、桌面宠物、doodle 模板、测试）。
3. 若需要视觉概念：手写 SVG 先出；AI 图像额度恢复后再出插画版。
4. 产品改名（appId / 数据目录 / CLI / npm / 工具名）另立设计文档，本文件只负责 Lore 角色。

---

## 14. Builder check（2026-11-05）

一个 fresh general-purpose subagent 读本文档后提出的问题，按重要性排序：

1. **范围**：只做 asset/pipeline，还是也落产品 UI？→ 已列为用户待决 #1。
2. **图标切换与改名迁移的先后**：现在换线上图标会出现 MAFW 名字 + Orcalore 图标的错位；等改名一起上则管线先不动。→ 已列为用户待决 #2。
3. **§10 的 fork**：companion vs Lead 头像、宠物默认、icon 构成、资产目录。→ 已按「已定」收口。
4. **桌面宠物实现**：sprite sheet vs 单个 SVG + motion tokens。→ 已定 v1 应用内 SVG + motion tokens；不做 OS 级悬浮 sprite。
5. **App icon 透明 vs 底板**：→ 已定 app icon 用暖奶油圆角底板；角色本体透明；tray 单色实心剪影 + 眼睛镂空。
6. **表情 → 事件映射**：→ 见 §14.1；若 v1 不落 UI，则只需要表情表。
7. **Lore 是否说话**：→ v1 visual-only，不发布台词。
8. **验证机器 vs 人工**：→ 16px / 灰度 / 对比度 / 调色板用脚本；「无虎鲸特征」与一致性人工评审。

### 14.1 表情 → 事件（provisional）

| 事件 | 表情 |
|---|---|
| 空闲 / 无活动 | idle |
| recall / search 命中 | curious → happy |
| 工具执行中 / 长任务 | focused |
| thinking / planning | thinking |
| turn.completed / goal PASS | proud |
| approval.asked | curious |
| turn.failed / error | blank（不在错误弹窗里出现） |
| 长时间无活动 | sleepy |

> 如果 v1 只做资产，不落 UI，这张表只作为后续实现的合同，不产生代码。

---

## 15. 资产包评审（2026-11-05）

`Lore平台图标资产/`（四平台 v1）已到位。结论：**接受为平台图标 v1**；但它是图标包，不是完整角色系统。

### 通过

- 识别点齐：奶油白珠体 + 两只墨点眼 + 小高光 + 细墨线 + handoff 信笺。
- 四平台覆盖完整：Windows ICO(16–256) + PNG 矩阵；macOS ICNS + 安全边距；Linux hicolor 16–512；Android 5 密度 + adaptive/monochrome + Play Store。
- 16/24px 用简化 Base（省略线/信笺）；32px 以上才出现线；符合小尺寸策略。
- ICO/ICNS 回读通过；Android XML / `#1D1F25` 背景色正确。
- 16px 在墨色底板上仍能读出珠体 + 两眼；对比度够。
- 没有虎鲸特征；只保留 ink / cream / white + mint accent。

### 偏差 / 已接受

- **墨色底板**（非文档暂定的暖奶油底）：预览里奶油珍珠更跳，接受并已改文档。
- **soft 3D / 插画感**（非 flat vector）：更贴 Jolly/dots，接受为主视觉；flat/mono 用于小尺寸/tray；SVG 源后续补。
- **macOS 1024 底板约 897/1024（87.9%）**：比 Windows 961（93.8%）收了一点，接近仓库旧管线 88%；严格按 macOS HIG 824（80.5%）还可再收 ~7%，但不影响当前可用。
- **Android foreground 的 tag 可能被圆形 mask 裁掉**：清单已声明 tag 是非关键识别信息，可接受。

### 缺口

- 没有 SVG / Android Vector Drawable 源。
- 没有 tray 专用 16/20/24/32 + `@2x`；可从 `母版/Lore单色轮廓_1024.png` 派生。
- 没有 favicon（16/32/48）；可从 Windows 16/32/48 或单色轮廓派生。
- 没有 companion / 桌面宠物尺寸；avatar pack 已覆盖 16–1024（圆形 + 透明）。
- 没有表情 / 配件 / doodle / 桌面宠物；本包只是平台图标，角色系统仍需 character sheet。
- 没有 iOS / Windows Store / 社交横幅；不在 v1 范围。

### 技术读数

| 项 | 读数 |
|---|---|
| Windows 1024 底板 | alpha bbox `(32,32,993,993)` = 961/1024（93.8%） |
| macOS 1024 底板 | alpha bbox `(64,64,961,961)` = 897/1024（87.9%） |
| macOS 512 | `(29,29,483,483)` = 450/512（87.9%） |
| Windows ICO | 16 / 24 / 32 / 48 / 64 / 128 / 256 |
| macOS ICNS | `ic07/08/09/10/11/12/13/14` + `TOC`；回读通过 |
| Android foreground (mdpi) | 108×108，bbox `(13,23,95,85)`；tag 可被裁 |
| Android launcher (mdpi) | 48×48，满幅墨色底板 + 奶油珍珠 |
| 16px 调色板 | cream/white + ink 为主；对比度可用 |
| 主色 | `#1D1F25` ink；cream/white；mint accent ≈ `#4FD388` |

### 已定（2026-11-05）：Lore = 品牌形象，不替换 Lead 头像

Lore 是**左上品牌位的脸**（20px 圆形，显示 18px + Orcalore 字标），不是 Lead 的头像。Lead 名字不变；Lead tab / 左栏 ProjectResources 行保持 L 徽标 / 首字母；Tech Lead / Builder / Reviewer 同样保留角色标记。

这意味着：

- **Lead tab**：保持 L 徽标 + 完整 “Lead” 文本；不放大头像；隐藏冗余状态点并给标题保留最小宽度。
- **左栏资源行**：保持首字母（如 L），不换成 Lore。
- **Avatar pack**：15 档、圆形/透明两版保留为未来品牌素材；当前 UI 只消费 20px 圆形作为左上品牌图标。
- **App icon**：使用平台 pack；不在本切片切换（等 Orcalore 改名）。
- **v1 最小集**：平台图标 + 左上品牌位；Lead 头像不在 v1；记忆面板 / onboarding / 空态 / 桌面宠物是否进 v1 仍待定。
