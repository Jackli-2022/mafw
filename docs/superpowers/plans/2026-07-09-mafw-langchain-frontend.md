# MAFW LangChain Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a React 19 SPA with Chat (LangChain RAG Agent), Enhanced Dashboard, and LangGraph state machine visualization, backed by a new Gateway chat service.

**Architecture:** React 19 + Vite + Tailwind + React Flow frontend in `frontend/`, communicating with Gateway via `POST /api/chat` (SSE stream) and REST endpoints. ChatAgentService on the Gateway side uses CodeAgentAdapter + MAFWRetriever + MAFWMemory. Development uses Vite proxy (`:5173` → `:3111`); production builds output to `gateway/src/dashboard/public/`.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, React Flow, Zustand, `@langchain/core`

## Global Constraints

- Gateway backend tests live in `tests/unit/gateway/`
- Frontend uses Vite proxy `/api/*` → `localhost:3111` in dev mode
- Build output goes to `gateway/src/dashboard/public/`
- SSE stream format: `data: {...}\n\n` with event types `text`, `graph_state`, `done`, `error`
- All React component files use `.tsx` extension, non-component files use `.ts`

---

### Task 1: Gateway Chat Backend (agent + graph-runner + classifier)

**Files:**
- Create: `gateway/src/chat/intent-classifier.ts`
- Create: `gateway/src/chat/graph-runner.ts`
- Create: `gateway/src/chat/rag-responder.ts`
- Create: `gateway/src/chat/agent.ts`
- Create: `gateway/src/chat/index.ts`
- Test: `tests/unit/gateway/chat-agent.test.ts`

**Interfaces:**
- Consumes: `CodeAgentAdapter`, `MAFWRetriever`, `MAFWMemory` from `src/langchain/`; `buildExecutionGraph`, `FileCheckpointer` from `src/langgraph/`
- Produces: `ChatAgentService.handleChat(req, res)` — SSE stream handler; `IntentClassifier.classify(message) → Intent`;

- [ ] **Step 1: Create `gateway/src/chat/intent-classifier.ts`**

```typescript
export type IntentAction = 'EXECUTE_GRAPH' | 'RAG_ONLY' | 'SEARCH_MEMORY';

export interface Intent {
  action: IntentAction;
  entities: Record<string, string>;
}

export class IntentClassifier {
  classify(message: string): Intent {
    const lower = message.toLowerCase();
    if (lower.includes('开始') || lower.includes('规划') || lower.includes('执行') || lower.includes('run')) {
      return { action: 'EXECUTE_GRAPH', entities: {} };
    }
    if (lower.includes('搜索') || lower.includes('查找') || lower.includes('记忆') || lower.includes('search')) {
      return { action: 'SEARCH_MEMORY', entities: {} };
    }
    return { action: 'RAG_ONLY', entities: {} };
  }
}
```

- [ ] **Step 2: Create `gateway/src/chat/graph-runner.ts`**

```typescript
import { buildExecutionGraph, FileCheckpointer } from '../../src/langgraph';
import { LoopStateType } from '../../src/langgraph/loop-state';

export class GraphRunner {
  constructor(
    private projectDir: string,
    private mafwDir: string,
  ) {}

  async run(
    goalId: string,
    extraContext: Record<string, any>,
    onState: (update: { activeNodeId: string; phase: string }) => void,
    signal?: AbortSignal,
  ): Promise<{ status: string }> {
    const timeoutSignal = AbortSignal.timeout(120_000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const cp = new FileCheckpointer(this.mafwDir);
    // buildNodeOptions would be injected from the caller (MafwScheduler)
    const graph = buildExecutionGraph(this.buildNodeOptions(this.mafwDir));
    const app = graph.compile({ checkpointer: cp });

    const initialState: Partial<LoopStateType> = {
      goalId: goalId as any,
      projectDir: this.projectDir as any,
      mafwDir: this.mafwDir as any,
      round: 1,
      maxRounds: 3,
      ...extraContext,
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

  private buildNodeOptions(mafwDir: string) {
    // Minimal node options for chat-triggered execution
    return {
      plan: async (s: any) => ({ wavePlanPath: null, round: s.round }),
      execute: async (s: any) => ({ receiptPath: null }),
      review: async (s: any) => ({ reviewVerdict: 'PASS' as const, reviewReportPath: null, reviewFeedback: '' }),
      archiveSuccess: async (s: any) => { console.log(`[ChatGraph] ${s.goalId} PASSED`); return {}; },
      archiveFail: async (s: any) => { console.error(`[ChatGraph] ${s.goalId} FAILED: ${s.lastError}`); return {}; },
      archiveMaxRetries: async (s: any) => { console.error(`[ChatGraph] ${s.goalId} max retries`); return {}; },
    };
  }
}
```

