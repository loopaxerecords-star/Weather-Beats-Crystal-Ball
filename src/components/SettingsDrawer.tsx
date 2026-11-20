import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  MapPin,
  Play,
  Square,
  Mic,
  Volume2,
  VolumeX,
  ChevronRight,
  ChevronDown,
  ArrowUpRight
} from 'lucide-react';
import { DomainCategory, TelemetryStatus } from '../types/telemetry';
import { ActiveTab } from './Header';
import { ALL_DOMAINS_LIST, UNIVERSAL_DOMAINS } from '../services/domainRegistry';
import { telemetryEngine } from '../services/telemetryEngine';
import { audioDspEngine, SequencerPlaybackStatus } from '../services/audioDspEngine';
import {
  build32BarComposition,
  computeDomainVector24
} from '../services/weatherBeatsComposer';
import {
  evaluateThreshold,
  loadAllThresholds,
  makeThresholdKey
} from '../services/thresholdAlerts';

import { VoiceQueryResult } from '../services/voiceTelemetryOracle';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  telemetryMode: TelemetryStatus;
  onChangeTelemetryMode: (mode: TelemetryStatus) => void;
  eps: number;
  bufferPercent: number;
  focusedDomain: 'all' | DomainCategory;
  onChangeFocusedDomain: (domain: 'all' | DomainCategory) => void;
  voiceReplyEnabled: boolean;
  onToggleVoiceReply: () => void;
  onTriggerVoiceAsk: () => void;
  onOpenDetail: (tab: ActiveTab) => void;
  lastOracleResult?: VoiceQueryResult | null;
}

