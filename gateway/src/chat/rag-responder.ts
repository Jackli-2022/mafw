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
    for (let i = 0; i < responseText.length; i++) {
      if (_signal?.aborted) break;
      res.write(`data: ${JSON.stringify({ type: 'text', content: responseText[i] })}\n\n`);
      await new Promise(r => setTimeout(r, 20));
    }
  }
}
