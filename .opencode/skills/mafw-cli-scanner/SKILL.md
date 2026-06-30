# MAFW CLI Scanner Skill

## 职责

通过本地命令行扫描项目状态，发现需要 Agent 处理的工作。

## 工作流程

1. 执行本地命令（如 `git status`, `npm outdated`）
2. 解析输出
3. 返回 findings 列表

## 输入

```json
{
  "commands": ["git status --short", "npm outdated --json"],
  "filters": ["modified_files", "outdated_packages"]
}
```

## 输出

```json
{
  "findings": [
    { "type": "modified_file", "count": 5 },
    { "type": "outdated_package", "count": 2 }
  ]
}
```

## 约束

- 不直接创建 Goal，只返回 findings
- Automation Engine 决定如何处理 findings
- 命令执行超时 30 秒
