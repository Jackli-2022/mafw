# 海马层重构调研：职能清单 × LLM 边界 × 管线归位（2026-10-10）

> 三个问题：①海马体到底要干什么（完整职能清单）②哪些环节必须过 LLM ③turnCompress / reflection 在目标架构里放哪。
> 方法：四线并行调研（海马职能清单 / 业界 verbatim 层 / 机械捕获与成本 / 分阶段架构与调度，引文核验）+ 本地核对（C0 实施状态、t1 数据规模、成本结构、2026-09-23 双系统 spec 前史）。
> 起因：`2026-10-10-memory-architecture-brain-survey.md` §2.4 海马映射修正——turnCompress 做的恰是海马不做的两件事（写时抽象、写时选择）。
> 结论形态：诊断 + 分级选项（V1-V3）+ 成本；重构决策留给用户。

---

## TL;DR

1. **海马八个职能，七个是机械的**（哈希/嵌入/图操作即可实现，零语义理解）；唯一必须语义理解的是**皮层巩固**（gist/图式提取）。脑的实现恰好是 AI 该抄的分工：**零推理热路径 + 预算受限的批处理语义层**。
2. **LLM 边界**：捕获（海马层）不过 LLM——嵌入、BM25、实体收割（GLiNER 50M 匹敌 ChatGPT zero-shot NER）、novelty（1−maxCosine）、MinHash 标记、机械 salience 全部可行且比 LLM 便宜 2-3 个数量级。必须过 LLM 的只有三个操作：**跨会话聚合、冲突判定（identity）、gist 综合**——全部可推迟到离线巩固。
3. **turnCompress 不是海马，是"快巩固"**（awake replay / SWS 快路径）；**reflection 是"深巩固"**（sleep 整合）。两者都保留但**重定位**：从「准入关 + 唯一检索面生产者」降为「皮层学习者」——不写也不丢（raw 层永远可检索），选择错误从不可恢复变成软失败。
4. **数据已经在**：t1_archive 51616 回合 / 533 会话，只写不读。缺的不是存储，是检索面 + 巩固层读原文 + provenance 修复。

---

## 1. 海马体职能完整清单：八个职能，七个机械

### 1.1 子区职能分工

| 子区 | 计算 | 速度 | 存储 |
|---|---|---|---|
| **DG**（齿状回） | 模式分离：稀疏扩张重编码（LSH 同构）——相似输入正交化；成年神经genesis 防分离器饱和 | 在线，逐事件 | 不存（是变换不是存储） |
| **CA3** | 三合一：自联想补全（部分线索→完整吸引子，Nakazawa 2002 *Science*）；一次性绑定（Marr 1971——任意共现特征绑成一个 episode 码）；**比较器/新颖性检测**（Lisman & Grace 2005——CA3 内部预测 vs EC 输入，失配=新颖） | 单次暴露；吸引子收敛数十 ms | 相关矩阵（=索引） |
| **CA1** | 预测×当前感觉的合取计算；表征跨天-周缓慢漂移（Ziv 2013 *Nat Neurosci*——时间上下文信号）；时间细胞 | 在线 | 预测+状态合取、序列/时间标签 |
| **Subiculum** | 输出枢纽 | 在线 | 整合输出码，非内容 |
| **EC**（内嗅） | 皮层漏斗（全部皮层流压缩进入）；网格细胞=速度积分器（机械累加器） | 在线，连续 | 当前状态估计，非 episode |

### 1.2 关键特性