- [ ] **Step 3: Create `gateway/src/chat/rag-responder.ts`**

```typescript
import { Document } from '@langchain/core/documents';
import { ServerResponse } from 'http';

export class RAGResponder {
  async stream(
    res: ServerResponse,
    message: string,
    _context: Document[],
    _memoryVars: Record<string, string>,
    _signal?: AbortSignal,
  ): Promise<void> {
    const responseText = `基于记忆的回复: "${message}" (RAG 模式)`;
    const words = responseText.split('');
    for (let i = 0; i < words.length; i++) {
      if (_signal?.aborted) break;
      res.write(`data: ${JSON.stringify({ type: 'text', content: words[i] })}\n\n`);
      await new Promise(r => setTimeout(r, 20));
    }
  }
}
```

- [ ] **Step 4: Create `gateway/src/chat/agent.ts`**

```typescript
import { IncomingMessage, ServerResponse } from 'http';
import { MAFWRetriever } from '../../src/langchain/retriever';
import { MAFWMemory } from '../../src/langchain/memory';
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';
import { ParametricStore } from '../../src/memory/store';
import { IntentClassifier } from './intent-classifier';
import { GraphRunner } from './graph-runner';
import { RAGResponder } from './rag-responder';

function initSSE(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
}

function pushSSE(res: ServerResponse, type: string, data: Record<string, any>) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

export class ChatAgentService {
  private intentClassifier = new IntentClassifier();
  private graphRunner: GraphRunner;
  private ragResponder = new RAGResponder();
  private retriever: MAFWRetriever;
  private memory: MAFWMemory;

  constructor(mafwDir: string) {
    const harmonicIndex = new HarmonicIndexManager(mafwDir);
    this.retriever = new MAFWRetriever(harmonicIndex);
    this.memory = new MAFWMemory(harmonicIndex, new ParametricStore());
    this.graphRunner = new GraphRunner(process.cwd(), mafwDir);
  }

  async handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const body = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => resolve(data));
    });
    const { message, goalId } = JSON.parse(body);
    if (!message) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'message required' }));
      return;
    }

    const [context, memoryVars] = await Promise.all([
      this.retriever._getRelevantDocuments(message),
      this.memory.loadMemoryVariables({}),
    ]);

    const intent = this.intentClassifier.classify(message);

    initSSE(res);

    if (intent.action === 'EXECUTE_GRAPH' && goalId) {
      pushSSE(res, 'text', { content: `启动 ${intent.action} 流程...` });
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

- [ ] **Step 5: Create `gateway/src/chat/index.ts`**

```typescript
export { ChatAgentService } from './agent';
export { IntentClassifier } from './intent-classifier';
export { GraphRunner } from './graph-runner';
export type { Intent, IntentAction } from './intent-classifier';
```

- [ ] **Step 6: Write test file `tests/unit/gateway/chat-agent.test.ts`**

```typescript
import { IntentClassifier } from '../../gateway/src/chat/intent-classifier';

describe('IntentClassifier', () => {
  const classifier = new IntentClassifier();

  it('classifies EXECUTE_GRAPH for 开始', () => {
    expect(classifier.classify('开始规划 goal-001').action).toBe('EXECUTE_GRAPH');
  });

  it('classifies EXECUTE_GRAPH for 执行', () => {
    expect(classifier.classify('执行任务 plan-A').action).toBe('EXECUTE_GRAPH');
  });

  it('classifies SEARCH_MEMORY for 搜索', () => {
    expect(classifier.classify('搜索关于认证的记忆').action).toBe('SEARCH_MEMORY');
  });

  it('classifies RAG_ONLY for casual chat', () => {
    expect(classifier.classify('今天天气怎么样').action).toBe('RAG_ONLY');
  });

  it('classifies EXECUTE_GRAPH for English "run"', () => {
    expect(classifier.classify('run the pipeline').action).toBe('EXECUTE_GRAPH');
  });
});
```

- [ ] **Step 7: Run tests**

```bash
npx jest tests/unit/gateway/chat-agent.test.ts --no-coverage
```
Expected: 5 tests passed.

- [ ] **Step 8: Commit**

```bash
git add gateway/src/chat/ tests/unit/gateway/chat-agent.test.ts
git commit -m "feat(gateway): add ChatAgentService with IntentClassifier and GraphRunner"
```

---

### Task 2: Frontend Scaffold (Vite + React + Tailwind + stores)

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/index.css`
- Create: `frontend/src/vite-env.d.ts`
- Create: `frontend/src/types/index.ts`
- Create: `frontend/src/stores/appStore.ts`
- Create: `frontend/src/stores/goalStore.ts`

