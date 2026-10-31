'use client';

import React from 'react';
import { Plus } from 'lucide-react';

export type NavTab = 'dashboard' | 'workspace' | 'projects' | 'history' | 'settings';

interface NavbarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onNewTranslation: () => void;
}

export default function Navbar({
  activeTab,
  onSelectTab,
  onNewTranslation,
}: NavbarProps) {
  const navItems: Array<{ id: NavTab; label: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'workspace', label: 'Workspace' },
    { id: 'projects', label: 'My Projects' },
    { id: 'history', label: 'History' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 lg:px-10 py-4 bg-[#FAF8F5]/95 backdrop-blur-sm border-b border-[#E5E0D8]">
      {/* Zone 1: Single text element wordmark */}
      <button
        type="button"
        onClick={() => onSelectTab('dashboard')}
        className="font-display text-2xl font-semibold tracking-tight text-[#1C1917] hover:text-[#9A3412] transition-colors whitespace-nowrap shrink-0 cursor-pointer text-left"
      >
        GolpoTranslate
      </button>

      {/* Zone 2: 5 concise single-line text navigation links */}
      <nav aria-label="Main Navigation" className="flex items-center gap-5 md:gap-7 overflow-x-auto">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 cursor-pointer ${
                isActive
                  ? 'border-[#9A3412] text-[#1C1917] font-semibold'
                  : 'border-transparent text-[#57534E] hover:text-[#1C1917] hover:border-[#D6CFC5]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: 1 primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onNewTranslation}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Translation</span>
        </button>
      </div>
    </header>
  );
}
