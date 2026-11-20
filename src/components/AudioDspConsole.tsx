import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  audioDspEngine,
  AudioDspMetrics,
  RenderedReleaseBundle,
  SequencerPlaybackStatus
} from '../services/audioDspEngine';
import { GeolocationWeatherContext, telemetryEngine } from '../services/telemetryEngine';
import {
  ClusterOverrideMap,
  Composition32BarPlan,
  FmSynthParams,
  FxSlotConfig,
  NativeVoiceId,
  TELEMETRY_CLUSTERS,
  build32BarComposition,
  computeDomainVector24,
  deriveDefaultFxRack,
  deriveFmParams
} from '../services/weatherBeatsComposer';
import { Id3TrackMetadata, generateProceduralCoverArt } from '../services/audioExportEngine';
import { DomainCategory } from '../types/telemetry';
import {
  Sliders,
  Volume2,
  Music,
  Activity,
  Play,
  Square,
  MapPin,
  Download,
  Disc3,
  Lock,
  Unlock,
  RefreshCw,
  Waves
} from 'lucide-react';

const NATIVE_INSTRUMENTS: Array<{ id: NativeVoiceId; label: string; role: string }> = [
  { id: 'kora', label: 'Kora (21-String Harp)', role: 'Weather · Bio' },
  { id: 'djembe', label: 'Djembe & Talking Drum', role: 'Geological · Energy' },
  { id: 'kalimba', label: 'Kalimba / Mbira', role: 'Ocean · Agricultural' },
  { id: 'balafon', label: 'Balafon Marimba', role: 'Smart Bldg · Social' }
];

