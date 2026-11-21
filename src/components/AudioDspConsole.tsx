import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  audioDspEngine,
  AudioDspMetrics,
  LyriaFlowEngineState,
  RenderedReleaseBundle,
  SequencerPlaybackStatus
} from '../services/audioDspEngine';
import { GeolocationWeatherContext, telemetryEngine } from '../services/telemetryEngine';
import {
  ALL_SYNTH_VOICES,
  ClusterOverrideMap,
  Composition32BarPlan,
  FmSynthParams,
  FxSlotConfig,
  SynthVoiceId,
  TELEMETRY_BY_HOUR,
  TELEMETRY_CLUSTERS,
  VoiceMixMap,
  build32BarComposition,
  computeCircadianSpotlight,
  computeDomainVector24,
  deriveDefaultFxRack
} from '../services/weatherBeatsComposer';
import {
  buildLyriaTelemetryPayload,
  LyriaFlowResponse,
  ReleaseAiKit,
  requestAiReleaseKit,
  requestLyriaFlowAudio,
  requestMusicalDirection
} from '../services/aiIntelligenceSuite';
import { Id3TrackMetadata, generateProceduralCoverArt } from '../services/audioExportEngine';
import { DomainCategory } from '../types/telemetry';
import {
  Sliders,
  Volume2,
  VolumeX,
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
  Waves,
  Clock,
  Undo2,
  Wand2,
  Sparkles
} from 'lucide-react';

const VOICE_GROUPS: Array<{ id: 'foundation' | 'groove' | 'melodic'; label: string }> = [
  { id: 'foundation', label: 'Foundation · Pads, Sub-Bass & Seer Whispers' },
  { id: 'groove', label: 'Groove · Kick, Djembe & Stereo Perc' },
  { id: 'melodic', label: 'Melodic · Kora, Kalimba, Balafon & FM' }
];