**Interfaces:**
- Produces: `GoalStore` (Zustand), `AppStore` (Zustand), shared `types/index.ts`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "mafw-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "reactflow": "^11.11.0",
    "zustand": "^4.5.0",
    "@langchain/core": "^0.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3111',
    },
  },
  build: {
    outDir: '../gateway/src/dashboard/public',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 3: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `frontend/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#080b14',
        surface: 'rgba(16,22,40,0.55)',
        elevated: 'rgba(22,30,52,0.7)',
        blue: '#5b8def',
        purple: '#8b7cf7',
        cyan: '#4dd4e8',
        green: '#3bc98a',
        yellow: '#e8b84b',
        red: '#e8636b',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 5: Create `frontend/postcss.config.js`**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create `frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>MAFW · LangChain Frontend</title>
</head>
<body class="bg-base text-white">
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 7: Create `frontend/src/vite-env.d.ts`**

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 8: Create `frontend/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
}

body {
  font-family: 'Inter', -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 9: Create `frontend/src/types/index.ts`**

```typescript
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

- [ ] **Step 10: Create `frontend/src/stores/appStore.ts`**

```typescript
import { create } from 'zustand';

interface AppState {
  theme: 'dark' | 'light';
  sidebarCollapsed: boolean;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'dark',
  sidebarCollapsed: false,
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
```

- [ ] **Step 11: Create `frontend/src/stores/goalStore.ts`**

```typescript
import { create } from 'zustand';
import type { Goal } from '../types';

interface GoalState {
  currentGoalId: string | null;
  goals: Goal[];
  setGoalId: (id: string | null) => void;
  setGoals: (goals: Goal[]) => void;
}

export const useGoalStore = create<GoalState>((set) => ({
  currentGoalId: null,
  goals: [],
  setGoalId: (id) => set({ currentGoalId: id }),
  setGoals: (goals) => set({ goals }),
}));
```

- [ ] **Step 12: Create `frontend/src/App.tsx`**

```typescript
import { Sidebar } from './components/layout/Sidebar';
import { MainArea } from './components/layout/MainArea';

export default function App() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <MainArea />
    </div>
  );
}
```

- [ ] **Step 13: Create `frontend/src/main.tsx`**

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 14: Install dependencies and verify build**

```bash
cd frontend && npm install && npm run build
```
Expected: Build succeeds, output goes to `../gateway/src/dashboard/public/`.

- [ ] **Step 15: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): scaffold React 19 SPA with Vite, Tailwind, Zustand"
```

---

### Task 3: API Layer + Hooks

**Files:**
- Create: `frontend/src/api/chat.ts`
- Create: `frontend/src/api/goals.ts`
- Create: `frontend/src/api/memory.ts`
- Create: `frontend/src/hooks/useChat.ts`
- Create: `frontend/src/hooks/useGraphState.ts`
- Create: `frontend/src/hooks/useGoals.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `SSEEvent` from types; `Goal` from types
- Produces: `sendMessage(text, goalId?)` → SSE stream consumer; `useGraphState` → node status updates

- [ ] **Step 1: Create `frontend/src/api/chat.ts`**

```typescript
export async function sendChatMessage(
  message: string,
  goalId?: string,
): Promise<Response> {
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, goalId }),
  });
}
```

- [ ] **Step 2: Create `frontend/src/api/goals.ts`**

```typescript
import type { Goal } from '../types';

export async function fetchGoals(): Promise<Goal[]> {
  const res = await fetch('/api/goals');
  if (!res.ok) return [];
  return res.json();
}

export async function fetchGoalDetail(goalId: string): Promise<Goal | null> {
  const res = await fetch(`/api/goals/${goalId}`);
  if (!res.ok) return null;
  return res.json();
}
```

- [ ] **Step 3: Create `frontend/src/api/memory.ts`**

