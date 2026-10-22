# 06 · 契约缺口综合报告 —— MAFW gateway 契约 vs 业界前沿能力（收口交付物）

> 合成日期 2026-10-22。本报告是契约缺口研究的最终收口：读取 00-05 六份调研文档，交叉去重、按价值与跨平台收敛度排序，产出缺口总表、分层叙述与优先级建议。
> 基线权威：`00-our-contract-inventory.md`（外部报告与其冲突时以 00 为准；02 已按我方 AGENTS.md §5.19 做过基线勘误，受影响行 A1/A9/A10/B3/B4/B6/D5/F1 已修正）。
> 本报告为只读合成，除本文件外未改任何文件。

---

## 1. 研究方法与证据档位

### 1.1 输入与分工

| 文档 | 对象 | 角色 |
|---|---|---|
| 00 | 我方契约（canonical v3 + 路由面 164 条） | **基线权威**，代码行级盘点 |
| 01 | Claude Agent SDK 0.3.306 | 单平台深查（本地 sdk.d.ts 9589 行一手类型枚举） |
| 02 | Codex app-server main@2a77e82 + Gemini CLI 0.65.0 | 单平台深查（ts-rs 生成协议类型 + 官方文档；含基线勘误） |
| 03 | opencode SDK 1.18/1.19 vs CLI 2.1.x | 自家 runtime 真实面（本地 SDK 双 gen + v2 OpenAPI 146 ops + 运行时实例化验证） |
| 04 | pi（earendil-works/pi）+ dsh（DeepSeek Harness） | 可整体借鉴的两个 harness（官方文档级，未源码逐行；个别【推断】已标注） |
| 05 | ACP / MCP / AI SDK 6 / OpenAI / Anthropic / Gemini / 产品面 | 跨行业横扫（规范原文 + 产品 changelog） |

### 1.2 版本钉扎汇总

| 平台/规范 | 版本钉扎（2026-10-22） | 证据档位 |
|---|---|---|
| MAFW 契约 | canonical v3（2026-10-21 设计；代码快照 2026-10-22） | L1 代码行级 |
| Claude Agent SDK | 0.3.306 本地（npm 0.3.307 仅差 command_lifecycle patch，类型面等同） | L1 本地一手类型 |
| Codex | main@2a77e82f（2026-10-22）；@openai/codex-sdk 0.163.0 | L2 仓库生成类型 + 文档（developers.openai.com 403，产品面以 crate 源码 + 第三方交叉佐证） |
| Gemini CLI | 0.65.0（npm 2026-10-20）/ main@2026-10-22 | L2 官方文档 |
| opencode | SDK 1.18.21 本地 = npm 1.19.3（tarball diff 证实 API 零增量）；CLI v2.1.0 本机（npm 2.1.2）；v2 OpenAPI 146 ops | L1 本地 SDK + L2 docs + 运行时实例化 |
| pi | earendil-works/pi HEAD 58c0b02c（2026-10-21）；@earendil-works/pi-coding-agent 1.4.0 | L2 官方文档 |
| dsh | deepseek-ai/deepseek-harness HEAD 687f282e（2026-10-17）；@deepseek-ai/dsh 0.2.1-rc.2（developer preview，明示将有破坏性变更） | L2 官方文档（脚本生成事件×生产者×消费者矩阵） |
| ACP | v1 stable（Rust/TS SDK 1.0，独立 org agentclientprotocol）/ v2 draft | L2 规范原文 |
| MCP | 2026-07-28 stable（前版 2025-06-18 / 2025-11-25） | L2 规范原文 |
| AI SDK | v6（2025-12-22 发布） | L2 规范原文 |
| Anthropic / Gemini API / OpenAI Agents | 2026-09/10 发布线（Opus 5.5、Interactions API、Agents API beta） | L2 规范原文 |
| 产品面（Claude Code / Cursor / Codex Cloud / 云代理 / SDD） | 2026-08~10 changelog 与综述 | L3 产品文档 + 第三方交叉佐证 |

### 1.3 判定与去重规则

- **判定口径**（与 00 §⑤ 一致）：HAVE = 契约字段/动词 + 至少一个 runtime 实现 + 消费面接通；PARTIAL = 契约存在但实现/暴露面/语义有缺口；MISSING = 契约与实现均不存在。
- **契约缺失 ≠ 实现接线缺失**：maxTurns/maxCostUsd 属接线断裂（契约字段已在，见 §5.1），不计入缺口总表。
- **去重**：同一能力多平台重复出现（hooks、queue、outputSchema、subagent、elicitation、checkpoint……）合并为一条，收敛度体现在证据矩阵。
- **价值三轴**：跨平台收敛度（几家有）× 对多运行时网关契约的结构意义（是否改变 DTO/动词/事件骨架）× 用户可见收益。
- 严禁编造：所有判定可在 00-05 找到出处（§7 索引）；不确定处标"待验证"。

---

## 2. 缺口总表（核心交付物）

**图例**：C = Claude Agent SDK · X = Codex app-server · O = opencode（CLI 2.1.x / SDK 1.18-1.19）· P = pi · D = dsh · ★ = 业界标准/规范与产品面（ACP / MCP / AI SDK 6 / OpenAI Agents / Anthropic·Gemini API / 头部产品；**Gemini CLI 0.65 以 G 计入 ★ 列**）。判定 = 我方契约判定；落点 = canonical v3 框架层级（DTO / 事件词汇 / 动词 / 选项字段 / 能力位 / 认知面 / 工具层）。

### A. 认知与控制面

| # | 能力 | 证据矩阵 | 判定 | 价值 | 契约面落点 | 证据指针 |
|---|---|---|---|---|---|---|
| 1 | 认知面 hooks 门控/改写（拦工具调用、改工具入参/输出、拦 prompt、拒 Stop） | C X O P D ★ | PARTIAL | 高 | 认知面层：HostAdapter 四动词 → **六动词**（+gate/rewrite） | 01§③/§⑥A1；02§⑤G5-6；03§2.5；04§④E2/§④A3；05§9.1#5 |
| 2 | 系统提示分段/快照/每会话 instruction 条目（缓存经济 + 压缩免疫） | C O P D | PARTIAL | 中-高 | 认知面层：injectSystem 增分段标记/快照语义；session 通道 caching 提示 | 01§⑥H2；03§3.4#33；04§④D6；00§⑤#9③ |
| 3 | 步前准入瀑布（pre-step 权威 reject/enter(messages) + request-error 重试接管） | D | MISSING | 中 | 认知面层：gate 的 step 粒度变体 | 04§④A3 |
| 4 | 逐字投递 verbatim / client_composed（防注入物被 @file/slash 二次展开） | C | MISSING | 低-中 | 选项字段层：prompt.verbatim 位 | 01§⑥F2 |

### B. 子代理与任务编排

| # | 能力 | 证据矩阵 | 判定 | 价值 | 契约面落点 | 证据指针 |
|---|---|---|---|---|---|---|
| 5 | 子代理全栈（原生 spawn/后台子会话/生命周期事件/血缘目录/代理间消息/结构化结果） | C X O P D ★ | PARTIAL | 高 | DTO+事件层：parentSessionId/depth 预留 + `task.*`/`subagent.*` 词汇占位 | 01§⑥B1-2；02§⑤H1-2；03§3.2#12-14；04§3.6/§④E3；05§9.1#15 |
| 6 | 后台任务 / durable task 实体（五态状态机 + 轮询/订阅 + 跨端续接） | C X O P D ★ | PARTIAL | 高 | 动词+事件层：task.submit/get/cancel/message + `task.updated`（对齐 MCP tasks 五态） | 01§⑥B3；02§⑤I3；03§3.2#14/§3.4#27；04§④C5/§2.5；05§9.1#6 |
| 7 | 委托工作链归属（parentTurnId/rootTurnId/turnTrigger） | X | MISSING | 中 | 事件/DTO 层：turn 载荷归属字段 | 02§⑤B5 |
| 8 | Ralph 循环 / Agent Teams 编排原语（fresh-agent 每轮 + 任务板） | D | MISSING | 低 | gateway goal 层词汇借鉴（非 runtime 契约） | 04§④E4 |

