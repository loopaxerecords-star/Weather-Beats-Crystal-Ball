import React, { useState } from 'react';
import { DomainCategory } from '../types/telemetry';
import { ALL_DOMAINS_LIST, UNIVERSAL_DOMAINS } from '../services/domainRegistry';
import {
  CloudSun, Leaf, Globe, Zap, Cpu, Volume2, Music, Wind, Activity, Waves,
  Sun, Orbit, TreePine, Wheat, Factory, Building, Truck, Network, TrendingUp,
  DollarSign, Briefcase, MessageSquare, Bot, ShieldAlert, Search
} from 'lucide-react';

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  CloudSun, Leaf, Globe, Zap, Cpu, Volume2, Music, Wind, Activity, Waves,
  Sun, Orbit, TreePine, Wheat, Factory, Building, Truck, Network, TrendingUp,
  DollarSign, Briefcase, MessageSquare, Bot, ShieldAlert
};

interface SidebarProps {
  selectedDomain: DomainCategory;
  onSelectDomain: (domain: DomainCategory) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ selectedDomain, onSelectDomain }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterGroup, setFilterGroup] = useState<'all' | 'phase1' | 'expansions'>('all');

  const filteredDomains = ALL_DOMAINS_LIST.filter(d => {
    const matchesSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          d.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          d.description.toLowerCase().includes(searchTerm.toLowerCase());

    if (filterGroup === 'phase1') return matchesSearch && d.isPhase1Priority;
    if (filterGroup === 'expansions') return matchesSearch && !d.isPhase1Priority;
    return matchesSearch;
  });

  return (
    <aside className="w-80 bg-[#0d121e] border-r border-slate-800 flex flex-col shrink-0 select-none overflow-hidden">
      {/* Search & Filter Header */}
      <div className="p-4 border-b border-slate-800 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search 24 Intelligence Domains..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#141b2d] border border-slate-700/80 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500 font-medium"
          />
        </div>

        {/* Filter Segmented Buttons */}
        <div className="flex items-center gap-1.5 p-1 bg-[#141b2d] rounded-lg border border-slate-800">
          <button
            onClick={() => setFilterGroup('all')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
              filterGroup === 'all' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All (24)
          </button>
          <button
            onClick={() => setFilterGroup('phase1')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
              filterGroup === 'phase1' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Phase 1 (6)
          </button>
          <button
            onClick={() => setFilterGroup('expansions')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
              filterGroup === 'expansions' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Expansions (18)
          </button>
        </div>
      </div>

      {/* Domain Registry List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
        <div className="px-3 py-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
          <span>Intelligence Domains</span>
          <span className="font-mono text-cyan-400">{filteredDomains.length} / 24</span>
        </div>

        {filteredDomains.map((domain) => {
          const IconComponent = ICON_MAP[domain.iconName] || Activity;
          const isSelected = selectedDomain === domain.id;

          return (
            <button
              key={domain.id}
              onClick={() => onSelectDomain(domain.id)}
              className={`w-full text-left p-3.5 rounded-xl transition-all flex items-center gap-3.5 group relative border ${
                isSelected
                  ? 'bg-slate-800/90 border-slate-700 text-white shadow-lg'
                  : 'bg-transparent border-transparent hover:bg-slate-800/40 text-slate-300 hover:text-white'
              }`}
            >
              {/* Left Color Accent Bar */}
              <div
                className="w-1.5 h-full rounded-full absolute left-0 top-0 bottom-0 opacity-90"
                style={{ backgroundColor: domain.colorHex }}
              />

              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border"
                style={{
                  backgroundColor: `${domain.colorHex}15`,
                  borderColor: `${domain.colorHex}40`,
                  color: domain.colorHex
                }}
              >
                <IconComponent className="w-5 h-5" />
              </div>

              <div className="flex-1 min-w-0 pr-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-bold truncate leading-tight">{domain.name}</span>
                  {domain.isPhase1Priority && (
                    <span className="text-[10px] font-mono text-cyan-400 shrink-0 font-bold px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/50">CORE</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 truncate mt-1 leading-tight font-mono">
                  {domain.primaryUnit}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* System Platform Footnote */}
      <div className="p-4 border-t border-slate-800 bg-[#090d16] text-xs text-slate-400 flex items-center justify-between font-mono">
        <span>Weather Beats Core</span>
        <span className="text-cyan-400 font-bold">v1.0.0</span>
      </div>
    </aside>
  );
};
