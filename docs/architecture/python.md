# 持久 Python 内核

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

### 持久 Python 内核（Prime Agent 同款 Jupyter kernel）

给 agent 一个会话级持久 Python 环境（变量/导入/数据跨工具调用保持），Prime Agent
（`packages/coding-agent/src/core/kernel/`）同款架构：

```
opencode LLM                              Gateway（3000）                  .venv-pykernel
  mafw_python { code } ──→ POST /api/python/execute ──→ KernelService ──ZeroMQ──→ ipykernel_launcher
    （ToolContext.sessionID 定位内核）        ├─ session→kernel Map           ├─ 标准 Jupyter 协议 5.3
  mafw_python_restart    ──→ /restart        ├─ Mutex 串行队列（防并发踩踏）   ├─ allow_stdin:false
                                             ├─ 崩溃检测→自动重启+提示        └─ matplotlib 附件（display_data）
                                             └─ TTL 1h 闲置回收
```

要点：
- **`gateway/src/python/kernel-service.ts`**：Jupyter wire 协议（ZeroMQ Dealer/Subscriber，
  HMAC 签名按 jupyter_client 的 `json.dumps` 分隔符 + `ensure_ascii=False` 字节序列化）；
  `execute` 收集 stdout/stderr/execute_result/display_data（matplotlib 图→base64 附件）/
  error{traceback}；输出 cap 65536 + `truncated` 标记；超时→control 通道 interrupt；
  崩溃（exit 事件）→ 标记 dead → 下次调用自动重启并返回 `kernelRestarted: true`
- **Windows 陷阱**：`child.kill('SIGKILL')` 无效 → `taskkill /F /T` 兜底；zeromq receive
  用 `Promise.race` 超时会留下"幽灵 receive"吞消息 → 同一时刻只挂一个 receive、
  超时仅做检测（有 pending 才判死）；循环用 `socket === this.iopub/shell` 判断
  被替换（重启后旧循环静默退出）
- Python 环境：`.venv-pykernel`（专用，ipykernel/numpy/pandas/matplotlib），
  `MAFW_PYTHON_BIN` 可覆盖
- 安全：loopback-only；无沙箱（本机可信场景）；TTL 1h 回收 + 停机清理
- 引导：工具描述强化（数据分析/统计/多步计算 → 用 mafw_python 而非 bash python -c）+
  `bash-python-guide` hook 检测长 python 内联脚本注入温和提示（每会话一次）
- 测试：kernel 集成套件需 `--runInBand --forceExit`（真实内核 + zeromq handle 残留）
