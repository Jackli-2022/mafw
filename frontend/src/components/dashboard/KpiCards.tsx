interface KpiCardsProps {
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  totalLoops: number;
}

export function KpiCards({ totalGoals, activeGoals, completedGoals, totalLoops }: KpiCardsProps) {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      {[
        { label: 'Total Goals', value: totalGoals, color: 'text-blue-400' },
        { label: 'Active', value: activeGoals, color: 'text-green-400' },
        { label: 'Completed', value: completedGoals, color: 'text-purple-400' },
        { label: 'Total Loops', value: totalLoops, color: 'text-yellow-400' },
      ].map((kpi) => (
        <div key={kpi.label} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{kpi.label}</div>
          <div className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</div>
        </div>
      ))}
    </div>
  );
}
