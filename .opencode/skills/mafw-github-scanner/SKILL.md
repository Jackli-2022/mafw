# MAFW GitHub Scanner Skill

## 职责

扫描 GitHub 仓库，发现需要 Agent 处理的工作。

## 工作流程

1. 读取 args.repo 确定目标仓库
2. 读取 args.filters 确定扫描范围
3. 调用 GitHub API 获取数据
4. 返回 findings 列表

## 输入

```json
{
  "repo": "my-org/myapp",
  "filters": ["open_prs", "pending_reviews", "ci_failed"]
}
```

## 输出

```json
{
  "findings": [
    { "type": "open_pr", "count": 3 },
    { "type": "ci_failed", "count": 1 }
  ]
}
```

## 约束

- 需要 GitHub token（从环境变量读取）
- 不直接创建 Goal，只返回 findings
- Automation Engine 决定如何处理 findings
