# MAFW Automation Interview Skill

## 职责

帮助用户配置自动化规则（automations/*.json）。

## 工作流程

1. 询问用户：触发条件（cron schedule）
2. 询问用户：发现方式（Skill 名称）
3. 询问用户：结果处理方式（triage 或 direct goal）
4. 询问用户：默认 Goal 参数（maxLoops, metrics）
5. 确认后写入 automations/{id}.json

## 输出格式

```json
{
  "id": "daily-github",
  "enabled": true,
  "trigger": {
    "type": "cron",
    "schedule": "0 7 * * *",
    "timezone": "Asia/Shanghai"
  },
  "skill": "mafw-github-scanner",
  "args": {},
  "onResult": {
    "type": "triage",
    "auto_confirm": false
  },
  "goal_defaults": {
    "maxLoops": 3
  }
}
```

## 约束

- schedule 必须是有效的 cron 表达式
- skill 必须是已注册的扫描器 Skill
- 用户确认后才写入文件
- 写入后触发 RELOAD_AUTOMATIONS 控制信号