- **编码特征**：单次暴露、无复述（Ison 2015 人类单神经元一次呈现即绑定新刺激）；绑定的是 **what × where × when 的任意合取——元组，不是意义**；突触诱导 <1s，theta 周期内成型。
- **编码不筛选**：照单全收（McClelland 1995 CLS）；**筛选发生在巩固侧**——早时相 LTP 1-3h 内衰减，除非被"标记"（Frey & Morris 1997）；行为标记：编码后 ~1h 内的新奇事件可回溯固化弱记忆（Ballarini 2009 PNAS；Takeuchi 2016 *Nature*）。
- **索引理论**（Teyler & DiScenna 1986；Goode 2020 *Neuron* 整合）：海马存**内容无关的稀疏指针表**指向皮层模块；检索=指针解引用+皮层重新激活。AI 对应：id 指针表 + 内容寻址键——**存储本身可以是"笨"的**。
- **海马检索**：线索驱动的模式补全；返回**情境细节不是语义 gist**；实际可及性衰减天-周（啮齿）到月-年（人），但痕迹存在≠可检索（静默 engram，Ryan 2015 *Science*——不可检索的痕迹可被非常规通路复活）。
- **重放**：SWR 内 10-20× 压缩序列重放（~100ms/次，1-2 次/秒）；**觉醒态重放**：即时（秒级，常倒序）且可模拟未来路径（Pfeiffer & Foster 2013 *Nature*——规划）；**睡眠重放**：顺序、巩固导向。选择加权：奖赏与新颖性提升重放概率；重放会重组（Gupta 2010——从未走过的捷径）。
- **皮层对话协议**：海马是**皮层的训练器**——压缩、重复、**交错**的样本供给皮层慢速统计学习（McClelland 1995）；图式一致信息走 48h 快速皮层路径部分绕过海马（Tse 2007）。

### 1.3 机械 vs 语义分类（本调研核心结论）

| 职能 | 脑基质 | 机械/语义 | 单项成本画像 | AI 实现提示 |
|---|---|---|---|---|
| 模式分离 | DG | **机械**——随机稀疏扩张 ≡ LSH | 在线，逐项便宜 | LSH/SimHash over cue 键；高维扩张 |
| 模式补全 | CA3 | **机械**——吸引子查表 | 在线，便宜（tens of ms） | ANN 模糊检索 + 关联图游走 |
| 一次性合取绑定 | CA3+DG | **机械**——Hebbian 巧合 | 在线，单次暴露 | 元组→id 指针写；VPA 叠加；**写路径零 LLM** |
| 情景索引 | 海马索引→皮层内容 | **机械**——指针表+解引用 | 在线，便宜 | 稀疏索引（id+键锚）over 不可变内容库 |
| 新颖性门控 | CA3-CA1 比较器→VTA 环 | **机械核**（距离+阈值）；期望生成器是学出来的 | 在线，便宜 | 1−top-检索分 门（FOK 式）或嵌入距离 OOD；tag=重放优先权重 |
| 时间/序列编码 | CA1 时间细胞；TCM 漂移 | **机械**——衰减积分器+变点检测 | 在线，便宜 | 近因加权上下文向量；嵌入漂移边界检测（=N3） |
| 重放生成 | CA3-CA1 @ SWR | **大体机械**——转移游走+优先采样 | **离线，批处理，带宽封顶**（~100ms 事件，每晚数千次） | 后台重放作业按 need/novelty/奖赏采样；压缩转写本作巩固语料 |
| **巩固/图式提取** | 新皮层（mPFC），由海马重放喂养 | **语义——唯一必须的 LLM 席位** | **离线，昂贵，交错，天-年** | 批处理 LLM 管线：摘要/聚类/合并+supersede 链；图式一致快路径 |

> **设计推论**：海马的独特性是 **content-agnostic computation**——分离、补全、绑定、索引、门控、计时、重放调度全部不需要语义理解（脑自己也是用哈希式的稀疏码、吸引子、指针表、阈值、衰减实现的）。LLM 只属于皮层席位——批处理巩固/图式层——加上提供被机械层搬运的冻结语义表征（嵌入）。**脑强制执行的正是 AI 该有的分工：零推理热路径 + 预算受限的语义批处理层。**

---

## 2. verbatim 层：业界已收敛 + 硬证据

### 2.1 格局表

