# MAFW LangChain Frontend — Design Spec

## 1. Motivation

The existing MAFW dashboard is a vanilla JS SPA with 8 read-only views. The recent LangChain native refactoring added `CodeAgentAdapter`, `MAFWRetriever`, and `MAFWMemory` — but there is no interactive frontend that leverages these components.

This spec defines a React 19 SPA that unifies three experiences: a conversational Chat UI powered by LangChain RAG Agent, an enhanced Dashboard with memory search, and a live LangGraph state machine visualization.

## 2. Architecture

```
        Browser (:5173 dev / :3111 prod)
        ┌─────────────────────────────────┐
        │  React 19 SPA (Vite + Tailwind) │
        │  ┌────┬──────────────────────┐  │
        │  │Side│ Chat / Dash / Graph  │  │
        │  │bar │ (SSE live updates)   │  │
        │  └────┴──────────────────────┘  │
        └──────────┬──────────────────────┘
                   │ Vite Proxy (dev) / same-origin (prod)
                   ▼
        Gateway (:3111)
        ┌─────────────────────────────────┐
        │  /api/chat (POST → SSE stream)  │
        │  /api/memory/search (REST)      │
        │  /api/goals /api/stats (REST)   │
        │  /api/events (SSE EventBus)     │
        │  ChatAgentService               │
        │   ├─ IntentClassifier           │
        │   ├─ GraphRunner (stream)       │
        │   └─ RAGResponder               │
        └─────────────────────────────────┘
```

### 2.1 Development / Production Strategy

| Environment | Frontend Location | Port | Proxy |
|---|---|---|---|
| Development | `frontend/` (Vite dev server) | 5173 | Vite proxy `/api/*` → `:3111` |
| Production | `gateway/src/dashboard/public/` | 3111 | Same-origin |

### 2.2 Communication

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /api/chat` | SSE stream | Chat + graph state events |
| `GET /api/events` | SSE | Global event bus (graph state, goal updates) |
| `GET /api/memory/search?q=` | JSON | Direct memory search (no LangGraph) |
| `GET /api/goals` | JSON | Goal list |
| `GET /api/stats` | JSON | KPI statistics |

## 3. Directory Structure

```
mafw/
├── gateway/src/chat/                  ✨ NEW
│   ├── agent.ts                        ChatAgentService (orchestrator)
│   ├── graph-runner.ts                 GraphRunner (stream-based invoke)
│   ├── intent-classifier.ts            IntentClassifier (rule + LLM)
│   └── rag-responder.ts                RAG stream responder
│
├── gateway/src/dashboard/             🔄 MODIFY
│   └── public/                         Build output from frontend/
│
└── frontend/                           ✨ NEW (React 19 SPA)
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── tailwind.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── stores/
        │   ├── appStore.ts             Theme, sidebar state (Zustand)
        │   └── goalStore.ts            currentGoalId, goalList
        ├── api/
        │   ├── chat.ts                 POST /api/chat (SSE fetch)
        │   ├── goals.ts                GET /api/goals
        │   ├── memory.ts               GET /api/memory/search
        │   └── graph.ts                GET /api/graph/state
        ├── hooks/
        │   ├── useChat.ts              SSE chat stream consumer
        │   ├── useGraphState.ts        SSE → node status mapping
        │   └── useGoals.ts             Goal polling
        ├── types/
        │   └── index.ts                NodeStatus, GraphEvent, ChatMessage
        └── components/
            ├── layout/
            │   ├── Sidebar.tsx
            │   ├── MainArea.tsx
            │   └── TopBar.tsx
            ├── chat/
            │   ├── ChatPanel.tsx
            │   ├── MessageBubble.tsx
            │   └── StreamingText.tsx
            ├── dashboard/
            │   ├── KpiCards.tsx
            │   ├── GoalList.tsx
            │   ├── GoalDetail.tsx
            │   └── MemorySearch.tsx
            ├── graph/
            │   ├── LangGraphCanvas.tsx  React Flow canvas
            │   ├── PlanNode.tsx
            │   ├── ExecuteNode.tsx
            │   ├── ReviewNode.tsx
            │   └── ArchiveNode.tsx
            └── shared/
                ├── ConfigPanel.tsx
                └── ThemeToggle.tsx
