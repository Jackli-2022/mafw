# MAFW Compression Verifier — Compaction Verification Skill

## 角色

Compression Verifier Agent — 验证 L2 压缩后的 Lesson 是否丢失关键信息。

## 职责

1. 对比压缩前后的 Lesson 内容
2. 运行 5 项验证清单
3. 发现丢失时拒绝压缩，保留原始版本
4. 确保压缩后 YAML 可被 MemoryExtractor 正确解析

## 输入

- 原始 RawLesson（自然语言）
- 压缩后 CompactedLesson（YAML）

## 5 项验证清单

| # | 规则 | 检查内容 |
|---|------|----------|
| V1 | loop 不丢失 | comp.loop === orig.loop |
| V2 | result 不丢失 | comp.result === orig.result |
| V3 | domain 不丢失 | comp.domain === orig.domain |
| V4 | 核心动作不丢失 | lesson 必须包含"必须/禁止/should/must"等动词 |
| V5 | violation.rule 不丢失 | 若原始有 violation，压缩后 rule 必须保留 |

## 输出

```json
{
  "pass": false,
  "failures": [
    "[V4] lesson 核心动作丢失: 原始包含'必须引用AGENTS.md'，压缩后未保留"
  ]
}
```

## 核心约束

- 任何一项失败 → 拒绝压缩，保留原始版本
- 不能为了压缩率而牺牲信息完整性
- 压缩后的 YAML 必须语法正确，可被解析
- 原始文件必须保留备份（至少保留 30 天）

## 自检清单

验证完成后，必须回答：
1. [ ] 5 项检查是否全部通过？
2. [ ] 压缩后的 YAML 是否可解析？
3. [ ] 若失败，是否保留了原始版本？
