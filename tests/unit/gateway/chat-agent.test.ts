import { IntentClassifier } from '../../../gateway/src/chat/intent-classifier';

describe('IntentClassifier', () => {
  const classifier = new IntentClassifier(
    ['开始', '规划', '执行', 'run'],
    ['搜索', '查找', '记忆', 'search'],
  );

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

  it('classifies EXECUTE_GRAPH for "run"', () => {
    expect(classifier.classify('run the pipeline').action).toBe('EXECUTE_GRAPH');
  });
});
