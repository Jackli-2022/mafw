import * as http from 'http';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

export class ChatSessionManager {
  private sessions: Map<string, Set<http.ServerResponse>> = new Map();

  /** Register an SSE connection to listen for a specific session's events */
  register(sessionID: string, res: http.ServerResponse): void {
    res.writeHead(200, SSE_HEADERS);
    res.write(`data: ${JSON.stringify({ type: 'connected', sessionID })}\n\n`);

    if (!this.sessions.has(sessionID)) {
      this.sessions.set(sessionID, new Set());
    }
    this.sessions.get(sessionID)!.add(res);

    const self = this;
    res.on('close', () => {
      const set = self.sessions.get(sessionID);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          self.sessions.delete(sessionID);
        }
      }
    });
  }

  /** Push a text delta to all SSE connections for a session */
  pushDelta(sessionID: string, text: string): void {
    const set = this.sessions.get(sessionID);
    if (!set) return;
    const data = `data: ${JSON.stringify({ type: 'message_delta', sessionID, content: text })}\n\n`;
    for (const res of set) {
      try { res.write(data); } catch { this.removeResponse(sessionID, res); }
    }
  }

  /** Signal completion to all SSE connections for a session */
  pushComplete(sessionID: string): void {
    const set = this.sessions.get(sessionID);
    if (!set) return;
    const data = `data: ${JSON.stringify({ type: 'message_complete', sessionID })}\n\n`;
    for (const res of set) {
      try {
        res.write(data);
        res.end();
      } catch { /* client already gone */ }
    }
    this.sessions.delete(sessionID);
  }

  /** Signal error to all SSE connections for a session */
  pushError(sessionID: string, error: string): void {
    const set = this.sessions.get(sessionID);
    if (!set) return;
    const data = `data: ${JSON.stringify({ type: 'message_error', sessionID, error })}\n\n`;
    for (const res of set) {
      try {
        res.write(data);
        res.end();
      } catch { /* client already gone */ }
    }
    this.sessions.delete(sessionID);
  }

  /** Check if any SSE connections are listening for a session */
  hasListeners(sessionID: string): boolean {
    const set = this.sessions.get(sessionID);
    return !!set && set.size > 0;
  }

  /** Get all tracked session IDs */
  getTrackedSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  private removeResponse(sessionID: string, res: http.ServerResponse): void {
    const set = this.sessions.get(sessionID);
    if (set) {
      set.delete(res);
      if (set.size === 0) {
        this.sessions.delete(sessionID);
      }
    }
  }
}
