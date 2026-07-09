interface KpiCardsProps {
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  totalLoops: number;
}

const CARDS = [
  { label: 'Total Goals', value: null as number | null, color: 'text-blue-400', gradient: 'from-blue-500/10 to-blue-600/5', border: 'border-blue-500/10', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { label: 'Active', value: null as number | null, color: 'text-green-400', gradient: 'from-green-500/10 to-green-600/5', border: 'border-green-500/10', icon: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' },
  { label: 'Completed', value: null as number | null, color: 'text-purple-400', gradient: 'from-purple-500/10 to-purple-600/5', border: 'border-purple-500/10', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { label: 'Total Loops', value: null as number | null, color: 'text-yellow-400', gradient: 'from-yellow-500/10 to-yellow-600/5', border: 'border-yellow-500/10', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
];

export function KpiCards({ totalGoals, activeGoals, completedGoals, totalLoops }: KpiCardsProps) {
  const values = [totalGoals, activeGoals, completedGoals, totalLoops];

  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {CARDS.map((kpi, i) => (
        <div key={kpi.label} className={`rounded-xl p-4 bg-gradient-to-br ${kpi.gradient} ${kpi.border} border`}>
          <div className="flex items-center justify-between mb-3">
            <div className={`w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center`}>
              <svg className={`w-4 h-4 ${kpi.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={kpi.icon} />
              </svg>
            </div>
          </div>
          <div className={`text-2xl font-bold ${kpi.color} font-mono`}>{values[i]}</div>
          <div className="text-[11px] text-gray-600 mt-0.5 tracking-wide">{kpi.label}</div>
        </div>
      ))}
    </div>
  );
}
