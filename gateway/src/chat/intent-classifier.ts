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
