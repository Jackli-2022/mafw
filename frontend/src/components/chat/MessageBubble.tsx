interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed
          ${isUser
            ? 'bg-blue-500/20 text-blue-100 border border-blue-500/20'
            : 'bg-gray-800/50 text-gray-200 border border-gray-700/30'}`}
      >
        {content || (isUser ? '' : <span className="text-gray-500 italic">思考中...</span>)}
      </div>
    </div>
  );
}
