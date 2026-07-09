import { useState, useCallback } from 'react';
import type { ChatMessage, SSEEvent } from '../types';
import { sendChatMessage } from '../api/chat';

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(async (text: string, goalId?: string) => {
    if (loading) return;
    setLoading(true);
    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);

    const assistantMsg: ChatMessage = { role: 'assistant', content: '', timestamp: '' };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const response = await sendChatMessage(text, goalId);
      if (!response.ok || !response.body) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: `请求失败 (${response.status})`, timestamp: new Date().toISOString() };
          return updated;
        });
        setLoading(false);
        return;
      }

      const reader = response.body.getReader();
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
                  updated[updated.length - 1] = { ...last, content: last.content + event.content };
                }
                return updated;
              });
            }
            if (event.type === 'error' && event.message) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: `错误: ${event.message}`, timestamp: new Date().toISOString() };
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
    } catch (err: any) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: `连接失败: ${err.message}`, timestamp: new Date().toISOString() };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  return { messages, loading, sendMessage };
}
