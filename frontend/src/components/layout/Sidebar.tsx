import { useState } from 'react';

const TABS = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'graph', label: 'Graph', icon: '🔷' },
  { id: 'config', label: 'Config', icon: '⚙️' },
];

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <aside className="w-16 bg-gray-900 border-r border-gray-800 flex flex-col items-center py-4 gap-2">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg transition-all
            ${activeTab === tab.id ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
          title={tab.label}
        >
          {tab.icon}
        </button>
      ))}
    </aside>
  );
}