```typescript
export async function searchMemory(query: string, goalId?: string): Promise<any> {
  const params = new URLSearchParams({ q: query });
  if (goalId) params.set('goalId', goalId);
  const res = await fetch(`/api/memory/search?${params}`);
  if (!res.ok) return null;
  return res.json();
}
```

- [ ] **Step 4: Create `frontend/src/hooks/useChat.ts`**

```typescript
import { useState, useCallback } from 'react';
import type { ChatMessage, SSEEvent } from '../types';
import { sendChatMessage } from '../api/chat';

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(async (text: string, goalId?: string) => {
    setLoading(true);
    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);

    const assistantMsg: ChatMessage = { role: 'assistant', content: '', timestamp: '' };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const response = await sendChatMessage(text, goalId);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event: SSEEvent = JSON.parse(line.slice(6));
            if (event.type === 'text' && event.content) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: last.content + event.content! };
                }
                return updated;
              });
            }
            if (event.type === 'done') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last) {
                  updated[updated.length - 1] = { ...last, timestamp: new Date().toISOString() };
                }
                return updated;
              });
              setLoading(false);
            }
          } catch { /* skip malformed SSE */ }
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: '连接失败', timestamp: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { messages, loading, sendMessage };
}
```

- [ ] **Step 5: Create `frontend/src/hooks/useGraphState.ts`**

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { NodeStatus } from '../types';

interface GraphStateEvent {
  activeNodeId: string;
  phase: string;
}

const NODE_IDS = ['PLAN', 'EXECUTE', 'REVIEW', 'ARCHIVE_SUCCESS', 'ARCHIVE_FAIL', 'ARCHIVE_MAX_RETRIES'];

export function useGraphState() {
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, NodeStatus>>(
    () => Object.fromEntries(NODE_IDS.map((id) => [id, 'idle' as NodeStatus]))
  );

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'graph_state' || data.activeNodeId) {
          updateNodeStatuses(data as GraphStateEvent);
        }
      } catch { /* skip */ }
    };
    return () => es.close();
  }, []);

  const updateNodeStatuses = useCallback((event: GraphStateEvent) => {
    setNodeStatuses((prev) => {
      const next = { ...prev };
      for (const id of NODE_IDS) {
        if (id === event.activeNodeId) {
          next[id] = 'running';
        } else if (prev[id] === 'running') {
          next[id] = 'done';
        }
      }
      return next;
    });
  }, []);

  const resetStatuses = useCallback(() => {
    setNodeStatuses(Object.fromEntries(NODE_IDS.map((id) => [id, 'idle' as NodeStatus])));
  }, []);

  return { nodeStatuses, updateNodeStatuses, resetStatuses };
}
```

- [ ] **Step 6: Create `frontend/src/hooks/useGoals.ts`**

```typescript
import { useState, useEffect } from 'react';
import type { Goal } from '../types';
import { fetchGoals } from '../api/goals';
import { useGoalStore } from '../stores/goalStore';

export function useGoals() {
  const [loading, setLoading] = useState(true);
  const setGoals = useGoalStore((s) => s.setGoals);
  const goals = useGoalStore((s) => s.goals);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await fetchGoals();
      setGoals(data);
      setLoading(false);
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [setGoals]);

  return { goals, loading };
}
```

- [ ] **Step 7: Verify build**

```bash
cd frontend && npm run build
```
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/ frontend/src/hooks/
git commit -m "feat(frontend): add API layer, SSE chat hook, graph state hook"
```

---

### Task 4: Layout + Chat Components

**Files:**
- Create: `frontend/src/components/layout/Sidebar.tsx`
- Create: `frontend/src/components/layout/MainArea.tsx`
- Create: `frontend/src/components/layout/TopBar.tsx`
- Create: `frontend/src/components/chat/ChatPanel.tsx`
- Create: `frontend/src/components/chat/MessageBubble.tsx`
- Create: `frontend/src/components/chat/StreamingText.tsx`

**Interfaces:**
- Consumes: `useGoalStore`, `useAppStore`, `useChat`, `ChatMessage` type
- Produces: `<ChatPanel />` — full chat view; `<MessageBubble role content />`

- [ ] **Step 1: Create `frontend/src/components/layout/Sidebar.tsx`**