| 系统 | raw 可检索？ | 抽象层怎么读 raw | raw 生命周期 |
|---|---|---|---|
| **Zep/Graphiti** | ✅ episodes 一等节点（混合 cosine+BM25，可按 episode 重排 facts） | 写时同步提取（每 episode LLM 抽实体+事实边） | append-only，永不衰减（TTL 在 facts 上） |
| **Letta/MemGPT** | ✅ **recall storage = 全量消息库**（`conversation_search` 嵌入检索+分页）；与策展 archival 分离 | 双路：agent 自己分页翻原文 + sleep-time agent 重读历史重组块 | 永不删除；compaction 只影响上下文窗，不动 recall 库 |
| **Generative Agents**（Park 2023） | ✅ **memory stream 本身**——raw 观察是主检索单元（recency 0.995^h × importance × relevance） | 触发式：近期重要性总和>150 → 取 100 条生成 3 问题 → 5 条 insight **引用源记录 id**；reflection 写回流内同层竞争 | append-only；recency 是分数不是删除 |
| **HippoRAG 2** | ✅ passages 一等图节点 + passage-passage 边，PPR 融合 | 写时一次全读（OpenIE 建图），之后不再重读 | append-only（非参数持续学习） |
| **ChatGPT** | ✅ reference chat history = 对过去会话原文的检索；Sources UI 可打开原会话 | rolling summary 层叠在其上 | **不对称：派生数据 30 天删、原始会话保留**——raw 活得比派生长 |
| **Anthropic memory tool**（2025.9） | ✅ **verbatim 全对话按 user/session 目录存储**，模型按路径 `view` 导航——渐进披露 | 模型按需分页浏览原文 | 无删除 |
| **eMEM**（arXiv:2606.03374，最字面 CLS） | ✅ 观察层可检索；episode 结束时全文+嵌入提升 | episode 末 LLM 摘要成 gist；空闲期 maintenance sweep 归档（**raw 降级为 gist-only 可检索**——优雅保真降级） | 分段降级不删除（archive_after 默认 1h，部署可调到天） |
| **LightMem**（ICLR 2026） | ❌ 感官层预压缩**丢弃** verbatim（成本优先） | 分段摘要 + 离线更新队列 | 不保留——**唯一反例**，赢在极紧 token 预算场景 |

### 2.2 质量证据（raw vs 转述/摘要）

1. **MemGPT DMR**：分页检索原文 92.5%（GPT-4）vs 有损摘要基线 32.1%——**60 分差距**，最干净的 raw-vs-summary 对照（arXiv:2310.08560）。
2. **LongMemEval 消融**（arXiv:2410.10813）：把 raw 换成摘要/事实**损害** QA（信息丢失）；唯一例外是 multi-session 聚合题（事实分解有利）。**LLM 提取放 KEY 不放 VALUE**：事实增广键 + 原文值 = **+9.4% recall / +5.4% QA**。
3. **Mem0 LoCoMo**：全文 26k token 直读 J=72.90 仍高于抽取式 66.88——raw 赢质量，输 token。
4. **Reproducing LightMem**（arXiv:2607.29104）：同等检索深度下 **naive RAG over raw turns 普遍优于构造记忆**；oracle 评测显示"记忆构造移除了部分答案相关信息"。
5. **eMEM 消融**：纯 RAG 在 context-dependent 检索丢 30pt；巩固本身在 DRM-lure 拒斥值 29pt——**两层都要**。
6. **我们的自有证据**：LongMemEval 评测摄取把 haystack 全文放 primary_abstraction，BM25 检索 R@10=0.949——**raw 文本 BM25 检索本身成立**（当时被判为"评测专用形态"，实为 verbatim 层可行性的直接证据）。

### 2.3 海马粒度规格（2026-10-10 追问补充，脑侧证据）

海马**不是单一粒度，是多尺度同时表征**（Mau 2018：同一 CA1 群体同时携带秒级序列与小时-天漂移）：

| 尺度 | 规格 | 脑证据 | MAFW 对应 |
|---|---|---|---|
| 绑定单元 | theta 周期 ~125ms 一个 item-place-time 合取（gamma 子周期 5-9 槽） | Lisman & Jensen 2013 | 观察行（单条 obs） |
| engram 单元 | 稀疏集合（几个 % 神经元）；**~1 天窗口内重叠集合链接记忆** | Liu 2012；Cai 2016 | round/回合 |
| **事件单元** | situation model（人/物/地/活动），秒-分钟（典型几十秒），**内容定边界非时钟** | Zacks 2007；Radvansky & Zacks 2011；Güler 2025 | **话题分段（V2/N3）的目标单元** |
| episode 单元 | 事件链 + TCM 漂移上下文胶水（小时-天 recency 码） | Howard & Kahana 2002；Mankin 2012 | 会话 envelope + R8 滚动窗口（粗糙近似） |
| 自传层级 | ESK（秒-分）→ 一般事件（时-天）→ 人生时期（年）；海马=细节层，vmPFC=图式层 | Conway 2000；Gilboa & Marlatte 2017 | round → session → project/goal |