export const AudioDspConsole: React.FC = () => {
  const [metrics, setMetrics] = useState<AudioDspMetrics>(audioDspEngine.processBlock());
  const [synthFreq, setSynthFreq] = useState<number>(440);
  const [isSynthRunning, setIsSynthRunning] = useState<boolean>(false);

  // Stage 1: Geolocation + 24-Domain Telemetry State
  const [weatherCtx, setWeatherCtx] = useState<GeolocationWeatherContext>(() =>
    telemetryEngine.getWeatherContext()
  );
  const [latestByDomain, setLatestByDomain] = useState(() => telemetryEngine.getLatestByDomain());
  const [clusterOverrides, setClusterOverrides] = useState<ClusterOverrideMap>({});
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);

  // Stage 2: Synthesis Overrides & Sequencer State
  const [fmOverrides, setFmOverrides] = useState<Partial<FmSynthParams>>({});
  const [fxSlotsState, setFxSlotsState] = useState<FxSlotConfig[] | null>(null);
  const [seqStatus, setSeqStatus] = useState<SequencerPlaybackStatus>(() =>
    audioDspEngine.getSequencerStatus()
  );
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());

  // Stage 3: ID3 Metadata & Offline Render Bundle
  const [id3Meta, setId3Meta] = useState<Id3TrackMetadata>({
    title: 'Weather Beats 001',
    artist: 'Weather Beats · 24-Domain DSP',
    album: 'Environmental Sessions',
    genre: 'Electronic / Afro-Ambient',
    year: String(new Date().getFullYear()),
    comment: 'Synthesized from 24 live telemetry streams'
  });
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStageText, setRenderStageText] = useState('');
  const [renderedBundle, setRenderedBundle] = useState<RenderedReleaseBundle | null>(null);
  const [auditionUrl, setAuditionUrl] = useState<string | null>(null);

  // Subscribe to DSP metrics frame loop + telemetry updates + sequencer status
  useEffect(() => {
    let animId: number;
    const loop = () => {
      const data = audioDspEngine.processBlock();
      setMetrics({ ...data, fftSpectrum32: [...data.fftSpectrum32] });
      setNowTickMs(Date.now());
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);

    const unsubTelemetry = telemetryEngine.subscribe(() => {
      setLatestByDomain(telemetryEngine.getLatestByDomain());
      setWeatherCtx(telemetryEngine.getWeatherContext());
    });

    const unsubSeq = audioDspEngine.subscribeSequencer((status) => {
      setSeqStatus(status);
    });

    return () => {
      cancelAnimationFrame(animId);
      unsubTelemetry();
      unsubSeq();
    };
  }, []);

  const vector24 = useMemo(
    () => computeDomainVector24(latestByDomain, weatherCtx, clusterOverrides),
    [latestByDomain, weatherCtx, clusterOverrides]
  );

  const compositionPlan: Composition32BarPlan = useMemo(
    () => build32BarComposition(vector24, weatherCtx, fmOverrides, fxSlotsState || undefined),
    [vector24, weatherCtx, fmOverrides, fxSlotsState]
  );

  // Keep live sequencer plan synced when telemetry shifts
  useEffect(() => {
    audioDspEngine.updateCompositionPlan(compositionPlan);
  }, [compositionPlan]);

  // Procedural live cover art preview (throttled cleanly by composition signature)
  const previewCover = useMemo(() => {
    return generateProceduralCoverArt(vector24, weatherCtx, id3Meta, compositionPlan.bpm);
  }, [
    weatherCtx.region,
    weatherCtx.temperatureC,
    weatherCtx.aqi,
    compositionPlan.bpm,
    id3Meta.title,
    id3Meta.artist,
    id3Meta.album
  ]);

  const handleStartAudio = async () => {
    await audioDspEngine.startAudioContext();
  };

  const handleToggleSynth = async () => {
    await audioDspEngine.startAudioContext();
    const active = audioDspEngine.toggleSynthTone(synthFreq);
    setIsSynthRunning(active);
  };

  const handleFreqChange = (freq: number) => {
    setSynthFreq(freq);
    audioDspEngine.setSynthFrequency(freq);
  };

  const handleSyncGeolocation = useCallback(async () => {
    setGeoLoading(true);
    setGeoMessage(null);
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const synced = await telemetryEngine.syncGeolocationWeather(
            pos.coords.latitude,
            pos.coords.longitude
          );
          setWeatherCtx(synced);
          setLatestByDomain(telemetryEngine.getLatestByDomain());
          setGeoMessage(`Synced ${synced.region} (${synced.provider})`);
          setGeoLoading(false);
        },
        async () => {
          const synced = await telemetryEngine.syncGeolocationWeather(51.5074, -0.1278, 'London Met Hub');
          setWeatherCtx(synced);
          setLatestByDomain(telemetryEngine.getLatestByDomain());
          setGeoMessage('Location permission declined · synced London Met Hub');
          setGeoLoading(false);
        },
        { timeout: 6000 }
      );
    } else {
      const synced = await telemetryEngine.syncGeolocationWeather(51.5074, -0.1278, 'London Met Hub');
      setWeatherCtx(synced);
      setLatestByDomain(telemetryEngine.getLatestByDomain());
      setGeoMessage('Geolocation unavailable · synced London Met Hub');
      setGeoLoading(false);
    }
  }, []);

  const handleToggleSequencer = async () => {
    if (seqStatus.isPlaying) {
      audioDspEngine.stop32BarSequencer();
    } else {
      await audioDspEngine.start32BarSequencer(compositionPlan);
    }
  };

  const handleToggleClusterLock = (clusterId: string, currentAvg: number) => {
    setClusterOverrides((prev) => {
      const existing = prev[clusterId];
      if (existing?.locked) {
        const next = { ...prev };
        delete next[clusterId];
        return next;
      }
      return {
        ...prev,
        [clusterId]: { locked: true, value: currentAvg }
      };
    });
  };

  const handleClusterSlider = (clusterId: string, val: number) => {
    setClusterOverrides((prev) => ({
      ...prev,
      [clusterId]: { locked: true, value: val }
    }));
  };

  const handleUpdateFxSlot = (
    slotId: FxSlotConfig['id'],
    patch: Partial<FxSlotConfig>,
    regenerateImpulse = false
  ) => {
    const base = fxSlotsState || deriveDefaultFxRack(vector24, weatherCtx);
    const updated = base.map((slot) =>
      slot.id === slotId ? { ...slot, ...patch, telemetryLocked: false } : slot
    );
    setFxSlotsState(updated);
    audioDspEngine.updateFxRack(updated, regenerateImpulse);
  };

  const handleRebindFxToTelemetry = () => {
    setFxSlotsState(null);
    const fresh = deriveDefaultFxRack(vector24, weatherCtx);
    audioDspEngine.updateFxRack(fresh, true);
  };

  const handleResetFmToTelemetry = () => {
    setFmOverrides({});
  };

  const handleRenderBundle = async () => {
    if (isRendering) return;
    setIsRendering(true);
    setRenderProgress(4);
    setRenderStageText('Initializing 48000 Hz OfflineAudioContext...');

    try {
      const metaWithSignature: Id3TrackMetadata = {
        ...id3Meta,
        comment: `${id3Meta.comment} | ${compositionPlan.telemetrySignature}`
      };
      const bundle = await audioDspEngine.render32BarBundle(
        compositionPlan,
        metaWithSignature,
        vector24,
        weatherCtx,
        (pct, label) => {
          setRenderProgress(pct);
          setRenderStageText(label);
        }
      );
      setRenderedBundle(bundle);
      setAuditionUrl(bundle.mp3Url);
    } finally {
      setIsRendering(false);
    }
  };

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const liveFm = compositionPlan.fmParams;
  const activeFxSlots = compositionPlan.fxRack;

  return (
    <div className="flex-1 bg-[#0b0f17] flex flex-col min-w-0 overflow-y-auto p-6 lg:p-8 space-y-8 custom-scrollbar">
      {/* Header & Baseline Audio Controls */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 pb-6 border-b border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Sliders className="w-6 h-6 text-violet-400 shrink-0" />
            <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight">
              Audio & Musical Intelligence DSP Engine
            </h1>
            <span className="text-xs font-mono text-slate-400">
              48000 Hz · 1024 Samples · 32-Bar Telemetry DAW
            </span>
          </div>
          <p className="text-sm text-slate-300 mt-2 max-w-4xl leading-relaxed">
            Turning the atmosphere and all 24 telemetry domains into dynamic 32-bar Afro-electronic compositions across Native African instruments, FM synthesis, and a 6-slot environmental FX rack.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            onClick={handleStartAudio}
            className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Volume2 className="w-4 h-4 text-cyan-400" />
            <span>Initialize WebAudio</span>
          </button>

          <button
            onClick={handleToggleSequencer}
            className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-colors flex items-center gap-2 border whitespace-nowrap ${
              seqStatus.isPlaying
                ? 'bg-emerald-600 text-white border-emerald-400'
                : 'bg-cyan-600 hover:bg-cyan-500 text-slate-950 border-cyan-400'
            }`}
          >
            {seqStatus.isPlaying ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{seqStatus.isPlaying ? 'Stop 32-Bar Track' : 'Play 32-Bar Track'}</span>
          </button>

          <button
            onClick={handleToggleSynth}
            className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors flex items-center gap-2 border whitespace-nowrap ${
              isSynthRunning
                ? 'bg-violet-600 text-white border-violet-400'
                : 'bg-slate-900 text-slate-200 border-slate-700 hover:border-slate-600'
            }`}
          >
            {isSynthRunning ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{isSynthRunning ? 'Stop Synth Oscillator' : 'Start 440Hz Oscillator'}</span>
          </button>
        </div>
      </div>

      {/* STAGE 1: INPUT (NATURE + ALL 24 TELEMETRY DOMAINS) */}
      <section className="bg-[#121929] border border-slate-800 rounded-2xl p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2.5">
              <MapPin className="w-5 h-5 text-cyan-400" />
              <span>01. Input Stage — Nature & 24 Telemetry Modulation Bus</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 font-mono tabular-nums">
              {weatherCtx.region} · {weatherCtx.temperatureC.toFixed(1)}°C · Humidity {weatherCtx.humidityPct}% · Wind {weatherCtx.windSpeedMs} m/s · AQI {weatherCtx.aqi} · Pressure {weatherCtx.pressureHpa} hPa
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {geoMessage && <span className="text-xs font-mono text-cyan-400">{geoMessage}</span>}
            <button
              onClick={handleSyncGeolocation}
              disabled={geoLoading}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0b0f17] hover:bg-slate-800 text-cyan-300 border border-slate-700 transition-colors flex items-center gap-2 whitespace-nowrap disabled:opacity-60"
            >
              <MapPin className="w-4 h-4" />
              <span>{geoLoading ? 'Syncing Location...' : 'Sync Local Weather'}</span>
            </button>
          </div>
        </div>

        {/* 7 Clusters Spanning All 24 Domains */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {TELEMETRY_CLUSTERS.map((cluster) => {
            const readings = cluster.domains.map((d: DomainCategory) => vector24[d]);
            const avgNorm =
              readings.reduce((acc, r) => acc + r.normalized, 0) / Math.max(1, readings.length);
            const isLocked = Boolean(clusterOverrides[cluster.id]?.locked);

            return (
              <div
                key={cluster.id}
                className="p-4 rounded-xl bg-[#0b0f17] border border-slate-800 flex flex-col justify-between space-y-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-white truncate">{cluster.label}</span>
                    <button
                      onClick={() => handleToggleClusterLock(cluster.id, avgNorm)}
                      title={isLocked ? 'Unlock live telemetry' : 'Lock manual modulation override'}
                      className="text-xs font-mono px-2 py-1 rounded border border-slate-700 text-slate-300 hover:text-white flex items-center gap-1 shrink-0"
                    >
                      {isLocked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3 text-cyan-400" />}
                      <span>{isLocked ? 'Locked' : 'Live'}</span>
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 leading-snug">{cluster.dspTarget}</p>
                </div>

                {/* Domain chips as clean unboxed inline readouts */}
                <div className="space-y-1.5 pt-1">
                  {readings.map((r) => (
                    <div key={r.domain} className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span className="text-slate-300 truncate pr-2">{r.name.replace(' Intelligence', '')}</span>
                      <span className="text-slate-200 shrink-0">
                        {r.rawValue} {r.unit}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-400">
                    <span>Bus Modulation</span>
                    <span style={{ color: cluster.accentHex }}>{Math.round(avgNorm * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={avgNorm}
                    onChange={(e) => handleClusterSlider(cluster.id, Number(e.target.value))}
                    aria-label={`${cluster.label} modulation`}
                    className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* STAGE 2: SYNTHESIS ENGINE (32-BAR DYNAMIC ARRANGEMENT + NATIVE AFRICAN VOICES + FM SYNTH + 6-SLOT FX RACK) */}
      <section className="bg-[#121929] border border-slate-800 rounded-2xl p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2.5">
              <Waves className="w-5 h-5 text-violet-400" />
              <span>02. Synthesis Engine — 32-Bar Dynamic Afro-Electronic Arrangement</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 font-mono tabular-nums">
              Tempo {compositionPlan.bpm} BPM · Scale {compositionPlan.scaleName} · Active Bar {String(seqStatus.currentBar).padStart(2, '0')}/32 ({seqStatus.activeSection})
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-slate-300">
            <button
              onClick={handleResetFmToTelemetry}
              className="px-3 py-1.5 rounded-lg bg-[#0b0f17] border border-slate-700 hover:border-slate-500 text-slate-200 flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5 text-violet-400" />
              <span>Sync FM to Telemetry</span>
            </button>
            <button
              onClick={handleRebindFxToTelemetry}
              className="px-3 py-1.5 rounded-lg bg-[#0b0f17] border border-slate-700 hover:border-slate-500 text-slate-200 flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
              <span>Re-Bind 6 FX Slots</span>
            </button>
          </div>
        </div>

        {/* 32-Bar Dynamic Timeline */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>32-Bar Dynamic Structure (Zero Static Loops)</span>
            <span>Intro (1–4) · Groove (5–12) · Poly-Build (13–20) · Climax (21–26) · Breakdown (27–30) · Outro (31–32)</span>
          </div>
          <div className="grid grid-cols-16 sm:grid-cols-32 gap-1 bg-[#0b0f17] p-3 rounded-xl border border-slate-800">
            {compositionPlan.bars.map((bar) => {
              const isCurrent = seqStatus.isPlaying && seqStatus.currentBar === bar.barIndex + 1;
              return (
                <div
                  key={bar.barIndex}
                  title={`Bar ${bar.barIndex + 1} · ${bar.section} · Energy ${Math.round(bar.energy * 100)}% · ${bar.events.length} notes`}
                  className={`flex flex-col items-center justify-end h-16 rounded px-0.5 py-1 border transition-colors ${
                    isCurrent
                      ? 'border-cyan-400 bg-cyan-950/60'
                      : 'border-slate-800/80 bg-slate-900/60'
                  }`}
                >
                  <div
                    className={`w-full rounded-sm ${
                      bar.section === 'Climax'
                        ? 'bg-amber-400'
                        : bar.section === 'Poly-Build'
                          ? 'bg-violet-400'
                          : bar.section === 'Breakdown'
                            ? 'bg-emerald-400'
                            : 'bg-cyan-500'
                    }`}
                    style={{ height: `${Math.max(15, bar.energy * 100)}%` }}
                  />
                  <span className="text-[9px] font-mono text-slate-400 mt-1 tabular-nums">
                    {bar.barIndex + 1}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Native African Instruments + FM Synthesis */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Native African Instruments (5 cols) */}
          <div className="lg:col-span-5 p-5 rounded-xl bg-[#0b0f17] border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Native African Instruments</h3>
              <span className="text-xs font-mono text-amber-400">Click to Audition</span>
            </div>
            <div className="space-y-3">
              {NATIVE_INSTRUMENTS.map((inst) => {
                const triggeredRecently = nowTickMs - (seqStatus.activeVoices[inst.id] || 0) < 220;
                return (
                  <button
                    key={inst.id}
                    onClick={() => audioDspEngine.auditionNativeVoice(inst.id, compositionPlan)}
                    className={`w-full text-left p-3.5 rounded-lg border transition-colors flex items-center justify-between ${
                      triggeredRecently
                        ? 'bg-amber-950/40 border-amber-500/70 text-white'
                        : 'bg-[#121929] border-slate-800 hover:border-slate-700 text-slate-200'
                    }`}
                  >
                    <div>
                      <div className="text-sm font-semibold">{inst.label}</div>
                      <div className="text-xs font-mono text-slate-400 mt-0.5">{inst.role}</div>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-amber-300">
                      {triggeredRecently ? 'ACTIVE' : 'TRIGGER'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* FM Synthesis Engine (7 cols) */}
          <div className="lg:col-span-7 p-5 rounded-xl bg-[#0b0f17] border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">FM Synthesis Matrix</h3>
              <span className="text-xs font-mono tabular-nums text-violet-300">
                FM_MOD: {liveFm.fmModIndex.toFixed(2)} · Ratio 1:{liveFm.modRatio}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono tabular-nums text-slate-300">
                  <span>Carrier Base</span>
                  <span>{liveFm.carrierHz} Hz</span>
                </div>
                <input
                  type="range"
                  min={80}
                  max={440}
                  step={1}
                  value={liveFm.carrierHz}
                  onChange={(e) => setFmOverrides((p) => ({ ...p, carrierHz: Number(e.target.value) }))}
                  className="w-full accent-violet-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono tabular-nums text-slate-300">
                  <span>FM Modulation Index</span>
                  <span>{liveFm.fmModIndex.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={2.2}
                  step={0.05}
                  value={liveFm.fmModIndex}
                  onChange={(e) => setFmOverrides((p) => ({ ...p, fmModIndex: Number(e.target.value) }))}
                  className="w-full accent-violet-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono tabular-nums text-slate-300">
                  <span>Modulator Ratio</span>
                  <span>1:{liveFm.modRatio}</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.25}
                  value={liveFm.modRatio}
                  onChange={(e) => setFmOverrides((p) => ({ ...p, modRatio: Number(e.target.value) }))}
                  className="w-full accent-violet-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono tabular-nums text-slate-300">
                  <span>Envelope Decay</span>
                  <span>{liveFm.decaySec.toFixed(2)} s</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={0.9}
                  step={0.02}
                  value={liveFm.decaySec}
                  onChange={(e) => setFmOverrides((p) => ({ ...p, decaySec: Number(e.target.value) }))}
                  className="w-full accent-violet-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 6-Slot Environmental FX Rack */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">6-Slot Environmental Telemetry FX Rack</h3>
            <span className="text-xs font-mono text-slate-400">
              Distortion → Filter → Modulation → Delay → Reverb → Compressor
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {activeFxSlots.map((slot) => (
              <div
                key={slot.id}
                className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition-opacity ${
                  slot.bypass
                    ? 'bg-[#0b0f17]/50 border-slate-800/60 opacity-60'
                    : 'bg-[#0b0f17] border-slate-800'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-cyan-400">
                      FX_0{slot.slotNumber}
                    </span>
                    <button
                      onClick={() => handleUpdateFxSlot(slot.id, { bypass: !slot.bypass })}
                      className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                        slot.bypass
                          ? 'border-slate-700 text-slate-400'
                          : 'border-emerald-700/70 text-emerald-300 bg-emerald-950/30'
                      }`}
                    >
                      {slot.bypass ? 'BYPASS' : 'ACTIVE'}
                    </button>
                  </div>
                  <div className="text-sm font-bold text-white">{slot.name}</div>
                  <div className="text-[11px] font-mono text-slate-400 truncate">
                    {slot.telemetrySource}
                  </div>
                </div>

                <div className="space-y-2.5 pt-1">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-300">
                      <span>{slot.primaryLabel}</span>
                      <span>
                        {slot.primaryValue} {slot.primaryUnit}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={slot.primaryMin}
                      max={slot.primaryMax}
                      step={(slot.primaryMax - slot.primaryMin) / 100}
                      value={slot.primaryValue}
                      onChange={(e) =>
                        handleUpdateFxSlot(
                          slot.id,
                          { primaryValue: Number(e.target.value) },
                          slot.id === 'reverb'
                        )
                      }
                      className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-300">
                      <span>{slot.id === 'compressor' || slot.id === 'filter' ? slot.secondaryLabel : 'Mix'}</span>
                      <span>
                        {slot.id === 'compressor' || slot.id === 'filter'
                          ? `${slot.secondaryValue}${slot.secondaryUnit}`
                          : `${Math.round(slot.mix * 100)}%`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={slot.id === 'compressor' || slot.id === 'filter' ? slot.secondaryMin : 0}
                      max={slot.id === 'compressor' || slot.id === 'filter' ? slot.secondaryMax : 1}
                      step={slot.id === 'compressor' || slot.id === 'filter' ? 0.1 : 0.02}
                      value={slot.id === 'compressor' || slot.id === 'filter' ? slot.secondaryValue : slot.mix}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (slot.id === 'compressor' || slot.id === 'filter') {
                          handleUpdateFxSlot(slot.id, { secondaryValue: val });
                        } else {
                          handleUpdateFxSlot(slot.id, { mix: val });
                        }
                      }}
                      className="w-full accent-violet-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EXISTING REAL-TIME DSP METERS GRID (PRESERVED) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="p-6 rounded-2xl bg-[#121929] border border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-sm text-slate-300 font-semibold">
            <span>Peak Amplitude</span>
            <span className="text-xs font-mono text-cyan-400">dBFS</span>
          </div>
          <div className="text-3xl font-extrabold font-mono text-white tabular-nums tracking-tight">
            {metrics.peakDb.toFixed(1)} dB
          </div>
          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-rose-500 rounded-full transition-all duration-75"
              style={{ width: `${Math.min(100, Math.max(0, (metrics.peakDb + 60) * 1.66))}%` }}
            />
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-[#121929] border border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-sm text-slate-300 font-semibold">
            <span>RMS Level</span>
            <span className="text-xs font-mono text-violet-400">dBFS</span>
          </div>
          <div className="text-3xl font-extrabold font-mono text-white tabular-nums tracking-tight">
            {metrics.rmsDb.toFixed(1)} dB
          </div>
          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
            <div
              className="h-full bg-violet-500 rounded-full transition-all duration-75"
              style={{ width: `${Math.min(100, Math.max(0, (metrics.rmsDb + 60) * 1.66))}%` }}
            />
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-[#121929] border border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-sm text-slate-300 font-semibold">
            <span>Spectral Centroid</span>
            <span className="text-xs font-mono text-amber-400">Hz</span>
          </div>
          <div className="text-3xl font-extrabold font-mono text-white tabular-nums tracking-tight">
            {metrics.spectralCentroidHz} Hz
          </div>
          <div className="text-xs text-slate-300 font-mono pt-1">
            Pitch: <span className="text-cyan-400 font-bold">{metrics.detectedPitchHz} Hz (A4)</span>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-[#121929] border border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-sm text-slate-300 font-semibold">
            <span>Integrated Loudness</span>
            <span className="text-xs font-mono text-pink-400">LUFS</span>
          </div>
          <div className="text-3xl font-extrabold font-mono text-white tabular-nums tracking-tight">
            {metrics.lufsLoudness.toFixed(1)} LUFS
          </div>
          <div className="text-xs text-slate-300 font-mono pt-1">
            Target: <span className="text-white font-bold">-14.0 LUFS (Master)</span>
          </div>
        </div>
      </div>

      {/* EXISTING 32-BAND FFT FREQUENCY SPECTRUM VISUALIZER (PRESERVED) */}
      <div className="bg-[#121929] border border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2.5">
              <Activity className="w-5 h-5 text-violet-400" />
              <span>32-Band FFT Frequency Spectrum Analyzer</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              High-resolution spectral distribution extracted via Audio DSP thread
            </p>
          </div>

          <div className="flex items-center gap-6 text-sm font-mono text-slate-300 bg-[#0b0f17] px-4 py-2 rounded-xl border border-slate-800">
            <span>
              Sample Rate: <span className="text-cyan-400 font-bold">{metrics.sampleRate} Hz</span>
            </span>
            <span>
              Block Size: <span className="text-violet-400 font-bold">{metrics.bufferSize}</span>
            </span>
          </div>
        </div>

        <div className="h-48 flex items-end justify-between gap-1.5 pt-4">
          {metrics.fftSpectrum32.map((amp, idx) => (
            <div key={idx} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
              <div className="w-full bg-slate-800/80 rounded-t-lg overflow-hidden flex flex-col justify-end h-full">
                <div
                  className="w-full bg-gradient-to-t from-violet-600 via-cyan-500 to-indigo-400 transition-all duration-75 rounded-t-lg"
                  style={{ height: `${Math.max(6, amp * 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-slate-400 group-hover:text-slate-200 tabular-nums">
                {idx + 1}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* EXISTING INTERACTIVE OSCILLATOR PITCH CONTROL (PRESERVED) */}
      <div className="bg-[#121929] border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-bold text-white flex items-center gap-2.5">
            <Music className="w-5 h-5 text-pink-400" />
            <span>Synth Frequency Modulation: {synthFreq} Hz</span>
          </label>
          <span className="text-xs font-mono text-slate-400">20 Hz - 2000 Hz</span>
        </div>

        <input
          type="range"
          min="100"
          max="1200"
          value={synthFreq}
          onChange={(e) => handleFreqChange(Number(e.target.value))}
          className="w-full accent-violet-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
        />

        <div className="flex items-center justify-between text-xs font-mono text-slate-400 pt-2">
          <button onClick={() => handleFreqChange(220)} className="hover:text-cyan-400 font-semibold px-3 py-1 bg-slate-800/80 rounded-lg">
            A3 (220Hz)
          </button>
          <button onClick={() => handleFreqChange(440)} className="hover:text-cyan-400 font-bold text-cyan-300 px-3 py-1 bg-slate-800/80 rounded-lg">
            A4 (440Hz)
          </button>
          <button onClick={() => handleFreqChange(880)} className="hover:text-cyan-400 font-semibold px-3 py-1 bg-slate-800/80 rounded-lg">
            A5 (880Hz)
          </button>
        </div>
      </div>

      {/* STAGE 3: OUTPUT (PRODUCT — 320KBPS MP3, SEPARATED WAV STEMS, ID3v2.3 & PROCEDURAL COVER ART) */}
      <section className="bg-[#121929] border border-slate-800 rounded-2xl p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2.5">
              <Disc3 className="w-5 h-5 text-emerald-400" />
              <span>03. Output Stage — 32-Bar Master, Separated WAV Stems & ID3v2.3 Release</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              OfflineAudioContext 48000 Hz · 320kbps CBR MP3 · ID3v2.3 Tags + Embedded Cover Art · 4 Stereo RIFF WAV Stems
            </p>
          </div>

          <button
            onClick={handleRenderBundle}
            disabled={isRendering}
            className="px-5 py-2.5 text-sm font-bold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors flex items-center gap-2 whitespace-nowrap disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            <span>{isRendering ? 'Rendering 32 Bars...' : 'Render 32-Bar Master & Stems'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Procedural Cover Art Preview (4 cols) */}
          <div className="lg:col-span-4 space-y-3">
            <div className="aspect-square w-full rounded-xl overflow-hidden border border-slate-800 bg-[#0b0f17] flex items-center justify-center">
              {previewCover.dataUrl ? (
                <img
                  src={previewCover.dataUrl}
                  alt="Procedural 24-Domain Weather Beats Cover Art"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-xs font-mono text-slate-400">Cover Art Canvas</div>
              )}
            </div>
            {previewCover.dataUrl && (
              <button
                onClick={() =>
                  triggerDownload(
                    previewCover.dataUrl,
                    `${id3Meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'weather-beats'}-cover.jpg`
                  )
                }
                className="w-full py-2 text-xs font-semibold rounded-lg bg-[#0b0f17] hover:bg-slate-800 text-slate-200 border border-slate-700 transition-colors"
              >
                Download Cover Artwork (1024×1024 JPEG)
              </button>
            )}
          </div>

          {/* ID3 Metadata Form + Render Progress + Export Buttons (8 cols) */}
          <div className="lg:col-span-8 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1 text-xs font-mono text-slate-300">
                <span>ID3 Title (TIT2)</span>
                <input
                  type="text"
                  value={id3Meta.title}
                  onChange={(e) => setId3Meta((m) => ({ ...m, title: e.target.value }))}
                  className="w-full bg-[#0b0f17] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-sans focus:outline-none focus:border-cyan-500"
                />
              </label>

              <label className="space-y-1 text-xs font-mono text-slate-300">
                <span>ID3 Artist (TPE1)</span>
                <input
                  type="text"
                  value={id3Meta.artist}
                  onChange={(e) => setId3Meta((m) => ({ ...m, artist: e.target.value }))}
                  className="w-full bg-[#0b0f17] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-sans focus:outline-none focus:border-cyan-500"
                />
              </label>

              <label className="space-y-1 text-xs font-mono text-slate-300">
                <span>ID3 Album (TALB)</span>
                <input
                  type="text"
                  value={id3Meta.album}
                  onChange={(e) => setId3Meta((m) => ({ ...m, album: e.target.value }))}
                  className="w-full bg-[#0b0f17] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-sans focus:outline-none focus:border-cyan-500"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-xs font-mono text-slate-300">
                  <span>Genre (TCON)</span>
                  <input
                    type="text"
                    value={id3Meta.genre}
                    onChange={(e) => setId3Meta((m) => ({ ...m, genre: e.target.value }))}
                    className="w-full bg-[#0b0f17] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-sans focus:outline-none focus:border-cyan-500"
                  />
                </label>

                <label className="space-y-1 text-xs font-mono text-slate-300">
                  <span>Year (TYER)</span>
                  <input
                    type="text"
                    value={id3Meta.year}
                    onChange={(e) => setId3Meta((m) => ({ ...m, year: e.target.value }))}
                    className="w-full bg-[#0b0f17] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </label>
              </div>
            </div>

            {(isRendering || renderedBundle) && (
              <div className="p-4 rounded-xl bg-[#0b0f17] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className="text-emerald-300">{renderStageText || 'Ready'}</span>
                  <span className="text-white">{renderProgress}%</span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-150"
                    style={{ width: `${renderProgress}%` }}
                  />
                </div>
              </div>
            )}

            {renderedBundle && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#0b0f17] border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-white">
                        Master Release · 320kbps MP3 (ID3v2.3 + Embedded Art)
                      </div>
                      <div className="text-xs font-mono text-slate-400 tabular-nums">
                        {renderedBundle.durationSec}s · {renderedBundle.bpm} BPM · {(renderedBundle.mp3SizeBytes / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    <button
                      onClick={() => triggerDownload(renderedBundle.mp3Url, renderedBundle.mp3FileName)}
                      className="px-4 py-2 text-xs font-bold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 flex items-center gap-2 whitespace-nowrap"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download 320kbps MP3</span>
                    </button>
                  </div>

                  {auditionUrl && (
                    <audio controls src={auditionUrl} className="w-full h-10" />
                  )}
                </div>

                {/* 4 Separated WAV Stems */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {renderedBundle.stems.map((stem) => (
                    <div
                      key={stem.id}
                      className="p-3.5 rounded-xl bg-[#0b0f17] border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">{stem.label}</div>
                        <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                          16-bit 48kHz WAV · {(stem.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setAuditionUrl(stem.wavUrl)}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200"
                        >
                          Audition
                        </button>
                        <button
                          onClick={() => triggerDownload(stem.wavUrl, stem.fileName)}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-violet-600 hover:bg-violet-500 text-white"
                        >
                          WAV
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