```

## 4. Component Design

### 4.1 Stores (Zustand)

```typescript
// store/appStore.ts
interface AppState {
  theme: 'dark' | 'light';
  sidebarCollapsed: boolean;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

// store/goalStore.ts
interface GoalState {
  currentGoalId: string | null;
  goals: Goal[];
  setGoalId: (id: string) => void;
  setGoals: (goals: Goal[]) => void;
}
```

### 4.2 Chat Panel (`POST /api/chat` SSE Stream)

The single endpoint `POST /api/chat` returns a `text/event-stream`. The `useChat` hook consumes it via `fetch` + `ReadableStream`:

```typescript
// hooks/useChat.ts
async function sendMessage(message: string, goalId?: string) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, goalId }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    // Parse SSE: "data: {...}\n\n"
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        const event = JSON.parse(line.slice(6));
        if (event.type === 'text') appendMessage(event.content);
        if (event.type === 'graph_state') updateGraphState(event);
        if (event.type === 'done') setLoading(false);
      }
    }
  }
}
```

### 4.3 SSE Event Types

```typescript
type SSEEvent =
  | { type: 'text'; content: string }
  | { type: 'graph_state'; activeNodeId: string; phase: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
```

### 4.4 LangGraphCanvas (React Flow)

Nodes map to LangGraph state machine:

- **PlanNode** — position top-left
- **ExecuteNode** — position top-center
- **ReviewNode** — position top-right
- **ArchiveSuccessNode** — position bottom-right
- **ArchiveFailNode** — position bottom-center
- **ArchiveMaxRetriesNode** — position bottom-left

Edges represent transitions, with labels for conditional routes (`PASS`, `FAIL`, `max retries`).

```typescript
// types/index.ts
type NodeStatus = 'idle' | 'running' | 'done' | 'error';

// useGraphState.ts — maps SSE activeNodeId to node status
const updateNodeStatus = (activeNodeId: string) => {
  setNodes((nds) =>
    nds.map((node) => {
      if (node.id === activeNodeId) {
        return { ...node, data: { ...node.data, status: 'running' } };
      }
      if (node.data.status === 'running' && node.id !== activeNodeId) {
        return { ...node, data: { ...node.data, status: 'done' } };
      }
      return node;
    })
  );
};
```

Visual style per status:
- `idle` — semi-transparent gray, no border
- `running` — blue pulsing border (`@keyframes pulse`)
- `done` — solid green border
- `error` — red flash border

### 4.5 MemorySearch (Dashboard)

Direct REST call, bypasses LangGraph:

```typescript
// api/memory.ts
async function searchMemory(query: string, goalId?: string) {
  const params = new URLSearchParams({ q: query });
  if (goalId) params.set('goalId', goalId);
  const res = await fetch(`/api/memory/search?${params}`);
  return res.json();
}
```

## 5. Gateway Backend — Chat Agent

### 5.1 ChatAgentService

```typescript
// gateway/src/chat/agent.ts
export class ChatAgentService {
  private intentClassifier: IntentClassifier;
  private graphRunner: GraphRunner;
  private ragResponder: RAGResponder;

  async handleChat(req: IncomingMessage, res: ServerResponse) {
    const { message, goalId } = await parseBody(req);
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const [context, memoryVars] = await Promise.all([
      this.retriever._getRelevantDocuments(message),
      this.memory.loadMemoryVariables({}),
    ]);

    const intent = await this.intentClassifier.classify(message);

    initSSE(res);

    if (intent.action === 'EXECUTE_GRAPH') {
      pushSSE(res, 'text', { content: '启动规划流程...' });
      await this.graphRunner.run(goalId, { context, memoryVars }, (update) => {
        pushSSE(res, 'graph_state', update);
      }, abortController.signal);
      pushSSE(res, 'text', { content: '流程完成' });
    } else {
      await this.ragResponder.stream(res, message, context, memoryVars, abortController.signal);
    }

    pushSSE(res, 'done', {});
    res.end();
  }
}
```

### 5.2 IntentClassifier

```typescript
// gateway/src/chat/intent-classifier.ts
type Intent = { action: 'EXECUTE_GRAPH' | 'RAG_ONLY' | 'SEARCH_MEMORY'; entities: Record<string, string> };

export class IntentClassifier {
  classify(message: string): Intent {
    const lower = message.toLowerCase();
    if (lower.includes('开始') || lower.includes('规划') || lower.includes('执行')) {
      return { action: 'EXECUTE_GRAPH', entities: {} };
    }
    if (lower.includes('搜索') || lower.includes('查找') || lower.includes('记忆')) {
      return { action: 'SEARCH_MEMORY', entities: {} };
    }
    return { action: 'RAG_ONLY', entities: {} };
  }
}
```

### 5.3 GraphRunner (stream-based)

```typescript
// gateway/src/chat/graph-runner.ts
export class GraphRunner {
  async run(
    goalId: string,
    context: { context: Document[]; memoryVars: MemoryVariables },
    onState: (update: any) => void,
    signal?: AbortSignal,
  ) {
    const timeoutSignal = AbortSignal.timeout(120_000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const cp = new FileCheckpointer(this.mafwDir);
    const graph = buildExecutionGraph(this.buildNodeOptions(this.mafwDir));
    const app = graph.compile({ checkpointer: cp });

    const initialState = {
      goalId, projectDir: this.projectDir, mafwDir: this.mafwDir,
      round: 1, maxRounds: 3,
      ...context.memoryVars,
    };

    const stream = await app.stream(initialState, {
      configurable: { thread_id: goalId },
      signal: combinedSignal,
    });

    for await (const event of stream) {
      const nodeName = event.name;
      const nodeOutput = event.data?.output;
      if (nodeName && nodeOutput?.phase) {
        onState({ activeNodeId: nodeName.toUpperCase(), phase: nodeOutput.phase });
      }
    }

    return { status: 'completed' };
  }
}
```

## 6. Vite Config

```typescript
// frontend/vite.config.ts
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3111',
    },
  },
  build: {
    outDir: '../gateway/src/dashboard/public',
  },
});
```

## 7. Types

```typescript
// frontend/src/types/index.ts
export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

export interface GraphNodeData {
  label: string;
  status: NodeStatus;
  phase?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface SSEEvent {
  type: 'text' | 'graph_state' | 'done' | 'error';
  content?: string;
  activeNodeId?: string;
  phase?: string;
  message?: string;
}

export interface Goal {
  goalId: string;
  phase: string;
  loop: number;
  currentWave: number;
  totalWaves: number;
  nextAction?: string;
  updatedAt?: string;
}
```

## 8. Non-Goals

- NOT replacing the existing vanilla dashboard (coexists at different route)
- NOT adding authentication or user management
- NOT modifying the LangGraph state machine itself
- NOT adding LangSmith tracing (future work)
