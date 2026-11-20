import React from 'react';
import { Activity, Database, Sparkles, Sliders, Layers, Radio, Braces } from 'lucide-react';
import { TelemetryStatus } from '../types/telemetry';

export type ActiveTab =
  | 'dashboard'
  | 'cross_domain'
  | 'duckdb'
  | 'ai_lab'
  | 'event_log'
  | 'audio_dsp'
  | 'schema_inspector';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  telemetryMode: TelemetryStatus;
  setTelemetryMode: (mode: TelemetryStatus) => void;
  eps: number;
  bufferPercent: number;
  isAudioSynthActive: boolean;
  onToggleAudioSynth: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  telemetryMode,
  setTelemetryMode,
  eps,
  bufferPercent,
  isAudioSynthActive,
  onToggleAudioSynth
}) => {
  return (
    <header className="flex flex-col border-b border-slate-800 bg-[#0e1422] shrink-0 select-none">
      <div className="flex items-center justify-between gap-6 px-6 py-4">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3.5 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 via-indigo-500 to-violet-600 flex items-center justify-center border border-cyan-400/30">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <a href="/" className="text-base xl:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 flex items-center gap-2">
            <span>Weather Beats</span>
            <span className="text-cyan-400 font-semibold hidden sm:inline">Universal Intelligence</span>
          </a>
        </div>

        {/* Zone 2: Primary Navigation Links */}
        <nav className="hidden lg:flex items-center gap-1.5 text-sm font-medium text-slate-300 overflow-x-auto">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'dashboard'
                ? 'bg-slate-800 text-white border border-slate-700 font-semibold'
                : 'hover:text-white hover:bg-slate-800/50 border border-transparent'
            }`}
          >
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>Domains</span>
          </button>

          <button
            onClick={() => setActiveTab('audio_dsp')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'audio_dsp'
                ? 'bg-slate-800 text-white border border-slate-700 font-semibold'
                : 'hover:text-white hover:bg-slate-800/50 border border-transparent'
            }`}
          >
            <Sliders className="w-4 h-4 text-violet-400" />
            <span>Audio DSP</span>
          </button>

          <button
            onClick={() => setActiveTab('cross_domain')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'cross_domain'
                ? 'bg-slate-800 text-white border border-slate-700 font-semibold'
                : 'hover:text-white hover:bg-slate-800/50 border border-transparent'
            }`}
          >
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>Correlation</span>
          </button>

          <button
            onClick={() => setActiveTab('duckdb')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'duckdb'
                ? 'bg-slate-800 text-white border border-slate-700 font-semibold'
                : 'hover:text-white hover:bg-slate-800/50 border border-transparent'
            }`}
          >
            <Database className="w-4 h-4 text-amber-400" />
            <span>DuckDB</span>
          </button>

          <button
            onClick={() => setActiveTab('ai_lab')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'ai_lab'
                ? 'bg-slate-800 text-white border border-slate-700 font-semibold'
                : 'hover:text-white hover:bg-slate-800/50 border border-transparent'
            }`}
          >
            <Sparkles className="w-4 h-4 text-fuchsia-400" />
            <span>AI Lab</span>
          </button>

          <button
            onClick={() => setActiveTab('event_log')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'event_log'
                ? 'bg-slate-800 text-white border border-slate-700 font-semibold'
                : 'hover:text-white hover:bg-slate-800/50 border border-transparent'
            }`}
          >
            <Radio className="w-4 h-4 text-indigo-400" />
            <span>Event Log</span>
          </button>

          <button
            onClick={() => setActiveTab('schema_inspector')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'schema_inspector'
                ? 'bg-slate-800 text-white border border-slate-700 font-semibold'
                : 'hover:text-white hover:bg-slate-800/50 border border-transparent'
            }`}
          >
            <Braces className="w-4 h-4 text-cyan-400" />
            <span>Schema</span>
          </button>
        </nav>

        {/* Zone 3: Telemetry Controls & Primary Audio Action */}
        <div className="flex items-center gap-3.5 shrink-0">
          <div className="hidden xl:flex items-center gap-2.5 text-xs text-slate-300 font-mono tabular-nums bg-[#141b2d] px-3.5 py-2 rounded-lg border border-slate-700/60">
            <span className="text-slate-400">Rate:</span>
            <span className="text-cyan-400 font-bold">{eps} evt/s</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">Buffer:</span>
            <span className="text-slate-200 font-semibold">{bufferPercent}%</span>
          </div>

          <select
            aria-label="Telemetry Stream Mode"
            value={telemetryMode}
            onChange={(e) => setTelemetryMode(e.target.value as TelemetryStatus)}
            className="bg-slate-900 border border-slate-700 text-xs sm:text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500 font-semibold cursor-pointer"
          >
            <option value="LIVE">● LIVE TELEMETRY</option>
            <option value="SIMULATED">◈ SIMULATED DATA</option>
            <option value="PREDICTED">▲ MODEL PREDICTION</option>
            <option value="HISTORICAL">◷ HISTORICAL REPLAY</option>
            <option value="NOT CONNECTED">○ NOT CONNECTED</option>
          </select>

          <button
            onClick={onToggleAudioSynth}
            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 border ${
              isAudioSynthActive
                ? 'bg-violet-600 text-white border-violet-400'
                : 'bg-slate-900 text-slate-200 border-slate-700 hover:text-white hover:border-slate-600'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>{isAudioSynthActive ? '440Hz ON' : 'Start Audio DSP'}</span>
          </button>
        </div>
      </div>

      {/* Responsive Tablet/Mobile Navigation Strip */}
      <nav className="flex lg:hidden items-center gap-1.5 px-6 pb-3 overflow-x-auto text-xs font-medium text-slate-300">
        {(
          [
            ['dashboard', 'Domains'],
            ['audio_dsp', 'Audio DSP'],
            ['cross_domain', 'Correlation'],
            ['duckdb', 'DuckDB'],
            ['ai_lab', 'AI Lab'],
            ['event_log', 'Event Log'],
            ['schema_inspector', 'Schema']
          ] as [ActiveTab, string][]
        ).map(([tabId, label]) => (
          <button
            key={tabId}
            onClick={() => setActiveTab(tabId)}
            className={`px-3 py-1.5 rounded-md whitespace-nowrap shrink-0 transition-colors ${
              activeTab === tabId ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
};