```typescript
import { useState } from 'react';

const TABS = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'graph', label: 'Graph', icon: '🔷' },
  { id: 'config', label: 'Config', icon: '⚙️' },
];

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <aside className="w-16 bg-gray-900 border-r border-gray-800 flex flex-col items-center py-4 gap-2">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg transition-all
            ${activeTab === tab.id ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
          title={tab.label}
        >
          {tab.icon}
        </button>
      ))}
    </aside>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/layout/MainArea.tsx`**

```typescript
import { useState } from 'react';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { ChatPanel } from '../chat/ChatPanel';
import { LangGraphCanvas } from '../graph/LangGraphCanvas';

export function MainArea() {
  const [activeTab, setActiveTab] = useState('chat');

  return (
    <div className="flex flex-1">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 flex flex-col">
        <TopBar />
        <main className="flex-1 p-4 overflow-auto">
          {activeTab === 'chat' && <ChatPanel />}
          {activeTab === 'dashboard' && <div className="text-gray-400">Dashboard (coming soon)</div>}
          {activeTab === 'graph' && <LangGraphCanvas />}
          {activeTab === 'config' && <div className="text-gray-400">Config (coming soon)</div>}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/src/components/layout/TopBar.tsx`**

```typescript
import { useGoalStore } from '../../stores/goalStore';
import { useGoals } from '../../hooks/useGoals';

export function TopBar() {
  const { goals } = useGoals();
  const currentGoalId = useGoalStore((s) => s.currentGoalId);
  const setGoalId = useGoalStore((s) => s.setGoalId);

  return (
    <header className="h-14 border-b border-gray-800 flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <span className="font-bold text-lg tracking-tight">MAFW</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">v0.1</span>
      </div>
      <select
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200"
        value={currentGoalId || ''}
        onChange={(e) => setGoalId(e.target.value || null)}
      >
        <option value="">All Goals</option>
        {goals.map((g) => (
          <option key={g.goalId} value={g.goalId}>{g.goalId.slice(0, 24)}</option>
        ))}
      </select>
    </header>
  );
}
```

- [ ] **Step 4: Create `frontend/src/components/chat/MessageBubble.tsx`**

```typescript
interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed
          ${isUser
            ? 'bg-blue-500/20 text-blue-100 border border-blue-500/20'
            : 'bg-gray-800/50 text-gray-200 border border-gray-700/30'}`}
      >
        {content || (isUser ? '' : <span className="text-gray-500 italic">思考中...</span>)}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `frontend/src/components/chat/StreamingText.tsx`**

```typescript
interface StreamingTextProps {
  text: string;
  loading: boolean;
}

export function StreamingText({ text, loading }: StreamingTextProps) {
  if (!text && loading) {
    return <span className="inline-flex gap-1"><span className="animate-bounce">.</span><span className="animate-bounce delay-100">.</span><span className="animate-bounce delay-200">.</span></span>;
  }
  return <>{text}</>;
}
```

- [ ] **Step 6: Create `frontend/src/components/chat/ChatPanel.tsx`**

```typescript
import { useState } from 'react';
import { useChat } from '../../hooks/useChat';
import { useGoalStore } from '../../stores/goalStore';
import { MessageBubble } from './MessageBubble';

export function ChatPanel() {
  const [input, setInput] = useState('');
  const { messages, loading, sendMessage } = useChat();
  const currentGoalId = useGoalStore((s) => s.currentGoalId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');
    await sendMessage(text, currentGoalId || undefined);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-2">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-lg mb-2">MAFW LangChain Assistant</p>
            <p className="text-sm">输入消息开始对话，或输入"规划"触发 LangGraph 执行</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} />
        ))}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 mt-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息..."
          disabled={loading}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-5 py-2.5 bg-blue-500/20 text-blue-400 rounded-xl text-sm font-medium border border-blue-500/20 hover:bg-blue-500/30 disabled:opacity-30"
        >
          {loading ? '...' : '发送'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 7: Verify build**

```bash
cd frontend && npm run build
```
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/layout/ frontend/src/components/chat/
git commit -m "feat(frontend): add layout and chat UI components"
```

---

### Task 5: Dashboard Components

**Files:**
- Create: `frontend/src/components/dashboard/KpiCards.tsx`
- Create: `frontend/src/components/dashboard/GoalList.tsx`
- Create: `frontend/src/components/dashboard/GoalDetail.tsx`
- Create: `frontend/src/components/dashboard/MemorySearch.tsx`
- Modify: `frontend/src/components/layout/MainArea.tsx` (add dashboard route)

