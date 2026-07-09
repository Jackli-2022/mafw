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
    <div className="flex flex-col h-[calc(100vh-8rem)]">
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