**边界规则**（证据强度排序）：①上下文稳定性/变化（Güler 2025——主导）②贝叶斯惊喜（Kumar 2023——**分布级** divergence，非简单 surprisal）③目标相关性 ④唤醒状态；**时间邻近是链接信号不是分割信号**（小时窗口内链接，Cai 2016）。重放按**链式子序列**（Davidson 2009）——巩固读原文应按事件段，非整段 transcript。修正：Kraus 2013 是几十秒 time×distance 联合编码，小时-天级是 Mankin 2012/Mau 2018。

## 2.4 十条设计模式（跨系统收敛）

1. raw 永远可检索，抽象是更慢更便宜的附加路径——**没有任何保留 raw 的系统退化到 abstraction-only**。
2. 巩固按调度读 raw，**从不改写它**（raw append-only）。
3. provenance 一等：facts 指回 episodes、insight 引用源记录 id。
4. 衰减/TTL 管显著性或派生层，**不管 raw 删除**（ChatGPT 派生 30 天删、原始保留；eMEM 降级为 gist-only 而非删除）。
5. raw 写时打分（机械：时间戳/类型/长度 + poignancy），检索强化（S+1 / recency 重置 / 访问历史封顶）。
6. 层间融合用 reranker 不用过滤器（RRF/MMR/cross-encoder over facts+episodes；recency+importance+relevance 求和）。
7. 离线 sleep-time 摊销抽象成本，在线路径保持快速 raw 检索。
8. **压缩为上下文窗服务，不为存储服务**（MemGPT 逐出成摘要在上下文里，recall 库保全量）。
9. **按查询类型路由**：raw 承载细节/时间/多跳，抽象承载偏好/单跳/人设。
10. raw 按需分页（just-in-time），不预载。

---

## 3. LLM 边界：捕获机械、巩固语义

### 3.1 机械捕获技术清单

| 捕获时操作 | 机械实现 | vs LLM 质量差 | 成本比（LLM/机械） |
|---|---|---|---|
| round/exchange 粒度切块 | 轮次切分+时间戳 | **零**——round 是发表验证的最优值粒度（LongMemEval：round>session） | ~∞（免费） |
| 写时嵌入 | API $0.02-0.13/M 或本地 ONNX（fastembed 数十 ms/轮，CPU） | 零（两条路都要嵌入） | 1×（基线） |
| 词法/标识符索引 | BM25、regex 收割 | 精确 token 查询零差距；仅换述有差距 | ~∞ |
| **话题分段** | **注意力峰 ∩ 嵌入相似度谷**（LightMem，无 LLM，>80% 边界准确率；去掉损失 6.3%） | 小 | ~1000× |
| 实体/键词提取 | **GLiNER**（50M 参数零样本开放 NER：OOD 52.7 F1 > ChatGPT 47.5；20 数据集 47.8 vs 36.5） | ≈零（vs gpt-3.5 级）；vs 前沿模型差距温和 | ~100-1000× |
| 近重复检测 | MinHash/LSH（web 规模验证；会话记忆量比 web 语料小 3-5 个数量级，**每消息亚毫秒**） | 零 | ~∞ |
| 新颖性门控 | 1−maxCosine（Mem0/LightMem 内部就把它当 LLM 前置过滤器） | 零 | ~100× |
| 显著性 | 近因 0.995^h、TF、强调标记、工具失败事件、小 LM 熵（LLMLingua-2 式） | **欠验证**——唯一 gap（见 §3.3） | ~1000× |
| 事实提取作 **index key** | —（LLM 给 +9.4% recall） | 真差距——**但可推迟**：原文一直可检索，事实键离线补 | 25-100× |
| 冲突判定 / gist 综合 | — | **真需要语义** | — |

### 3.2 成本不对称（发表数字）

| 操作 | 每 1M token | 每消息对延迟 |
|---|---|---|
| 嵌入（3-small / Voyage-lite） | $0.02 | 0.1-0.3s，可批 |
| 嵌入（DashScope v4） | $0.07 | 0.1-0.3s |
| LLM 抽取（gpt-3.5 级） | $0.50 in / $1.50 out | 0.5-3s，串行 |
| 前沿抽取（GPT-4o 级） | ~$2.5 / $10 | 1-5s |