- [ ] **Step 1: Create `frontend/src/components/dashboard/KpiCards.tsx`**

```typescript
interface KpiCardsProps {
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  totalLoops: number;
}

export function KpiCards({ totalGoals, activeGoals, completedGoals, totalLoops }: KpiCardsProps) {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      {[
        { label: 'Total Goals', value: totalGoals, color: 'text-blue-400' },
        { label: 'Active', value: activeGoals, color: 'text-green-400' },
        { label: 'Completed', value: completedGoals, color: 'text-purple-400' },
        { label: 'Total Loops', value: totalLoops, color: 'text-yellow-400' },
      ].map((kpi) => (
        <div key={kpi.label} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{kpi.label}</div>
          <div className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/dashboard/GoalList.tsx`**

```typescript
import type { Goal } from '../../types';
import { useGoalStore } from '../../stores/goalStore';

interface GoalListProps {
  goals: Goal[];
}

export function GoalList({ goals }: GoalListProps) {
  const setGoalId = useGoalStore((s) => s.setGoalId);
  const currentGoalId = useGoalStore((s) => s.currentGoalId);

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Goals</h3>
      {goals.length === 0 && <div className="text-sm text-gray-500">No goals</div>}
      {goals.map((g) => (
        <div
          key={g.goalId}
          onClick={() => setGoalId(g.goalId)}
          className={`flex items-center justify-between p-3 rounded-lg cursor-pointer mb-1 transition-all
            ${currentGoalId === g.goalId ? 'bg-blue-500/10 border border-blue-500/20' : 'hover:bg-gray-800/50 border border-transparent'}`}
        >
          <span className="text-sm font-mono text-gray-300">{g.goalId.slice(0, 24)}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            g.phase === 'COMPLETED' ? 'bg-green-500/10 text-green-400' :
            g.phase === 'FAILED' ? 'bg-red-500/10 text-red-400' :
            'bg-blue-500/10 text-blue-400'
          }`}>{g.phase}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/src/components/dashboard/GoalDetail.tsx`**

```typescript
import type { Goal } from '../../types';

interface GoalDetailProps {
  goal: Goal | null;
}