function formatPanLabel(pan: number): string {
  if (Math.abs(pan) < 0.04) return 'C';
  const pct = Math.round(Math.abs(pan) * 100);
  return pan < 0 ? `L${pct}` : `R${pct}`;
}

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

  // Stage 2: Continuous 24-Telemetry Synthesis, AI Musical Director, Motif Evolver & 24-Hour Clock
  const [studioPrefsVersion, setStudioPrefsVersion] = useState(0);
  const [voiceMix, setVoiceMix] = useState<VoiceMixMap>(() => audioDspEngine.getVoiceMix());
  const [ambientWhispersEnabled, setAmbientWhispersEnabled] = useState<boolean>(() =>
    audioDspEngine.getAmbientWhispersEnabled()
  );
  const [autoEvolveEnabled, setAutoEvolveEnabled] = useState<boolean>(() =>
    audioDspEngine.getAutoEvolveEnabled()
  );
  const [hourOverride, setHourOverride] = useState<number | null>(() =>
    audioDspEngine.getHourOfDayOverride()
  );
  const [fmOverrides, setFmOverrides] = useState<Partial<FmSynthParams>>({});
  const [fxSlotsState, setFxSlotsState] = useState<FxSlotConfig[] | null>(null);
  const [seqStatus, setSeqStatus] = useState<SequencerPlaybackStatus>(() =>
    audioDspEngine.getSequencerStatus()
  );
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());

  // AI Musical Director & Motif Evolver UI state
  const [directorInput, setDirectorInput] = useState('');
  const [isDirecting, setIsDirecting] = useState(false);
  const [directorStatus, setDirectorStatus] = useState<string | null>(
    () => audioDspEngine.getLastDirectorSummary()
  );
  const [directorError, setDirectorError] = useState<string | null>(null);
  const [isEvolvingMotif, setIsEvolvingMotif] = useState(false);
  const [motifError, setMotifError] = useState<string | null>(() =>
    audioDspEngine.getLastMotifError()
  );

  // Google Lyria 3 Live Flow & Lyria Pro Studio Track state
  const [lyriaState, setLyriaState] = useState<LyriaFlowEngineState>(() =>
    audioDspEngine.getLyriaFlowState()
  );
  const [isRenderingLyriaPro, setIsRenderingLyriaPro] = useState(false);
  const [lyriaProTrack, setLyriaProTrack] = useState<LyriaFlowResponse | null>(null);
  const [lyriaProError, setLyriaProError] = useState<string | null>(null);

  // Stage 3: ID3 Metadata, AI Release Kit & Offline Render Bundle
  const [id3Meta, setId3Meta] = useState<Id3TrackMetadata>({
    title: 'Weather Beats 001',
    artist: 'Weather Beats · 24-Domain Telemetry',
    album: 'Circadian Telemetry Sessions',
    genre: 'Continuous Telemetry Flow',
    year: String(new Date().getFullYear()),
    comment: 'Composed continuously from 24 live telemetry streams'
  });
  const [aiReleaseKit, setAiReleaseKit] = useState<ReleaseAiKit | null>(null);
  const [useAiCoverArt, setUseAiCoverArt] = useState(true);
  const [linerNotes, setLinerNotes] = useState('');
  const [isGeneratingReleaseKit, setIsGeneratingReleaseKit] = useState(false);
  const [releaseKitError, setReleaseKitError] = useState<string | null>(null);
  const [exportDurationSec, setExportDurationSec] = useState<number>(120);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStageText, setRenderStageText] = useState('');
  const [renderedBundle, setRenderedBundle] = useState<RenderedReleaseBundle | null>(null);
  const [auditionUrl, setAuditionUrl] = useState<string | null>(null);

  // Subscribe to DSP metrics frame loop + telemetry updates + sequencer & studio preferences
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

    const unsubPrefs = audioDspEngine.subscribeStudioPreferences(() => {
      setVoiceMix(audioDspEngine.getVoiceMix());
      setAmbientWhispersEnabled(audioDspEngine.getAmbientWhispersEnabled());
      setAutoEvolveEnabled(audioDspEngine.getAutoEvolveEnabled());
      setHourOverride(audioDspEngine.getHourOfDayOverride());
      setDirectorStatus(audioDspEngine.getLastDirectorSummary());
      setMotifError(audioDspEngine.getLastMotifError());
      setStudioPrefsVersion((v) => v + 1);
    });

    const unsubLyria = audioDspEngine.subscribeLyriaFlow((state) => {
      setLyriaState(state);
    });

    return () => {
      cancelAnimationFrame(animId);
      unsubTelemetry();
      unsubSeq();
      unsubPrefs();
      unsubLyria();
    };
  }, []);

  const vector24 = useMemo(
    () => computeDomainVector24(latestByDomain, weatherCtx, clusterOverrides),
    [latestByDomain, weatherCtx, clusterOverrides]
  );

  const compositionPlan: Composition32BarPlan = useMemo(() => {
    const engineOpts = audioDspEngine.getCompositionOptions();
    return build32BarComposition(vector24, weatherCtx, {
      ...engineOpts,
      overrideFm: Object.keys(fmOverrides).length > 0 ? fmOverrides : engineOpts.overrideFm,
      overrideFx: fxSlotsState ?? engineOpts.overrideFx
    });
  }, [vector24, weatherCtx, fmOverrides, fxSlotsState, studioPrefsVersion]);

  // Keep live sequencer plan and ambient whisper telemetry snapshot synced
  useEffect(() => {
    audioDspEngine.updateCompositionPlan(compositionPlan);
    audioDspEngine.setWhisperTelemetryContext(vector24, weatherCtx, 'all');
  }, [compositionPlan, vector24, weatherCtx]);

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

  const handleApplyMusicalDirection = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = directorInput.trim();
    if (!text || isDirecting) return;
    setIsDirecting(true);
    setDirectorError(null);
    try {
      const patch = await requestMusicalDirection(text, {
        bpm: compositionPlan.bpm,
        telemetrySignature: compositionPlan.telemetrySignatureLabel,
        activeHour: `${compositionPlan.activeTelemetryHour.hourLabel} ${compositionPlan.activeTelemetryHour.mapping.instrument}`,
        scaleName: compositionPlan.scaleName,
        voiceMix,
        fxRack: compositionPlan.fxRack.map((s) => ({
          id: s.id,
          mix: s.mix,
          primaryValue: s.primaryValue,
          secondaryValue: s.secondaryValue
        }))
      });
      audioDspEngine.applyMusicalDirectorPatch(patch);
      setDirectorStatus(patch.summary);
      setDirectorInput('');
    } catch (err) {
      setDirectorError(err instanceof Error ? err.message : 'Musical direction request failed.');
    } finally {
      setIsDirecting(false);
    }
  };

  const handleUndoDirection = () => {
    const restored = audioDspEngine.revertLastDirectorPatch();
    setDirectorError(null);
    setDirectorStatus(restored ?? 'Reverted last direction.');
  };

  const handleEvolveMotifNow = async () => {
    if (isEvolvingMotif) return;
    setIsEvolvingMotif(true);
    setMotifError(null);
    try {
      await audioDspEngine.triggerManualMotifEvolution();
    } catch (err) {
      setMotifError(err instanceof Error ? err.message : 'Could not evolve harmonic motif.');
    } finally {
      setIsEvolvingMotif(false);
    }
  };

  const handleGenerateReleaseKit = async () => {
    if (isGeneratingReleaseKit) return;
    setIsGeneratingReleaseKit(true);
    setReleaseKitError(null);
    try {
      const standoutReadings = Object.values(vector24)
        .sort((a, b) => Math.abs(b.normalized - 0.5) - Math.abs(a.normalized - 0.5))
        .slice(0, 6)
        .map((r) => ({
          domain: r.name,
          value: r.rawValue,
          unit: r.unit,
          normalizedPct: Math.round(r.normalized * 100)
        }));

      const kit = await requestAiReleaseKit({
        weatherCtx,
        bpm: compositionPlan.bpm,
        telemetrySignatureLabel: compositionPlan.telemetrySignatureLabel,
        scaleName: compositionPlan.scaleName,
        chordSummary: compositionPlan.chordProgressionSummary,
        motifTitle: compositionPlan.activeMotifTitle,
        standoutReadings
      });
      setAiReleaseKit(kit);
      setUseAiCoverArt(Boolean(kit.coverArtDataUrl));
      setLinerNotes(kit.linerNotes);
      setId3Meta((prev) => ({
        ...prev,
        title: kit.title || prev.title,
        genre: compositionPlan.telemetrySignatureLabel,
        comment: kit.linerNotes.slice(0, 180)
      }));
    } catch (err) {
      setReleaseKitError(err instanceof Error ? err.message : 'Could not generate AI cover art & liner notes.');
    } finally {
      setIsGeneratingReleaseKit(false);
    }
  };

  const handleRenderBundle = async () => {
    if (isRendering) return;
    setIsRendering(true);
    setRenderProgress(4);
    setRenderStageText('Initializing 48000 Hz OfflineAudioContext...');

    try {
      const metaWithSignature: Id3TrackMetadata = {
        ...id3Meta,
        genre: id3Meta.genre || compositionPlan.telemetrySignatureLabel,
        comment: `${linerNotes ? `${linerNotes.slice(0, 140)} | ` : ''}${compositionPlan.telemetrySignature}`
      };
      const coverToEmbed =
        useAiCoverArt && aiReleaseKit?.coverArtDataUrl ? aiReleaseKit.coverArtDataUrl : null;
      const bundle = await audioDspEngine.render32BarBundle(
        compositionPlan,
        metaWithSignature,
        vector24,
        weatherCtx,
        (pct, label) => {
          setRenderProgress(pct);
          setRenderStageText(label);
        },
        exportDurationSec,
        coverToEmbed
      );
      setRenderedBundle(bundle);
      setAuditionUrl(bundle.mp3Url);
    } finally {
      setIsRendering(false);
    }
  };

  const handleRenderLyriaProTrack = async () => {
    if (isRenderingLyriaPro) return;
    setIsRenderingLyriaPro(true);
    setLyriaProError(null);
    try {
      const coverToAttach =
        useAiCoverArt && aiReleaseKit?.coverArtDataUrl ? aiReleaseKit.coverArtDataUrl : null;
      const payload = buildLyriaTelemetryPayload('pro', compositionPlan, weatherCtx, {
        directorNote: directorStatus,
        evolutionIndex: lyriaState.clipCount,
        coverArtDataUrl: coverToAttach
      });
      const res = await requestLyriaFlowAudio(payload);
      setLyriaProTrack(res);
    } catch (err) {
      setLyriaProError(
        err instanceof Error ? err.message : 'Google Lyria Pro studio render failed.'
      );
    } finally {
      setIsRenderingLyriaPro(false);
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
    <div className="flex-1 bg-[#10141c] flex flex-col min-w-0 overflow-y-auto p-6 lg:p-8 space-y-8 custom-scrollbar">
      {/* Header & Baseline Audio Controls */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Sliders className="w-6 h-6 text-[#c8b28e] shrink-0" />
            <h1 className="text-2xl lg:text-3xl font-bold text-[#ece7df] tracking-tight">
              Audio & Musical Intelligence DSP Engine
            </h1>
            <span className="text-xs font-mono text-[#9c9991]">
              48000 Hz · 1024 Samples · Endless Telemetry DAW
            </span>
          </div>
          <p className="text-sm text-[#b5b0a6] mt-2 max-w-4xl leading-relaxed">
            Compose directly with live telemetry: weather and the other 23 telemetry trees each act as a dedicated instrument AND own their own hour of the 24-hour day (00:00–23:00), morphing in an unbroken infinite tide with zero preset genres or abrupt transitions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            onClick={handleStartAudio}
            className="px-4 py-2.5 text-sm font-medium rounded-xl bg-[#1b2230] hover:bg-[#232c3d] text-[#e6e1d8] border border-white/[0.09] transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Volume2 className="w-4 h-4 text-[#a3c2bc]" />
            <span>Initialize WebAudio</span>
          </button>

          <button
            onClick={handleToggleSequencer}
            className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-colors flex items-center gap-2 border whitespace-nowrap ${
              seqStatus.isPlaying
                ? 'bg-[#7fa898] hover:bg-[#8eb5a5] text-[#11151d] border-[#8eb5a5]/70'
                : 'bg-[#c9b18a] hover:bg-[#d5bf9b] text-[#11151d] border-[#d5bf9b]/70'
            }`}
          >
            {seqStatus.isPlaying ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{seqStatus.isPlaying ? 'Stop Endless Flow' : 'Play Endless Flow'}</span>
          </button>

          <button
            onClick={handleToggleSynth}
            className={`px-4 py-2.5 text-sm font-medium rounded-xl transition-colors flex items-center gap-2 border whitespace-nowrap ${
              isSynthRunning
                ? 'bg-[#8d85a8] text-[#11151d] border-[#a29abd]'
                : 'bg-[#171c26] text-[#c7c2b8] border-white/[0.09] hover:border-white/[0.18]'
            }`}
          >
            {isSynthRunning ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{isSynthRunning ? 'Stop Synth Oscillator' : 'Start 440Hz Oscillator'}</span>
          </button>
        </div>
      </div>

      {/* STAGE 1: INPUT (NATURE + ALL 24 TELEMETRY DOMAINS) */}
      <section className="bg-[#161b25] border border-white/[0.08] rounded-2xl p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-white/[0.07]">
          <div>
            <h2 className="text-lg font-semibold text-[#ece7df] flex items-center gap-2.5">
              <MapPin className="w-5 h-5 text-[#a3c2bc]" />
              <span>01. Input Stage — Nature & 24 Telemetry Modulation Bus</span>
            </h2>
            <p className="text-xs text-[#9c9991] mt-1 font-mono tabular-nums">
              {weatherCtx.region} · {weatherCtx.temperatureC.toFixed(1)}°C · Humidity {weatherCtx.humidityPct}% · Wind {weatherCtx.windSpeedMs} m/s · AQI {weatherCtx.aqi} · Pressure {weatherCtx.pressureHpa} hPa
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {geoMessage && <span className="text-xs font-mono text-[#a3c2bc]">{geoMessage}</span>}
            <button
              onClick={handleSyncGeolocation}
              disabled={geoLoading}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-[#11151d] hover:bg-[#1e2432] text-[#d7d2c8] border border-white/[0.09] transition-colors flex items-center gap-2 whitespace-nowrap disabled:opacity-60"
            >
              <MapPin className="w-4 h-4 text-[#a3c2bc]" />
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
                className="p-4 rounded-xl bg-[#11151d] border border-white/[0.07] flex flex-col justify-between space-y-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#ece7df] truncate">{cluster.label}</span>
                    <button
                      onClick={() => handleToggleClusterLock(cluster.id, avgNorm)}
                      title={isLocked ? 'Unlock live telemetry' : 'Lock manual modulation override'}
                      className="text-xs font-mono px-2 py-1 rounded border border-white/[0.09] text-[#b5b0a6] hover:text-[#ece7df] flex items-center gap-1 shrink-0"
                    >
                      {isLocked ? <Lock className="w-3 h-3 text-[#c8b28e]" /> : <Unlock className="w-3 h-3 text-[#8bb5a6]" />}
                      <span>{isLocked ? 'Locked' : 'Live'}</span>
                    </button>
                  </div>
                  <p className="text-xs text-[#9c9991] leading-snug">{cluster.dspTarget}</p>
                </div>

                {/* Domain chips as clean unboxed inline readouts */}
                <div className="space-y-1.5 pt-1">
                  {readings.map((r) => (
                    <div key={r.domain} className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span className="text-[#a6a29a] truncate pr-2">{r.name.replace(' Intelligence', '')}</span>
                      <span className="text-[#dcd7cd] shrink-0">
                        {r.rawValue} {r.unit}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono tabular-nums text-[#9c9991]">
                    <span>Bus Modulation</span>
                    <span className="text-[#c8b28e]">{Math.round(avgNorm * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={avgNorm}
                    onChange={(e) => handleClusterSlider(cluster.id, Number(e.target.value))}
                    aria-label={`${cluster.label} modulation`}
                    className="w-full accent-[#7fa898] cursor-pointer h-1.5 bg-[#202634] rounded-lg"
                  />
                </div>
              </div>
            );
          })}
        </div>
        {/* 24-Hour Telemetry Clock & Instrument Matrix (1 Hour per Telemetry Tree, 00:00–23:00) */}
        <div className="pt-5 border-t border-white/[0.07] space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#ece7df] flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#c9b18a]" />
                <span>24-Hour Circadian Telemetry Clock — One Hour &amp; Instrument Per Tree</span>
              </h3>
              <p className="text-xs text-[#9c9991] mt-0.5 font-mono tabular-nums">
                Active Hour {compositionPlan.activeTelemetryHour.hourLabel} ({compositionPlan.activeTelemetryHour.mapping.circadianPhase}) · Featured Soloist:{' '}
                <span className="text-[#c9b18a]">{compositionPlan.activeTelemetryHour.mapping.instrument}</span>
              </p>
            </div>
            {hourOverride !== null && (
              <button
                type="button"
                onClick={() => audioDspEngine.setHourOfDayOverride(null)}
                className="px-3 py-1.5 rounded-lg bg-[#11151d] hover:bg-[#1e2432] border border-[#c9b18a]/40 text-xs font-mono text-[#e6d5b8] whitespace-nowrap shrink-0"
              >
                Return to Live Local Clock
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
            {TELEMETRY_BY_HOUR.map((item) => {
              const reading = vector24[item.domain];
              const isCurrentHour = item.hourOfDay === compositionPlan.activeTelemetryHour.hourOfDay;
              const spotlightPct = Math.round(
                computeCircadianSpotlight(item.hourOfDay, compositionPlan.activeTelemetryHour.hourFloat) * 100
              );
              return (
                <button
                  key={item.domain}
                  type="button"
                  onClick={() =>
                    audioDspEngine.setHourOfDayOverride(
                      hourOverride === item.hourOfDay ? null : item.hourOfDay
                    )
                  }
                  className={`text-left p-2.5 rounded-xl border transition-colors ${
                    isCurrentHour
                      ? 'bg-[#202532] border-[#c9b18a]/55'
                      : 'bg-[#11151d] border-white/[0.06] hover:border-white/[0.16]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums">
                    <span className={isCurrentHour ? 'text-[#c9b18a] font-semibold' : 'text-[#9c9991]'}>
                      {item.hourLabel}
                    </span>
                    <span className="text-[#7fa898]">{Math.round(reading.normalized * 100)}%</span>
                  </div>
                  <div className="text-xs font-medium text-[#ece7df] truncate mt-1">
                    {item.instrument}
                  </div>
                  <div className="text-[11px] text-[#9c9991] truncate">
                    {reading.name.replace(' Intelligence', '')}
                  </div>
                  <div className="text-[10px] font-mono tabular-nums text-[#7e7b74] mt-1 flex items-center justify-between">
                    <span className="truncate">{item.circadianPhase}</span>
                    {spotlightPct >= 40 && <span className="text-[#c9b18a]">Solo {spotlightPct}%</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* STAGE 2: SYNTHESIS ENGINE (INFINITE CONTINUOUS TELEMETRY FLOW + AI DIRECTOR + 10-VOICE STEREO MIXER + FM + FX) */}
      <section className="bg-[#161b25] border border-white/[0.08] rounded-2xl p-6 space-y-6">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-white/[0.07]">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-[#ece7df] flex items-center gap-2.5">
              <Waves className="w-5 h-5 text-[#9a93b8]" />
              <span>02. Synthesis Engine — Infinite 24-Telemetry Flow</span>
            </h2>
            <p className="text-xs text-[#c7c2b8] font-mono tabular-nums">
              <span className="text-[#c9b18a] font-semibold">{compositionPlan.telemetrySignatureLabel}</span> ·{' '}
              {compositionPlan.scaleName} · Chord{' '}
              <span className="text-[#92bda9] font-semibold">
                {seqStatus.currentChord || compositionPlan.bars[0]?.chordSymbol}
              </span>{' '}
              · Bar {seqStatus.currentBar} ({seqStatus.activeSection})
            </p>
            <p className="text-[11px] text-[#9c9991] font-mono">
              Progression: {compositionPlan.chordProgressionSummary}
              {compositionPlan.activeMotifTitle ? ` · Active Motif: ${compositionPlan.activeMotifTitle}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono text-[#c7c2b8]">
            <button
              type="button"
              onClick={() => audioDspEngine.setAutoEvolveEnabled(!autoEvolveEnabled)}
              aria-pressed={autoEvolveEnabled}
              className={`px-3 py-1.5 rounded-lg border flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                autoEvolveEnabled
                  ? 'bg-[#202530] border-[#7fa898]/45 text-[#a3c2bc]'
                  : 'bg-[#11151d] border-white/[0.08] text-[#9c9991] hover:text-[#dcd7cd]'
              }`}
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>{autoEvolveEnabled ? 'Auto-Evolve On' : 'Auto-Evolve Off'}</span>
            </button>
            <button
              type="button"
              onClick={handleEvolveMotifNow}
              disabled={isEvolvingMotif}
              className="px-3 py-1.5 rounded-lg bg-[#11151d] border border-white/[0.09] hover:border-[#c9b18a]/50 text-[#e6d5b8] flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#c9b18a] ${isEvolvingMotif ? 'animate-spin' : ''}`} />
              <span>{isEvolvingMotif ? 'Evolving...' : 'Evolve Motif Now'}</span>
            </button>
            <button
              type="button"
              onClick={() => audioDspEngine.setAmbientWhispersEnabled(!ambientWhispersEnabled)}
              aria-pressed={ambientWhispersEnabled}
              className={`px-3 py-1.5 rounded-lg border flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                ambientWhispersEnabled
                  ? 'bg-[#202530] border-[#c8b28e]/45 text-[#e6d7bd]'
                  : 'bg-[#11151d] border-white/[0.08] text-[#9c9991] hover:text-[#dcd7cd]'
              }`}
            >
              <Waves className="w-3.5 h-3.5" />
              <span>{ambientWhispersEnabled ? 'Whispers On' : 'Whispers Off'}</span>
            </button>
            <button
              type="button"
              onClick={handleResetFmToTelemetry}
              className="px-3 py-1.5 rounded-lg bg-[#11151d] border border-white/[0.09] hover:border-white/[0.18] text-[#d7d2c8] flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#9a93b8]" />
              <span>Sync FM</span>
            </button>
            <button
              type="button"
              onClick={handleRebindFxToTelemetry}
              className="px-3 py-1.5 rounded-lg bg-[#11151d] border border-white/[0.09] hover:border-white/[0.18] text-[#d7d2c8] flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#8bb5a6]" />
              <span>Re-Bind FX</span>
            </button>
          </div>
        </div>

        {/* Continuous Emergent Telemetry Signature Meters & AI Musical Director */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-5 p-4 rounded-xl bg-[#11151d] border border-white/[0.07] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[#c9b18a] font-semibold">Emergent Telemetry Vector</span>
              <span className="text-[#9c9991]">{compositionPlan.emergentProfile.signatureTitle}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              {[
                { label: 'Kinetic Drive', val: compositionPlan.emergentProfile.kineticDrive },
                { label: 'Atmospheric Space', val: compositionPlan.emergentProfile.atmosphericSpace },
                { label: 'Polyrhythm Weave', val: compositionPlan.emergentProfile.polyrhythmDensity },
                { label: 'Harmonic Warmth', val: compositionPlan.emergentProfile.harmonicWarmth }
              ].map((m) => (
                <div key={m.label} className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono tabular-nums text-[#b5b0a6]">
                    <span>{m.label}</span>
                    <span className="text-[#ece7df]">{Math.round(m.val * 100)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#1e2432] overflow-hidden">
                    <div
                      className="h-full bg-[#7fa898] transition-all duration-300"
                      style={{ width: `${Math.round(m.val * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="xl:col-span-7 p-4 rounded-xl bg-[#11151d] border border-white/[0.07] space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs font-mono">
              <span className="text-[#ece7df] font-semibold">Natural-Language Musical Director</span>
              {audioDspEngine.canUndoDirectorPatch() && (
                <button
                  type="button"
                  onClick={handleUndoDirection}
                  className="px-2.5 py-1 rounded-md bg-[#1e2432] hover:bg-[#272f40] text-[#c9b18a] flex items-center gap-1"
                >
                  <Undo2 className="w-3 h-3" />
                  <span>Undo Last Direction</span>
                </button>
              )}
            </div>
            <form onSubmit={handleApplyMusicalDirection} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={directorInput}
                onChange={(e) => setDirectorInput(e.target.value)}
                placeholder="e.g., Make it warmer and slower with deeper reverb and softer hats..."
                className="flex-1 bg-[#161b25] border border-white/[0.09] rounded-lg px-3 py-2 text-xs text-[#ece7df] placeholder:text-[#7c7972] focus:outline-none focus:border-[#c9b18a]/60"
              />
              <button
                type="submit"
                disabled={isDirecting || !directorInput.trim()}
                className="px-4 py-2 rounded-lg bg-[#c9b18a] hover:bg-[#d5bf9b] text-[#11151d] text-xs font-semibold whitespace-nowrap disabled:opacity-50"
              >
                {isDirecting ? 'Directing...' : 'Apply Direction'}
              </button>
            </form>
            {(directorStatus || directorError || motifError) && (
              <div
                className={`text-[11px] font-mono ${
                  directorError || motifError ? 'text-[#e5a8a3]' : 'text-[#a3c2bc]'
                }`}
              >
                {directorError || motifError || directorStatus}
              </div>
            )}
          </div>
        </div>

        {/* Google Lyria 3 Live Flow Hybrid Bus (lyria-3-clip-preview · Purely Instrumental Equal-Power Blend) */}
        <div className="p-4 rounded-xl bg-[#11151d] border border-white/[0.08] space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#ece7df]">
                <Sparkles className="w-4 h-4 text-[#c9b18a]" />
                <span>Google Lyria 3 Live Flow · Purely Instrumental Hybrid Blend</span>
                <span className="text-[11px] font-mono text-[#9c9991]">
                  lyria-3-clip-preview · Dual-Deck Equal-Power Crossfade
                </span>
              </div>
              <p className="text-[11px] font-mono text-[#9c9991]">
                {lyriaState.activePromptSummary
                  ? `Active Cycle #${lyriaState.clipCount} (Deck ${lyriaState.activeDeck ?? '—'}): ${lyriaState.activePromptSummary}`
                  : 'Seamlessly crossfades 30s instrumental Lyria clips into your live 24-telemetry synthesizer with automatic Seer voice ducking.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0 text-xs font-mono">
              <button
                type="button"
                onClick={() => audioDspEngine.setLyriaFlowEnabled(!lyriaState.enabled)}
                aria-pressed={lyriaState.enabled}
                className={`px-3 py-1.5 rounded-lg border flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  lyriaState.enabled
                    ? 'bg-[#202530] border-[#7fa898]/50 text-[#a3c2bc]'
                    : 'bg-[#161b25] border-white/[0.09] text-[#c7c2b8] hover:text-[#ece7df]'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-[#c9b18a]" />
                <span>{lyriaState.enabled ? 'Lyria Clip Live: On' : 'Lyria Clip Live: Off'}</span>
              </button>
              <button
                type="button"
                onClick={() => void audioDspEngine.forceEvolveLyriaClip()}
                disabled={
                  !seqStatus.isPlaying ||
                  lyriaState.status === 'generating' ||
                  lyriaState.status === 'crossfading'
                }
                className="px-3 py-1.5 rounded-lg bg-[#161b25] border border-white/[0.09] hover:border-[#c9b18a]/50 text-[#e6d5b8] flex items-center gap-1.5 whitespace-nowrap disabled:opacity-45"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-[#c9b18a] ${
                    lyriaState.status === 'generating' || lyriaState.status === 'crossfading'
                      ? 'animate-spin'
                      : ''
                  }`}
                />
                <span>Evolve Clip Now</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-white/[0.06]">
            <div className="flex items-center gap-3 flex-1 max-w-md text-xs font-mono tabular-nums">
              <span className="text-[#9c9991] whitespace-nowrap">Live Synth</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={lyriaState.blend}
                onChange={(e) => audioDspEngine.setLyriaFlowBlend(Number(e.target.value))}
                aria-label="Live Synth to Google Lyria Flow Blend"
                className="flex-1 accent-[#7fa898] cursor-pointer h-1.5 bg-[#202634] rounded-lg"
              />
              <span className="text-[#c9b18a] whitespace-nowrap">
                Lyria {Math.round(lyriaState.blend * 100)}%
              </span>
            </div>

            <div className="text-[11px] font-mono text-[#a3c2bc]">
              {!lyriaState.enabled
                ? 'Standby · 100% Live 24-Telemetry WebAudio Synth'
                : !seqStatus.isPlaying
                  ? 'Armed · Start Endless Flow to stream Lyria clips'
                  : lyriaState.status === 'generating'
                    ? 'Generating initial Lyria 3 clip (live synth active)...'
                    : lyriaState.status === 'crossfading'
                      ? 'Crossfading next telemetry-synced Lyria clip...'
                      : lyriaState.status === 'playing'
                        ? `Playing Deck ${lyriaState.activeDeck} · Equal-power blend active`
                        : 'Lyria stream paused on error · live synth unaffected'}
            </div>
          </div>

          {lyriaState.errorMessage && (
            <div className="text-xs font-mono text-[#e5a8a3] pt-0.5">
              {lyriaState.errorMessage}
            </div>
          )}
        </div>

        {/* Continuous Flow Wave Monitor */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono">
            <span>Continuous Flow Wave Monitor (Evolving Indefinitely Beyond Bar 32)</span>
            <span>Intro → Groove → Poly-Build → Climax → Breakdown → Endless Waves</span>
          </div>
          <div className="grid grid-cols-16 sm:grid-cols-32 gap-1 bg-[#11151d] p-3 rounded-xl border border-white/[0.07]">
            {compositionPlan.bars.map((bar) => {
              const isCurrent =
                seqStatus.isPlaying && ((seqStatus.currentBar - 1) % 32) === bar.barIndex;
              return (
                <div
                  key={bar.barIndex}
                  title={`Bar ${bar.barIndex + 1} · ${bar.section} · ${bar.chordSymbol}${bar.isFillBar ? ' (Fill)' : ''} · Energy ${Math.round(bar.energy * 100)}% · ${bar.events.length} events`}
                  className={`flex flex-col items-center justify-end h-16 rounded px-0.5 py-1 border transition-colors ${
                    isCurrent
                      ? 'border-[#c8b28e]/80 bg-[#272b35]'
                      : bar.isFillBar
                        ? 'border-[#c8b28e]/25 bg-[#181d27]'
                        : 'border-white/[0.05] bg-[#151a23]'
                  }`}
                >
                  <div
                    className={`w-full rounded-sm ${
                      bar.section === 'Climax'
                        ? 'bg-[#c9a977]'
                        : bar.section === 'Poly-Build'
                          ? 'bg-[#948fb0]'
                          : bar.section === 'Breakdown'
                            ? 'bg-[#7fa898]'
                            : 'bg-[#6e949c]'
                    }`}
                    style={{ height: `${Math.max(15, bar.energy * 100)}%` }}
                  />
                  <span className="text-[9px] font-mono text-[#8e8b83] mt-1 tabular-nums">
                    {bar.barIndex + 1}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 10-Voice Stereo Studio Mixer + FM Synthesis */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 10-Voice Stereo Studio Mixer & Audition Rack (7 cols) */}
          <div className="lg:col-span-7 p-5 rounded-xl bg-[#11151d] border border-white/[0.07] space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[#ece7df]">10-Voice Stereo Studio Mixer</h3>
                <p className="text-[11px] font-mono text-[#9c9991]">
                  Click any voice name to audition · live gain, stereo pan &amp; mute
                </p>
              </div>
              <button
                onClick={() => audioDspEngine.resetVoiceMix()}
                className="px-2.5 py-1 rounded-lg bg-[#161b25] border border-white/[0.09] hover:border-white/[0.18] text-[11px] font-mono text-[#d7d2c8] flex items-center gap-1.5 shrink-0"
              >
                <RefreshCw className="w-3 h-3 text-[#c8b28e]" />
                <span>Reset Mix</span>
              </button>
            </div>

            <div className="space-y-4">
              {VOICE_GROUPS.map((group) => {
                const voices = ALL_SYNTH_VOICES.filter((v) => v.group === group.id);
                return (
                  <div key={group.id} className="space-y-2">
                    <div className="text-[11px] font-mono text-[#9c9991] uppercase tracking-wider">
                      {group.label}
                    </div>
                    <div className="space-y-2">
                      {voices.map((voice) => {
                        const ch = voiceMix[voice.id] || {
                          gain: voice.defaultGain,
                          pan: voice.defaultPan,
                          muted: false
                        };
                        const triggeredRecently =
                          nowTickMs - (seqStatus.activeVoices[voice.id as SynthVoiceId] || 0) < 220;
                        return (
                          <div
                            key={voice.id}
                            className={`px-3 py-2.5 rounded-lg border transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                              ch.muted
                                ? 'bg-[#161b25]/50 border-white/[0.05] opacity-60'
                                : triggeredRecently
                                  ? 'bg-[#22252d] border-[#c8b28e]/50'
                                  : 'bg-[#161b25] border-white/[0.07]'
                            }`}
                          >
                            <button
                              onClick={() => audioDspEngine.auditionVoice(voice.id, compositionPlan)}
                              className="text-left min-w-0 flex-1 group"
                              title={`Audition ${voice.label}`}
                            >
                              <div className="text-xs font-semibold text-[#ece7df] group-hover:text-[#d8c4a1] truncate flex items-center gap-2">
                                <span>{voice.label}</span>
                                <span className="text-[10px] font-mono text-[#c8b28e]">
                                  {triggeredRecently ? 'ACTIVE' : 'AUDITION'}
                                </span>
                              </div>
                              <div className="text-[11px] font-mono text-[#9c9991] truncate">
                                {voice.telemetryRole}
                              </div>
                            </button>

                            <div className="flex items-center gap-3 shrink-0">
                              <div className="w-24 space-y-0.5">
                                <div className="flex justify-between text-[10px] font-mono tabular-nums text-[#9c9991]">
                                  <span>Vol</span>
                                  <span>{Math.round(ch.gain * 100)}%</span>
                                </div>
                                <input
                                  type="range"
                                  min={0}
                                  max={1.25}
                                  step={0.02}
                                  value={ch.gain}
                                  aria-label={`${voice.label} volume`}
                                  onChange={(e) =>
                                    audioDspEngine.setVoiceMixChannel(voice.id, {
                                      gain: Number(e.target.value)
                                    })
                                  }
                                  className="w-full accent-[#7fa898] cursor-pointer h-1.5 bg-[#202634] rounded-lg"
                                />
                              </div>

                              <div className="w-20 space-y-0.5">
                                <div className="flex justify-between text-[10px] font-mono tabular-nums text-[#9c9991]">
                                  <span>Pan</span>
                                  <span>{formatPanLabel(ch.pan)}</span>
                                </div>
                                <input
                                  type="range"
                                  min={-1}
                                  max={1}
                                  step={0.05}
                                  value={ch.pan}
                                  aria-label={`${voice.label} pan`}
                                  onChange={(e) =>
                                    audioDspEngine.setVoiceMixChannel(voice.id, {
                                      pan: Number(e.target.value)
                                    })
                                  }
                                  className="w-full accent-[#c8b28e] cursor-pointer h-1.5 bg-[#202634] rounded-lg"
                                />
                              </div>

                              <button
                                onClick={() =>
                                  audioDspEngine.setVoiceMixChannel(voice.id, {
                                    muted: !ch.muted
                                  })
                                }
                                aria-label={ch.muted ? `Unmute ${voice.label}` : `Mute ${voice.label}`}
                                className={`p-1.5 rounded-md border transition-colors ${
                                  ch.muted
                                    ? 'bg-[#2a1d1f] border-[#b47670]/55 text-[#d8a39d]'
                                    : 'bg-[#11151d] border-white/[0.09] text-[#b5b0a6] hover:text-[#ece7df]'
                                }`}
                              >
                                {ch.muted ? (
                                  <VolumeX className="w-3.5 h-3.5" />
                                ) : (
                                  <Volume2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* FM Synthesis Engine (5 cols) */}
          <div className="lg:col-span-5 p-5 rounded-xl bg-[#11151d] border border-white/[0.07] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#ece7df]">FM Synthesis Matrix</h3>
              <span className="text-xs font-mono tabular-nums text-[#b2acc9]">
                FM_MOD: {liveFm.fmModIndex.toFixed(2)} · Ratio 1:{liveFm.modRatio}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono tabular-nums text-[#c7c2b8]">
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
                  className="w-full accent-[#9a93b8] cursor-pointer h-1.5 bg-[#202634] rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono tabular-nums text-[#c7c2b8]">
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
                  className="w-full accent-[#9a93b8] cursor-pointer h-1.5 bg-[#202634] rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono tabular-nums text-[#c7c2b8]">
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
                  className="w-full accent-[#9a93b8] cursor-pointer h-1.5 bg-[#202634] rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono tabular-nums text-[#c7c2b8]">
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
                  className="w-full accent-[#9a93b8] cursor-pointer h-1.5 bg-[#202634] rounded-lg"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 6-Slot Environmental FX Rack */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#ece7df]">6-Slot Environmental Telemetry FX Rack</h3>
            <span className="text-xs font-mono text-[#9c9991]">
              Distortion → Filter → Modulation → Delay → Reverb → Compressor
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {activeFxSlots.map((slot) => (
              <div
                key={slot.id}
                className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition-opacity ${
                  slot.bypass
                    ? 'bg-[#11151d]/55 border-white/[0.05] opacity-60'
                    : 'bg-[#11151d] border-white/[0.07]'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-[#a3c2bc]">
                      FX_0{slot.slotNumber}
                    </span>
                    <button
                      onClick={() => handleUpdateFxSlot(slot.id, { bypass: !slot.bypass })}
                      className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                        slot.bypass
                          ? 'border-white/[0.09] text-[#9c9991]'
                          : 'border-[#7fa898]/45 text-[#9bc0b1] bg-[#1a2523]'
                      }`}
                    >
                      {slot.bypass ? 'BYPASS' : 'ACTIVE'}
                    </button>
                  </div>
                  <div className="text-sm font-semibold text-[#ece7df]">{slot.name}</div>
                  <div className="text-[11px] font-mono text-[#9c9991] truncate">
                    {slot.telemetrySource}
                  </div>
                </div>

                <div className="space-y-2.5 pt-1">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono tabular-nums text-[#c7c2b8]">
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
                      className="w-full accent-[#7fa898] cursor-pointer h-1.5 bg-[#202634] rounded-lg"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono tabular-nums text-[#c7c2b8]">
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
                      className="w-full accent-[#9a93b8] cursor-pointer h-1.5 bg-[#202634] rounded-lg"
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
        <div className="p-6 rounded-2xl bg-[#161b25] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between text-sm text-[#c7c2b8] font-medium">
            <span>Peak Amplitude</span>
            <span className="text-xs font-mono text-[#a3c2bc]">dBFS</span>
          </div>
          <div className="text-3xl font-bold font-mono text-[#ece7df] tabular-nums tracking-tight">
            {metrics.peakDb.toFixed(1)} dB
          </div>
          <div className="w-full h-2.5 bg-[#202634] rounded-full overflow-hidden p-0.5">
            <div
              className="h-full bg-gradient-to-r from-[#6c9487] via-[#8ea9a6] to-[#c8a97e] rounded-full transition-all duration-75"
              style={{ width: `${Math.min(100, Math.max(0, (metrics.peakDb + 60) * 1.66))}%` }}
            />
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-[#161b25] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between text-sm text-[#c7c2b8] font-medium">
            <span>RMS Level</span>
            <span className="text-xs font-mono text-[#b2acc9]">dBFS</span>
          </div>
          <div className="text-3xl font-bold font-mono text-[#ece7df] tabular-nums tracking-tight">
            {metrics.rmsDb.toFixed(1)} dB
          </div>
          <div className="w-full h-2.5 bg-[#202634] rounded-full overflow-hidden p-0.5">
            <div
              className="h-full bg-[#8f89ab] rounded-full transition-all duration-75"
              style={{ width: `${Math.min(100, Math.max(0, (metrics.rmsDb + 60) * 1.66))}%` }}
            />
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-[#161b25] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between text-sm text-[#c7c2b8] font-medium">
            <span>Spectral Centroid</span>
            <span className="text-xs font-mono text-[#c8b28e]">Hz</span>
          </div>
          <div className="text-3xl font-bold font-mono text-[#ece7df] tabular-nums tracking-tight">
            {metrics.spectralCentroidHz} Hz
          </div>
          <div className="text-xs text-[#b5b0a6] font-mono pt-1">
            Pitch: <span className="text-[#a3c2bc] font-semibold">{metrics.detectedPitchHz} Hz (A4)</span>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-[#161b25] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between text-sm text-[#c7c2b8] font-medium">
            <span>Integrated Loudness</span>
            <span className="text-xs font-mono text-[#c59a97]">LUFS</span>
          </div>
          <div className="text-3xl font-bold font-mono text-[#ece7df] tabular-nums tracking-tight">
            {metrics.lufsLoudness.toFixed(1)} LUFS
          </div>
          <div className="text-xs text-[#b5b0a6] font-mono pt-1">
            Target: <span className="text-[#ece7df] font-semibold">-14.0 LUFS (Master)</span>
          </div>
        </div>
      </div>

      {/* EXISTING 32-BAND FFT FREQUENCY SPECTRUM VISUALIZER (PRESERVED) */}
      <div className="bg-[#161b25] border border-white/[0.08] rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.07]">
          <div>
            <h2 className="text-base font-semibold text-[#ece7df] flex items-center gap-2.5">
              <Activity className="w-5 h-5 text-[#9a93b8]" />
              <span>32-Band FFT Frequency Spectrum Analyzer</span>
            </h2>
            <p className="text-xs text-[#9c9991] mt-1 font-mono">
              High-resolution spectral distribution extracted via Audio DSP thread
            </p>
          </div>

          <div className="flex items-center gap-6 text-sm font-mono text-[#c7c2b8] bg-[#11151d] px-4 py-2 rounded-xl border border-white/[0.07]">
            <span>
              Sample Rate: <span className="text-[#a3c2bc] font-semibold">{metrics.sampleRate} Hz</span>
            </span>
            <span>
              Block Size: <span className="text-[#b2acc9] font-semibold">{metrics.bufferSize}</span>
            </span>
          </div>
        </div>

        <div className="h-48 flex items-end justify-between gap-1.5 pt-4">
          {metrics.fftSpectrum32.map((amp, idx) => (
            <div key={idx} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
              <div className="w-full bg-[#1a202c] rounded-t-lg overflow-hidden flex flex-col justify-end h-full">
                <div
                  className="w-full bg-gradient-to-t from-[#506b76] via-[#749a9e] to-[#c8b28e] transition-all duration-75 rounded-t-lg"
                  style={{ height: `${Math.max(6, amp * 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-[#8e8b83] group-hover:text-[#dcd7cd] tabular-nums">
                {idx + 1}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* EXISTING INTERACTIVE OSCILLATOR PITCH CONTROL (PRESERVED) */}
      <div className="bg-[#161b25] border border-white/[0.08] rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-[#ece7df] flex items-center gap-2.5">
            <Music className="w-5 h-5 text-[#c8b28e]" />
            <span>Synth Frequency Modulation: {synthFreq} Hz</span>
          </label>
          <span className="text-xs font-mono text-[#9c9991]">20 Hz - 2000 Hz</span>
        </div>

        <input
          type="range"
          min="100"
          max="1200"
          value={synthFreq}
          onChange={(e) => handleFreqChange(Number(e.target.value))}
          className="w-full accent-[#9a93b8] cursor-pointer h-2 bg-[#202634] rounded-lg"
        />

        <div className="flex items-center justify-between text-xs font-mono text-[#a6a29a] pt-2">
          <button onClick={() => handleFreqChange(220)} className="hover:text-[#ece7df] font-medium px-3 py-1 bg-[#1e2432] rounded-lg">
            A3 (220Hz)
          </button>
          <button onClick={() => handleFreqChange(440)} className="hover:text-[#ece7df] font-semibold text-[#c8b28e] px-3 py-1 bg-[#1e2432] rounded-lg">
            A4 (440Hz)
          </button>
          <button onClick={() => handleFreqChange(880)} className="hover:text-[#ece7df] font-medium px-3 py-1 bg-[#1e2432] rounded-lg">
            A5 (880Hz)
          </button>
        </div>
      </div>

      {/* STAGE 3: OUTPUT (PRODUCT — 320KBPS MP3, SEPARATED WAV STEMS, ID3v2.3 & PROCEDURAL COVER ART) */}
      <section className="bg-[#161b25] border border-white/[0.08] rounded-2xl p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-white/[0.07]">
          <div>
            <h2 className="text-lg font-semibold text-[#ece7df] flex items-center gap-2.5">
              <Disc3 className="w-5 h-5 text-[#7fa898]" />
              <span>03. Output Stage — Endless Session Master, WAV Stems &amp; ID3v2.3 Release</span>
            </h2>
            <p className="text-xs text-[#9c9991] mt-1 font-mono">
              OfflineAudioContext 48000 Hz · 320kbps CBR MP3 · ID3v2.3 Tags + Embedded Cover Art · 5 Stereo RIFF WAV Stems
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 bg-[#11151d] p-1 rounded-xl border border-white/[0.08] text-xs font-mono">
              {[
                { sec: 60, label: '1 min' },
                { sec: 120, label: '2 min' },
                { sec: 240, label: '4 min' }
              ].map((opt) => (
                <button
                  key={opt.sec}
                  type="button"
                  onClick={() => setExportDurationSec(opt.sec)}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors ${
                    exportDurationSec === opt.sec
                      ? 'bg-[#c9b18a] text-[#11151d] font-semibold'
                      : 'text-[#b5b0a6] hover:text-[#ece7df]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              onClick={handleRenderBundle}
              disabled={isRendering}
              className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-[#7fa898] hover:bg-[#8eb5a5] text-[#11151d] transition-colors flex items-center gap-2 whitespace-nowrap disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              <span>
                {isRendering
                  ? `Rendering ${Math.round(exportDurationSec / 60)}m Session...`
                  : `Render ${Math.round(exportDurationSec / 60)}m Master & Stems`}
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* AI & Procedural Cover Art Preview (4 cols) */}
          <div className="lg:col-span-4 space-y-3">
            <div className="aspect-square w-full rounded-xl overflow-hidden border border-white/[0.08] bg-[#11151d] flex items-center justify-center">
              {(useAiCoverArt && aiReleaseKit?.coverArtDataUrl) || previewCover.dataUrl ? (
                <img
                  src={
                    useAiCoverArt && aiReleaseKit?.coverArtDataUrl
                      ? aiReleaseKit.coverArtDataUrl
                      : previewCover.dataUrl
                  }
                  alt="Weather Beats Session Cover Art"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-xs font-mono text-[#9c9991]">Cover Art Canvas</div>
              )}
            </div>

            <button
              type="button"
              onClick={handleGenerateReleaseKit}
              disabled={isGeneratingReleaseKit}
              className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-[#c9b18a] hover:bg-[#d5bf9b] text-[#11151d] transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>
                {isGeneratingReleaseKit
                  ? 'Generating AI Cover & Liner Notes...'
                  : 'Generate AI Cover Art & Liner Notes'}
              </span>
            </button>

            {aiReleaseKit?.coverArtDataUrl && (
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setUseAiCoverArt(true)}
                  className={`flex-1 py-1.5 rounded-lg border ${
                    useAiCoverArt
                      ? 'bg-[#202532] border-[#c9b18a]/50 text-[#ece7df]'
                      : 'bg-[#11151d] border-white/[0.08] text-[#9c9991]'
                  }`}
                >
                  AI Cover
                </button>
                <button
                  type="button"
                  onClick={() => setUseAiCoverArt(false)}
                  className={`flex-1 py-1.5 rounded-lg border ${
                    !useAiCoverArt
                      ? 'bg-[#202532] border-[#c9b18a]/50 text-[#ece7df]'
                      : 'bg-[#11151d] border-white/[0.08] text-[#9c9991]'
                  }`}
                >
                  Procedural
                </button>
              </div>
            )}

            {releaseKitError && (
              <div className="text-xs font-mono text-[#e5a8a3]">{releaseKitError}</div>
            )}

            {((useAiCoverArt && aiReleaseKit?.coverArtDataUrl) || previewCover.dataUrl) && (
              <button
                type="button"
                onClick={() =>
                  triggerDownload(
                    useAiCoverArt && aiReleaseKit?.coverArtDataUrl
                      ? aiReleaseKit.coverArtDataUrl
                      : previewCover.dataUrl,
                    `${id3Meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'weather-beats'}-cover.jpg`
                  )
                }
                className="w-full py-2 text-xs font-medium rounded-lg bg-[#11151d] hover:bg-[#1e2432] text-[#d7d2c8] border border-white/[0.09] transition-colors"
              >
                Download Cover Artwork
              </button>
            )}
          </div>

          {/* ID3 Metadata Form + Session Liner Notes + Render Progress + Export Buttons (8 cols) */}
          <div className="lg:col-span-8 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1 text-xs font-mono text-[#b5b0a6]">
                <span>ID3 Title (TIT2)</span>
                <input
                  type="text"
                  value={id3Meta.title}
                  onChange={(e) => setId3Meta((m) => ({ ...m, title: e.target.value }))}
                  className="w-full bg-[#11151d] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-[#ece7df] font-sans focus:outline-none focus:border-[#c8b28e]/60"
                />
              </label>

              <label className="space-y-1 text-xs font-mono text-[#b5b0a6]">
                <span>ID3 Artist (TPE1)</span>
                <input
                  type="text"
                  value={id3Meta.artist}
                  onChange={(e) => setId3Meta((m) => ({ ...m, artist: e.target.value }))}
                  className="w-full bg-[#11151d] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-[#ece7df] font-sans focus:outline-none focus:border-[#c8b28e]/60"
                />
              </label>

              <label className="space-y-1 text-xs font-mono text-[#b5b0a6]">
                <span>ID3 Album (TALB)</span>
                <input
                  type="text"
                  value={id3Meta.album}
                  onChange={(e) => setId3Meta((m) => ({ ...m, album: e.target.value }))}
                  className="w-full bg-[#11151d] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-[#ece7df] font-sans focus:outline-none focus:border-[#c8b28e]/60"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-xs font-mono text-[#b5b0a6]">
                  <span>Telemetry Signature</span>
                  <input
                    type="text"
                    value={id3Meta.genre}
                    onChange={(e) => setId3Meta((m) => ({ ...m, genre: e.target.value }))}
                    className="w-full bg-[#11151d] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-[#ece7df] font-sans focus:outline-none focus:border-[#c8b28e]/60"
                  />
                </label>

                <label className="space-y-1 text-xs font-mono text-[#b5b0a6]">
                  <span>Year (TYER)</span>
                  <input
                    type="text"
                    value={id3Meta.year}
                    onChange={(e) => setId3Meta((m) => ({ ...m, year: e.target.value }))}
                    className="w-full bg-[#11151d] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-[#ece7df] font-mono focus:outline-none focus:border-[#c8b28e]/60"
                  />
                </label>
              </div>
            </div>

            <label className="block space-y-1 text-xs font-mono text-[#b5b0a6]">
              <span>Session Liner Notes (Embedded in ID3 Comment)</span>
              <textarea
                rows={2}
                value={linerNotes}
                onChange={(e) => setLinerNotes(e.target.value)}
                placeholder="Click 'Generate AI Cover Art & Liner Notes' or write custom session notes..."
                className="w-full bg-[#11151d] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-[#ece7df] font-sans focus:outline-none focus:border-[#c8b28e]/60"
              />
            </label>

            {(isRendering || renderedBundle) && (
              <div className="p-4 rounded-xl bg-[#11151d] border border-white/[0.07] space-y-3">
                <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className="text-[#9bc0b1]">{renderStageText || 'Ready'}</span>
                  <span className="text-[#ece7df]">{renderProgress}%</span>
                </div>
                <div className="w-full h-2 bg-[#202634] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#7fa898] transition-all duration-150"
                    style={{ width: `${renderProgress}%` }}
                  />
                </div>
              </div>
            )}

            {renderedBundle && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#11151d] border border-white/[0.07] space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#ece7df]">
                        Master Release · 320kbps MP3 (ID3v2.3 + Embedded Art)
                      </div>
                      <div className="text-xs font-mono text-[#9c9991] tabular-nums">
                        {renderedBundle.durationSec}s · {renderedBundle.bpm} BPM · {(renderedBundle.mp3SizeBytes / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    <button
                      onClick={() => triggerDownload(renderedBundle.mp3Url, renderedBundle.mp3FileName)}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#c9b18a] hover:bg-[#d5bf9b] text-[#11151d] flex items-center gap-2 whitespace-nowrap"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download 320kbps MP3</span>
                    </button>
                  </div>

                  {auditionUrl && (
                    <audio controls src={auditionUrl} className="w-full h-10" />
                  )}
                </div>

                {/* Separated WAV Stems */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {renderedBundle.stems.map((stem) => (
                    <div
                      key={stem.id}
                      className="p-3.5 rounded-xl bg-[#11151d] border border-white/[0.07] flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#ece7df] truncate">{stem.label}</div>
                        <div className="text-[11px] font-mono text-[#9c9991] tabular-nums">
                          16-bit 48kHz WAV · {(stem.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setAuditionUrl(stem.wavUrl)}
                          className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#1e2432] hover:bg-[#272f40] text-[#dcd7cd]"
                        >
                          Audition
                        </button>
                        <button
                          onClick={() => triggerDownload(stem.wavUrl, stem.fileName)}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-[#7d7798] hover:bg-[#8d87a8] text-[#11151d]"
                        >
                          WAV
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Google Lyria Pro Full-Length Studio Track (lyria-3-pro-preview) */}
            <div className="p-4 rounded-xl bg-[#11151d] border border-[#c9b18a]/25 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-[#ece7df] flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#c9b18a]" />
                    <span>Google Lyria Pro Studio Track</span>
                    <span className="text-[11px] font-mono text-[#9c9991]">
                      lyria-3-pro-preview
                    </span>
                  </div>
                  <p className="text-xs text-[#9c9991]">
                    Render a full-length purely instrumental studio track conditioned on Hour{' '}
                    {compositionPlan.activeTelemetryHour.hourLabel} (
                    {compositionPlan.activeTelemetryHour.mapping.instrument}), {compositionPlan.bpm} BPM{' '}
                    {compositionPlan.scaleName}
                    {useAiCoverArt && aiReleaseKit?.coverArtDataUrl
                      ? ', and your session AI Cover Art.'
                      : '.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleRenderLyriaProTrack}
                  disabled={isRenderingLyriaPro}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#c9b18a] hover:bg-[#d5bf9b] text-[#11151d] flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors disabled:opacity-60"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {isRenderingLyriaPro
                      ? 'Rendering Lyria Pro...'
                      : 'Render Full-Length Lyria Pro Track'}
                  </span>
                </button>
              </div>

              {lyriaProError && (
                <div className="text-xs font-mono text-[#e5a8a3]">{lyriaProError}</div>
              )}

              {lyriaProTrack && (
                <div className="pt-2 border-t border-white/[0.07] space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono">
                    <span className="text-[#a3c2bc] truncate">
                      {lyriaProTrack.promptSummary}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        triggerDownload(
                          lyriaProTrack.audioDataUrl,
                          `${id3Meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'weather-beats'}-lyria-pro.mp3`
                        )
                      }
                      className="px-3.5 py-1.5 rounded-lg bg-[#7fa898] hover:bg-[#8eb5a5] text-[#11151d] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Lyria Pro MP3</span>
                    </button>
                  </div>
                  <audio controls src={lyriaProTrack.audioDataUrl} className="w-full h-10" />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
