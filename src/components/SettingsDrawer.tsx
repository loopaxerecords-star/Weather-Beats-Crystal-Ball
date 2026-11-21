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
import { ALL_DOMAINS_LIST } from '../services/domainRegistry';
import { telemetryEngine } from '../services/telemetryEngine';
import {
  audioDspEngine,
  LyriaFlowEngineState,
  SequencerPlaybackStatus
} from '../services/audioDspEngine';
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
  const [prefsVersion, setPrefsVersion] = useState(0);
  const [ambientWhispersEnabled, setAmbientWhispersEnabled] = useState<boolean>(() =>
    audioDspEngine.getAmbientWhispersEnabled()
  );
  const [autoEvolveEnabled, setAutoEvolveEnabled] = useState<boolean>(() =>
    audioDspEngine.getAutoEvolveEnabled()
  );
  const [lyriaState, setLyriaState] = useState<LyriaFlowEngineState>(() =>
    audioDspEngine.getLyriaFlowState()
  );

  useEffect(() => {
    if (!isOpen) return;
    setAmbientWhispersEnabled(audioDspEngine.getAmbientWhispersEnabled());
    setAutoEvolveEnabled(audioDspEngine.getAutoEvolveEnabled());
    setLyriaState(audioDspEngine.getLyriaFlowState());
    setPrefsVersion((v) => v + 1);
    const unsubTel = telemetryEngine.subscribe(() => {
      setWeatherCtx(telemetryEngine.getWeatherContext());
      setLatestByDomain(telemetryEngine.getLatestByDomain());
    });
    const unsubSeq = audioDspEngine.subscribeSequencer((status) => {
      setSeqStatus(status);
    });
    const unsubPrefs = audioDspEngine.subscribeStudioPreferences(() => {
      setAmbientWhispersEnabled(audioDspEngine.getAmbientWhispersEnabled());
      setAutoEvolveEnabled(audioDspEngine.getAutoEvolveEnabled());
      setPrefsVersion((v) => v + 1);
    });
    const unsubLyria = audioDspEngine.subscribeLyriaFlow((state) => {
      setLyriaState(state);
    });
    return () => {
      unsubTel();
      unsubSeq();
      unsubPrefs();
      unsubLyria();
    };
  }, [isOpen]);

  const vector24 = useMemo(
    () => computeDomainVector24(latestByDomain, weatherCtx),
    [latestByDomain, weatherCtx]
  );

  const compositionPlan = useMemo(
    () => build32BarComposition(vector24, weatherCtx, audioDspEngine.getCompositionOptions()),
    [vector24, weatherCtx, prefsVersion]
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
        className="fixed inset-0 bg-black/45 transition-opacity"
      />

      {/* Slide-Over Right Settings Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Observatory Settings"
        className="relative z-10 h-full w-full max-w-[460px] bg-[#12161f] border-l border-white/[0.08] text-[#e6e1d8] flex flex-col shadow-2xl"
      >
        {/* Clean 1-Row Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2 className="text-base font-semibold tracking-tight text-[#ece7df]">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close Settings Drawer"
            className="p-2 rounded-lg text-[#9c9991] hover:text-[#ece7df] hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Clean Scrollable Sections */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 custom-scrollbar">
          {/* 01. Stream & Atmosphere */}
          <section className="rounded-xl bg-[#181d28] border border-white/[0.07] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[#eae5dc]">01. Stream &amp; Atmosphere</h3>
              <span className="text-xs font-mono tabular-nums text-[#9c9991]">
                {eps} evt/s · Buffer {bufferPercent}%
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="drawer-stream-mode" className="text-xs text-[#9c9991]">
                Telemetry Stream Mode
              </label>
              <select
                id="drawer-stream-mode"
                value={telemetryMode}
                onChange={(e) => onChangeTelemetryMode(e.target.value as TelemetryStatus)}
                className="w-full bg-[#11151d] border border-white/[0.1] rounded-lg px-3 py-2 text-xs font-medium text-[#e6e1d8] focus:outline-none focus:border-[#c8b28e]/60 cursor-pointer"
              >
                <option value="LIVE">Live Telemetry</option>
                <option value="SIMULATED">Simulated Data</option>
                <option value="PREDICTED">Model Prediction</option>
                <option value="HISTORICAL">Historical Replay</option>
                <option value="NOT CONNECTED">Paused (Not Connected)</option>
              </select>
            </div>

            <div className="space-y-2.5 pt-1">
              <div className="text-xs font-mono tabular-nums text-[#c7c2b8] leading-relaxed">
                {weatherCtx.region} · {weatherCtx.temperatureC.toFixed(1)}°C · AQI {weatherCtx.aqi}
              </div>
              <button
                onClick={handleSyncWeather}
                disabled={isSyncingWeather}
                className="w-full py-2 px-3 rounded-lg bg-[#202736] hover:bg-[#283144] border border-white/[0.09] text-xs font-medium text-[#a3c2bc] flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-60"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>{isSyncingWeather ? 'Syncing...' : 'Sync Local Weather'}</span>
              </button>
            </div>
          </section>

          {/* 02. Domain Lens & Alerts */}
          <section className="rounded-xl bg-[#181d28] border border-white/[0.07] p-4 space-y-3">
            <h3 className="text-sm font-semibold text-[#eae5dc]">02. Domain Lens &amp; Alerts</h3>

            <div className="flex flex-col gap-2">
              <label htmlFor="drawer-domain-lens" className="text-xs text-[#9c9991]">
                Focused Crystal Ball Domain
              </label>
              <select
                id="drawer-domain-lens"
                value={focusedDomain}
                onChange={(e) => onChangeFocusedDomain(e.target.value as 'all' | DomainCategory)}
                className="w-full bg-[#11151d] border border-white/[0.1] rounded-lg px-3 py-2 text-xs font-medium text-[#e6e1d8] focus:outline-none focus:border-[#c8b28e]/60 cursor-pointer"
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
              <div className="text-xs space-y-1 text-[#c7c2b8] font-mono tabular-nums">
                <div>
                  {focusedReading.name}:{' '}
                  <span className="text-[#a3c2bc] font-semibold">
                    {focusedReading.rawValue} {focusedReading.unit}
                  </span>{' '}
                  · {Math.round(focusedReading.normalized * 100)}% range
                </div>
                {activeThresholdAlert && (
                  <div className="text-[#d4bc94] font-sans">Alert status: {activeThresholdAlert}</div>
                )}
              </div>
            ) : (
              <p className="text-xs text-[#9c9991] leading-relaxed">
                Monitoring all 24 active intelligence streams simultaneously.
              </p>
            )}

            <button
              onClick={() => onOpenDetail('dashboard')}
              className="w-full px-3.5 py-2 rounded-lg bg-[#202736] hover:bg-[#283144] border border-white/[0.08] text-xs font-medium text-[#e6e1d8] flex items-center justify-between transition-colors"
            >
              <span>Open Domain Dashboard &amp; Thresholds</span>
              <ArrowUpRight className="w-4 h-4 text-[#c8b28e]" />
            </button>
          </section>

          {/* 03. Endless Flow Audio DSP Studio */}
          <section className="rounded-xl bg-[#181d28] border border-white/[0.07] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[#eae5dc]">03. Endless Flow Audio DSP Studio</h3>
              <span className="text-xs font-mono tabular-nums text-[#a3c2bc]">
                {compositionPlan.bpm} BPM
              </span>
            </div>

            <div className="rounded-lg bg-[#11151d] border border-white/[0.08] px-3 py-2.5 space-y-1">
              <div className="text-xs font-semibold text-[#ece7df]">
                {compositionPlan.telemetrySignatureLabel}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-[#c9b18a]">
                Hour {compositionPlan.activeTelemetryHour.hourLabel} ·{' '}
                {compositionPlan.activeTelemetryHour.mapping.instrument}
              </div>
              <div className="text-[11px] font-mono text-[#9c9991]">
                {compositionPlan.scaleName} · {seqStatus.currentChord || compositionPlan.bars[0]?.chordSymbol}
                {compositionPlan.activeMotifTitle ? ` · Motif: ${compositionPlan.activeMotifTitle}` : ''}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[#c7c2b8]">Google Lyria Flow Live</span>
              <button
                onClick={() => audioDspEngine.setLyriaFlowEnabled(!lyriaState.enabled)}
                aria-pressed={lyriaState.enabled}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                  lyriaState.enabled
                    ? 'bg-[#222938] text-[#a3c2bc] border-[#7fa898]/45'
                    : 'bg-[#11151d] text-[#8f8c84] border-white/[0.08]'
                }`}
              >
                {lyriaState.enabled ? 'On' : 'Off'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[#c7c2b8]">Auto-Evolve AI Motifs</span>
              <button
                onClick={() => audioDspEngine.setAutoEvolveEnabled(!autoEvolveEnabled)}
                aria-pressed={autoEvolveEnabled}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                  autoEvolveEnabled
                    ? 'bg-[#222938] text-[#a3c2bc] border-[#7fa898]/45'
                    : 'bg-[#11151d] text-[#8f8c84] border-white/[0.08]'
                }`}
              >
                {autoEvolveEnabled ? 'On' : 'Off'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[#c7c2b8]">Ambient Seer Whispers</span>
              <button
                onClick={() => audioDspEngine.setAmbientWhispersEnabled(!ambientWhispersEnabled)}
                aria-pressed={ambientWhispersEnabled}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                  ambientWhispersEnabled
                    ? 'bg-[#222938] text-[#e0cda9] border-[#c8b28e]/40'
                    : 'bg-[#11151d] text-[#8f8c84] border-white/[0.08]'
                }`}
              >
                {ambientWhispersEnabled ? 'On' : 'Off'}
              </button>
            </div>

            <div className="text-xs font-mono tabular-nums text-[#b8b3a9] leading-relaxed">
              {seqStatus.isPlaying
                ? `Bar ${seqStatus.currentBar} · ${seqStatus.activeSection} · 24 Telemetry Streams Active`
                : 'Sequencer Idle · Continuous 24-Hour Telemetry Composition'}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleMusic}
                className={`flex-1 px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 border transition-colors ${
                  seqStatus.isPlaying
                    ? 'bg-[#7fa898] hover:bg-[#8eb5a5] text-[#11151d] border-[#8eb5a5]/70'
                    : 'bg-[#c9b18a] hover:bg-[#d5bf9b] text-[#11151d] border-[#d5bf9b]/70'
                }`}
              >
                {seqStatus.isPlaying ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )}
                <span>{seqStatus.isPlaying ? 'Stop Endless Flow' : 'Play Endless Flow'}</span>
              </button>
            </div>

            <button
              onClick={() => onOpenDetail('audio_dsp')}
              className="w-full px-3.5 py-2 rounded-lg bg-[#202736] hover:bg-[#283144] border border-white/[0.08] text-xs font-medium text-[#e6e1d8] flex items-center justify-between transition-colors"
            >
              <span>Open Endless Flow DAW &amp; Stem Exporter</span>
              <ArrowUpRight className="w-4 h-4 text-[#c8b28e]" />
            </button>
          </section>

          {/* 04. Voice & AI Oracle */}
          <section className="rounded-xl bg-[#181d28] border border-white/[0.07] p-4 space-y-3">
            <h3 className="text-sm font-semibold text-[#eae5dc]">04. Voice &amp; AI Oracle</h3>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[#c7c2b8]">Spoken AI voice replies</span>
              <button
                onClick={onToggleVoiceReply}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  voiceReplyEnabled
                    ? 'bg-[#202736] text-[#a3c2bc] border-[#8eb5a5]/35'
                    : 'bg-[#11151d] text-[#8f8c84] border-white/[0.08]'
                }`}
              >
                {voiceReplyEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                <span>{voiceReplyEnabled ? 'On' : 'Muted'}</span>
              </button>
            </div>

            <p className="text-xs text-[#9c9991]">{speechCapabilities}</p>

            <button
              onClick={onTriggerVoiceAsk}
              className="w-full px-3.5 py-2 rounded-lg bg-[#202736] hover:bg-[#283144] border border-white/[0.08] text-xs font-medium text-[#e0cda9] flex items-center justify-center gap-2 transition-colors"
            >
              <Mic className="w-4 h-4" />
              <span>Ask Crystal Ball by Voice</span>
            </button>

            {lastOracleResult && (
              <div className="pt-2 border-t border-white/[0.07] space-y-1">
                <div className="text-[11px] font-mono text-[#a3c2bc]">
                  Last spoken reading · {lastOracleResult.intentSummary}
                </div>
                <p className="text-xs text-[#c7c2b8] leading-relaxed">
                  {lastOracleResult.answerText}
                </p>
              </div>
            )}
          </section>

          {/* Collapsed Advanced Tools Accordion */}
          <section className="rounded-xl bg-[#181d28] border border-white/[0.07] overflow-hidden">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.03] transition-colors"
            >
              <div>
                <div className="text-sm font-semibold text-[#eae5dc]">Advanced Tools</div>
                <div className="text-xs text-[#9c9991]">
                  Correlation, DuckDB SQL, AI Lab, Event Log &amp; Schema
                </div>
              </div>
              {advancedOpen ? (
                <ChevronDown className="w-4 h-4 text-[#9c9991]" />
              ) : (
                <ChevronRight className="w-4 h-4 text-[#9c9991]" />
              )}
            </button>

            {advancedOpen && (
              <div className="border-t border-white/[0.07] divide-y divide-white/[0.06]">
                {ADVANCED_TOOLS.map((tool) => (
                  <button
                    key={tool.id}
                    onClick={() => onOpenDetail(tool.id)}
                    className="w-full px-4 py-3 text-left hover:bg-white/[0.04] transition-colors flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[#e6e1d8]">{tool.label}</div>
                      <div className="text-[11px] text-[#9c9991]">{tool.detail}</div>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-[#c8b28e] shrink-0" />
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