### C. 输入/输出与流

| # | 能力 | 证据矩阵 | 判定 | 价值 | 契约面落点 | 证据指针 |
|---|---|---|---|---|---|---|
| 9 | 回合级结构化输出 outputSchema（约束最终消息 + 原生重试 + 终态分类） | C X O D ★（P 工具/子代理级） | PARTIAL | 高 | 选项字段层：SessionPromptOpts 增 `outputSchema` | 01§⑥C2；02§⑤B4；03§3.5#39；04§3.6；05§2 |
| 10 | StopReason / 错误码终态分类（end_turn/max_tokens/refusal/预算硬停…） | C X O P D ★ | PARTIAL | 高 | 事件层：turn.completed/failed 载荷增 `stopReason` 枚举 + `error.code` | 01§⑤5.1/§⑥C2；02§⑤F5；04§2.1/§3.1；05§9.1#3 |
| 11 | 服务端队列/inbox（排队/取消/幂等 id/重排/队列可见 + steer 并发前置条件） | C X O P D | PARTIAL | 高 | 动词+事件层：delivery 增 `'queue'`、prompt 取消动词、`queue.updated` 事件、`expectedTurn` 选项 | 01§⑥F1；02§⑤B1-2/B8；03§3.1#2；04§④A1；05§8#6 |
| 12 | settled 二段终止 + wait 原语（willRetry ≠ settled；root idle + 受管后代完成） | P D | MISSING | 中 | 事件+动词层：`turn.settled` / session.wait | 04§④A2 |
| 13 | data part（类型化自定义数据 + 同 id 调和 + transient 不入历史） | ★(AI SDK 6) | MISSING | 中-高 | DTO 层：MafwPart 开放 `data-{name}` 变体 | 05§3 |
| 14 | citations / source part（独立 part 与行内 spans 两形态兼容） | X D ★ | MISSING | 中 | DTO 层：MafwPart 增 `source` 变体（含可选 spans） | 01§④4.3；02§⑤G1；04§④F8；05§3/§5/§6 |
| 15 | notice 瞬态通知（非历史 severity 通道） | ★(ACP) | MISSING | 中 | 事件层：`notice` 事件（severity/title/description） | 05§1 |
| 16 | 命令执行/文件变更一等 part（commandActions/exitCode/durationMs/PatchApplyStatus） | X O ★(ACP v2 diff 块) | PARTIAL | 中 | DTO 层：tool part 结构化扩展或专用 part 变体（现靠透传变体兜底） | 02§⑤C1-2；03§3.1#4 |
| 17 | 生成型媒体 part（图像生成/输出侧流式语义） | X G ★ | PARTIAL | 中 | DTO 层：输出侧 media part 变体（现为文本标记协议 + 工件 URL） | 02§⑤C4；05§6#4；00§⑤#11 |
| 18 | partial JSON 工具输入流（tool.delta input/output 落地） | ★(AI SDK) | PARTIAL | 中 | 事件层：tool.delta kind 扩展已设计未实现——落地 | 00§②.3；05§8#4 |
| 19 | 富文本输入 span / skill / mention 引用型输入 | X G | MISSING | 低-中 | 选项字段层：SessionPromptOpts.parts 扩展 | 02§⑤C10 |
| 20 | plan 流式 delta + 载荷 canonical schema | X | PARTIAL | 低-中 | 事件层：plan.updated delta+snapshot 双形态 + Todo 载荷契约 | 02§⑤B7；00§⑤#14 |

### D. 工具面

| # | 能力 | 证据矩阵 | 判定 | 价值 | 契约面落点 | 证据指针 |
|---|---|---|---|---|---|---|
| 21 | 工具注解（readOnly/destructive/idempotent/openWorld）+ 呈现元数据（kind/title/locations/icons） | C X P D ★ | MISSING | 高 | 工具层：MafwToolRegistration / NativeToolDeclaration 增 `annotations` + 呈现元数据 | 05§1/§2；04§④C1；02§⑤C8；01§④4.3 |
| 22 | 结构化工具结果（outputSchema 校验 structuredContent + content/details 三通道） | C X O P D ★ | MISSING | 高 | 工具层：tool part state 增 `structuredOutput` | 04§④C2；05§2 |
| 23 | 工具暴露分级（direct/model-only/deferred/hidden/namespace）+ tool_search 延迟激活 | C P D ★(Anthropic defer_loading) | MISSING | 中 | 工具层：NativeToolDeclaration 增 `deferred`/exposure | 01§⑥E2；04§④C1 |
| 24 | 会话中动态增删工具（保缓存的 inline 变更） | C P D | MISSING | 中 | 工具+事件层：工具变更词汇（toolsAdded/Removed 同族） | 01§⑥E3；04§④D6/§3.2 |
| 25 | 双向工具面（runtime 委托宿主执行 DynamicToolSpec / 嵌套 executeTool + parent 链） | X P ★(ACP v2 客户端 MCP) | MISSING | 中 | 动词层：hostTools 回调（现有 /api/tools/execute 是 gateway→消费方，方向相反） | 02§⑤E1；04§④C3 |
| 26 | MCP 生命周期管理面（健康/OAuth/热重载/per-tool 策略/mcp.tools.changed） | C X O | PARTIAL | 中 | 动词层：mcp 命名空间（现仅配置文件自接线 + 全量 config 透传） | 01§⑥E1；02§⑤E7；03§3.7#54；00§⑤#6 |
| 27 | 工具结果外溢 spill（不透明 locator + 头尾 + retrievalHint；fork 继承） | D | MISSING | 低-中 | 工具层：大输出地址化策略（替代截断丢失） | 04§④C4 |

### E. 会话与持久化

| # | 能力 | 证据矩阵 | 判定 | 价值 | 契约面落点 | 证据指针 |
|---|---|---|---|---|---|---|
| 28 | 持久事件历史 + seq 游标续传（先重放后直播；断线以最后 seq 恢复） | C X O P D ★(ACP v2 draft) | MISSING | 高 | 动词+事件层：`session.events(after)` 原语 | 03§3.1#1；04§④B2；05§1#11 |
| 29 | 会话配置选项（sticky 模型/agent/思考等级切换 + config 事件族 + 联动完整返回） | C X O P D ★ | PARTIAL | 高 | 动词+事件层：setConfigOption 动词 + `session.config`/switched 事件 | 01§⑤5.1；02§②.2；03§3.2#17；04§2.4；05§1#5 |
| 30 | 检查点自动化 + 组合 rewind（影子 git/staged revert/会话-文件三态选择/恢复后重提议） | C G O | PARTIAL | 中-高 | 动词层：`session.checkpoint/restore(files\|conversation\|both)` | 01§⑥A2；02§⑤A9-10；03§3.6#44 |
| 31 | 会话可携带性（export/import --sanitize / move / share URL） | C X O | MISSING | 中 | 动词层：session.export/import/move/share | 01§⑤5.2/§⑥D4；02§③5-6；03§3.1#7/9；00§⑤#7 |
| 32 | 会话目录服务（全文搜索/分区 sections/附件关联/归档/双向分页 item anchor） | X O | MISSING | 低-中 | 动词层：session.list/search 参数扩展 | 02§⑤A2/A5-8；03§3.1#6 |
| 33 | 多客户端 rejoin 运行中会话 + 断线在途审批重投 | X C | MISSING | 中 | 事件层：SSE 重连语义 + pending permission 恢复 | 02§⑤A3；01§⑥H3 |
| 34 | 读未读回执 + revision 乐观并发（会话元数据 CAS） | X | MISSING | 低 | 动词层：会话元数据 revision | 02§⑤A4 |
| 35 | 能力发现契约（skills / AGENTS.md / 命令广播 available_commands） | X G O P ★ | PARTIAL | 中-高 | 事件+动词层：`session.commands` 事件 + skills 发现动词 | 05§1/§7/§9.1#7；03§3.4#31；02§⑤G4；04§2.4 |

