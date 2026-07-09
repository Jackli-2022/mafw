import type { Goal } from '../../types';
import { useGoalStore } from '../../stores/goalStore';

interface GoalListProps {
  goals: Goal[];
}

export function GoalList({ goals }: GoalListProps) {
  const setGoalId = useGoalStore((s) => s.setGoalId);
  const currentGoalId = useGoalStore((s) => s.currentGoalId);

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Goals</h3>
      {goals.length === 0 && <div className="text-sm text-gray-500">No goals</div>}
      {goals.map((g) => (
        <div
          key={g.goalId}
          onClick={() => setGoalId(g.goalId)}
          className={`flex items-center justify-between p-3 rounded-lg cursor-pointer mb-1 transition-all
            ${currentGoalId === g.goalId ? 'bg-blue-500/10 border border-blue-500/20' : 'hover:bg-gray-800/50 border border-transparent'}`}
        >
          <span className="text-sm font-mono text-gray-300">{g.goalId.slice(0, 24)}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            g.phase === 'COMPLETED' ? 'bg-green-500/10 text-green-400' :
            g.phase === 'FAILED' ? 'bg-red-500/10 text-red-400' :
            'bg-blue-500/10 text-blue-400'
          }`}>{g.phase}</span>
        </div>
      ))}
    </div>
  );
}