export function GoalDetail({ goal }: GoalDetailProps) {
  if (!goal) {
    return <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 text-center text-gray-500">选择一个 Goal 查看详情</div>;
  }

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-sm">{goal.goalId}</h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{goal.phase}</span>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-gray-500">Loop</span><p className="font-mono">{goal.loop}</p></div>
        <div><span className="text-gray-500">Wave</span><p className="font-mono">{goal.currentWave}/{goal.totalWaves}</p></div>
        <div><span className="text-gray-500">Next</span><p className="font-mono">{goal.nextAction || '—'}</p></div>
        <div><span className="text-gray-500">Updated</span><p className="font-mono text-xs">{goal.updatedAt ? new Date(goal.updatedAt).toLocaleString() : '—'}</p></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `frontend/src/components/dashboard/MemorySearch.tsx`**

```typescript
import { useState } from 'react';
import { searchMemory } from '../../api/memory';
import { useGoalStore } from '../../stores/goalStore';

export function MemorySearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const currentGoalId = useGoalStore((s) => s.currentGoalId);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    const data = await searchMemory(query, currentGoalId || undefined);
    setResults(data?.entries || []);
    setLoading(false);
  };

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Memory Search</h3>
      <form onSubmit={handleSearch} className="flex gap-2 mb-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索记忆..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none"
        />
        <button type="submit" disabled={loading} className="px-4 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-sm">
          {loading ? '...' : '搜索'}
        </button>
      </form>
      {results && results.length === 0 && <div className="text-sm text-gray-500">无结果</div>}
      {results?.map((r: any, i: number) => (
        <div key={i} className="text-xs text-gray-400 py-1.5 border-b border-gray-800 last:border-0">
          <span className="text-gray-500">{r.tier}</span> {r.content?.slice(0, 100)}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Wire up dashboard view in `MainArea.tsx`**

Find the dashboard placeholder line and replace:

```typescript
{activeTab === 'dashboard' && <DashboardView />}
```

Then create the DashboardView as part of MainArea (or inline):

```typescript
// Inside MainArea.tsx, add:
import { useGoals } from '../../hooks/useGoals';
import { useGoalStore } from '../../stores/goalStore';
import { KpiCards } from '../dashboard/KpiCards';
import { GoalList } from '../dashboard/GoalList';
import { GoalDetail } from '../dashboard/GoalDetail';
import { MemorySearch } from '../dashboard/MemorySearch';

function DashboardView() {
  const { goals } = useGoals();
  const currentGoalId = useGoalStore((s) => s.currentGoalId);
  const active = goals.filter(g => g.phase !== 'COMPLETED' && g.phase !== 'FAILED' && g.phase !== 'ARCHIVED').length;
  const completed = goals.filter(g => g.phase === 'COMPLETED').length;
  const loops = goals.reduce((sum, g) => sum + (g.loop || 0), 0);
  const selectedGoal = goals.find(g => g.goalId === currentGoalId) || null;

  return (
    <div>
      <KpiCards totalGoals={goals.length} activeGoals={active} completedGoals={completed} totalLoops={loops} />
      <div className="grid grid-cols-3 gap-4">
        <GoalList goals={goals} />
        <GoalDetail goal={selectedGoal} />
        <MemorySearch />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify build**

```bash
cd frontend && npm run build
```
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/dashboard/ frontend/src/components/layout/MainArea.tsx
git commit -m "feat(frontend): add dashboard view with KPI cards, goal list, memory search"
```

---

### Task 6: Graph Visualization (React Flow)

**Files:**
- Create: `frontend/src/components/graph/PlanNode.tsx`
- Create: `frontend/src/components/graph/ExecuteNode.tsx`
- Create: `frontend/src/components/graph/ReviewNode.tsx`
- Create: `frontend/src/components/graph/ArchiveNode.tsx`
- Create: `frontend/src/components/graph/LangGraphCanvas.tsx`

**Interfaces:**
- Consumes: `useGraphState` hook, `NodeStatus` type
- Produces: `<LangGraphCanvas />` — React Flow canvas with custom nodes

- [ ] **Step 1: Create custom node components**

Create `frontend/src/components/graph/PlanNode.tsx`:

```typescript
import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { NodeStatus } from '../../types';

const STATUS_STYLES: Record<NodeStatus, { bg: string; border: string; pulse?: boolean }> = {
  idle: { bg: 'bg-gray-800/30', border: 'border-gray-700/30' },
  running: { bg: 'bg-blue-500/10', border: 'border-blue-500/50', pulse: true },
  done: { bg: 'bg-green-500/10', border: 'border-green-500/30' },
  error: { bg: 'bg-red-500/10', border: 'border-red-500/50' },
};

function BaseNode({ id, data, label }: { id: string; data: { status?: NodeStatus }; label: string }) {
  const status = data.status || 'idle';
  const style = STATUS_STYLES[status];

  return (
    <div className={`px-6 py-3 rounded-xl border ${style.bg} ${style.border} ${style.pulse ? 'animate-pulse shadow-lg shadow-blue-500/10' : ''} transition-all duration-300`}>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${status === 'running' ? 'bg-blue-400' : status === 'done' ? 'bg-green-400' : status === 'error' ? 'bg-red-400' : 'bg-gray-600'}`} />
        <span className="text-sm font-medium text-gray-200">{label}</span>
      </div>
    </div>
  );
}

export const PlanNode = memo((props: NodeProps) => <BaseNode {...props} label="Plan" />);
export const ExecuteNode = memo((props: NodeProps) => <BaseNode {...props} label="Execute" />);
export const ReviewNode = memo((props: NodeProps) => <BaseNode {...props} label="Review" />);
export const ArchiveNode = memo((props: NodeProps) => <BaseNode {...props} label="Archive" />);
```

Create each custom node file similarly. For simplicity, create them all in one file or separate files that re-export from a shared base.

- [ ] **Step 2: Create `frontend/src/components/graph/LangGraphCanvas.tsx`**

```typescript
import { useCallback } from 'react';
import ReactFlow, {
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MarkerType,
  type Node,
  type Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useGraphState } from '../../hooks/useGraphState';
import { PlanNode, ExecuteNode, ReviewNode, ArchiveNode } from './index';

const nodeTypes = {
  plan: PlanNode,
  execute: ExecuteNode,
  review: ReviewNode,
  archive: ArchiveNode,
};

const initialNodes: Node[] = [
  { id: 'PLAN', type: 'plan', position: { x: 250, y: 0 }, data: { status: 'idle' } },
  { id: 'EXECUTE', type: 'execute', position: { x: 250, y: 100 }, data: { status: 'idle' } },
  { id: 'REVIEW', type: 'review', position: { x: 250, y: 200 }, data: { status: 'idle' } },
  { id: 'ARCHIVE_SUCCESS', type: 'archive', position: { x: 100, y: 320 }, data: { status: 'idle', label: 'Success' } },
  { id: 'ARCHIVE_FAIL', type: 'archive', position: { x: 250, y: 320 }, data: { status: 'idle', label: 'Fail' } },
  { id: 'ARCHIVE_MAX_RETRIES', type: 'archive', position: { x: 400, y: 320 }, data: { status: 'idle', label: 'Max Retries' } },
];

const initialEdges: Edge[] = [
  { id: 'e-plan-execute', source: 'PLAN', target: 'EXECUTE', animated: true, style: { stroke: '#5b8def' } },
  { id: 'e-execute-review', source: 'EXECUTE', target: 'REVIEW', animated: true, style: { stroke: '#5b8def' } },
  { id: 'e-review-success', source: 'REVIEW', target: 'ARCHIVE_SUCCESS', label: 'PASS', animated: true, style: { stroke: '#3bc98a' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3bc98a' } },
  { id: 'e-review-fail', source: 'REVIEW', target: 'ARCHIVE_FAIL', label: 'ERROR', style: { stroke: '#e8636b' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#e8636b' } },
  { id: 'e-review-retry', source: 'REVIEW', target: 'PLAN', label: 'FAIL (retry)', style: { stroke: '#e8b84b' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#e8b84b' } },
  { id: 'e-review-max', source: 'REVIEW', target: 'ARCHIVE_MAX_RETRIES', label: 'max retries', style: { stroke: '#e8636b' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#e8636b' } },
];

export function LangGraphCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const { nodeStatuses } = useGraphState();

  // Sync node statuses from SSE
  const syncNodes = useCallback(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: { ...node.data, status: nodeStatuses[node.id] || 'idle' },
      }))
    );
  }, [nodeStatuses, setNodes]);

  // Run sync when statuses change
  import('react').then(({ useEffect }) => {
    useEffect(syncNodes, [syncNodes]);
  });

  return (
    <div className="h-[600px] bg-gray-900/30 rounded-xl border border-gray-800">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background color="rgba(255,255,255,0.02)" />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

Note: The above has a problematic dynamic import of React inside the component. Fix this by moving the useEffect to the top level of the function, using a proper React import at the top:

- [ ] **Step 3: Correct LangGraphCanvas with proper useEffect**

```typescript
import { useCallback, useEffect } from 'react';
// ... rest same as Step 2 but with top-level useEffect

export function LangGraphCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const { nodeStatuses } = useGraphState();

  const syncNodes = useCallback(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: { ...node.data, status: nodeStatuses[node.id] || 'idle' },
      }))
    );
  }, [nodeStatuses, setNodes]);

  useEffect(() => { syncNodes(); }, [syncNodes]);

  return (
    <div className="h-[600px] bg-gray-900/30 rounded-xl border border-gray-800">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background color="rgba(255,255,255,0.02)" />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 4: Create `frontend/src/components/graph/index.ts` (barrel export)**

```typescript
export { PlanNode, ExecuteNode, ReviewNode, ArchiveNode } from './PlanNode';
export { LangGraphCanvas } from './LangGraphCanvas';
```

- [ ] **Step 5: Verify build**

```bash
cd frontend && npm run build
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/graph/
git commit -m "feat(frontend): add LangGraph visualization with React Flow"
```

---

### Task 7: End-to-End Verification

**Files:**
- No new files — verify the full build and integration

- [ ] **Step 1: Build frontend**

```bash
cd frontend && npm run build
```
Expected: Build output in `gateway/src/dashboard/public/`.

- [ ] **Step 2: Verify the build output exists**

```bash
ls gateway/src/dashboard/public/index.html
```
Expected: File exists.

- [ ] **Step 3: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: All tests pass.

- [ ] **Step 4: Run TypeScript check on frontend**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Verify Gateway TypeScript (ensure chat imports resolve)**

```bash
cd gateway && npx tsc --noEmit 2>&1 | grep -i "chat" || echo "No chat-related errors"
```
Expected: "No chat-related errors" or only pre-existing errors.

- [ ] **Step 6: Commit any final adjustments**

```bash
git add -A
git status
git commit -m "chore: final adjustments after LangChain frontend build"
```
