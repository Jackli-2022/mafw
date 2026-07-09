import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ChatPanel } from '../chat/ChatPanel';
import { LangGraphCanvas } from '../graph/LangGraphCanvas';

function DashboardView() {
  return <div className="text-gray-400">Dashboard (coming soon)</div>;
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