### F. 审批与交互

| # | 能力 | 证据矩阵 | 判定 | 价值 | 契约面落点 | 证据指针 |
|---|---|---|---|---|---|---|
| 36 | Elicitation 结构化表单（form schema + url mode + timed 超时模式） | C X O P D ★ | PARTIAL | 高 | 事件+动词层：question.asked 载荷增 `schema`/`mode:'url'`/超时语义 | 01§⑥A5；02§⑤D6；03§3.3#24；04§④A5；05§1/§2 |
| 37 | 审批精细化（amendment 式批准/cancel/reject_always/turn 粒度授权/plan·dontAsk 档） | C X D ★(ACP) | PARTIAL | 中 | 动词层：permissionReply 扩值 + 载荷（现 once/always/reject + suggestedRule） | 01§⑥A3-4；02§⑤D1-4；05§1#3 |
| 38 | AI 审批者路由（approvalsReviewer=auto_review/guardian + 断路器 + 人工推翻） | X | MISSING | 低-中 | gateway 审批面（reviewer 抽象，非 runtime 契约） | 02§⑤D2/§③8 |
| 39 | 审批审计对入会话日志（approval/asked+decided log-only，随会话可回放） | D | PARTIAL | 中 | 事件层：decision-log（现有 jsonl）对齐会话日志化 | 04§④E1；00§⑤附 |
| 40 | 策略引擎精细化（argsPattern 正则/priority 分层/deny 即从模型工具集移除） | X G | PARTIAL | 中 | 审批规则层：permission-rules.json 增强（现 tool/prefix 匹配） | 02§⑤D5；00§⑤附 |

### G. 模型与用量

| # | 能力 | 证据矩阵 | 判定 | 价值 | 契约面落点 | 证据指针 |
|---|---|---|---|---|---|---|
| 41 | thinking/effort 控制面（等级枚举+预算+运行期切换）+ **signature 保真透传** | C X O P D ★ | MISSING | 高 | DTO+选项层：part 增 `signature` 透传位（normalize 保真）；prompt 增 effort/thinkingLevel | 01§⑥C1；02§②.6；03§1；04§④D2；05§5/§6/§8 |
| 42 | 模型容错（fallback 链 / rerouted 事件 / supersedes 消息撤回） | C X G P | MISSING | 中 | 事件层：`model.rerouted` + `message.superseded` 预留 | 01§⑥C3；02§⑤B10；04§④D1 |
| 43 | 重试可见性（assistant/attempt 失败尝试持久化 + auto_retry 事件族） | C X O P D | MISSING | 中 | 事件/DTO 层：attempt 载荷或 part 变体（retried 事件现为 drop 行） | 04§④A4；03§3.1#10；01§④4.1 |
| 44 | usage 完备语义（cacheWrite/modelContextWindow/costBasis/currency/per-model 累计口径） | C X G D ★(ACP) | PARTIAL | 中 | 事件层：usage 载荷字段扩展（现有五字段合成） | 01§⑥I1；02§⑤F1；04§④D3；05§1#12 |
| 45 | 上下文逐类 token 分解（mcp_tools/memory_files/agents/skills 逐项 + deferred 类） | C X G | MISSING | 中 | 动词/事件层：context.usage（注入预算可核算） | 01§⑥D1；02§⑤F1 |
| 46 | 账号配额/限额可见性与等待策略（rateLimits 事件 + 自动续跑） | C X G | MISSING | 中 | 非契约（网关 usage 插件自建 8 适配器为替代） | 01§⑥I2；02§⑤F2 |
| 47 | 虚拟模型路由（per-request route/sticky 保缓存/失败换模 + 路由状态随分支持久化） | P | MISSING | 低-中 | 模型路由契约（mafw_get_model_route 相邻面） | 04§④D1 |
| 48 | classify / 图像生成一等公民（LLM API 不止 chat） | P | MISSING | 低 | completion 通道扩展（classify/generateImages） | 04§④D4 |

### H. 压缩与记忆

| # | 能力 | 证据矩阵 | 判定 | 价值 | 契约面落点 | 证据指针 |
|---|---|---|---|---|---|---|
| 49 | 压缩实体化 + 策略参数化（compactionId/summary 内容/failed 终态 + trigger/keep/自定义摘要） | C O P D ★(ACP) | PARTIAL | 中 | 事件+选项层：session.compacted 载荷扩展 + prompt contextPolicy | 01§⑥D3；03§3.5#41；04§④B5；05§1/§5 |
| 50 | 记忆召回可观测（memory.recalled 事件 / memoryCitation 消息级引用） | C X | MISSING | 低-中 | 事件层：recall 注入可观测（现为 transform 静默注入） | 01§⑥D2；02§⑤G1 |

### I. 平台工程与互操作

| # | 能力 | 证据矩阵 | 判定 | 价值 | 契约面落点 | 证据指针 |
|---|---|---|---|---|---|---|
| 51 | 沙箱/环境契约（OS 级沙箱声明 + environment 引用参数） | C X G D ★(Cursor) | MISSING | 中 | 能力位层：capabilities.sandbox + task/prompt environment 引用 | 01§⑥G1；02§③；04§3.8；05§7 |
| 52 | 远程执行环境 / exec-server 协议（远端 process/fs/http + 网络策略） | X | MISSING | 低-中 | 动词层：environment 引用占位（不内嵌配置细节） | 02§⑤I1-2 |
| 53 | 实时语音会话（双向流/WebRTC/转写 delta） | X O ★(Gemini Live) | MISSING | 低-中 | 传输通道（现有 TTS 为单向合成，非契约） | 02§⑤I6；03§3.7#47 |
| 54 | 暂停-恢复 RunState（可序列化 run state + 中断续跑同一 turn） | ★ P D | MISSING | 中-高 | 动词层：`turn.suspend/resume(runState)` | 05§4/§9.1#16；04§2.5 |
| 55 | ACP 接入模式（网关作为 ACP agent 被 IDE 复用） | G O D | MISSING | 低-中 | 对外集成面（评估项） | 02§⑤I7；03§3.7#55；05§1 |
| 56 | 遥测契约化（类型化 schema + OTel trace carrier 跨进程续链） | P D ★(OpenAI tracing) | MISSING | 低 | 遥测词汇（网关侧插件非契约） | 04§④F7；05§4 |
| 57 | 进程预热 prewarm / SpareProcess（会话未定先起进程，延迟绑定参数） | C | MISSING | 低 | agentProcess 层扩展（worker 冷启动痛点） | 01§⑥H1 |
| 58 | 会话全文搜索 + 跨会话引用注入（历史作为模型可查询语料） | X D | MISSING | 低-中 | 动词层：session.search（与谐波记忆系统相邻） | 02§⑤A7；04§④F8 |
| 59 | 类型化网关生成（编译期 Host/Client 双面契约 + Peer 角色访问控制 + 冷恢复） | D | MISSING | 低 | 工程方法参照（vocabulary-sync 双向钉扎已有雏形） | 04§④F1 |

