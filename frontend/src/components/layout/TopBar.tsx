import { useGoalStore } from '../../stores/goalStore';
import { useGoals } from '../../hooks/useGoals';

export function TopBar() {
  const { goals } = useGoals();
  const currentGoalId = useGoalStore((s) => s.currentGoalId);
  const setGoalId = useGoalStore((s) => s.setGoalId);

  return (
    <header className="h-14 border-b border-gray-800 flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <span className="font-bold text-lg tracking-tight">MAFW</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">v0.1</span>
      </div>
      <select
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200"
        value={currentGoalId || ''}
        onChange={(e) => setGoalId(e.target.value || null)}
      >
        <option value="">All Goals</option>
        {goals.map((g) => (
          <option key={g.goalId} value={g.goalId}>{g.goalId.slice(0, 24)}</option>
        ))}
      </select>
    </header>
  );
}