每 token 比 **25-100×**；计入抽取 prompt 的滚动摘要+上下文（5-12× 膨胀）+ 第二次判定调用，**写路径有效比 ~100-1000×**。系统级：LightMem 总 token ↓38×、API 调用 ↓30×、纯在线成本 ↓106×；Zep 图构建 26k 会话膨胀出 >600k token 记忆（20×）且数小时不可查询。

### 3.3 LLM-at-capture 的三个已记录失败模式

- **丢细节**：LongMemEval 商用研究——ChatGPT 压缩中覆写关键信息；Coze 漏记间接信息；Mem0 OpenAI-memory 基线丢时间戳（尽管 prompt 明示）→ temporal <15%。
- **破坏性更新**：LightMem 案例研究——LLM 把"相关但不矛盾"判成冲突删旧条 → **不可逆信息丢失**；修复正是机械捕获论：**测试时只插入，巩固推迟到 sleep-time**。
- **成本主导**：Zep 20× 膨胀；LangMem 热路径 p50 18s / p95 60s（LLM 在路径上）。

### 3.4 必须语义的三个操作（不可机械化的部分）

1. **跨会话聚合**（multi-session 事实综合）——离线巩固的活。
2. **冲突/identity 判定**——**沿用 2026-09-23 spec 的实测证伪**：cosine 0.995 但实为不同实体（LLM 判 create）→ 纯相似度不可判 identity；需实体层（GLiNER 收割 + 规范化 ID）+ laya/LLM 裁判。
3. **gist 综合**（去情境化、抽象）——皮层巩固的本职。

**显著性是唯一欠验证的机械信号**：recency 已验证有效；Generative Agents 的 LLM poignancy 是现任（写时每观察一次 LLM 调用——恰是我们要去掉的）；小 LM 熵（LLMLingua-2 式）是最有发表的代理。V2 可 observe-first 落机械显著性对照。

---

## 4. MAFW 现状核对（本地事实）

| 事实 | 状态 |
|---|---|
| **C0 源重建已实施**（2026-09-23 spec 落了）：`source-reconstruction.ts` + `searchArchive`（单会话 LIKE 锚点搜索）+ `get-memory` 指针兑现附原始证据 | ✅ 但**仅按需兑现**——`mafw_get_memory` 逐条回源，非检索面 |
| **t1_archive 51616 回合 / 533 会话**（较 09-23 的 41523/448 增长） | 只写不读——recall/搜索从不查它 |
| **provenance 缺陷仍在**：turnCompress/reflection 写的记忆 `source_session_id` = worker 会话，worker 会话被白名单排除不落 archive → **管线写的记忆回源 no-op**（只有插件原生写入的记忆能回源） | ❌ 未修 |
| index-scan 占记忆系统成本 83%（$10.02/13M，2026-08-25 实测；~68k tokens/扫描 × 320 活跃条目）——LLM 合并裁判/索引扫描是最大 LLM 成本 | 结构性问题 |
| 2026-09-23 spec 的 **Phase C4 分系统检索通道**（episodic 时间/近因通道 + semantic 语义通道 RRF） | ❌ 从未落地 |
| MinHash **写时合并**（0.7 相似即 soft-supersede） | **反海马**——脑的 DG 是分离不合并；合并判定应属巩固层（note-board 跟进项①的 MinHash 预合并问题同源） |
| 分型衰减（episodic 0.010/semantic 0.005/procedural 0.003/global 0.001）+ CATD + ACT-R | ✅ 已有（海马层可直接复用 episodic 档） |
| embedding runtime（fire-and-forget 2s 防抖批量）+ BM25 tokenCache | ✅ 已有基建 |
| worker 会话 8h idle compaction + compaction 事件触发 turnCompress flush | ✅ 抢救性提取已存在 |

---

## 5. 目标架构：三层归位

