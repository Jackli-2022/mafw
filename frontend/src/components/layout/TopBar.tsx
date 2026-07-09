import { useGoalStore } from '../../stores/goalStore';
import { useGoals } from '../../hooks/useGoals';

export function TopBar() {
  const { goals } = useGoals();
  const currentGoalId = useGoalStore((s) => s.currentGoalId);
  const setGoalId = useGoalStore((s) => s.setGoalId);

  return (
    <header className="h-12 border-b border-white/5 flex items-center justify-between px-4 bg-[#080b14]/80 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <span className="font-bold text-sm tracking-tight text-gray-200">MAFW</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium">v0.1</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500">Goal:</span>
        <select
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 font-mono outline-none focus:border-blue-500/30 transition-colors"
          value={currentGoalId || ''}
          onChange={(e) => setGoalId(e.target.value || null)}
        >
          <option value="" className="bg-[#0f1422]">All Goals</option>
          {goals.map((g) => (
            <option key={g.goalId} value={g.goalId} className="bg-[#0f1422]">{g.goalId.slice(0, 24)}</option>
          ))}
        </select>
      </div>
    </header>
  );
}