const ADVANCED_TOOLS: Array<{ id: ActiveTab; label: string; detail: string }> = [
  { id: 'cross_domain', label: 'Cross-Domain Correlation', detail: 'Pearson matrix across 24 streams' },
  { id: 'duckdb', label: 'DuckDB Analytical Store', detail: 'In-browser SQL & telemetry queries' },
  { id: 'ai_lab', label: 'AI Intelligence Lab', detail: 'Deep prompt synthesis across domains' },
  { id: 'event_log', label: 'Live Event Stream & CSV', detail: 'Raw canonical bus & CSV export' },
  { id: 'schema_inspector', label: 'Canonical Schema Inspector', detail: 'Live validation & JSON schema view' }
];

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  isOpen,
  onClose,
  telemetryMode,
  onChangeTelemetryMode,
  eps,
  bufferPercent,
  focusedDomain,
  onChangeFocusedDomain,
  voiceReplyEnabled,
  onToggleVoiceReply,
  onTriggerVoiceAsk,
  onOpenDetail,
  lastOracleResult = null
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isSyncingWeather, setIsSyncingWeather] = useState(false);
  const [weatherCtx, setWeatherCtx] = useState(() => telemetryEngine.getWeatherContext());
  const [latestByDomain, setLatestByDomain] = useState(() => telemetryEngine.getLatestByDomain());
  const [seqStatus, setSeqStatus] = useState<SequencerPlaybackStatus>(() =>
    audioDspEngine.getSequencerStatus()
  );

  useEffect(() => {
    if (!isOpen) return;
    const unsubTel = telemetryEngine.subscribe(() => {
      setWeatherCtx(telemetryEngine.getWeatherContext());
      setLatestByDomain(telemetryEngine.getLatestByDomain());
    });
    const unsubSeq = audioDspEngine.subscribeSequencer((status) => {
      setSeqStatus(status);
    });
    return () => {
      unsubTel();
      unsubSeq();
    };
  }, [isOpen]);

  const vector24 = useMemo(
    () => computeDomainVector24(latestByDomain, weatherCtx),
    [latestByDomain, weatherCtx]
  );

  const compositionPlan = useMemo(
    () => build32BarComposition(vector24, weatherCtx),
    [vector24, weatherCtx]
  );

  const activeThresholdAlert = useMemo(() => {
    if (focusedDomain === 'all') return null;
    const latestEvt = latestByDomain[focusedDomain];
    if (!latestEvt) return null;
    const thresholds = loadAllThresholds();
    const rule = thresholds[makeThresholdKey(focusedDomain, latestEvt.measurement.measurement_id)];
    const evalRes = evaluateThreshold(latestEvt.measurement.value, rule);
    if (evalRes.status === 'high' || evalRes.status === 'low') {
      return `${evalRes.status.toUpperCase()} threshold (${evalRes.value} vs ${evalRes.breachedLimit} ${latestEvt.measurement.unit})`;
    }
    return 'Within configured limits';
  }, [focusedDomain, latestByDomain]);

  const speechCapabilities = useMemo(() => {
    if (typeof window === 'undefined') return 'Browser check pending';
    const hasRec =
      'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    const hasMic = Boolean(navigator.mediaDevices?.getUserMedia);
    if (hasRec && hasMic) return 'Microphone & Web Speech API ready';
    if (hasMic) return 'Microphone reactive · typed question fallback active';
    return 'Typed question fallback ready';
  }, []);

  if (!isOpen) return null;

  const handleSyncWeather = () => {
    setIsSyncingWeather(true);
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const synced = await telemetryEngine.syncGeolocationWeather(
            pos.coords.latitude,
            pos.coords.longitude
          );
          setWeatherCtx(synced);
          setLatestByDomain(telemetryEngine.getLatestByDomain());
          setIsSyncingWeather(false);
        },
        async () => {
          const synced = await telemetryEngine.syncGeolocationWeather(
            51.5074,
            -0.1278,
            'London Met Hub'
          );
          setWeatherCtx(synced);
          setLatestByDomain(telemetryEngine.getLatestByDomain());
          setIsSyncingWeather(false);
        },
        { timeout: 6000 }
      );
    } else {
      telemetryEngine
        .syncGeolocationWeather(51.5074, -0.1278, 'London Met Hub')
        .then((synced) => {
          setWeatherCtx(synced);
          setLatestByDomain(telemetryEngine.getLatestByDomain());
          setIsSyncingWeather(false);
        });
    }
  };

  const handleToggleMusic = async () => {
    if (seqStatus.isPlaying) {
      audioDspEngine.stop32BarSequencer();
    } else {
      await audioDspEngine.start32BarSequencer(compositionPlan);
    }
  };

  const focusedReading = focusedDomain === 'all' ? null : vector24[focusedDomain];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Click-Away Scrim (No backdrop-blur over WebGL canvas) */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 bg-black/50 transition-opacity"
      />

      {/* Slide-Over Right Settings Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Observatory Settings"
        className="relative z-10 h-full w-full max-w-[460px] bg-[#0d1322] border-l border-slate-800 text-slate-100 flex flex-col shadow-2xl"
      >
        {/* Clean 1-Row Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <h2 className="text-base font-semibold tracking-tight text-white">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close Settings Drawer"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Clean Scrollable Sections */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* 01. Stream & Atmosphere */}
          <section className="rounded-xl bg-[#121929] border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">01. Stream &amp; Atmosphere</h3>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {eps} evt/s · Buffer {bufferPercent}%
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="drawer-stream-mode" className="text-xs text-slate-400">
                Telemetry Stream Mode
              </label>
              <select
                id="drawer-stream-mode"
                value={telemetryMode}
                onChange={(e) => onChangeTelemetryMode(e.target.value as TelemetryStatus)}
                className="w-full bg-[#0b0f17] border border-slate-700 rounded-lg px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
              >
                <option value="LIVE">Live Telemetry</option>
                <option value="SIMULATED">Simulated Data</option>
                <option value="PREDICTED">Model Prediction</option>
                <option value="HISTORICAL">Historical Replay</option>
                <option value="NOT CONNECTED">Paused (Not Connected)</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-xs font-mono tabular-nums text-slate-300 truncate">
                {weatherCtx.region} · {weatherCtx.temperatureC.toFixed(1)}°C · AQI {weatherCtx.aqi}
              </span>
              <button
                onClick={handleSyncWeather}
                disabled={isSyncingWeather}
                className="px-3 py-1.5 rounded-lg bg-[#182238] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-cyan-300 flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>{isSyncingWeather ? 'Syncing...' : 'Sync Local Weather'}</span>
              </button>
            </div>
          </section>

          {/* 02. Domain Lens & Alerts */}
          <section className="rounded-xl bg-[#121929] border border-slate-800 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">02. Domain Lens &amp; Alerts</h3>

            <div className="flex flex-col gap-2">
              <label htmlFor="drawer-domain-lens" className="text-xs text-slate-400">
                Focused Crystal Ball Domain
              </label>
              <select
                id="drawer-domain-lens"
                value={focusedDomain}
                onChange={(e) => onChangeFocusedDomain(e.target.value as 'all' | DomainCategory)}
                className="w-full bg-[#0b0f17] border border-slate-700 rounded-lg px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
              >
                <option value="all">All 24 Domains (Unified)</option>
                {ALL_DOMAINS_LIST.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {focusedReading ? (
              <div className="text-xs space-y-1 text-slate-300 font-mono tabular-nums">
                <div>
                  {UNIVERSAL_DOMAINS[focusedReading.domainId].name}:{' '}
                  <span className="text-cyan-300 font-semibold">
                    {focusedReading.rawValue} {focusedReading.unit}
                  </span>{' '}
                  · {Math.round(focusedReading.normalized * 100)}% range
                </div>
                {activeThresholdAlert && (
                  <div className="text-amber-300 font-sans">Alert status: {activeThresholdAlert}</div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Monitoring all 24 active intelligence streams simultaneously.
              </p>
            )}

            <button
              onClick={() => onOpenDetail('dashboard')}
              className="w-full px-3.5 py-2 rounded-lg bg-[#182238] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-100 flex items-center justify-between transition-colors"
            >
              <span>Open Domain Dashboard &amp; Thresholds</span>
              <ArrowUpRight className="w-4 h-4 text-cyan-300" />
            </button>
          </section>

          {/* 03. 32-Bar Audio DSP Studio */}
          <section className="rounded-xl bg-[#121929] border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">03. 32-Bar Audio DSP Studio</h3>
              <span className="text-xs font-mono tabular-nums text-cyan-300">
                {compositionPlan.bpm} BPM
              </span>
            </div>

            <div className="text-xs font-mono tabular-nums text-slate-300">
              {compositionPlan.scaleName} ·{' '}
              {seqStatus.isPlaying
                ? `Playing Bar ${String(seqStatus.currentBar).padStart(2, '0')}/32 (${seqStatus.activeSection})`
                : 'Sequencer Idle'}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleMusic}
                className={`flex-1 px-3.5 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 border transition-colors ${
                  seqStatus.isPlaying
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                    : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 border-cyan-400'
                }`}
              >
                {seqStatus.isPlaying ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )}
                <span>{seqStatus.isPlaying ? 'Stop 32-Bar Beats' : 'Play 32-Bar Beats'}</span>
              </button>
            </div>

            <button
              onClick={() => onOpenDetail('audio_dsp')}
              className="w-full px-3.5 py-2 rounded-lg bg-[#182238] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-100 flex items-center justify-between transition-colors"
            >
              <span>Open Full 32-Bar DAW &amp; Stem Exporter</span>
              <ArrowUpRight className="w-4 h-4 text-cyan-300" />
            </button>
          </section>

          {/* 04. Voice & AI Oracle */}
          <section className="rounded-xl bg-[#121929] border border-slate-800 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">04. Voice &amp; AI Oracle</h3>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-300">Spoken AI voice replies</span>
              <button
                onClick={onToggleVoiceReply}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                  voiceReplyEnabled
                    ? 'bg-[#182238] text-cyan-300 border-cyan-500/50'
                    : 'bg-[#0b0f17] text-slate-400 border-slate-700'
                }`}
              >
                {voiceReplyEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                <span>{voiceReplyEnabled ? 'On' : 'Muted'}</span>
              </button>
            </div>

            <p className="text-xs text-slate-400">{speechCapabilities}</p>

            <button
              onClick={onTriggerVoiceAsk}
              className="w-full px-3.5 py-2 rounded-lg bg-[#182238] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-amber-300 flex items-center justify-center gap-2 transition-colors"
            >
              <Mic className="w-4 h-4" />
              <span>Ask Crystal Ball by Voice</span>
            </button>

            {lastOracleResult && (
              <div className="pt-2 border-t border-slate-800 space-y-1">
                <div className="text-[11px] font-mono text-cyan-300">
                  Last spoken reading · {lastOracleResult.intentSummary}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {lastOracleResult.answerText}
                </p>
              </div>
            )}
          </section>

          {/* Collapsed Advanced Tools Accordion */}
          <section className="rounded-xl bg-[#121929] border border-slate-800 overflow-hidden">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors"
            >
              <div>
                <div className="text-sm font-semibold text-white">Advanced Tools</div>
                <div className="text-xs text-slate-400">
                  Correlation, DuckDB SQL, AI Lab, Event Log &amp; Schema
                </div>
              </div>
              {advancedOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {advancedOpen && (
              <div className="border-t border-slate-800 divide-y divide-slate-800/80">
                {ADVANCED_TOOLS.map((tool) => (
                  <button
                    key={tool.id}
                    onClick={() => onOpenDetail(tool.id)}
                    className="w-full px-4 py-3 text-left hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-100">{tool.label}</div>
                      <div className="text-[11px] text-slate-400">{tool.detail}</div>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-cyan-400 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
};