```
                    【海马层 H · verbatim 可检索】（新增检索面，零 LLM）
  t1_observations ──轮完成──▶ t1_archive（51616 回合已在）
    写：机械——嵌入（已有 runtime）+ BM25 tokenCache + GLiNER/regex 实体收割
        + novelty(1−maxCosine) + MinHash【标记不合并】 + 机械 salience（近因/强调标记/工具失败）
    读：round 粒度（LongMemEval 最优值粒度）；BM25/dense；FOK 门同治
    生命周期：快衰减（episodic 档或更快）+ 容量/事件触发巩固；永不删除（降级不删除，eMEM 式）
         ▲ raw（供读）                    │ 写 semantic 候选 + tentative + episodic 精选
         │                               ▼
    【快巩固 F · turnCompress 重定位】（awake replay / SWS 快路径 / 图式直通）
    读：海马层【原始回合】——不再只是转述者；保留 B1 交错回放
    写：semantic 候选 + ≤1 tentative（A2 保留）+ 高价值 episodic 精选（策展高亮，非唯一记录）
    归位：从「准入关」降为「皮层学习者」——不写也不丢，选择错误软失败
         │                              ▼
    【深巩固 S · reflection 不动】（sleep 整合）
    读：海马层原文（D6 在此被吸收）+ episodic units；保持 A2 判定/A4 回流/A5 指针/D1b 降能
    写：gist + distilled_by + 公理/skill 通道（周管线不动）

  【检索融合】RRF over [海马层 verbatim 命中 + gist 命中]（模式 6：reranker 不 filter）
  【查询路由】细节/时间/多跳 → verbatim；偏好/单跳/人设 → gist（模式 9）
  【注入】<recall> 指针可含 #t1-xxx（verbatim 槽位，低权重少量，守 100ms 契约）
  【LLM 边界】热路径零 LLM；LLM 只在 F/S 巩固层 + laya 冲突判定；index-scan 的 LLM 合并裁判迁入巩固层
```

**三个问题的回答**：
- **海马要干什么**：§1.3 八职能表——机械层全表照抄（分离→MinHash 标记化改造、补全→BM25/dense、绑定→t1 行即元组、索引→指针/锚、新颖性→1−maxCosine、时间→近因衰减+变点、重放→B1/巩固采样）；语义部分（巩固/图式）归 F/S。
- **要不要过 LLM**：海马层**不过**（§3.1 技术清单成熟且便宜 2-3 个数量级）；必须语义的三个操作（聚合/identity/gist）全部离线化。
- **turnCompress/reflection 放哪**：F=turnCompress（小时级快巩固，读原文、写候选、软选择）；S=reflection（日级深巩固，现状增强全保留）。两者都不再承担"唯一检索面生产者"职责。

---

## 6. 分级选项

| 级 | 内容 | 规模 | 成本变化 | 风险 | 收益 |
|---|---|---|---|---|---|
| **V1 最小 verbatim 检索面** | ① `searchArchive` 扩展为**跨会话** FTS5/内存 BM25（tokenCache 模式）；② recall 出口 RRF 融合（verbatim ≤2 槽位 ×0.5 降权，守 100ms）；③ **provenance 修复**（worker 写入时 source 指回源会话）；④ get_memory 的 #t1 指针 | ~2-3 天 | +嵌入/轮（$0.00002 级）+检索面（51k 行 BM25 内存可行）；**零新 LLM** | 检索噪声（槽位+降权控制）；100ms 契约（FTS5/BM25 需实测） | FTT verbatim 轨迹、选择错误可恢复、D6 一半、管线记忆可回源 |
| **V2 机械捕获 + 快巩固重定位** | ① 写路径机械增强：GLiNER 实体收割 + novelty + MinHash 改**标记不合并**（合并判定迁巩固层）；② turnCompress prompt 重定位：读海马层原文（快巩固语义）；③ **话题分段替换小时批**（注意力峰∩嵌入谷，LightMem 无 LLM 路线 = N3 落地）；④ 机械 salience observe-first（对照 LLM poignancy） | ~1-2 周 | GLiNER ONNX 一次性 ~100-300MB；novelty 每写一次嵌入查询；turnCompress token 略降（读精选原文非全转写） | turnCompress 行为变化需 A/B；分段质量（>80% 发表基线） | N3 落地、MinHash 假合并修复、写成本结构反转开始、海马 tag（novelty/need）成为巩固排序输入（N7） |
| **V3 完整三层 + 成本重构** | ① 分系统检索通道（09-23 C4：episodic 时间/近因 + semantic 语义，RRF）；② N1 实体概念层（identity 判合并）；③ index-scan LLM 合并裁判迁入巩固层——**砍 83% 记忆系统成本的路径**；④ D5 测量门 + LongMemEval verbatim 层消融（raw-only / gist-only / 双层 A/B） | ~2-4 周 + 基准 | 记忆系统 LLM 成本结构反转（巩固-only）；检索两通道延迟预算重分配 | 检索回归风险最大（C4 当年没敢动）；需完整基准护栏 | 完整 CLS 同构、83% 成本路径、双层消融证据 |

