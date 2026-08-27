# nativeApprovals 翻译层设计规格

## 概述

为 pi runtime 实现 nativeApprovals 能力，使 pi 的工具执行经过 opencode 的审批流程。用户在桌面 UI 看到审批卡片，可批准/拒绝，响应回传到 pi extension 决定是否执行工具。

## 目标

- pi 声明 `nativeApprovals: true`
- 桌面 UI 显示 pi 工具执行的审批卡片
- 用户批准/拒绝后，pi 执行或阻断工具
- 保持 opencode 路径行为不变

## 架构

```
pi tool_call 事件
  ↓
MafwApprovalExtension（pi extension）
  ↓ 翻译为 opencode 形状
permission.asked 事件（RawRuntimeEvent）
  ↓
pi-events.ts translatePiEvent
  ↓
normalize.ts → EventFacets
  ↓
index.ts handleOpencodeEvent
  ↓
桌面 SSE → PermissionCard
  ↓
用户批准/拒绝 → gateway HTTP API
  ↓
runtime.session.permissionReply(requestId, approved)
  ↓
ApprovalBridge.pendingRequests.get(requestId).resolve(approved)
  ↓
extension 返回 { block: false } 或 { block: true, reason: "rejected" }
```

## 组件设计

### 1. ApprovalBridge（共享状态）

```typescript
// gateway/src/runtime/pi/pi-approval-bridge.ts
interface PendingRequest {
  resolve: (approved: boolean) => void;
  timeout: NodeJS.Timeout;
}

class ApprovalBridge {
  private pending = new Map<string, PendingRequest>();
  
  request(requestId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(false); // 超时自动拒绝
      }, 5 * 60 * 1000); // 5 分钟超时
      
      this.pending.set(requestId, { resolve, timeout });
    });
  }
  
  reply(requestId: string, approved: boolean): boolean {
    const req = this.pending.get(requestId);
    if (!req) return false;
    
    clearTimeout(req.timeout);
    this.pending.delete(requestId);
    req.resolve(approved);
    return true;
  }
  
  dispose(): void {
    for (const { resolve, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      resolve(false);
    }
    this.pending.clear();
  }
}
```

### 2. MafwApprovalExtension（pi extension）

```typescript
// gateway/src/runtime/pi/pi-approval-extension.ts
import type { Extension, ToolCallEvent, ToolCallEventResult } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'crypto';

interface ApprovalPolicy {
  autoApprove: string[]; // 自动放行的工具名
  autoDeny: string[];    // 自动拒绝的工具名
  // 其余工具需要审批
}

const DEFAULT_POLICY: ApprovalPolicy = {
  autoApprove: ['read', 'grep', 'ls', 'find', 'glob'],
  autoDeny: [],
};

function createMafwApprovalExtension(
  bridge: ApprovalBridge,
  emitEvent: (event: RawRuntimeEvent) => void,
  policy: ApprovalPolicy = DEFAULT_POLICY,
): Extension {
  return {
    name: 'mafw-approval',
    on: (emitter) => {
      emitter.on('tool_call', async (event: ToolCallEvent, ctx) => {
        const toolName = event.toolName;
        
        // 自动放行
        if (policy.autoApprove.includes(toolName)) {
          return;
        }
        
        // 自动拒绝
        if (policy.autoDeny.includes(toolName)) {
          return { block: true, reason: 'auto-denied by policy' };
        }
        
        // 需要审批
        const requestId = randomUUID();
        const sessionID = ctx.sessionId;
        
        // 发射 permission.asked 事件
        emitEvent({
          payload: {
            type: 'permission.asked',
            properties: {
              sessionID,
              requestId,
              toolName,
              args: event.input,
              risk: 'medium', // 简化：所有需审批工具都是 medium
            },
          },
        });
        
        // 等待响应
        const approved = await bridge.request(requestId);
        
        // 发射 permission.replied 事件
        emitEvent({
          payload: {
            type: 'permission.replied',
            properties: {
              sessionID,
              requestId,
              approved,
            },
          },
        });
        
        if (!approved) {
          return { block: true, reason: 'rejected by user' };
        }
      });
    },
  };
}
```

### 3. pi-events.ts 扩展