> 表内 59 行已交叉去重：hooks（01§③/02§G5/04§E2/05§9.1#5 四处出现）合并为 #1；queue（01§F1/02§B2/03#2/04§A1 四处）合并为 #11；outputSchema（01§C2/02§B4/03#39/04§3.6/05§2 五处）合并为 #9；subagent（01§B/02§H/03#12-14/04§3.6/05§9.1#15 五处）合并为 #5；elicitation（01§A5/02§D6/03#24/04§A5/05§1-2 五处）合并为 #36；checkpoint/rewind（01§A2/02§A9-10/03#44 三处）合并为 #30。

---

## 3. 分层叙述

### Tier 1 —— 已成业界标准 / 多平台收敛，我方缺失（11 条）

**T1-1 认知面 hooks 门控/改写（gate/rewrite）｜收敛 6/6｜PARTIAL｜高**
在工具调用前后、prompt 提交、回合结束等生命周期点上，宿主可以**拦截**（gate）、**改写**（rewrite）、注入（inject），而不仅是观察。最小公分母是 pi/dsh 桥接的 Claude Code 四件套（UserPromptSubmit/PreToolUse/PostToolUse/Stop）；最富实现是 Claude SDK 的 33 hooks——PreToolUse 可 `updatedInput` 改参后放行、PostToolUse 可 `updatedToolOutput` 改写输出、Stop 可 block 强制续跑，加上 OpenAI guardrails 把守卫插进审批流之前（preApprovalInputGuardrails）；Codex 14、Gemini 11（含独有的 BeforeToolSelection）、pi 25+（返回值效应六分类）、dsh waterfall（agent/pre-step 权威 reject/enter）各有效应语义。我方 HostAdapter 认知面四动词（observe/injectContext/injectSystem/tools）只有注入+观察两个方向，审批钩子 applyApprovalPolicy 是事件驱动 facet、改不了工具入参。落点 = 认知面扩成六动词。Claude Code 已把"规则必须落成 hook 而非 prompt 指令"写进文档——这是把安全边界从提示词升级为协议的位置，也是本次研究公认的最大结构性缺口（01/02/04/05 四份报告独立列为首位或次位）。

**T1-2 子代理全栈｜收敛 6/6｜PARTIAL｜高**
runtime 原生的子代理 spawn（前台/后台）、生命周期事件、血缘目录、代理间消息与结构化结果。最小公分母是 opencode 的 `subagent{background:true}` 工具（后台返回 sessionID 续聊 + parentID 天然成树）；最富实现是 dsh 六 provider（spawn/fork/acp/codex/claude-code/dsh-sdk）+ sendMessage/interrupt(authority)/drainDescendants + SubagentResult.structured（outputSchema 校验），Claude 则有行为级 AgentDefinition（background/observer/memory/autoCompactWindow）+ task.\* 消息族 + getSubagentMessages 回读，Codex 以 collabAgentToolCall 十动词 + subAgentActivity item + parentTurnId 归属链表达。我方有 session.children + parentID 事后识别（PARTIAL），但无 canonical 事件词汇（设计 §1 已定 F6 drop/延期）、无 spawn 动词、desktop 面板纯靠推导。落点 = DTO 预留 parentSessionId/depth + `task.*` 事件族占位（与 T1-8 合并设计）；goal 并行 wave（explore/review 只读节点）是最直接收益。

**T1-3 回合级结构化输出 outputSchema｜收敛 6/6（turn 级 4+MCP）｜PARTIAL｜高**
对 agent 回合最终输出施加 JSON Schema 约束 + 校验失败自动重试 + 终态分类。最小公分母是 opencode 的 prompt `format: OutputFormat{json_schema{schema,retryCount}}`；最富实现是 Claude 的 StructuredOutput 工具交卷机制（校验错误定位到 key/枚举/长度 + `error_max_structured_output_retries` 终态）；Codex 把 outputSchema 做成 turn/start 参数且粘滞后续 turn；dsh SubagentResult.structured 经 outputSchema 校验；MCP structuredContent 是 stable spec（工具结果层）。我方仅 CompletionRequest.responseFormat 覆盖无状态单次补全通道，SessionPromptOpts 无 per-turn 约束。落点 = 选项字段层加 `outputSchema`；goal 编排的 plan/execute/review 产物解析（waves.json/receipts 双门判定）可直接换成 schema 门，是六平台全收敛里性价比最高的增量。

**T1-4 工具注解 + 结构化工具结果（MCP 对齐）｜收敛 5/6（O 未证实消费）｜MISSING｜高**
工具声明携带风险注解（readOnlyHint/destructiveHint/idempotentHint/openWorldHint）与呈现元数据（kind/title/locations/icons），结果携带经 outputSchema 校验的 structuredContent，形成 content（模型）/structured（程序）/details（UI）三通道。这是本次研究**标准硬度最高**的缺口：MCP 2025-06-18/11-25 stable + ACP ToolKind 分类学双规范背书；实现侧 pi 最完整（annotations + exposure 五级 + 三通道），Claude 有 45 个结构化 per-tool Input/Output 形态，Codex mcpToolCall 带 readOnlyHint/mcpAppUi，dsh 有 outputSchema 校验。我方 TOOL_CLASS 8 类是自建静态分类学（读方向归一），但注册面无 annotations 透传、tool part output 无 schema 约定——接入 MCP server 时注解信息被直接丢弃，而这恰是审批决策与 UI 呈现的输入。落点 = 工具层（MafwToolRegistration/NativeToolDeclaration + tool part state.structuredOutput）。

**T1-5 thinking/effort 控制面 + signature 保真｜收敛 6/6｜MISSING｜高**
推理深度的参数化控制与推理连续性签名的保真透传。档位面：最小公分母是各家枚举（Codex turn effort、dsh initialize reasoningEffort、opencode reasoning_options variants）；最富是 pi 七级 + thinkingBudgets 每级 token 预算 + thinkingLevelMap 模型映射 + 运行期 set/cycle；Anthropic 已到 always-on adaptive thinking + effort 参数（Opus 5.5 思考不可关闭）；ACP thought_level 是 stable config category。签名面：Gemini encrypted thought signatures 严格校验（缺失即 400）、Anthropic thinking signature 多轮回放必需、pi 在跨 provider 交接时自认丢弃 thinking 块。我方 reasoning part 只读展示、无等级/预算控制、无 signature 透传位——多 runtime 归一化时丢签名是**隐性正确性风险**（严格校验模型直接拒绝请求）。落点 = DTO 加 signature 透传位（P0 级）+ prompt 加 effort/thinkingLevel 选项（P1 级）。

