import { useState, useEffect, useCallback } from 'react';
import type { NodeStatus } from '../types';

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
          setNodeStatuses((prev) => {
            const next = { ...prev };
            const activeId = data.activeNodeId;
            for (const id of NODE_IDS) {
              if (id === activeId) {
                next[id] = 'running';
              } else if (prev[id] === 'running') {
                next[id] = 'done';
              }
            }
            return next;
          });
        }
      } catch { /* skip */ }
    };
    return () => es.close();
  }, []);

  const resetStatuses = useCallback(() => {
    setNodeStatuses(Object.fromEntries(NODE_IDS.map((id) => [id, 'idle' as NodeStatus])));
  }, []);

  return { nodeStatuses, resetStatuses };
}