**推荐路径**：V1 先行（最小风险、修两个已知缺陷、D6 一半到手）→ 观察 verbatim 槽位命中质量 → V2（机械捕获+分段）→ V3（通道+成本重构）按基准推进。每级独立可回退。

---

## 7. 与路线图的关系

| 既有项 | 关系 |
|---|---|
| **D6 第一人称重放** | **被吸收**——V1 给检索面，V2 给巩固层读原文（"reflection 喂 turn 级原文"原方案） |
| **N3 事件分段** | **V2 实现路径确定**（LightMem 注意力峰∩嵌入谷，无 LLM） |
| **N1 实体概念层** | V3 合跑（GLiNER 收割 + identity 判合并） |
| **N7 巩固优先级消费** | V2 落地——海马层的 novelty/need 机械标量直接作巩固排序输入（brain tag 语义） |
| **D5 测量门** | V3 合跑（verbatim 层 + 实体层都会改基线） |
| **N4 自适应分化** | V2 的 MinHash 标记化是它的前置（标记→巩固层分化判定） |
| note-board 跟进项①（MinHash 预合并） | V2 顺带修复 |

## 8. 决策点（留给用户）

1. **海马层生命周期**：eMEM 默认 1h 归档为 gist-only；脑是天-周。建议 round 级独立衰减档（快于 episodic 0.010/天）+ 容量上限，永不删除——具体参数 V1 observe-first 定。
2. **episodic 精选单元去留**：eMEM/LongMemEval 证据支持 raw+gist 两层已够；turnCompress 的 episodic 精选保留为"策展高亮"还是逐步淡出（大改动，放 V3 决策）。
3. **index-scan 成本重构时机**：独立立项还是并入 V3（83% 成本的诱惑 vs 一次动太多）。
4. **V1 的检索面实现**：FTS5（SQLite 原生，简单）vs 内存 BM25（tokenCache 复用，与现有一致）——实现时 benchmark 定。

---

## 附：调研底稿

四线原始报告存本会话 task 结果（海马职能 ses_edb3ebac4ffe0N9q4yuUrIk4k7 / 业界 verbatim ses_edb3e844dffe8tUEgwWqVFo8nw / 机械捕获 ses_edb3e4c2effe8lkx1FIUOeCu6S7 / 分阶段架构 ses_edb3e1894ffe2CVMusJfmf5LoX）。关键引文锚点：

- 海马子区：Knierim & Neunuebel 2016；Nakazawa 2002 *Science*；Marr 1971；Lisman & Grace 2005 *Neuron*；Ziv 2013 *Nat Neurosci*；Goode 2020 *Neuron*
- 编码不筛选/标记：Frey & Morris 1997 *Nature*；Ballarini 2009 PNAS；Takeuchi 2016 *Nature*
- 重放：Foster & Wilson 2006 *Nature*；Pfeiffer & Foster 2013 *Nature*；Gupta 2010 *Neuron*
- verbatim 层：MemGPT arXiv:2310.08560（DMR 92.5 vs 32.1）；Generative Agents arXiv:2304.03442；eMEM arXiv:2606.03374；Zep arXiv:2501.13956；HippoRAG 2 arXiv:2502.14802；Anthropic memory tool（2025.9）；ChatGPT reference chat history docs
- 机械捕获：LongMemEval arXiv:2410.10813（round 粒度/键增广 +9.4%）；GLiNER arXiv:2311.08526；SemDeDup arXiv:2303.09540；LightMem arXiv:2510.18866（话题分段无 LLM >80%）；Reproducing LightMem arXiv:2607.29104
- 成本：LightMem 38×/106×；Zep 20× 膨胀（Mem0 §4.5 arXiv:2504.19413）
- 调度：Letta sleep-time arXiv:2504.13171（5×）；MemoryOS arXiv:2506.06326（heat）；MemoryBank arXiv:2305.10250（e^(−t/S)+检索强化）；Mem0 Dream docs（卫生/合成分离）