**T1-6 服务端队列/inbox｜收敛 5/6｜PARTIAL｜高**
busy 会话的提交排队成为服务端一等状态：可观测、可取消、可重排、幂等。最小公分母是 Claude 的 priority now/next/later + queued_turn_count + cancel_queued + interrupt 回执（still_queued）；最富实现是 opencode 持久 inbox（delivery:'queue'、PATCH/DELETE 取消待处理输入、幂等 id、resume:false 仅入队、Move 项可见）与 Codex thread/queue 六动词（add/list/update/delete/reorder/start）+ turn/steer 的 expectedTurnId 乐观并发 + NonSteerableTurnKind 例外集；pi 双队列各自 one-at-a-time/all 模式 + queue_update 全量队列事件 + clear_queue；dsh 有 agent/inbox/\* 四事件 + updateQueue。我方 delivery 只有 steer/followup 二值（pi 映射 streamingBehavior、opencode 忽略），排队仅存在于 TUI 客户端，abort 后 queued 消息行为未定义。落点 = 动词层 prompt 增 queue/取消/幂等 id + 事件层 queue.updated；这是"goal 派发不丢消息"的运行时中立原语。

**T1-7 持久事件历史 + seq 游标续传｜收敛 6/6｜MISSING｜高**
事件持久化为带序号的历史，客户端持"最后已提交 seq"即可断线续传（先重放后直播）。最小公分母是 Claude sessionStore 转录镜像（@alpha dual-write）；最富实现是 dsh follow（打开快照 + 无缺口 durable 帧 + 可选瞬态 assistant-stream，以最后 seq 续传）+ page 向后游标分页；opencode v2.session.history/events + SessionDurableEvent 是现成可消费面；pi-durable watchEvents（snapshot + 事件批，慢消费者折叠）；ACP v2 resume 带 replayFrom（draft）；Codex rollout JSONL + rejoin。我方 SSE 断线重订阅即断档——serve watchdog 重启必须重订阅否则自动化触发器与桌面转发全部静默失效，是 AGENTS §5.15 已文档化的生产脆弱性；历史 normalize 恒 flat 属全量回放、无增量游标。落点 = 动词层 `session.events(after)`（opencode 先行、pi 快照兜底）。

**T1-8 后台任务 / durable task 实体｜收敛 6/6｜PARTIAL｜高**
与对话回合解耦的后台执行单元：五态状态机（working/input_required/completed/failed/cancelled）、轮询/订阅取果、跨端续接。标准面 MCP tasks 扩展 2026-07-28 转正；最小公分母是 opencode 的 shell{background:true} + 完成通知 + /api/shell 路由与 session.background（同步子代理转后台）；最富实现是 Codex cloud tasks（7 天状态恢复 + ApplyOutcome 把云 diff 应用回本地）与 pi-durable（commit 先于展示、崩溃环停车 parked + retryTask、requestId 幂等提交、sleepUntil 存储型睡眠）；dsh 有 jobs 三工具 + 后台完成经 agent.inject() 通知回流；Claude 有 backgroundTasks/stopTask/perTaskStopAffordance。我方异步单元 = 会话回合（promptAsync + SSE + messages 查询），形态成立（00 ⑤#12 HAVE），但无 task-handle 查询面、opencode v2 原语未收编、BudgetGuard 的 step 计数会被长工具卡死。落点 = 动词+事件层 task.submit/get/cancel + task.updated，与 T1-2 子代理词汇合并设计。

**T1-9 会话配置选项（sticky 切换 + config 事件族）｜收敛 6/6｜PARTIAL｜高**
会话级 sticky 配置的运行期切换动词 + 配置变更事件 + 联动完整返回。ACP v1 stable 定义了 config_option 四分类（mode/model/model_config/thought_level）+ set_config_option 返回完整联动状态 + config_option_update 主动变更；opencode 有 v2.session.switchAgent/switchModel（后续 provider turn 生效）+ AgentSelected/ModelSelected 消息；Claude 有 setModel/setMaxThinkingTokens/setPermissionMode/applyFlagSettings；pi 有 set_model/cycle_model/set_thinking_level + thinking_level_changed 事件；Codex 有 thread/settings/update 与 turn/settings/update（粘滞）；dsh 有 selectModel/initializeDefaultModel。我方模型/agent 是 per-prompt 参数（每次重发）、permission_mode 是唯一会话级档、agent.switched/model.switched 事件被 drop。落点 = 动词 setConfigOption + 事件 session.config/switched；UI 状态与 runtime 真值同步的直接解法。

**T1-10 StopReason / 错误码终态分类｜收敛 6/6｜PARTIAL｜高**
回合终态的语义分类枚举 + 结构化错误码。ACP StopReason 五值（end_turn/max_tokens/max_turn_requests/refusal/cancelled，v2 增 error）是 stable spec；dsh TurnEndReason 七分（含 blocked/interrupted 崩溃恢复合成/forked 种子合成）；pi stopReason 六值；Codex CodexErrorInfo（contextWindowExceeded/sessionBudgetExceeded/rateLimitExceeded/tooManyDenials…）；Claude TerminalReason（error_max_budget_usd/error_max_structured_output_retries）。我方 turn.completed/failed/aborted 三元组 + MafwMessage.finish 原生透传（PARTIAL），但无 canonical 枚举、无错误码契约——上层无法区分"模型拒答"与"配额截断"与"预算硬停"，跨 runtime 重试/降级决策失去依据。落点 = 事件载荷层加 stopReason + error.code，改动极小、杠杆极高。

**T1-11 Elicitation 结构化表单（form + url + timed）｜收敛 6/6｜PARTIAL｜高**
结构化表单式人机交互：受限 JSON Schema 表单（扁平对象 + 原始类型 + 枚举 + 默认值）与出站 URL 交互（OAuth/敏感凭据，凭据不过客户端）。MCP 2025-11-25 stable（SEP-1036 url mode）+ ACP stable（必须展示完整 URL 并获同意）双规范背书；Claude 有 onElicitation + Elicitation/ElicitationResult hooks + property_order；Codex mcpServer/elicitation/request 支持单选/多选/数字/布尔富表单；opencode 有 Form.\* 系统 + MCP elicitation（**网关不代理则用户侧只见卡死**）；pi 有 RPC 扩展 UI 子协议；dsh 有 user-questions waterfall + ask_user timed 模式（超时返回 pending、答案以 late user/message 到达）。我方 question.asked/replied 是纯文本问答（answers: string[][]）——无 schema 表单、无 URL 模式、无超时语义。落点 = question.asked 载荷增 schema/mode:url/timed。

### Tier 2 —— 主流采用中，值得跟进

