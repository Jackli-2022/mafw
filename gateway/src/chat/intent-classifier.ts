export type IntentAction = 'EXECUTE_GRAPH' | 'RAG_ONLY' | 'SEARCH_MEMORY';

export interface Intent {
  action: IntentAction;
  entities: Record<string, string>;
}

import { config } from '../config';

export class IntentClassifier {
  private readonly executeKw: string[];
  private readonly searchKw: string[];

  constructor(executeKw?: string[], searchKw?: string[]) {
    this.executeKw = executeKw ?? config.chat.executeGraphKeywords;
    this.searchKw = searchKw ?? config.chat.searchMemoryKeywords;
  }

  classify(message: string): Intent {
    const lower = message.toLowerCase();
    if (this.executeKw.some(kw => lower.includes(kw))) {
      return { action: 'EXECUTE_GRAPH', entities: {} };
    }
    if (this.searchKw.some(kw => lower.includes(kw))) {
      return { action: 'SEARCH_MEMORY', entities: {} };
    }
    return { action: 'RAG_ONLY', entities: {} };
  }
}
