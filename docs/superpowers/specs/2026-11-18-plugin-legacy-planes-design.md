# E16 legacy plane 声明（runtime / media / tts / usage）

> 状态：设计已定，待实施
> 前置：E12–E15（五个 gateway plane 已有 `contributes` 上界与 `check` 自查）

## 1. 问题

`contributes.gateway` 只覆盖 `actions` / `events` / `tools` / `observers` / `http`。
另外四类 legacy 贡献（`runtime` / `media` / `tts` / `usage`）只能靠 `activate()` 返回值自述：

- 安装审查看不到「这个包会替换 agent 运行时」「这个包会注册 TTS 引擎」；
- 没有上界，声明与执行依旧是两张皮；
- `mafw plugin check` 的 inventory 里它们完全隐形。

`runtime` 尤其严重：它能替换整个 agent 循环，却比一个 action 更不可见。

## 2. 设计（singleton 面，规则与数组面不同）

数组面是「registered ⊆ declared」；这四个面每包最多一个实例，所以规则是**名字/模态对齐**：

```jsonc
"contributes": {
  "gateway": {
    "runtime": { "name": "my-runtime" },
    "media":   { "name": "my-media", "modalities": ["image", "video"] },
    "tts":     { "name": "my-tts" },
    "usage":   { "name": "my-usage" }
  }
}
```

| 面 | 声明 | 违规 |
|---|---|---|
| `runtime` | `{ name?: string }` | 实际名（`spec.name ?? packageName`）≠ 声明名 |
| `media` | `{ name?: string; modalities?: string[] }` | 实际 name 不等，或实际 modalities ⊄ 声明 |
| `tts` | `{ name?: string }` | 实际名不等 |
| `usage` | `{ name?: string }` | 实际名不等 |

- **未声明 = 不受约束**（兼容）；**声明了但没注册 = 合法**（条件注册）。
- 四个面都需要 `trusted`（untrusted worker 只支持 actions/events），所以声明只对 trusted 生效；untrusted 包声明它们应在 manifest 校验阶段就拒绝（它永远无法满足）。
- 名字的默认值统一为包名（与 host 现状一致）。

逐字错误文案：

```
runtime "x" is not declared in plugin.json contributes.gateway.runtime
media "x" is not declared in plugin.json contributes.gateway.media
media modality "video" is not declared in plugin.json contributes.gateway.media.modalities
tts "x" is not declared in plugin.json contributes.gateway.tts
usage "x" is not declared in plugin.json contributes.gateway.usage
```

## 3. `check` 的可见性

`declared` / `registered` 增加四个键（全部可选）：

- `runtime?: string` / `tts?: string` / `usage?: string`（名字）
- `media?: { name?: string; modalities: string[] }`

渲染沿用现有风格（名字空间分隔、`+`/`-` 只对已声明面）。

## 4. 非目标

- 不改 legacy 贡献的**运行时行为**（注册顺序、loader、清理、依赖）。
- 不把 legacy 面改成数组形式，不做多实例。
- 不引入 per-modality 的权限 token（`permissions` 仍是粗粒度）。
- 不动 untrusted worker 的能力面。

## 5. 风险

- **兼容性**：未声明即不受约束，所以存量包零影响。
- **untrusted 声明即拒绝**是新增的硬失败；若存量 untrusted 包恰好写了这些键（此前被忽略），会在下次 reload 失败——当前无此类包，且错误信息直接给出修法。
- 名字对齐是**弱约束**（只查名字/模态，不查能力实现），价值在审查可见性与漂移检测，不在沙箱。