- **检查点自动化 + 组合 rewind**（C/G/O；中-高）：我方 fork/revert/unrevert/diff/revertDiff 动词集已是业界最全档（00 ⑤#1 HAVE），缺的是 Gemini 式"修改前自动影子 git 快照 + 会话/文件/两者三态选择 + 恢复后重提议原 tool call"与 opencode v2 staged revert（含未跟踪文件）。落点 = session.checkpoint/restore；改造面小、用户可见度高。
- **暂停-恢复 RunState**（OpenAI/MCP tasks/ACP v2/pi-durable/dsh；中-高）：四个独立来源同一方向——"暂停-恢复"正在取代"打断-重来"（05 §9.3#2）。我方 abort 是终态、fork 是历史分叉，均非"暂停后恢复同一 run"。落点 = turn.suspend/resume(runState)。
- **data part 类型化自定义数据**（AI SDK 6；中-高）：MafwPart 封闭枚举使 usage/plan 成为特权内置，上层应用无法附带自有结构化数据并渐进更新（同 id 调和、transient 不入历史）。落点 = 开放 `data-{name}` 变体；desktop 工具卡/泳道图可直接受益。
- **系统提示分段/快照 + 每会话 instruction 条目**（C/O/P/D；中-高）：MAFW 每轮注入 memory-guide/user-profile/agent-priors 三块、边界 recall 是 per-turn 动态注入，天然破坏前缀缓存；opencode 的 instructions/entries 是压缩免疫 + 免每轮注入的原生载体，Claude 的 snapshot/boundary 语义可显著提缓存命中。对记忆披露层是更优载体。
- **能力发现契约（skills/AGENTS.md/命令广播）**（★/X/G/O/P；中-高）：AGENTS.md 已完成 Linux Foundation 中立化（60k+ 仓库），ACP available_commands_update 是 stable；我方 mafwCommands 非契约发现、W2 skill 物化只写文件。提供发现/加载动词可零成本收割生态。
- **citations/source part**（★/X/D；中）：AI SDK 独立 source part 与 Gemini 行内 annotation 是两种竞争形态，设计为"独立 part + 可选 spans"可同时兼容；00 ⑤#10 判 ABSENT。websearch 结果现为非结构化 tool part。
- **notice 瞬态通知**（★ACP；中）：非历史 severity 通道，现在只能占用 assistant 消息表达告警。
- **命令执行/文件变更一等 part**（X/O/★；中）：commandActions 管道级解析、exitCode、durationMs、PatchApplyStatus 状态机——审计与 UI 刚需，现为笼统 tool 快照 + 透传变体兜底。
- **生成型媒体 part**（X/G/★；中）：输出侧图像生成/流式语义（00 ⑤#11 PARTIAL），现为文本标记协议 + 工件 URL，非 canonical part。
- **tool.delta 落地**（★AI SDK；中）：input/output 增量已设计（v3 kind 扩展）未实现，实现对齐 AI SDK 文本增量式。
- **会话中动态增删工具**（C/P/D；中）：goal 按节点换工具面目前靠身份物化，消息级 tool_addition/removal（保缓存的 inline 变更）是更细粒度。
- **双向工具面**（X/P/★；中）：runtime 委托宿主执行工具（Codex item/tool/call DynamicToolSpec、pi ctx.executeTool 嵌套调用）——与现有 /api/tools/execute（gateway 提供工具给消费方）方向相反。
- **MCP 生命周期管理面**（C/X/O；中）：现仅配置文件自接线，无健康观测（mcp.tools.changed 被 drop）、无 OAuth 型 server 支持。
- **会话可携带性 export/import/move**（C/X/O；中）：00 ⑤#7 判 ABSENT；TUI /export 是自研 Markdown，原生 JSON export（含脱敏）是备份/迁移/评测数据源。
- **多客户端 rejoin + 在途审批重投**（X/C；中）：SSE 断连重订阅后 pending permission.asked 是否可见未定义，正对应 Claude reinitialize 的在途控制请求重投。
- **审批精细化**（C/X/D/★；中）：在已有 once/always/reject + suggestedRule + 规则沉淀之上，缺 cancel、reject_always（ACP stable）、amendment 式"批即改策略"（Codex）、turn 粒度授权与 plan/dontAsk 档语义。
- **审批审计对会话日志化**（D；中）：decision-log 已有 jsonl（P1.5 校准数据），对齐 dsh 的 approval/asked+decided log-only 入会话日志，让审批历史随会话可回放。
- **模型容错**（C/X/G/P；中）：fallbackModel 链、model/rerouted 事件、supersedes 消息撤回——我方只有 turn.failed 单一信号，message.superseded 值得预留。
- **重试可见性**（C/X/O/P/D；中）：dsh assistant/attempt 把失败尝试（含原始流）持久化、pi auto_retry 事件族呈现"第几次尝试/退避多久/最终错误"；我方 retried 事件是 drop 行，turn.failed 只见终态。
- **usage 完备语义**（C/X/G/D/★；中）：缺 cacheWriteInput、modelContextWindow、costBasis 价目基准审计、currency（ISO-4217）、per-model 累计口径（usage vs modelUsage 双口径）；UsageDock 可直接吸收字段级形态。
- **上下文逐类 token 分解**（C/X/G；中）：getContextUsage 逐类分解（mcp_tools/memory_files/agents/skills 逐项 + deferred 类）——recall 注入预算从拍脑袛建成可核算。
- **压缩实体化 + 策略参数化**（C/O/P/D/★；中）：compactionId 寻址 + summary 内容回传 + failed/cancelled 终态（ACP stable）+ trigger/keep/excludeTools 参数（Anthropic）+ 自定义摘要钩子（PreCompact 挂点恰是谐波记忆参与压缩提示词的天然入口）。
- **沙箱/环境契约**（C/X/G/D/★；中）：OS 级沙箱超出网关能做的（审批门控），但 capabilities.sandbox 能力位声明可让 auto 档参考"沙箱内自动放行"；environment 引用参数为云任务占位。
- **settled/wait 二段终止**（P/D；中）："回复完成"在重试/压缩/排队/子代理下是分布式的，需要权威"无自动延续"信号与可组合 wait 原语。
- **步前准入瀑布**（D；中）：dsh agent/pre-step 权威 reject/enter(messages) 是比 turn 级 permission 更细的控制面，可作 gate 动词的 step 粒度变体。
- **委托工作链归属**（X；中）：parentTurnId/rootTurnId 让跨线程任务的因果链可归因（谁的活），对 usage/审计/树状 UI 都关键。

### Tier 3 —— 早期探索，可提前占位

