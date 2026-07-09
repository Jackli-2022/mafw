import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ChatPanel } from '../chat/ChatPanel';
import { LangGraphCanvas } from '../graph/LangGraphCanvas';
import { useGoals } from '../../hooks/useGoals';
import { useGoalStore } from '../../stores/goalStore';
import { KpiCards } from '../dashboard/KpiCards';
import { GoalList } from '../dashboard/GoalList';
import { GoalDetail } from '../dashboard/GoalDetail';
import { MemorySearch } from '../dashboard/MemorySearch';

function DashboardView() {
  const { goals } = useGoals();
  const currentGoalId = useGoalStore((s) => s.currentGoalId);
  const active = goals.filter(g => g.phase !== 'COMPLETED' && g.phase !== 'FAILED' && g.phase !== 'ARCHIVED').length;
  const completed = goals.filter(g => g.phase === 'COMPLETED').length;
  const loops = goals.reduce((sum, g) => sum + (g.loop || 0), 0);
  const selectedGoal = goals.find(g => g.goalId === currentGoalId) || null;

  return (
    <div>
      <KpiCards totalGoals={goals.length} activeGoals={active} completedGoals={completed} totalLoops={loops} />
      <div className="grid grid-cols-3 gap-4">
        <GoalList goals={goals} />
        <GoalDetail goal={selectedGoal} />
        <MemorySearch />
      </div>
    </div>
  );
}

export function MainArea() {
  const [activeTab, setActiveTab] = useState('chat');

  return (
    <div className="flex flex-1">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 flex flex-col">
        <TopBar />
        <main className="flex-1 p-4 overflow-auto">
          {activeTab === 'chat' && <ChatPanel />}
          {activeTab === 'dashboard' && <DashboardView />}
          {activeTab === 'graph' && <LangGraphCanvas />}
          {activeTab === 'config' && <div className="text-gray-400">Config (coming soon)</div>}
        </main>
      </div>
    </div>
  );
}
