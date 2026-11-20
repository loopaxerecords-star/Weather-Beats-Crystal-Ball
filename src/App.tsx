import React, { useState, useEffect } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { DomainCategory, TelemetryStatus } from './types/telemetry';
import { ActiveTab } from './components/Header';
import { DomainDashboard } from './components/DomainDashboard';
import { AudioDspConsole } from './components/AudioDspConsole';
import { CrossDomainAnalytics } from './components/CrossDomainAnalytics';
import { DuckDbConsole } from './components/DuckDbConsole';
import { AiIntelligencePanel } from './components/AiIntelligencePanel';
import { LiveEventStream } from './components/LiveEventStream';
import { SchemaInspector } from './components/SchemaInspector';
import { CrystalBallExperience } from './components/CrystalBallExperience';
import { SettingsDrawer } from './components/SettingsDrawer';
import { ALL_DOMAINS_LIST } from './services/domainRegistry';
import { telemetryEngine, TelemetryEngineStats } from './services/telemetryEngine';
import { VoiceQueryResult } from './services/voiceTelemetryOracle';

const DETAIL_TITLES: Record<ActiveTab, string> = {
  dashboard: 'Domain Telemetry & Thresholds',
  audio_dsp: '32-Bar Audio DSP Studio & Exporter',
  cross_domain: 'Cross-Domain Correlation',
  duckdb: 'DuckDB Analytical Store',
  ai_lab: 'AI Intelligence Lab',
  event_log: 'Live Event Stream & CSV',
  schema_inspector: 'Canonical Schema Inspector'
};

export default function App() {
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [activeDetailView, setActiveDetailView] = useState<'none' | ActiveTab>('none');
  const [focusedDomain, setFocusedDomain] = useState<'all' | DomainCategory>('all');
  const [lastSpecificDomain, setLastSpecificDomain] = useState<DomainCategory>('weather');
  const [telemetryMode, setTelemetryMode] = useState<TelemetryStatus>('LIVE');
  const [stats, setStats] = useState<TelemetryEngineStats>(telemetryEngine.getStats());
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState<boolean>(true);
  const [voiceTriggerNonce, setVoiceTriggerNonce] = useState<number>(0);
  const [lastOracleResult, setLastOracleResult] = useState<VoiceQueryResult | null>(null);

  useEffect(() => {
    const unsubscribe = telemetryEngine.subscribeStats((newStats) => {
      setStats(newStats);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isDrawerOpen && activeDetailView === 'none') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeDetailView !== 'none') {
          setActiveDetailView('none');
          setIsDrawerOpen(true);
        } else if (isDrawerOpen) {
          setIsDrawerOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawerOpen, activeDetailView]);

  const handleChangeFocusedDomain = (next: 'all' | DomainCategory) => {
    setFocusedDomain(next);
    if (next !== 'all') {
      setLastSpecificDomain(next);
    }
  };

  const handleModeChange = (mode: TelemetryStatus) => {
    setTelemetryMode(mode);
    telemetryEngine.setMode(mode);
  };

  const handleOpenDetail = (tab: ActiveTab) => {
    setIsDrawerOpen(false);
    setActiveDetailView(tab);
  };

  const handleTriggerVoiceAsk = () => {
    setIsDrawerOpen(false);
    setActiveDetailView('none');
    setVoiceTriggerNonce((n) => n + 1);
  };

  const bufferPercent = Math.round((stats.bufferQueueSize / stats.maxBufferQueueSize) * 100);
  const activeSpecificDomain: DomainCategory =
    focusedDomain === 'all' ? lastSpecificDomain : focusedDomain;

  return (
    <div className="relative h-screen w-screen bg-[#05070e] text-slate-100 overflow-hidden font-sans">
      {/* Main Interactive Experience: Celestial Brass Astrolabe Crystal Ball + Top-Right Cogwheel */}
      <CrystalBallExperience
        focusedDomain={focusedDomain}
        onChangeFocusedDomain={handleChangeFocusedDomain}
        voiceReplyEnabled={voiceReplyEnabled}
        onToggleVoiceReply={() => setVoiceReplyEnabled((v) => !v)}
        onOpenSettings={() => setIsDrawerOpen(true)}
        voiceTriggerNonce={voiceTriggerNonce}
        onOracleResult={setLastOracleResult}
      />

      {/* Simplified Slide-Over Right Settings Drawer */}
      <SettingsDrawer
        isOpen={isDrawerOpen && activeDetailView === 'none'}
        onClose={() => setIsDrawerOpen(false)}
        telemetryMode={telemetryMode}
        onChangeTelemetryMode={handleModeChange}
        eps={stats.eventsPerSecond}
        bufferPercent={bufferPercent}
        focusedDomain={focusedDomain}
        onChangeFocusedDomain={handleChangeFocusedDomain}
        voiceReplyEnabled={voiceReplyEnabled}
        onToggleVoiceReply={() => setVoiceReplyEnabled((v) => !v)}
        onTriggerVoiceAsk={handleTriggerVoiceAsk}
        onOpenDetail={handleOpenDetail}
        lastOracleResult={lastOracleResult}
      />

      {/* Focused Single-View Detail Overlay (Zero 7-Tab Header or Sidebar Clutter) */}
      {activeDetailView !== 'none' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={DETAIL_TITLES[activeDetailView]}
          className="fixed inset-0 z-50 flex flex-col h-screen w-screen bg-[#0b0f17] text-slate-100 overflow-hidden"
        >
          {/* Slim Single-Row Breadcrumb Bar */}
          <div className="flex items-center justify-between gap-4 px-6 py-3 bg-[#090d16] border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              <button
                onClick={() => {
                  setActiveDetailView('none');
                  setIsDrawerOpen(true);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#141c2e] hover:bg-slate-800 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-cyan-400" />
                <span>Back to Settings</span>
              </button>

              <span className="text-sm font-semibold text-white truncate">
                {DETAIL_TITLES[activeDetailView]}
              </span>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {(activeDetailView === 'dashboard' || activeDetailView === 'ai_lab') && (
                <select
                  aria-label="Select Intelligence Domain"
                  value={activeSpecificDomain}
                  onChange={(e) => handleChangeFocusedDomain(e.target.value as DomainCategory)}
                  className="bg-[#0d1322] border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
                >
                  {ALL_DOMAINS_LIST.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}

              <button
                onClick={() => {
                  setActiveDetailView('none');
                  setIsDrawerOpen(false);
                }}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <X className="w-3.5 h-3.5 text-cyan-400" />
                <span>Return to Crystal Ball</span>
              </button>
            </div>
          </div>

          {/* Single Focused Module Viewport */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {activeDetailView === 'dashboard' && <DomainDashboard domainId={activeSpecificDomain} />}
            {activeDetailView === 'audio_dsp' && <AudioDspConsole />}
            {activeDetailView === 'cross_domain' && <CrossDomainAnalytics />}
            {activeDetailView === 'duckdb' && <DuckDbConsole />}
            {activeDetailView === 'ai_lab' && (
              <AiIntelligencePanel currentDomain={activeSpecificDomain} />
            )}
            {activeDetailView === 'event_log' && <LiveEventStream />}
            {activeDetailView === 'schema_inspector' && (
              <SchemaInspector onNavigateToEventLog={() => setActiveDetailView('event_log')} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