- **ACP v2 upsert 三态 patch 语义**（省略=不变/null=清除/值=替换）：part.updated/complete 载荷设计时预留 null=清除，历史 normalize 管道先支持，避免未来二次破坏（05§9.2#2）。
- **MCP MRTR 待答请求统一**（input_required → inputResponses 重试原调用）：permission.asked/question.asked 可统一为"待答请求"抽象留位（05§9.2#3）。
- **会话级聚合状态**（running/idle/requires_action）：ACP v2 draft；新增 state.updated 事件即可平移（05§9.1#17）。
- **steer 边界策略参数**：delivery:'steer' 增 boundary:'immediate'|'next-tool'|'next-turn'，对齐 Cursor 2026-08 的"排队至工具边界"实践——我方领先项的增强而非缺口（05§8#6）。
- **行内引用 spans 兼容**：source part 设计为"独立 part + 可选 spans"，同时兼容 AI SDK 与 Gemini 两种模式（05§9.2#7）。
- **虚拟模型路由**（pi）：per-request route + sticky 保缓存 + 路由状态随分支持久化——mafw_get_model_route 的契约化方向（04§④D1）。
- **classify/图像生成一等公民**（pi）：LLM API 契约不止 chat，classify(choice/score/bool) 与 generateImages 可枚举为模型类型（04§④D4）。
- **约束采样**（pi）：constrainedSampling strict json_schema prefer/require——工具参数正确性的 provider 侧保证（04§④D5）。
- **工具结果外溢 spill**（dsh）：超限内容存 artifact 返回 locator + 头尾 + retrievalHint，fork 继承——大输出的"地址化"替代截断丢失（04§④C4）。
- **工具暴露分级 + tool_search**（C/P/D）：deferred/hidden/namespace + 延迟激活，大工具集（MCP 时代）的上下文经济性方案（01§⑥E2；04§④C1）。
- **PTY 持久终端**（X/O/D）：persistent-pty handoff 是长交互进程跨会话接管的唯一原生通道（03§3.7#46；04§④C6）。
- **会话目录服务**（X/O）：分区 sections/附件关联（PR↔thread）/全文搜索/归档——会话从"列表"升级为"可检索目录"（02§⑤A2-7）。
- **读未读回执 + revision CAS**（X）：多设备同步的会话元数据乐观并发范本（02§⑤A4）。
- **thread/sample 采样与预测**（X）：在 ephemeral fork 上捕获一次模型响应而不执行——投机预取原语（02§⑤J6）。
- **AI 审批者路由**（X）：approvalsReviewer=auto_review/guardian_subagent + 断路器 + 人工推翻——审批面本身可编程（02§⑤D2）。
- **Ralph 循环 / Agent Teams**（dsh）：fresh-agent 每轮全新子会话 + 有界结构化 handoff、团队任务板——goal 层编排词汇借鉴（04§④E4）。
- **taskBudget 模型自节流**（C）：与 maxCostUsd/BudgetGuard 形成三层预算（模型自知余量→客户端硬停→网关兜底）（01§⑥C4）。
- **记忆召回可观测**（C/X）：memory.recalled 事件 + memoryCitation 消息级引用——让"本轮想起了什么"对 UI 可见（01§⑥D2；02§⑤G1）。
- **verbatim 逐字投递**（C）：防 injectContext 注入物被 runtime 的 @file/slash 展开语义污染（synthetic 标记是部分防线）（01§⑥F2）。
- **进程预热 prewarm**（C）：会话未定先起进程、claim 时延迟绑定 cwd/model/permissionMode——worker/media 会话冷启动痛点（01§⑥H1）。
- **遥测契约化**（P/D/★）：类型化 schema + OTel trace carrier 存进任务 JSON 跨进程续链（04§④F7）。
- **ACP 接入模式**（G/O/D）：网关若说 ACP 可直接被 JetBrains/Zed 等 IDE 复用——对外集成面评估项（02§⑤I7；03§3.7#55）。
- **类型化网关生成**（dsh typert）：编译期从 ts.Program 生成 Host/Client 双面契约——我方 vocabulary-sync 双向钉扎测试的工程化延伸（04§④F1）。
- **会话全文搜索 + 跨会话引用注入**（X/D）：历史作为模型可查询语料、跨会话快照注入为 durable 不可信上下文——与谐波记忆系统互补的会话内形态（02§⑤A7；04§④F8）。
- **实时语音会话**（X/O/★）：双向流（输入音频 + 转写 + 输出音频）是另一条传输通道的会话形态，现有 TTS/VAD 管线为单向非契约（02§⑤I6；03§3.7#47）。
- **远程环境 / exec-server**（X）：远端 process/fs/http 完整分协议——task/prompt 预留 environment 引用参数即可占位（02§⑤I1-2；05§9.2#8）。

---

## 4. 我方反向优势（业界没有而我们有的——保持并强调）

1. **多 runtime canonical 契约本身**。业界没有任何一家做跨 harness 归一：ACP 是 client↔agent 层但面向单 agent；dsh 事件溯源是单平台内部哲学；pi/dsh/Claude 各自为政。MAFW 的 platform@dialect 寻址（@v1/@v2 双表 + 自适应探测）、词汇单源（SDK events.ts ↔ mafw-vocabulary.ts 双向钉扎）、flat DTO + egress shim 单点、conformance/dry-event 门禁，是本次调研确认的**独有资产**——六份报告的所有"缺口"都只在"单个 runtime 能力"意义上成立，而"把 N 家归一到一套词汇"只有我们在做。
2. **delivery:'steer' 先行**。Cursor 2026-08 才把"steering 排队至下一工具边界而非打断"产品化并作为 changelog 亮点，ACP v2 仍把 queued-work 列为未来流程；MAFW 已有 steer/followup 二值语义且 pi 侧真实映射 streamingBehavior。缺的只是 boundary 参数与队列可见性（见 T1-6），领先地位成立。
3. **maxTurns/maxCostUsd 预算三件套 vs pi/dsh 双双缺失**。pi 的 BudgetGuard 已从当前仓库移除（token 预算仅剩 thinkingBudgets/压缩预算），dsh 仅 SDK initialize maxTokens（输出上限），两家均无每-run 成本/轮次上限；Claude/Codex 的 maxBudgetUsd 也只是 Options 字段。MAFW 有 prompt 级预算字段 + turnBudgetApi 能力位 + BudgetGuard 网关兜底三层——**但接线有断裂（§5.1），领先项尚未兑现为通用能力**。
4. **谐波记忆 vs auto-memory**。Claude auto-memory（select/synthesize 双模 + 三 scope）与 Gemini Auto Memory（后台挖掘 + inbox 人工审批）都是浅层实现；MAFW 的 BM25/dense RRF/能量衰减/ACT-R 检索结算/巩固合并/supersede 链/pinned/sticky/权威标签远超两者。可借鉴的只是"召回可观测事件"（Tier 3），机制本身是设计分歧不是缺口（01§⑥D2 明判）。
5. **gateway 侧 scheduler / goals / automation / 身份层 / 审批三档**。Codex 的 thread/goal 对象（objective + tokenBudget + status）刚起步，dsh goals 是工具级语义（maxGoalRounds + CAS revision + armed/disarmed 刻意不持久），Claude 的会话内 cron 是工具形态；MAFW 的 goal 编排（NodeDriver + 泳道可视化 + watchdog 恢复）+ IdentityRegistry 身份物化三车道 + 审批三档预设（read-only/auto/full-access + 25 次预算回落）+ automation rules 是编排面整体领先。dsh goals 的"轮上限 + blockedReason + 人工再武装"三件套防失控设计值得互鉴（04§④E5）。
6. **检查点/回滚动词集**。fork(sessionID,messageID) + revert/unrevert + diff + vcs.apply + hunk 级反向回退（revertDiff）——Claude 无 unrevert、pi revert 不可逆、ACP fork 仍在 RFD；00 ⑤#1/#8 双判 HAVE，是契约面最完整的域之一（缺的只是自动化与组合语义，见 Tier 2）。

---

## 5. 附带发现（非契约缺口，但需行动）

### 5.1 maxTurns/maxCostUsd 内部接线断裂（P0，接线问题非契约问题）

契约字段存在（contract.ts:129-132 + turnBudgetApi 能力位），但：① opencode adapter 实际只透传 parts/agent/model/variant/system/noReply——delivery/maxTurns/maxCostUsd 静默丢弃（opencode-adapter.ts:110-121，SDK 无对应字段）；② HTTP 面 `POST /api/session/:id/promptAsync` body 只解构 {message, parts, agent, model}，预算字段不在暴露面（index.ts:5738-5760）；③ 预算仅 goal 会话经 BudgetGuard 兜底（attachBudgetGuardForGoal 读 policySnapshot）——**非 goal 的普通会话无任何预算控制**。修复路径：HTTP 面接收预算字段 + 普会话 BudgetGuard 挂载（或 SDK 出字段后透传）。（00§①.2/§⑤#9；AGENTS §5.19）

### 5.2 opencode-adapter.ts:286 permissionReply 疑似调用不存在成员（待验证）

adapter 调 `(client.session as any).permission.reply(...)`，但 SDK 1.18.21/1.18.30/1.19.3 的 v2 兼容类 Session2 **没有 permission 成员**（运行时实例化实测 undefined → 调用即 TypeError）；正确面是 `client.permission.reply`（全局）或 `client.v2.session.permission.reply`（v2 会话级，参数形状与现调用完全吻合——疑似漏写 `.v2`）。编译产物同样带此调用（dist/opencode-adapter.js:243）；hook 路径 fail-open 会掩盖（自动应答静默失败），HTTP reply 路由会 500。**serve 当前未运行，未能活体复现**——列入契约测试修复清单。（03§3.0）

### 5.3 pi 仓库改名 + BudgetGuard 移除（方言表与依赖需更新）

