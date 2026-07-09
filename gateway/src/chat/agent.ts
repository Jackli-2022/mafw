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

    try {
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
        this.retriever.getRelevantDocuments(message),
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
    } catch (err: any) {
      if (res.headersSent) {
        pushSSE(res, 'error', { message: err.message || 'Internal error' });
      } else {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message || 'Internal error' }));
      }
    } finally {
      res.end();
    }
  }
}
