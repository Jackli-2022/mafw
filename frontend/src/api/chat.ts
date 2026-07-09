export async function sendChatMessage(
  message: string,
  goalId?: string,
): Promise<Response> {
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, goalId }),
  });
}