badlogic/pi-mono 已整体迁移为 earendil-works/pi（GitHub 301 重定向），npm 作用域 @mariozechner/pi-\* 全部改名 @earendil-works/pi-\*（pi-coding-agent 现为 1.4.0）；早期调研引用的 BudgetGuard 在当前仓库已检索不到（文档级反证，未逐行见源码）。我方 pi runtime 的依赖与方言表若引用旧包名需更新。（04§①）

### 5.4 仓库 3 份 SDK 副本版本漂移

gateway 1.18.21 / root 1.18.30 / npm 1.19.3 三副本并存；1.18.21→1.19.3 实 diff 仅 4 处类型微调（API 零增量），但升级需三处对齐。另：SDK2 客户端只覆盖 v2 OpenAPI 146 操作的一部分，v2 新面（forms/voice/shell 路由/fs.write/session import-export/instructions 等）只能直连 HTTP——消费策略债需登记。（03§①/§2.4）

### 5.5 工程卫生杂项

route-catalog.ts 文件头"94 条 operation"注释已过时（实际 SDK_FACING 110 条）；`session.command` 为 openapi 转录的悬空登记（无 handler、SDK 未暴露）——Phase 3 前的已知状态，建议顺手清理注释。（00§④）

---

## 6. 优先级建议

### P0 —— 接线修复与正确性（零/低契约变更，先于一切新能力）

1. **预算接线**：HTTP promptAsync 面接收 maxTurns/maxCostUsd + 普通会话 BudgetGuard 挂载路径（兑现既有契约承诺；这是对 pi/dsh 的领先项，接线断裂等于自废武功）。
2. **permissionReply 断线**：活体验证 §5.2 → 修复（补 .v2 或改 client.permission.reply）+ 契约测试钉扎。
3. **signature 透传位**：reasoning/tool part 增可选 signature 字段、normalize 管道保真——多 runtime 归一化的隐性正确性风险（Gemini 严格校验 400、Anthropic 多轮 thinking 回放拒）。
4. 工程卫生：SDK 三副本对齐策略、pi 方言表包名更新（@earendil-works/pi-\*）、route-catalog 注释。

### P1 —— Tier 1 契约扩展（一揽子 canonical v3.x minor，按价值排序）

1. **工具面 MCP 对齐包**：annotations + outputSchema + structuredOutput + kind/title（#21/#22）——stable spec 对齐、最大收敛面、审批/UI/桌面全受益。
2. **回合级 outputSchema + StopReason**（#9/#10）——一个选项字段 + 一个载荷字段，goal 编排产物解析直接换 schema 门。
3. **队列/inbox 双件套**：delivery:'queue' + prompt 取消 + 幂等 id + queue.updated（#11）——goal 派发可靠性。
4. **持久事件历史**：session.events(after)（#28）——根治 serve 重启事件断档，opencode 先行、pi 快照兜底。
5. **thinking/effort 选项**（#41 控制面半）——prompt effort/thinkingLevel 选项字段。
6. **子代理 + 后台任务词汇占位**（#5/#6）——DTO parentSessionId/depth + task.\* 事件族 + task.submit/get/cancel，一次设计合并落位。
7. **认知面 gate/rewrite 六动词设计**（#1）——设计先行（挂 claude adapter Phase 2 与 v2 插件迁移），实现分期。
8. **elicitation 表单载荷**（#36）——question.asked schema/mode:url；MCP elicitation 到达即不再卡死。

### P2 —— Tier 2 跟进（按 §3 Tier 2 排序推进）

检查点自动化 → RunState → data part → instruction entries/提示分段 → 能力发现 → citations → notice → 命令/文件一等 part → 审批精细化 → 模型容错/重试可见性 → usage 完备化 → 压缩实体化 → 上下文分解 → 沙箱能力位 → 会话可携带性 → 其余。

### 若只做三件事

**第一件：P0 接线修复包**（预算 HTTP 面+普会话兜底、permissionReply、signature 透传）——不是新能力，而是让既有契约承诺兑现；预算与审批是我方对 pi/dsh 的两张领先牌，接线断裂意味着领先只存在于纸面，而 signature 是归一化管线的正确性风险。**第二件：工具面 MCP 对齐包**（annotations + outputSchema + structuredContent + kind/title）——本次研究中标准硬度最高的缺口（MCP+ACP 双 stable），改动集中在 mafw-tools.ts 与 tool part 快照、不动 DTO/动词骨架，却让审批决策、工具卡渲染、跨 runtime 桥接同时受益。**第三件：队列 inbox + 持久事件回放**——网关作为基础设施的立身之本：前者根治"goal 派发在 busy/abort 边界丢消息"（五平台已收敛的服务端语义），后者根治"serve 重启事件断档"（AGENTS 已文档化的生产脆弱性），两者共同把 MAFW 从"能用的转发层"升格为"可靠的消息基础设施"。若有第四件，做回合级 outputSchema + StopReason——六方收敛、改动最小、goal 编排直接换 schema 门。

---

## 7. 来源索引

| 文档 | 内容 | 本文引用密度 |
|---|---|---|
| `00-our-contract-inventory.md` | 我方契约精确盘点：RuntimeClient 全动词/选项表、24 事件词汇、MafwPart 全形态、164 路由、14 项重点核查判定、设计-实现 delta | 基线权威——所有判定的 HAVE/PARTIAL 出处；§⑤ 判定表被反复引用 |
| `01-claude-agent-sdk.md` | Claude Agent SDK 0.3.306：Options 65 字段、33 hooks、39 SDKMessage、Query 方法、§⑥ A-I 前沿清单、Top 10 | Tier 1 #1/#2/#3/#5/#6/#9/#10/#11 的最富实现端证据 |
| `02-codex-gemini.md` | Codex app-server（~135 方法 + 89 通知 + 22 item 类型 + turn 参数面）+ Gemini CLI 22 项能力；§A-J 缺口表（已按 AGENTS §5.19 勘误） | 队列/审批精细化/命令文件一等 part/沙箱/远端环境/目录服务的主要来源 |
| `03-opencode.md` | opencode 真实面：SDK1/SDK2 全枚举、v2 OpenAPI 未覆盖面、60 项缺口表、tasks API 不存在的反证、§3.0 permissionReply 断线 | 持久事件历史/inbox/子代理/sticky 切换/instruction entries 的来源；§5 附带发现 5.2/5.4 唯一出处 |
| `04-pi-dsh.md` | pi（含 pi-durable/chord/virtual-models）+ dsh（Cordis 事件族/Typert/子代理六 provider/审批/spill/token-meter）；§④ A-G + 反向发现 G1-G3 | settled/wait/重试可见性/事件溯源/结构化结果三通道的来源；§4 反向优势 3/5 的出处；§5.3 唯一出处 |
| `05-industry-frontier.md` | ACP v1/v2、MCP 2026-07-28、AI SDK 6、OpenAI Agents、Anthropic/Gemini API、产品级前沿（云代理/SDD/AGENTS.md）、流式语义；§9.1 已成标准 18 条 + §9.2 占位 10 条 | Tier 分档的判定基准（已成标准/主流采用/早期探索）；工具注解/配置选项/StopReason/notice/elicitation 的 stable spec 出处 |

> 交叉一致性说明：四份平台报告（01/02/03/04）对 hooks、queue、outputSchema、subagent、checkpoint、elicitation 的独立发现已互相印证并在 §2 总表合并；05 的档位判定（已成标准/主流采用/早期探索）用作 Tier 划分基准；所有与 00 冲突处（02 勘误行）已按 00 为准修正。