```typescript
// gateway/src/runtime/pi/pi-events.ts 扩展 translatePiEvent
case 'permission.asked':
  return {
    payload: {
      type: 'permission.asked',
      properties: {
        sessionID: event.properties.sessionID,
        requestId: event.properties.requestId,
        toolName: event.properties.toolName,
        args: event.properties.args,
        risk: event.properties.risk,
      },
    },
  };

case 'permission.replied':
  return {
    payload: {
      type: 'permission.replied',
      properties: {
        sessionID: event.properties.sessionID,
        requestId: event.properties.requestId,
        approved: event.properties.approved,
      },
    },
  };
```

### 4. PiSessionRegistry 扩展

```typescript
// gateway/src/runtime/pi/pi-session.ts 扩展
class PiSessionRegistry {
  private approvalBridges = new Map<string, ApprovalBridge>();
  
  async create(opts: { directory?: string; approvalBridge?: ApprovalBridge }): Promise<{ id: string }> {
    const id = randomUUID();
    const bridge = opts.approvalBridge ?? new ApprovalBridge();
    this.approvalBridges.set(id, bridge);
    
    const session = await createAgentSession({
      cwd: opts.directory,
      extensions: [createMafwApprovalExtension(bridge, this.emitEvent)],
    });
    
    this.sessions.set(id, session);
    return { id };
  }
  
  async permissionReply(sessionID: string, requestId: string, approved: boolean): Promise<boolean> {
    const bridge = this.approvalBridges.get(sessionID);
    if (!bridge) return false;
    return bridge.reply(requestId, approved);
  }
  
  async delete(sessionID: string): Promise<void> {
    const bridge = this.approvalBridges.get(sessionID);
    if (bridge) {
      bridge.dispose();
      this.approvalBridges.delete(sessionID);
    }
    // ... 原有删除逻辑
  }
}
```

### 5. RuntimeClient 扩展

```typescript
// gateway/src/runtime/contract.ts 扩展 RuntimeClient
interface RuntimeClient {
  session: {
    // ... 原有方法
    permissionReply?(sessionID: string, requestId: string, approved: boolean): Promise<boolean>;
  };
}
```

### 6. index.ts 接线

```typescript
// gateway/src/index.ts handleOpencodeEvent 扩展
if (f.type === 'permission.asked') {
  // 已有逻辑：发射 SSE，等待 HTTP API 响应
  // HTTP API 调用 runtime.session.permissionReply(sessionID, requestId, approved)
}
```

## 配置

```yaml
# config.yaml
runtime:
  plugin: pi
  pluginConfig:
    pi:
      approvalPolicy:
        autoApprove: ['read', 'grep', 'ls', 'find', 'glob']
        autoDeny: []
```

## 测试策略

1. **ApprovalBridge 单元测试**：request/reply/timeout/dispose
2. **MafwApprovalExtension 单元测试**：auto-approve/auto-deny/manual approval
3. **pi-events 翻译测试**：permission.asked/replied 事件翻译
4. **PiSessionRegistry 集成测试**：create → tool_call → permission.asked → reply → 执行/阻断
5. **端到端测试**：桌面 UI 审批卡片显示，用户批准/拒绝

## 验收标准

1. pi 声明 `nativeApprovals: true`
2. pi 执行 bash/edit/write 工具时，桌面显示审批卡片
3. 用户批准后工具执行
4. 用户拒绝后工具阻断，pi 收到 "rejected by user"
5. read/grep/ls/find/glob 自动放行，无审批卡片
6. opencode 路径行为不变
7. 超时（5 分钟）自动拒绝

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| pi extension API 变更 | 锁定 pi-coding-agent 版本（0.84.1），升级时回归测试 |
| 审批卡片 UI 不匹配 | 复用 opencode PermissionCard 组件，翻译 toolName/args |
| 长时间无响应阻塞 pi | 5 分钟超时自动拒绝 |
| 多会话并发审批混淆 | 每个 session 独立 ApprovalBridge |

## 后续扩展

- `sessionStorageApi`：通过 `SessionManager.findMostRecentSession(dir, cwd)` 实现 `listByDirectory`
- `agentConfigApi`：翻译 `AgentDefinition` → `~/.pi/agent/prompts/<name>.md` + extension 阻断策略
