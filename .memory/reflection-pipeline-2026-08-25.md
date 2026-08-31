# Reflection Pipeline Refactoring & LongMemEval Benchmark - 2026-08-25

## 1. 反射管线三合一重构（2026-08-25，5 commits）

### 核心变更
- **reflect 输入升级**：从摘要改为 `memory_value` 全文（截断 2000 字符）
- **prompt 明确分工**：
  - `turnCompress`：事实层（事实提取、去重、整合）
  - `reflect`：跨回合高阶模式（洞察、趋势、模式识别）
- **reflect 三步编排**（Generative Agents 风格）：
  1. 问题生成 → 2. 检索取证 → 3. 蒸馏（失败回退直蒸馏）

### 工具扩展
- **`mafw_add_memory` 新增 `importance` 参数**：映射到 `HarmonicUnit.salience`（HTTP+MCP 双路径）
- **`cue_anchors` 空数组防御**

### 测试结果
- 反射管线测试：13/13 通过
- 全量测试：151 套通过（9 套 huggingface 网络不可达预存失败）

---

## 2. LongMemEval 基准复测（2026-08-25T17-00-44Z）

反射管线重构后复测，验证写入管线改动不影响检索/阅读路径。

### L1 检索层（bm25 session 粒度，48 题）
| 指标 | 结果 |
|------|------|
| R@1 | 0.586 |
| R@10 | 0.949 |
| NDCG@10 | 0.882 |

**与基线完全一致**

### L2 阅读层（DeepSeek v4-flash enumerate+question_date）
| 指标 | 结果 |
|------|------|
| Accuracy | 0.938（45/48） |

### 错题（3 道，与上次完全相同）
1. **3c1045c8**：multi-session 年龄推断
2. **09d032c9**：preference R@10=0 语义鸿沟
3. **370a8ff4**：temporal 11.57 周 vs gold 15 周计算差异

### 结论
写入管线改动不影响检索/阅读路径，分数无变化符合预期。收益需等真实使用中 reflect 产出质量提升后观察。

---

## 关键技术参考

### HarmonicUnit.salience 映射
```typescript
interface HarmonicUnit {
  salience?: number;  // 检索排序：× energy × salience
}
```

### reflect 三步编排
```
问题生成 → 检索取证 → 蒸馏
    ↓ 失败    ↓ 失败
    └──→ 直接蒸馏 ←┘
```
