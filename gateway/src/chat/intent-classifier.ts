export type IntentAction = 'EXECUTE_GRAPH' | 'RAG_ONLY' | 'SEARCH_MEMORY';

export interface Intent {
  action: IntentAction;
  entities: Record<string, string>;
}

import { config } from '../config';

export class IntentClassifier {
  classify(message: string): Intent {
    const lower = message.toLowerCase();
    const executeKw = config.chat.executeGraphKeywords;
    if (executeKw.some(kw => lower.includes(kw))) {
      return { action: 'EXECUTE_GRAPH', entities: {} };
    }
    const searchKw = config.chat.searchMemoryKeywords;
    if (searchKw.some(kw => lower.includes(kw))) {
      return { action: 'SEARCH_MEMORY', entities: {} };
    }
    return { action: 'RAG_ONLY', entities: {} };
  }
}
