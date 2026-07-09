import type { Goal } from '../../types';

interface GoalDetailProps {
  goal: Goal | null;
}

export function GoalDetail({ goal }: GoalDetailProps) {
  if (!goal) {
    return <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 text-center text-gray-500">选择一个 Goal 查看详情</div>;
  }

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-sm">{goal.goalId}</h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{goal.phase}</span>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-gray-500">Loop</span><p className="font-mono">{goal.loop}</p></div>
        <div><span className="text-gray-500">Wave</span><p className="font-mono">{goal.currentWave}/{goal.totalWaves}</p></div>
        <div><span className="text-gray-500">Next</span><p className="font-mono">{goal.nextAction || '—'}</p></div>
        <div><span className="text-gray-500">Updated</span><p className="font-mono text-xs">{goal.updatedAt ? new Date(goal.updatedAt).toLocaleString() : '—'}</p></div>
      </div>
    </div>
  );
}
