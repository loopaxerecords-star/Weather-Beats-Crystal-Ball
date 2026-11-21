import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  Settings,
  Play,
  Square,
  MapPin,
  ChevronDown,
  ChevronUp,
  Mic,
  MicOff,
  AudioLines,
  Volume2,
  VolumeX,
  Send,
  RotateCcw,
  Waves,
  Radio,
  Undo2,
  Sparkles
} from 'lucide-react';
import { DomainCategory } from '../types/telemetry';
import { ALL_DOMAINS_LIST, UNIVERSAL_DOMAINS } from '../services/domainRegistry';
import { GeolocationWeatherContext, telemetryEngine } from '../services/telemetryEngine';
import {
  audioDspEngine,
  createVoiceHighPass250Hz16dB,
  LyriaFlowEngineState,
  SequencerPlaybackStatus
} from '../services/audioDspEngine';
import {
  build32BarComposition,
  computeDomainVector24
} from '../services/weatherBeatsComposer';
import { queryVoiceTelemetryOracle } from '../services/geminiService';
import { VoiceQueryResult } from '../services/voiceTelemetryOracle';
import {
  addSmartAlertRule,
  classifyCrystalBallPrompt,
  compileSmartAlertRule,
  deriveWeatherVoiceStyle,
  evaluateSmartAlertRules,
  loadSmartAlertRules,
  requestMusicalDirection,
  SmartAlertRule,
  subscribeSmartAlertRules
} from '../services/aiIntelligenceSuite';
import {
  liveSeerVoiceClient,
  LiveVoiceConnectionState
} from '../services/liveSeerVoiceClient';
import {
  SINGULARITY_VERTEX_SHADER,
  SINGULARITY_FRAGMENT_SHADER,
  NEBULA_VERTEX_SHADER,
  NEBULA_FRAGMENT_SHADER,
  AURA_VERTEX_SHADER,
  AURA_FRAGMENT_SHADER,
  createAstrolabeRuneRingTexture,
  createBrushedBrassRoughnessTexture,
  createSoftGlowSpriteTexture,
  updateArcSegmentsBuffer
} from '../services/crystalBallVisuals';
import {
  CRYSTAL_BALL_POS_X,
  CRYSTAL_BALL_POS_Y,
  CRYSTAL_BALL_POS_Z,
  CRYSTAL_BALL_SCALE,
  SeerAnimationSignals,
  StagedAnimationWeights,
  buildFortuneTellerParlorRig,
  computeStagedAnimationWeights
} from '../services/fortuneTellerRig';
import {
  CelestialBackdropSignals,
  TELEMETRY_ANOMALY_DEVIATION_THRESHOLD,
  buildCelestialBackdropUi
} from '../services/celestialBackdropUi';
import { SeerWhisperEvent } from '../services/seerWhisperComposer';
import { useMicAudioVisualizer } from '../hooks/useMicAudioVisualizer';

interface CrystalBallExperienceProps {
  focusedDomain: 'all' | DomainCategory;
  onChangeFocusedDomain: (domain: 'all' | DomainCategory) => void;
  voiceReplyEnabled: boolean;
  onToggleVoiceReply: () => void;
  onOpenSettings: () => void;
  voiceTriggerNonce?: number;
  onOracleResult?: (result: VoiceQueryResult) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface HoverReadout {
  index: number;
  domainId: DomainCategory;
  name: string;
  formattedValue: string;
  normalizedPct: number;
  screenX: number;
  screenY: number;
  isAnomaly?: boolean;
}

const DOMAIN_INDEX_MAP = new Map<DomainCategory, number>(
  ALL_DOMAINS_LIST.map((d, idx) => [d.id, idx])
);

// Reusable module-scope Three.js math objects (zero GC in animation loop)
const _dummyObj = new THREE.Object3D();
const _tempColor = new THREE.Color();
const _pointerNdc = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();
const _gemPos = new THREE.Vector3();
const _nextGemPos = new THREE.Vector3();
const _projVec = new THREE.Vector3();

function formatSpokenUnit(unit: string): string {
  switch (unit) {
    case '°C':
      return 'degrees Celsius';
    case 'µg/m³':
      return 'micrograms per cubic meter';
    case 'hPa':
      return 'hectopascals';
    case 'm/s':
      return 'meters per second';
    case 'km/h':
      return 'kilometers per hour';
    case 'tok/s':
      return 'tokens per second';
    case '%':
      return 'percent';
    case 'kW':
      return 'kilowatts';
    case 'W/m²':
      return 'watts per square meter';
    case 'ms':
      return 'milliseconds';
    case 'BPM':
      return 'beats per minute';
    default:
      return unit;
  }
}

export const CrystalBallExperience: React.FC<CrystalBallExperienceProps> = ({
  focusedDomain,
  onChangeFocusedDomain,
  voiceReplyEnabled,
  onToggleVoiceReply,
  onOpenSettings,
  voiceTriggerNonce = 0,
  onOracleResult
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const typedInputRef = useRef<HTMLInputElement | null>(null);

  // Dedicated live microphone audio-visualizer hook (strictly zero-feedback AnalyserNode)
  const {
    isActive: isMicVisualizerActive,
    permissionError: micVisualizerError,
    start: startMicVisualizer,
    stop: stopMicVisualizer,
    clearError: clearMicVisualizerError,
    sampleMetrics: sampleMicMetrics
  } = useMicAudioVisualizer();
  const [isVisualizerPinned, setIsVisualizerPinned] = useState(false);
  const isVisualizerPinnedRef = useRef(false);
  isVisualizerPinnedRef.current = isVisualizerPinned;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptDraftRef = useRef<string>('');

  const speechAudioCtxRef = useRef<AudioContext | null>(null);
  const speechAnalyserRef = useRef<AnalyserNode | null>(null);
  const speechSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const speechFallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechBufferRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(new ArrayBuffer(256 * 4)));
  const isSynthSpeakingRef = useRef<boolean>(false);

  const [webglFailed, setWebglFailed] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(true);
  const [weatherCtx, setWeatherCtx] = useState<GeolocationWeatherContext>(() =>
    telemetryEngine.getWeatherContext()
  );
  const [latestByDomain, setLatestByDomain] = useState(() => telemetryEngine.getLatestByDomain());
  const [seqStatus, setSeqStatus] = useState<SequencerPlaybackStatus>(() =>
    audioDspEngine.getSequencerStatus()
  );
  const [studioPrefsVersion, setStudioPrefsVersion] = useState(0);
  const [ambientWhispersEnabled, setAmbientWhispersEnabled] = useState<boolean>(() =>
    audioDspEngine.getAmbientWhispersEnabled()
  );
  const [lyriaState, setLyriaState] = useState<LyriaFlowEngineState>(() =>
    audioDspEngine.getLyriaFlowState()
  );
  const [activeWhisper, setActiveWhisper] = useState<SeerWhisperEvent | null>(() =>
    audioDspEngine.getActiveWhisper()
  );
  const [isSyncingWeather, setIsSyncingWeather] = useState(false);
  const [typedQuestion, setTypedQuestion] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const [oracleLoading, setOracleLoading] = useState(false);
  const [oracleResult, setOracleResult] = useState<VoiceQueryResult | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isSpeakingReply, setIsSpeakingReply] = useState(false);
  const [liveVoiceState, setLiveVoiceState] = useState<LiveVoiceConnectionState>(() =>
    liveSeerVoiceClient.getState()
  );
  const [liveVoiceError, setLiveVoiceError] = useState<string | null>(null);
  const [smartAlertRules, setSmartAlertRules] = useState<SmartAlertRule[]>(() =>
    loadSmartAlertRules()
  );
  const [pulseTimestamp, setPulseTimestamp] = useState<number>(0);
  const [hoverReadout, setHoverReadout] = useState<HoverReadout | null>(null);

  const focusedDomainRef = useRef(focusedDomain);
  focusedDomainRef.current = focusedDomain;

  const onChangeDomainRef = useRef(onChangeFocusedDomain);
  onChangeDomainRef.current = onChangeFocusedDomain;

  const voiceEnabledRef = useRef(voiceReplyEnabled);
  voiceEnabledRef.current = voiceReplyEnabled;

  const onOracleResultRef = useRef(onOracleResult);
  onOracleResultRef.current = onOracleResult;

  // Refs synced cleanly into the WebGL render loop without tearing down the canvas
  const liveStateRef = useRef({
    isPlayEngaged: false,
    energy: 0.36,
    bassEnergy: 0.25,
    micEnergy: 0,
    micActive: false,
    micBass: 0,
    micMid: 0,
    micTreble: 0,
    micPeakHold: 0,
    speakingEnergy: 0,
    swirlSpeed: 0.45,
    primaryHex: '#5b8fa8',
    secondaryHex: '#33416b',
    accentHex: '#c9a66b',
    runeOuterHex: '#c9a66b',
    runeInnerHex: '#7fa8b8',
    runeOpacityBoost: 0,
    runeScaleBoost: 0,
    domainNorms: new Array(24).fill(0.5) as number[],
    domainColors: ALL_DOMAINS_LIST.map((d) => d.colorHex),
    fftSpectrum32: new Float32Array(32),
    focusedIndex: -1,
    hoveredIndex: -1,
    pulseAge: 10,
    pointerNdcX: 0,
    pointerNdcY: 0
  });

  // Keyboard shortcut 'H' to toggle hidden controls dock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'h' && e.key !== 'H') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      setDockCollapsed((prev) => !prev);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const unsubTel = telemetryEngine.subscribe(() => {
      setLatestByDomain(telemetryEngine.getLatestByDomain());
      setWeatherCtx(telemetryEngine.getWeatherContext());
    });
    const unsubSeq = audioDspEngine.subscribeSequencer((status) => {
      setSeqStatus(status);
    });
    const unsubPrefs = audioDspEngine.subscribeStudioPreferences(() => {
      setAmbientWhispersEnabled(audioDspEngine.getAmbientWhispersEnabled());
      setStudioPrefsVersion((v) => v + 1);
    });
    const unsubWhisper = audioDspEngine.subscribeWhisper((evt) => {
      setActiveWhisper(evt);
    });
    const unsubLyria = audioDspEngine.subscribeLyriaFlow((state) => {
      setLyriaState(state);
    });
    const unsubAlerts = subscribeSmartAlertRules(() => {
      setSmartAlertRules(loadSmartAlertRules());
    });
    return () => {
      unsubTel();
      unsubSeq();
      unsubPrefs();
      unsubWhisper();
      unsubLyria();
      unsubAlerts();
    };
  }, []);

  const vector24 = useMemo(
    () => computeDomainVector24(latestByDomain, weatherCtx),
    [latestByDomain, weatherCtx]
  );

  const compositionPlan = useMemo(
    () => build32BarComposition(vector24, weatherCtx, audioDspEngine.getCompositionOptions()),
    [vector24, weatherCtx, studioPrefsVersion]
  );

  const smartAlertEval = useMemo(
    () => evaluateSmartAlertRules(smartAlertRules, { weather: weatherCtx, vector24 }),
    [smartAlertRules, weatherCtx, vector24]
  );

  useEffect(() => {
    audioDspEngine.setSmartAlertIntensityBias(smartAlertEval.activeIntensityBias);
  }, [smartAlertEval.activeIntensityBias]);

  const compositionPlanRef = useRef(compositionPlan);
  compositionPlanRef.current = compositionPlan;

  useEffect(() => {
    audioDspEngine.updateCompositionPlan(compositionPlan);
  }, [compositionPlan]);

  useEffect(() => {
    audioDspEngine.setWhisperTelemetryContext(vector24, weatherCtx, focusedDomain);
  }, [vector24, weatherCtx, focusedDomain]);

  useEffect(() => {
    audioDspEngine.setOracleSpeakingPriority(
      isSpeakingReply || isListening || oracleLoading || liveVoiceState === 'connected'
    );
  }, [isSpeakingReply, isListening, oracleLoading, liveVoiceState]);

  const vector24Ref = useRef(vector24);
  vector24Ref.current = vector24;

  // Trigger beat pulse subtly on bar change when 32-bar sequencer plays
  const prevBarRef = useRef<number>(seqStatus.currentBar);
  useEffect(() => {
    if (seqStatus.isPlaying && seqStatus.currentBar !== prevBarRef.current) {
      prevBarRef.current = seqStatus.currentBar;
      setPulseTimestamp(Date.now());
    }
  }, [seqStatus.isPlaying, seqStatus.currentBar]);

  // Continuous DSP + Microphone + Crystal Ball Speech RMS sampling
  useEffect(() => {
    let rafId = 0;
    const sampleSignals = () => {
      const dsp = audioDspEngine.processBlock();
      const spectrum = dsp.fftSpectrum32;
      const spectrumTarget = liveStateRef.current.fftSpectrum32;
      let fftSum = 0;
      let bassSum = 0;
      for (let i = 0; i < spectrum.length; i++) {
        const val = spectrum[i];
        if (i < spectrumTarget.length) {
          spectrumTarget[i] = val;
        }
        fftSum += val;
        if (i < 6) bassSum += val;
      }
      const fftAvg = fftSum / Math.max(1, spectrum.length);
      const bassAvg = bassSum / 6;

      const mic = sampleMicMetrics();
      const micRms = mic.active ? mic.rms : 0;

      let speakRms = 0;
      if (speechAnalyserRef.current && speechSourceRef.current) {
        const sbuf = speechBufferRef.current;
        speechAnalyserRef.current.getFloatTimeDomainData(sbuf);
        let sq = 0;
        for (let i = 0; i < sbuf.length; i++) {
          sq += sbuf[i] * sbuf[i];
        }
        speakRms = Math.min(1, Math.sqrt(sq / sbuf.length) * 4.8);
      } else if (isSynthSpeakingRef.current) {
        const t = performance.now() * 0.008;
        speakRms = 0.35 + Math.abs(Math.sin(t) * Math.cos(t * 0.57)) * 0.52;
      }

      const tempNorm = vector24.weather.normalized;
      const windNorm = Math.min(1, weatherCtx.windSpeedMs / 20);
      const solarNorm = vector24.solar.normalized;

      const selectedMeta = focusedDomain === 'all' ? null : UNIVERSAL_DOMAINS[focusedDomain];
      const alertTint = smartAlertEval.activeOrbTintHex;
      const basePrimaryHex =
        alertTint ??
        (selectedMeta
          ? selectedMeta.colorHex
          : tempNorm > 0.58
            ? '#4f89a8'
            : '#4a8a9c');
      const baseSecondaryHex = selectedMeta ? '#3b3c6e' : solarNorm > 0.55 ? '#4c3473' : '#263f6e';
      const baseAccentHex = selectedMeta
        ? '#c9a66b'
        : tempNorm > 0.55
          ? '#c79b5c'
          : '#8fb4c9';

      const micColorDriven = mic.active && (mic.intensity > 0.035 || mic.peakHold > 0.05);
      const primaryHex = micColorDriven ? mic.nebulaPrimaryHex : basePrimaryHex;
      const secondaryHex = micColorDriven ? mic.nebulaSecondaryHex : baseSecondaryHex;
      const accentHex = micColorDriven ? mic.nebulaAccentHex : baseAccentHex;
      const runeOuterHex = micColorDriven ? mic.runeOuterHex : baseAccentHex;
      const runeInnerHex = micColorDriven ? mic.runeInnerHex : basePrimaryHex;

      const whisperEnv = audioDspEngine.getWhisperEnvelopeEnergy();
      const liveVoiceEnv = liveSeerVoiceClient.getLiveVoiceEnergy();
      const combinedSpeakRms = Math.min(1, Math.max(speakRms, whisperEnv * 0.9, liveVoiceEnv));

      const voiceEnergyBoost = Math.max(mic.intensity * 0.65, micRms * 0.55, combinedSpeakRms * 0.65);
      liveStateRef.current.isPlayEngaged =
        seqStatus.isPlaying || liveVoiceState === 'connected' || isSpeakingReply;
      liveStateRef.current.micActive = mic.active;
      liveStateRef.current.micEnergy = Math.max(micRms, mic.intensity);
      liveStateRef.current.micBass = mic.bass;
      liveStateRef.current.micMid = mic.mid;
      liveStateRef.current.micTreble = mic.treble;
      liveStateRef.current.micPeakHold = mic.peakHold;
      liveStateRef.current.speakingEnergy = combinedSpeakRms;
      liveStateRef.current.bassEnergy = Math.min(
        1,
        bassAvg * 2.2 +
          mic.bass * 0.72 +
          (seqStatus.isPlaying ? 0.18 : 0) +
          combinedSpeakRms * 0.35
      );
      liveStateRef.current.energy = Math.min(
        1,
        0.22 + fftAvg * 1.9 + voiceEnergyBoost + (seqStatus.isPlaying ? 0.2 : 0)
      );
      liveStateRef.current.swirlSpeed =
        0.22 +
        windNorm * 0.52 +
        vector24.space.normalized * 0.28 +
        mic.swirlBoost * 0.6 +
        combinedSpeakRms * 0.45;
      liveStateRef.current.primaryHex = primaryHex;
      liveStateRef.current.secondaryHex = secondaryHex;
      liveStateRef.current.accentHex = accentHex;
      liveStateRef.current.runeOuterHex = runeOuterHex;
      liveStateRef.current.runeInnerHex = runeInnerHex;
      liveStateRef.current.runeOpacityBoost = mic.active ? mic.runeOpacityBoost * 0.55 : 0;
      liveStateRef.current.runeScaleBoost = mic.active ? mic.runeScaleBoost * 0.55 : 0;
      liveStateRef.current.domainNorms = ALL_DOMAINS_LIST.map((d) => vector24[d.id].normalized);
      liveStateRef.current.focusedIndex =
        focusedDomain === 'all' ? -1 : (DOMAIN_INDEX_MAP.get(focusedDomain) ?? -1);
      liveStateRef.current.pulseAge = (Date.now() - pulseTimestamp) / 1000;

      rafId = requestAnimationFrame(sampleSignals);
    };

    rafId = requestAnimationFrame(sampleSignals);
    return () => cancelAnimationFrame(rafId);
  }, [
    vector24,
    weatherCtx,
    focusedDomain,
    seqStatus.isPlaying,
    liveVoiceState,
    isSpeakingReply,
    smartAlertEval.activeOrbTintHex,
    pulseTimestamp,
    sampleMicMetrics
  ]);

  const stopSpeechPlayback = useCallback(() => {
    if (speechSourceRef.current) {
      try {
        speechSourceRef.current.onended = null;
        speechSourceRef.current.stop();
        speechSourceRef.current.disconnect();
      } catch {
        // Ignore already-stopped AudioBufferSourceNode
      }
      speechSourceRef.current = null;
    }
    if (speechFallbackAudioRef.current) {
      speechFallbackAudioRef.current.pause();
      speechFallbackAudioRef.current.src = '';
      speechFallbackAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    isSynthSpeakingRef.current = false;
    setIsSpeakingReply(false);
  }, []);

  const speakWithBrowserSynthesis = useCallback((text: string) => {
    if (!voiceEnabledRef.current || !text.trim()) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      audioDspEngine.setOracleSpeakingPriority(true);
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const english = voices.filter((v) => /^en\b/i.test(v.lang));
      const preferredVoice =
        english.find((v) =>
          /samantha|serena|victoria|karen|moira|aria|natural|female|google uk english female/i.test(
            v.name
          )
        ) ??
        english[0] ??
        voices[0];
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
      utterance.rate = 0.96;
      utterance.pitch = 0.96;
      utterance.volume = 0.36;
      utterance.onstart = () => {
        isSynthSpeakingRef.current = true;
        setIsSpeakingReply(true);
      };
      utterance.onend = () => {
        isSynthSpeakingRef.current = false;
        setIsSpeakingReply(false);
      };
      utterance.onerror = () => {
        isSynthSpeakingRef.current = false;
        setIsSpeakingReply(false);
      };
      isSynthSpeakingRef.current = true;
      setIsSpeakingReply(true);
      window.speechSynthesis.speak(utterance);
    } catch {
      isSynthSpeakingRef.current = false;
      setIsSpeakingReply(false);
    }
  }, []);

  const playVoiceReply = useCallback(
    async (result: VoiceQueryResult) => {
      stopSpeechPlayback();
      if (!voiceEnabledRef.current || !result.answerText) return;
      audioDspEngine.setOracleSpeakingPriority(true);

      if (result.audioBase64Wav) {
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx) {
            if (!speechAudioCtxRef.current) {
              const ctx = new AudioCtx();
              speechAudioCtxRef.current = ctx;
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 256;

              const presenceEq = ctx.createBiquadFilter();
              presenceEq.type = 'peaking';
              presenceEq.frequency.value = 2750;
              presenceEq.Q.value = 1.0;
              presenceEq.gain.value = 3.5;

              const voiceBoost = ctx.createGain();
              voiceBoost.gain.value = 0.59;

              // Ethereal Stereo Ping-Pong Oracle Vocal Delay (3:2 warm damped repeats)
              const delayHp = ctx.createBiquadFilter();
              delayHp.type = 'highpass';
              delayHp.frequency.value = 340;

              const delayL = ctx.createDelay(1.2);
              const delayR = ctx.createDelay(1.2);
              delayL.delayTime.value = 0.31;
              delayR.delayTime.value = 0.465;

              const dampL = ctx.createBiquadFilter();
              dampL.type = 'lowpass';
              dampL.frequency.value = 2400;
              const dampR = ctx.createBiquadFilter();
              dampR.type = 'lowpass';
              dampR.frequency.value = 2150;

              const fbL = ctx.createGain();
              const fbR = ctx.createGain();
              fbL.gain.value = 0.3;
              fbR.gain.value = 0.28;

              const wetGain = ctx.createGain();
              wetGain.gain.value = 0.28;

              const safetyLimiter = ctx.createDynamicsCompressor();
              safetyLimiter.threshold.value = -2.0;
              safetyLimiter.knee.value = 3;
              safetyLimiter.ratio.value = 14;
              safetyLimiter.attack.value = 0.002;
              safetyLimiter.release.value = 0.08;

              // 250 Hz 16 dB/oct voice high-pass filter before vocal presence EQ
              const voiceHp = createVoiceHighPass250Hz16dB(ctx);

              analyser.connect(voiceHp.input);
              voiceHp.output.connect(presenceEq);
              presenceEq.connect(voiceBoost);
              voiceBoost.connect(safetyLimiter);

              // Parallel ping-pong vocal delay path
              voiceBoost.connect(delayHp);
              delayHp.connect(delayL);
              delayL.connect(dampL);
              dampL.connect(fbL);
              fbL.connect(delayR);
              delayR.connect(dampR);
              dampR.connect(fbR);
              fbR.connect(delayL);

              if (typeof ctx.createStereoPanner === 'function') {
                const panL = ctx.createStereoPanner();
                const panR = ctx.createStereoPanner();
                panL.pan.value = -0.66;
                panR.pan.value = 0.66;
                dampL.connect(panL);
                dampR.connect(panR);
                panL.connect(wetGain);
                panR.connect(wetGain);
              } else {
                dampL.connect(wetGain);
                dampR.connect(wetGain);
              }
              wetGain.connect(safetyLimiter);

              safetyLimiter.connect(ctx.destination);
              speechAnalyserRef.current = analyser;
            }
            const ctx = speechAudioCtxRef.current;
            if (ctx.state === 'suspended') {
              await ctx.resume();
            }

            const binary = atob(result.audioBase64Wav);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const decoded = await ctx.decodeAudioData(bytes.buffer.slice(0));
            const src = ctx.createBufferSource();
            src.buffer = decoded;
            if (speechAnalyserRef.current) {
              src.connect(speechAnalyserRef.current);
            } else {
              src.connect(ctx.destination);
            }
            src.onended = () => {
              speechSourceRef.current = null;
              setIsSpeakingReply(false);
            };
            speechSourceRef.current = src;
            setIsSpeakingReply(true);
            src.start(0);
            return;
          }
        } catch {
          // Fall through cleanly to <audio> / speechSynthesis
        }

        try {
          const mime = result.audioMimeType || 'audio/wav';
          const audio = new Audio(`data:${mime};base64,${result.audioBase64Wav}`);
          audio.volume = 0.36;
          speechFallbackAudioRef.current = audio;
          audio.onplay = () => {
            isSynthSpeakingRef.current = true;
            setIsSpeakingReply(true);
          };
          audio.onended = () => {
            isSynthSpeakingRef.current = false;
            setIsSpeakingReply(false);
          };
          audio.onerror = () => {
            isSynthSpeakingRef.current = false;
            setIsSpeakingReply(false);
          };
          await audio.play();
          return;
        } catch {
          isSynthSpeakingRef.current = false;
          setIsSpeakingReply(false);
        }
      }

      speakWithBrowserSynthesis(result.answerText);
    },
    [stopSpeechPlayback, speakWithBrowserSynthesis]
  );

  const speakDomainInstant = useCallback(
    (domainId: 'all' | DomainCategory) => {
      if (!voiceEnabledRef.current) return;
      stopSpeechPlayback();
      if (domainId === 'all') {
        const phrase = `All twenty-four telemetry domains unified. Local temperature is ${weatherCtx.temperatureC.toFixed(1)} degrees Celsius, with tempo at ${compositionPlan.bpm} beats per minute.`;
        speakWithBrowserSynthesis(phrase);
        return;
      }
      const meta = UNIVERSAL_DOMAINS[domainId];
      const reading = vector24Ref.current[domainId];
      const phrase = `${meta.name}: ${reading.rawValue} ${formatSpokenUnit(reading.unit)}, at ${Math.round(reading.normalized * 100)} percent modulation.`;
      speakWithBrowserSynthesis(phrase);
    },
    [stopSpeechPlayback, speakWithBrowserSynthesis, weatherCtx.temperatureC, compositionPlan.bpm]
  );

  const speakDomainInstantRef = useRef(speakDomainInstant);
  speakDomainInstantRef.current = speakDomainInstant;

  const submitOracleQuestion = useCallback(
    async (rawQuestion: string) => {
      const cleaned = rawQuestion.trim();
      if (!cleaned) return;

      setOracleLoading(true);
      setActionNotice(null);
      setPulseTimestamp(Date.now());
      audioDspEngine.auditionNativeVoice('kora', compositionPlan);

      try {
        const intent = classifyCrystalBallPrompt(cleaned);
        if (intent === 'music_direction') {
          const patch = await requestMusicalDirection(cleaned, {
            bpm: compositionPlan.bpm,
            telemetrySignature: compositionPlan.telemetrySignatureLabel,
            activeHour: `${compositionPlan.activeTelemetryHour.hourLabel} ${compositionPlan.activeTelemetryHour.mapping.instrument}`,
            scaleName: compositionPlan.scaleName,
            voiceMix: audioDspEngine.getVoiceMix()
          });
          audioDspEngine.applyMusicalDirectorPatch(patch);
          setActionNotice(`Mix updated: ${patch.summary}`);
          return;
        }
        if (intent === 'smart_alert') {
          const compiled = await compileSmartAlertRule(cleaned);
          addSmartAlertRule(compiled);
          setActionNotice(`Smart alert armed: ${compiled.label} (${compiled.summary})`);
          return;
        }

        const result = await queryVoiceTelemetryOracle(
          cleaned,
          vector24,
          weatherCtx,
          voiceReplyEnabled
        );
        setOracleResult(result);
        onOracleResultRef.current?.(result);
        onChangeDomainRef.current(result.matchedDomain);
        setPulseTimestamp(Date.now());
        if (voiceReplyEnabled) {
          await playVoiceReply(result);
        }
      } catch (err) {
        setActionNotice(err instanceof Error ? err.message : 'Request could not be completed.');
      } finally {
        setOracleLoading(false);
      }
    },
    [compositionPlan, vector24, weatherCtx, voiceReplyEnabled, playVoiceReply]
  );

  const handleToggleLiveVoice = useCallback(async () => {
    setLiveVoiceError(null);
    if (liveSeerVoiceClient.isActive()) {
      liveSeerVoiceClient.disconnect();
      setLiveVoiceState('idle');
      return;
    }
    stopSpeechPlayback();
    const summary = `${weatherCtx.region}, ${weatherCtx.temperatureC.toFixed(1)}C, wind ${weatherCtx.windSpeedMs} m/s, AQI ${weatherCtx.aqi}, ${compositionPlan.telemetrySignatureLabel}, hour ${compositionPlan.activeTelemetryHour.hourLabel} featuring ${compositionPlan.activeTelemetryHour.mapping.instrument}.`;
    await liveSeerVoiceClient.connect(summary, deriveWeatherVoiceStyle(weatherCtx), {
      onStateChange: (nextState, errMsg) => {
        setLiveVoiceState(nextState);
        if (errMsg) setLiveVoiceError(errMsg);
      },
      onOutputTranscript: (text) => {
        if (text.trim()) setActionNotice(`Seer: ${text.trim()}`);
      }
    });
  }, [weatherCtx, compositionPlan, stopSpeechPlayback]);

  const submitOracleRef = useRef(submitOracleQuestion);
  submitOracleRef.current = submitOracleQuestion;

  const stopMicrophoneCapture = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors if recognition already ended
      }
      recognitionRef.current = null;
    }
    if (!isVisualizerPinnedRef.current) {
      stopMicVisualizer();
    }
    setIsListening(false);
  }, [stopMicVisualizer]);

  const handleToggleMicVisualizer = useCallback(async () => {
    setMicError(null);
    clearMicVisualizerError();
    if (isVisualizerPinnedRef.current) {
      setIsVisualizerPinned(false);
      isVisualizerPinnedRef.current = false;
      if (!recognitionRef.current) {
        stopMicVisualizer();
      }
      return;
    }

    const started = await startMicVisualizer();
    if (started) {
      setIsVisualizerPinned(true);
      isVisualizerPinnedRef.current = true;
      setPulseTimestamp(Date.now());
    }
  }, [clearMicVisualizerError, startMicVisualizer, stopMicVisualizer]);

  const handleToggleListening = useCallback(async () => {
    if (isListening) {
      const pendingTranscript = transcriptDraftRef.current.trim();
      stopMicrophoneCapture();
      if (pendingTranscript) {
        setLiveTranscript('');
        transcriptDraftRef.current = '';
        await submitOracleRef.current(pendingTranscript);
      }
      return;
    }

    setMicError(null);
    clearMicVisualizerError();
    setLiveTranscript('');
    transcriptDraftRef.current = '';
    stopSpeechPlayback();
    setDockCollapsed(false);

    const micReady = await startMicVisualizer();
    if (!micReady) {
      setMicError('Microphone blocked or unavailable. Type a question below.');
      typedInputRef.current?.focus();
      return;
    }

    const SpeechRecCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .webkitSpeechRecognition;

    if (!SpeechRecCtor) {
      stopMicrophoneCapture();
      setMicError('Live transcription requires Chromium SpeechRecognition. Type a question below.');
      typedInputRef.current?.focus();
      return;
    }

    try {
      const recognition = new SpeechRecCtor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      let submitted = false;

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let interim = '';
        let finalText = '';
        for (let i = 0; i < event.results.length; i++) {
          const r = event.results[i];
          const text = r[0]?.transcript || '';
          if (r.isFinal) finalText += text;
          else interim += text;
        }
        const combined = (finalText || interim).trim();
        transcriptDraftRef.current = combined;
        setLiveTranscript(combined);

        if (finalText.trim() && !submitted) {
          submitted = true;
          stopMicrophoneCapture();
          setLiveTranscript('');
          transcriptDraftRef.current = '';
          submitOracleRef.current(finalText.trim());
        }
      };

      recognition.onerror = (ev: { error: string }) => {
        if (ev.error !== 'aborted' && ev.error !== 'no-speech') {
          setMicError(`Voice capture error (${ev.error}). Type your question below.`);
        }
        stopMicrophoneCapture();
      };

      recognition.onend = () => {
        const leftover = transcriptDraftRef.current.trim();
        stopMicrophoneCapture();
        if (leftover && !submitted) {
          submitted = true;
          setLiveTranscript('');
          transcriptDraftRef.current = '';
          submitOracleRef.current(leftover);
        }
      };

      recognitionRef.current = recognition;
      setIsListening(true);
      recognition.start();
    } catch {
      stopMicrophoneCapture();
      setMicError('Could not start speech recognition. Type your question below.');
      typedInputRef.current?.focus();
    }
  }, [
    isListening,
    clearMicVisualizerError,
    startMicVisualizer,
    stopMicrophoneCapture,
    stopSpeechPlayback
  ]);

  const prevVoiceNonceRef = useRef(voiceTriggerNonce);
  useEffect(() => {
    if (voiceTriggerNonce !== prevVoiceNonceRef.current) {
      prevVoiceNonceRef.current = voiceTriggerNonce;
      handleToggleListening();
    }
  }, [voiceTriggerNonce, handleToggleListening]);

  useEffect(() => {
    return () => {
      stopMicrophoneCapture();
      stopSpeechPlayback();
      liveSeerVoiceClient.disconnect();
      if (speechAudioCtxRef.current) {
        speechAudioCtxRef.current.close().catch(() => {});
        speechAudioCtxRef.current = null;
      }
    };
  }, [stopMicrophoneCapture, stopSpeechPlayback]);

  useEffect(() => {
    if (!voiceReplyEnabled) {
      stopSpeechPlayback();
    }
  }, [voiceReplyEnabled, stopSpeechPlayback]);

  // Mount Three.js Celestial Brass Astrolabe Crystal Ball Scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: false,
        powerPreference: 'high-performance'
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0d14');
    scene.fog = new THREE.FogExp2('#0a0d14', 0.044);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 1.18, 5.75);

    const controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 3.2;
    controls.maxDistance = 8.8;
    controls.minPolarAngle = Math.PI * 0.24;
    controls.maxPolarAngle = Math.PI * 0.56;
    controls.minAzimuthAngle = -0.68;
    controls.maxAzimuthAngle = 0.68;
    controls.target.set(0, 0.16, -0.05);
    controls.update();

    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    if (!isSoftwareGl) {
      composer = new EffectComposer(renderer);
      composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      composer.setSize(width, height);
      composer.addPass(new RenderPass(scene, camera));
      // Ultra-subtle natural candlelight bloom (zero neon glow flashing)
      bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.05, 0.25, 0.97);
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
    }

    // Warm/Cool Parlor Observatory Lighting Rig (Restrained Candlelit Brass & Soft Moonlight)
    const hemiLight = new THREE.HemisphereLight('#94a3b8', '#0f172a', 0.62);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#fff5e1', 2.15);
    keyLight.position.set(4.5, 6.5, 4.2);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -4;
    keyLight.shadow.camera.right = 4;
    keyLight.shadow.camera.top = 4;
    keyLight.shadow.camera.bottom = -4;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#94a3b8', 0.92);
    rimLight.position.set(-4.8, 3.6, -4.6);
    scene.add(rimLight);

    const brassBounceLight = new THREE.PointLight('#d97706', 1.1, 8, 2);
    brassBounceLight.position.set(0, -0.42, 1.55);
    scene.add(brassBounceLight);

    // Procedural Canvas Textures
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const runeTexPrimary = createAstrolabeRuneRingTexture('#ffffff', '#e0f2fe');
    runeTexPrimary.anisotropy = maxAniso;
    const runeTexSecondary = createAstrolabeRuneRingTexture('#f8fafc', '#bae6fd');
    runeTexSecondary.anisotropy = maxAniso;
    const brassRoughTex = createBrushedBrassRoughnessTexture();
    const glowSpriteTex = createSoftGlowSpriteTexture();

    // Composite Celestial Brass Astrolabe Crystal Ball (scaled 0.62x flush on velvet parlor table)
    const orbAssembly = new THREE.Group();
    orbAssembly.scale.setScalar(CRYSTAL_BALL_SCALE);
    orbAssembly.position.set(CRYSTAL_BALL_POS_X, CRYSTAL_BALL_POS_Y, CRYSTAL_BALL_POS_Z);
    scene.add(orbAssembly);

    const corePointLight = new THREE.PointLight('#7dd3fc', 1.75, 8.5, 2);
    corePointLight.position.set(0, 0.35, 0);
    orbAssembly.add(corePointLight);

    // 2. Sculpted Multi-Tiered Obsidian & Brushed Bronze Pedestal (LatheGeometry)
    const plinthPoints = [
      new THREE.Vector2(0.0, -1.77),
      new THREE.Vector2(1.52, -1.77),
      new THREE.Vector2(1.48, -1.66),
      new THREE.Vector2(1.24, -1.56),
      new THREE.Vector2(1.06, -1.46),
      new THREE.Vector2(0.92, -1.26),
      new THREE.Vector2(0.76, -1.06),
      new THREE.Vector2(1.08, -0.92),
      new THREE.Vector2(1.16, -0.82),
      new THREE.Vector2(0.78, -0.78),
      new THREE.Vector2(0.0, -0.82)
    ];
    const plinthGeo = new THREE.LatheGeometry(plinthPoints, 64);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: '#141c2c',
      metalness: 0.52,
      roughness: 0.58
    });
    const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    plinthMesh.castShadow = true;
    plinthMesh.receiveShadow = true;
    orbAssembly.add(plinthMesh);

    const brassMat = new THREE.MeshPhysicalMaterial({
      color: '#d97706',
      metalness: 0.92,
      roughness: 0.26,
      roughnessMap: brassRoughTex,
      anisotropy: 0.75,
      clearcoat: 0.35
    });
    const goldMat = new THREE.MeshPhysicalMaterial({
      color: '#fbbf24',
      metalness: 0.94,
      roughness: 0.18,
      roughnessMap: brassRoughTex,
      anisotropy: 0.85,
      clearcoat: 0.5
    });

    // Hooded Celestial Seer, Velvet-Draped Parlor Table, Flickering Candles & Tarot Cards
    const parlorRig = buildFortuneTellerParlorRig({
      maxAnisotropy: maxAniso,
      isSoftwareGl,
      brassMat,
      goldMat,
      glowSpriteTex
    });
    scene.add(parlorRig.group);

    // Behind-the-Orb 3D Celestial 24-Domain Telemetry Arch, Anomaly Markers & 32-Band Audio Halo
    const celestialBackdropUi = buildCelestialBackdropUi({
      maxAnisotropy: maxAniso,
      isSoftwareGl,
      brassMat,
      goldMat,
      glowSpriteTex
    });
    scene.add(celestialBackdropUi.group);

    const collarGeo = new THREE.TorusGeometry(1.08, 0.06, 20, 64);
    const collarMesh = new THREE.Mesh(collarGeo, brassMat);
    collarMesh.rotation.x = Math.PI / 2;
    collarMesh.position.y = -0.84;
    collarMesh.castShadow = true;
    orbAssembly.add(collarMesh);

    const stepRingGeo = new THREE.TorusGeometry(1.48, 0.032, 16, 64);
    const stepRingMesh = new THREE.Mesh(stepRingGeo, goldMat);
    stepRingMesh.rotation.x = Math.PI / 2;
    stepRingMesh.position.y = -1.72;
    orbAssembly.add(stepRingMesh);

    // 3. 4 Sculpted Dragon-Claw Astrolabe Talons + Glowing Bezel Gems
    const clawGeometries: THREE.BufferGeometry[] = [];
    const clawGemMat = new THREE.MeshStandardMaterial({
      color: '#fde68a',
      emissive: '#d97706',
      emissiveIntensity: 0.72,
      roughness: 0.16,
      metalness: 0.35
    });
    const clawGemGeo = new THREE.OctahedronGeometry(0.082, 0);

    for (let c = 0; c < 4; c++) {
      const ang = (c / 4) * Math.PI * 2 + Math.PI / 4;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);

      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(cosA * 1.04, -0.84, sinA * 1.04),
        new THREE.Vector3(cosA * 1.38, -0.58, sinA * 1.38),
        new THREE.Vector3(cosA * 1.46, -0.14, sinA * 1.46),
        new THREE.Vector3(cosA * 1.34, 0.16, sinA * 1.34)
      ]);
      const talonGeo = new THREE.TubeGeometry(curve, 24, 0.048, 12, false);
      clawGeometries.push(talonGeo);
      const talonMesh = new THREE.Mesh(talonGeo, brassMat);
      talonMesh.castShadow = true;
      orbAssembly.add(talonMesh);

      const gem = new THREE.Mesh(clawGemGeo, clawGemMat);
      gem.position.set(cosA * 1.34, 0.2, sinA * 1.34);
      gem.rotation.y = ang;
      orbAssembly.add(gem);
    }

    // 4. Concentric Astrolabe Gyroscope Brass Rings & Counter-Rotating Glowing Rune Halos
    const gimbalOuterGeo = new THREE.TorusGeometry(1.86, 0.028, 18, 112);
    const gimbalOuter = new THREE.Mesh(gimbalOuterGeo, goldMat);
    gimbalOuter.position.y = 0.35;
    gimbalOuter.rotation.set(0.36, 0.2, 0.14);
    orbAssembly.add(gimbalOuter);

    const gimbalInnerGeo = new THREE.TorusGeometry(1.62, 0.02, 16, 96);
    const gimbalInner = new THREE.Mesh(gimbalInnerGeo, brassMat);
    gimbalInner.position.y = 0.35;
    gimbalInner.rotation.set(-0.52, 0.45, -0.2);
    orbAssembly.add(gimbalInner);

    const runeRingOuterGeo = new THREE.RingGeometry(1.66, 2.18, 96);
    const runeRingOuterMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#d97706'),
      map: runeTexPrimary,
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const runeRingOuter = new THREE.Mesh(runeRingOuterGeo, runeRingOuterMat);
    runeRingOuter.position.y = -0.35;
    runeRingOuter.rotation.x = -Math.PI / 2 + 0.08;
    runeRingOuter.renderOrder = 2;
    orbAssembly.add(runeRingOuter);

    const runeRingInnerGeo = new THREE.RingGeometry(1.38, 1.72, 96);
    const runeRingInnerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#7dd3fc'),
      map: runeTexSecondary,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const runeRingInner = new THREE.Mesh(runeRingInnerGeo, runeRingInnerMat);
    runeRingInner.position.y = 0.35;
    runeRingInner.rotation.set(Math.PI * 0.38, 0.24, 0.12);
    runeRingInner.renderOrder = 2;
    orbAssembly.add(runeRingInner);

    // 5. Multi-Layer Swirling Galaxy Nebula Core Assembly
    const singularityGeo = new THREE.SphereGeometry(0.42, 48, 48);
    const singularityMat = new THREE.ShaderMaterial({
      vertexShader: SINGULARITY_VERTEX_SHADER,
      fragmentShader: SINGULARITY_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0.4 },
        uBeatPulse: { value: 0 },
        uColorPrimary: { value: new THREE.Color('#38bdf8') },
        uColorAccent: { value: new THREE.Color('#fbbf24') }
      }
    });
    const singularityMesh = new THREE.Mesh(singularityGeo, singularityMat);
    singularityMesh.position.y = 0.35;
    singularityMesh.renderOrder = 1;
    orbAssembly.add(singularityMesh);

    const dustCount = 420;
    const dustPositions = new Float32Array(dustCount * 3);
    const dustColors = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const arm = i % 3;
      const t = i / dustCount;
      const r = 0.26 + Math.pow(t, 0.72) * 0.78;
      const angle = t * Math.PI * 6.5 + (arm * Math.PI * 2) / 3;
      const verticalSpread =
        (Math.sin(i * 19.3) * 0.28 + Math.cos(i * 7.1) * 0.14) * (1 - t * 0.4);
      dustPositions[i * 3] = Math.cos(angle) * r;
      dustPositions[i * 3 + 1] = verticalSpread;
      dustPositions[i * 3 + 2] = Math.sin(angle) * r;

      _tempColor.setHSL(0.52 + (i % 5) * 0.08, 0.85, 0.65);
      dustColors[i * 3] = _tempColor.r;
      dustColors[i * 3 + 1] = _tempColor.g;
      dustColors[i * 3 + 2] = _tempColor.b;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    dustGeo.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.075,
      map: glowSpriteTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    dustPoints.position.y = 0.35;
    dustPoints.renderOrder = 2;
    orbAssembly.add(dustPoints);

    const nebulaGeo = new THREE.SphereGeometry(1.1, 64, 64);
    const nebulaMat = new THREE.ShaderMaterial({
      vertexShader: NEBULA_VERTEX_SHADER,
      fragmentShader: NEBULA_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0.38 },
        uSwirlSpeed: { value: 0.45 },
        uBeatPulse: { value: 0 },
        uColorPrimary: { value: new THREE.Color('#0ea5e9') },
        uColorSecondary: { value: new THREE.Color('#4f46e5') },
        uColorAccent: { value: new THREE.Color('#fbbf24') }
      }
    });
    const nebulaMesh = new THREE.Mesh(nebulaGeo, nebulaMat);
    nebulaMesh.position.y = 0.35;
    nebulaMesh.renderOrder = 2;
    orbAssembly.add(nebulaMesh);

    // Crackling Energy / Lightning Arcs inside orb
    const arcCount = 6;
    const segmentsPerArc = 12;
    const arcVertexPositions = new Float32Array(arcCount * segmentsPerArc * 6);
    updateArcSegmentsBuffer(arcVertexPositions, arcCount, segmentsPerArc, 0, 0.35, 1.12);
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(arcVertexPositions, 3));
    const arcMat = new THREE.LineBasicMaterial({
      color: '#bae6fd',
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const arcLines = new THREE.LineSegments(arcGeo, arcMat);
    arcLines.position.y = 0.35;
    arcLines.frustumCulled = false;
    arcLines.renderOrder = 3;
    orbAssembly.add(arcLines);

    // 6. Outer Optical Crystal Glass Sphere & Ethereal Volumetric Aura Shell
    const glassGeo = new THREE.SphereGeometry(1.32, 64, 64);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: '#e0f2fe',
      metalness: 0.0,
      roughness: 0.03,
      transmission: isSoftwareGl ? 0 : 0.9,
      transparent: true,
      opacity: isSoftwareGl ? 0.34 : 1.0,
      ior: 1.54,
      thickness: 1.5,
      iridescence: 0.38,
      iridescenceIOR: 1.32,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.45,
      depthWrite: false
    });
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.position.y = 0.35;
    glassMesh.renderOrder = 4;
    orbAssembly.add(glassMesh);

    const auraGeo = new THREE.SphereGeometry(1.44, 48, 48);
    const auraMat = new THREE.ShaderMaterial({
      vertexShader: AURA_VERTEX_SHADER,
      fragmentShader: AURA_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0.38 },
        uBeatPulse: { value: 0 },
        uColorPrimary: { value: new THREE.Color('#38bdf8') },
        uColorAccent: { value: new THREE.Color('#fbbf24') }
      }
    });
    const auraMesh = new THREE.Mesh(auraGeo, auraMat);
    auraMesh.position.y = 0.35;
    auraMesh.renderOrder = 5;
    orbAssembly.add(auraMesh);

    // 7. 24 Hoverable & Clickable Orbital Domain Gems
    const moteGeo = new THREE.OctahedronGeometry(0.068, 0);
    const moteMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.22,
      metalness: 0.58,
      emissive: '#38bdf8',
      emissiveIntensity: 0.48
    });
    const moteCount = 24;
    const motesInstanced = new THREE.InstancedMesh(moteGeo, moteMat, moteCount);
    motesInstanced.frustumCulled = false;
    motesInstanced.position.y = 0.35;
    for (let i = 0; i < moteCount; i++) {
      _tempColor.set(liveStateRef.current.domainColors[i] || '#38bdf8');
      motesInstanced.setColorAt(i, _tempColor);
    }
    if (motesInstanced.instanceColor) {
      motesInstanced.instanceColor.needsUpdate = true;
    }
    orbAssembly.add(motesInstanced);

    // 8. Overhead Constellation Dome Canopy & Live Domain Filament Network
    const domeGeo = new THREE.IcosahedronGeometry(4.6, 2);
    const domeWireGeo = new THREE.WireframeGeometry(domeGeo);
    domeGeo.dispose();
    const domeMat = new THREE.LineBasicMaterial({
      color: '#64748b',
      transparent: true,
      opacity: 0.048,
      depthWrite: false
    });
    const domeWire = new THREE.LineSegments(domeWireGeo, domeMat);
    domeWire.position.y = 0.65;
    scene.add(domeWire);

    const constellationPositions = new Float32Array((moteCount + 1) * 6);
    const constellationGeo = new THREE.BufferGeometry();
    constellationGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(constellationPositions, 3)
    );
    const constellationMat = new THREE.LineBasicMaterial({
      color: '#94a3b8',
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const constellationLines = new THREE.LineSegments(constellationGeo, constellationMat);
    constellationLines.position.y = 0.35;
    constellationLines.frustumCulled = false;
    orbAssembly.add(constellationLines);

    // Distant Starfield Backdrop
    const starCount = 340;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 10.5 + Math.random() * 14;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) - 1.5;
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: '#e2e8f0',
      size: 0.14,
      map: glowSpriteTex,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Ensure orbAssembly world matrix is computed for accurate scaled world-space gem projection
    orbAssembly.updateMatrixWorld(true);

    // Unified Raycasting Hover & Click Inspection across Orbital Gems & Behind-the-Orb Telemetry Arch
    const raycastTargets: THREE.Object3D[] = [
      motesInstanced,
      celestialBackdropUi.interactiveNodesMesh
    ];
    let pointerDownX = 0;
    let pointerDownY = 0;
    let lastRaycastMs = 0;
    const gemLocalPositions = Array.from({ length: moteCount }, () => new THREE.Vector3());
    const gemWorldPositions = Array.from({ length: moteCount }, () => new THREE.Vector3());

    const updatePointerNdc = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const handlePointerMove = (e: PointerEvent) => {
      updatePointerNdc(e.clientX, e.clientY);
      liveStateRef.current.pointerNdcX = _pointerNdc.x;
      liveStateRef.current.pointerNdcY = _pointerNdc.y;

      // Clear stale projected tooltip immediately while dragging the camera orbit
      if (e.buttons !== 0 && Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > 4) {
        if (liveStateRef.current.hoveredIndex !== -1) {
          liveStateRef.current.hoveredIndex = -1;
          setHoverReadout(null);
        }
        return;
      }

      const now = performance.now();
      if (now - lastRaycastMs < 32) return;
      lastRaycastMs = now;

      _raycaster.setFromCamera(_pointerNdc, camera);
      const hits = _raycaster.intersectObjects(raycastTargets, false);

      const hit = hits[0];
      const idx = hit?.instanceId;
      if (hit && idx !== undefined) {
        liveStateRef.current.hoveredIndex = idx;
        canvas.style.cursor = 'pointer';
        const domainMeta = ALL_DOMAINS_LIST[idx];
        const reading = vector24Ref.current[domainMeta.id];
        const worldPos =
          hit.object === celestialBackdropUi.interactiveNodesMesh
            ? celestialBackdropUi.nodeWorldPositions[idx]
            : gemWorldPositions[idx];
        _projVec.copy(worldPos).project(camera);
        const rect = canvas.getBoundingClientRect();
        const sx = ((_projVec.x + 1) * 0.5) * rect.width;
        const sy = ((-_projVec.y + 1) * 0.5) * rect.height;
        const isAnomaly =
          Boolean(celestialBackdropUi.anomalyFlags[idx]) ||
          Math.abs(reading.normalized - 0.5) >= TELEMETRY_ANOMALY_DEVIATION_THRESHOLD;
        setHoverReadout({
          index: idx,
          domainId: domainMeta.id,
          name: domainMeta.name,
          formattedValue: `${reading.rawValue} ${reading.unit}`,
          normalizedPct: Math.round(reading.normalized * 100),
          screenX: sx,
          screenY: sy,
          isAnomaly
        });
      } else if (liveStateRef.current.hoveredIndex !== -1) {
        liveStateRef.current.hoveredIndex = -1;
        canvas.style.cursor = 'grab';
        setHoverReadout(null);
      }
    };

    const handlePointerLeave = () => {
      liveStateRef.current.pointerNdcX = 0;
      liveStateRef.current.pointerNdcY = 0;
      if (liveStateRef.current.hoveredIndex !== -1) {
        liveStateRef.current.hoveredIndex = -1;
        canvas.style.cursor = 'grab';
        setHoverReadout(null);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
    };

    const handlePointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
      if (dist > 6) return;

      updatePointerNdc(e.clientX, e.clientY);
      _raycaster.setFromCamera(_pointerNdc, camera);
      const hits = _raycaster.intersectObjects(raycastTargets, false);
      if (hits.length > 0 && hits[0].instanceId !== undefined) {
        const domainMeta = ALL_DOMAINS_LIST[hits[0].instanceId];
        const nextDomain =
          focusedDomainRef.current === domainMeta.id ? 'all' : domainMeta.id;
        onChangeDomainRef.current(nextDomain);
        setPulseTimestamp(Date.now());
        audioDspEngine.auditionNativeVoice('kora', compositionPlanRef.current);
        speakDomainInstantRef.current(nextDomain);
      }
    };

    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      if (composer) {
        composer.setSize(w, h);
      }
      if (bloomPass) {
        bloomPass.resolution.set(w, h);
      }
    };
    window.addEventListener('resize', handleResize);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglFailed(true);
    };
    const handleContextRestored = () => {
      setWebglFailed(false);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const seerSignals: SeerAnimationSignals = {
      energy: 0.36,
      bassEnergy: 0.25,
      micEnergy: 0,
      speakingEnergy: 0,
      beatImpulse: 0,
      swirlSpeed: 0.45,
      pointerNdcX: 0,
      pointerNdcY: 0,
      orbColor: nebulaMat.uniforms.uColorPrimary.value,
      accentColor: nebulaMat.uniforms.uColorAccent.value,
      reducedMotion
    };
    const backdropSignals: CelestialBackdropSignals = {
      energy: 0.36,
      bassEnergy: 0.25,
      micEnergy: 0,
      speakingEnergy: 0,
      beatImpulse: 0,
      domainNorms: liveStateRef.current.domainNorms,
      domainColors: liveStateRef.current.domainColors,
      focusedIndex: -1,
      hoveredIndex: -1,
      fftSpectrum32: liveStateRef.current.fftSpectrum32,
      orbColor: nebulaMat.uniforms.uColorPrimary.value,
      accentColor: nebulaMat.uniforms.uColorAccent.value,
      reducedMotion
    };
    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || !gl.fenceSync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const stageWeights: StagedAnimationWeights = {
      core: 0,
      seerBreathGaze: 0,
      handsCandlesIncense: 0,
      astrolabeRings: 0,
      constellationBackdrop: 0
    };
    let playElapsed = 0;
    let coreClock = 0;
    let ringsClock = 0;
    let constellationClock = 0;

    const tick = () => {
      if (disposed) return;
      const delta = Math.min(0.1, clock.getDelta());
      const elapsed = clock.getElapsedTime();
      const st = liveStateRef.current;

      const motionMul = reducedMotion ? 0.12 : 1.0;

      // Animations stay serenely still before Play, then awaken smoothly ONE BY ONE after Play is engaged
      if (st.isPlayEngaged) {
        playElapsed = Math.min(14, playElapsed + delta);
      } else {
        playElapsed = Math.max(0, playElapsed - delta * 2.2);
      }
      computeStagedAnimationWeights(playElapsed, stageWeights);

      const wCore = stageWeights.core;
      const wRings = stageWeights.astrolabeRings;
      const wConstellation = stageWeights.constellationBackdrop;

      coreClock += delta * motionMul * wCore;
      ringsClock += delta * motionMul * wRings;
      constellationClock += delta * motionMul * wConstellation;

      // Stage 1: Crystal ball core & inner nebula (zero neon strobe flashing)
      singularityMat.uniforms.uTime.value = coreClock;
      singularityMat.uniforms.uEnergy.value = THREE.MathUtils.damp(
        singularityMat.uniforms.uEnergy.value,
        0.18 + st.energy * 0.36 * wCore,
        3.5,
        delta
      );
      singularityMat.uniforms.uBeatPulse.value = 0;

      nebulaMat.uniforms.uTime.value = coreClock;
      nebulaMat.uniforms.uEnergy.value = singularityMat.uniforms.uEnergy.value;
      nebulaMat.uniforms.uBeatPulse.value = 0;
      nebulaMat.uniforms.uSwirlSpeed.value = THREE.MathUtils.damp(
        nebulaMat.uniforms.uSwirlSpeed.value,
        st.swirlSpeed * 0.65 * wCore,
        3.5,
        delta
      );

      auraMat.uniforms.uTime.value = coreClock;
      auraMat.uniforms.uEnergy.value = singularityMat.uniforms.uEnergy.value * 0.6;
      auraMat.uniforms.uBeatPulse.value = 0;

      const colorLerpAlpha = Math.min(1, delta * (st.micActive ? 4.5 : 2.2));
      _tempColor.set(st.primaryHex);
      nebulaMat.uniforms.uColorPrimary.value.lerp(_tempColor, colorLerpAlpha);
      singularityMat.uniforms.uColorPrimary.value.copy(nebulaMat.uniforms.uColorPrimary.value);
      auraMat.uniforms.uColorPrimary.value.copy(nebulaMat.uniforms.uColorPrimary.value);

      _tempColor.set(st.secondaryHex);
      nebulaMat.uniforms.uColorSecondary.value.lerp(_tempColor, colorLerpAlpha);

      _tempColor.set(st.accentHex);
      nebulaMat.uniforms.uColorAccent.value.lerp(_tempColor, colorLerpAlpha);
      singularityMat.uniforms.uColorAccent.value.copy(nebulaMat.uniforms.uColorAccent.value);
      auraMat.uniforms.uColorAccent.value.copy(nebulaMat.uniforms.uColorAccent.value);
      arcMat.color.lerp(_tempColor, colorLerpAlpha);

      // Calm warm core illumination — no beat-flash spikes
      corePointLight.color.copy(nebulaMat.uniforms.uColorPrimary.value);
      corePointLight.intensity = THREE.MathUtils.damp(
        corePointLight.intensity,
        1.15 + st.energy * 0.42 * wCore,
        3.0,
        delta
      );

      // Stage 4: Brass gimbal rings & equatorial rune rings
      gimbalOuter.rotation.y += delta * (0.16 + st.micBass * 0.18) * motionMul * wRings;
      gimbalOuter.rotation.z += delta * (0.05 + st.micMid * 0.08) * motionMul * wRings;
      gimbalInner.rotation.y -= delta * (0.22 + st.micTreble * 0.22) * motionMul * wRings;
      gimbalInner.rotation.x += delta * (0.06 + st.micMid * 0.1) * motionMul * wRings;

      _tempColor.set(st.runeOuterHex);
      runeRingOuterMat.color.lerp(_tempColor, colorLerpAlpha);
      _tempColor.set(st.runeInnerHex);
      runeRingInnerMat.color.lerp(_tempColor, colorLerpAlpha);

      runeRingOuter.rotation.z += delta * (0.11 + st.swirlSpeed * 0.08) * motionMul * wRings;
      runeRingInner.rotation.z -= delta * (0.18 + st.swirlSpeed * 0.1) * motionMul * wRings;

      const targetOuterOpacity = Math.min(0.28, 0.14 + st.energy * 0.09 * wRings + st.runeOpacityBoost * 0.15 * wRings);
      const targetInnerOpacity = Math.min(0.24, 0.12 + st.energy * 0.08 * wRings + st.runeOpacityBoost * 0.15 * wRings);
      runeRingOuterMat.opacity = THREE.MathUtils.damp(runeRingOuterMat.opacity, targetOuterOpacity, 5.0, delta);
      runeRingInnerMat.opacity = THREE.MathUtils.damp(runeRingInnerMat.opacity, targetInnerOpacity, 5.0, delta);

      const targetOuterScale = 1 + st.runeScaleBoost * 0.5 * wRings;
      const targetInnerScale = 1 + st.runeScaleBoost * 0.65 * wRings;
      const dampedOuterScale = THREE.MathUtils.damp(runeRingOuter.scale.x, targetOuterScale, 6.0, delta);
      const dampedInnerScale = THREE.MathUtils.damp(runeRingInner.scale.x, targetInnerScale, 6.0, delta);
      runeRingOuter.scale.set(dampedOuterScale, dampedOuterScale, 1);
      runeRingInner.scale.set(dampedInnerScale, dampedInnerScale, 1);

      dustPoints.rotation.y += delta * (0.14 + st.swirlSpeed * 0.16) * motionMul * wCore;
      stars.rotation.y += delta * 0.01 * motionMul * wConstellation;
      domeWire.rotation.y -= delta * 0.014 * motionMul * wConstellation;

      updateArcSegmentsBuffer(
        arcVertexPositions,
        arcCount,
        segmentsPerArc,
        coreClock,
        0.15 + st.energy * 0.35 * wCore,
        1.12
      );
      arcGeo.attributes.position.needsUpdate = true;
      arcMat.opacity = THREE.MathUtils.damp(arcMat.opacity, 0.05 + st.energy * 0.13 * wCore, 4.0, delta);

      // Stage 5: 24-domain orbital gems & constellation filaments
      const highlightIdx = st.hoveredIndex >= 0 ? st.hoveredIndex : st.focusedIndex;
      for (let i = 0; i < moteCount; i++) {
        const norm = st.domainNorms[i] ?? 0.5;
        const baseAngle =
          (i / moteCount) * Math.PI * 2 + constellationClock * (0.14 + norm * 0.1);
        const tilt = Math.sin(i * 1.65 + constellationClock * 0.3) * 0.42;
        const radius = 1.56 + norm * 0.4;
        const gx = Math.cos(baseAngle) * radius;
        const gy = Math.sin(tilt) * 0.58 + 0.14;
        const gz = Math.sin(baseAngle) * radius;

        gemLocalPositions[i].set(gx, gy, gz);
        gemWorldPositions[i].set(gx, gy + 0.35, gz).applyMatrix4(orbAssembly.matrixWorld);
        _dummyObj.position.set(gx, gy, gz);

        const isHighlighted = i === highlightIdx;
        const s = (0.64 + norm * 0.58) * (isHighlighted ? 1.55 : 1.0);
        _dummyObj.scale.set(s, s * 1.25, s);
        _dummyObj.rotation.set(constellationClock + i, constellationClock * 0.65, i);
        _dummyObj.updateMatrix();
        motesInstanced.setMatrixAt(i, _dummyObj.matrix);
      }
      motesInstanced.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < moteCount; i++) {
        const nextIdx = (i + 1) % moteCount;
        _gemPos.copy(gemLocalPositions[i]);
        _nextGemPos.copy(gemLocalPositions[nextIdx]);

        const offset = i * 6;
        constellationPositions[offset] = _gemPos.x;
        constellationPositions[offset + 1] = _gemPos.y;
        constellationPositions[offset + 2] = _gemPos.z;
        constellationPositions[offset + 3] = _nextGemPos.x;
        constellationPositions[offset + 4] = _nextGemPos.y;
        constellationPositions[offset + 5] = _nextGemPos.z;
      }

      const beamOffset = moteCount * 6;
      if (highlightIdx >= 0 && highlightIdx < moteCount) {
        const hp = gemLocalPositions[highlightIdx];
        constellationPositions[beamOffset] = 0;
        constellationPositions[beamOffset + 1] = 0;
        constellationPositions[beamOffset + 2] = 0;
        constellationPositions[beamOffset + 3] = hp.x;
        constellationPositions[beamOffset + 4] = hp.y;
        constellationPositions[beamOffset + 5] = hp.z;
      } else {
        constellationPositions[beamOffset] = 0;
        constellationPositions[beamOffset + 1] = 0;
        constellationPositions[beamOffset + 2] = 0;
        constellationPositions[beamOffset + 3] = 0;
        constellationPositions[beamOffset + 4] = 0;
        constellationPositions[beamOffset + 5] = 0;
      }
      constellationGeo.attributes.position.needsUpdate = true;

      // Update Pretty Female Fortune Teller Portrait, Astrolabe Halo, Incense Smoke, Hovering Hands & Candles
      seerSignals.energy = st.energy;
      seerSignals.bassEnergy = st.bassEnergy;
      seerSignals.micEnergy = st.micEnergy;
      seerSignals.speakingEnergy = st.speakingEnergy;
      seerSignals.beatImpulse = 0;
      seerSignals.swirlSpeed = st.swirlSpeed;
      seerSignals.pointerNdcX = st.pointerNdcX;
      seerSignals.pointerNdcY = st.pointerNdcY;
      seerSignals.stageWeights = stageWeights;
      parlorRig.update(elapsed, delta, seerSignals);

      // Update Behind-the-Orb 3D 24-Domain Telemetry Arch, Anomaly Markers & 32-Band Audio Halo (Stage 5)
      backdropSignals.energy = st.energy;
      backdropSignals.bassEnergy = st.bassEnergy;
      backdropSignals.micEnergy = st.micEnergy;
      backdropSignals.speakingEnergy = st.speakingEnergy;
      backdropSignals.beatImpulse = 0;
      backdropSignals.domainNorms = st.domainNorms;
      backdropSignals.focusedIndex = st.focusedIndex;
      backdropSignals.hoveredIndex = st.hoveredIndex;
      backdropSignals.animationWeight = wConstellation;
      celestialBackdropUi.update(elapsed, delta, backdropSignals);

      controls.update();

      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();
      parlorRig.dispose();
      celestialBackdropUi.dispose();

      plinthGeo.dispose();
      plinthMat.dispose();
      collarGeo.dispose();
      stepRingGeo.dispose();
      brassMat.dispose();
      goldMat.dispose();
      clawGeometries.forEach((g) => g.dispose());
      clawGemGeo.dispose();
      clawGemMat.dispose();
      gimbalOuterGeo.dispose();
      gimbalInnerGeo.dispose();
      runeRingOuterGeo.dispose();
      runeRingOuterMat.dispose();
      runeRingInnerGeo.dispose();
      runeRingInnerMat.dispose();
      singularityGeo.dispose();
      singularityMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      nebulaGeo.dispose();
      nebulaMat.dispose();
      arcGeo.dispose();
      arcMat.dispose();
      glassGeo.dispose();
      glassMat.dispose();
      auraGeo.dispose();
      auraMat.dispose();
      moteGeo.dispose();
      moteMat.dispose();
      domeWireGeo.dispose();
      domeMat.dispose();
      constellationGeo.dispose();
      constellationMat.dispose();
      starGeo.dispose();
      starMat.dispose();

      runeTexPrimary.dispose();
      runeTexSecondary.dispose();
      brassRoughTex.dispose();
      glowSpriteTex.dispose();
      envTarget.dispose();
      if (composer) {
        composer.dispose();
      }
      renderer.dispose();
      if (canvas.parentElement === container) {
        container.removeChild(canvas);
      }
    };
  }, []);

  // 2D Canvas fallback if WebGL is completely unavailable
  useEffect(() => {
    if (!webglFailed || !fallbackCanvasRef.current) return;
    const canvas = fallbackCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const draw = (timeMs: number) => {
      const w = (canvas.width = canvas.clientWidth || window.innerWidth);
      const h = (canvas.height = canvas.clientHeight || window.innerHeight);
      ctx.fillStyle = '#05070e';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2 - 20;
      const r = Math.min(w, h) * 0.22;
      const t = timeMs * 0.001;

      const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#fef3c7');
      g.addColorStop(0.45, liveStateRef.current.primaryHex);
      g.addColorStop(0.85, liveStateRef.current.secondaryHex);
      g.addColorStop(1, 'rgba(5, 7, 14, 0.2)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.32, r * 0.36, Math.sin(t * 0.3) * 0.2, 0, Math.PI * 2);
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [webglFailed]);

  const handleSyncWeather = useCallback(async () => {
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
          setPulseTimestamp(Date.now());
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
          setPulseTimestamp(Date.now());
          setIsSyncingWeather(false);
        },
        { timeout: 6000 }
      );
    } else {
      const synced = await telemetryEngine.syncGeolocationWeather(
        51.5074,
        -0.1278,
        'London Met Hub'
      );
      setWeatherCtx(synced);
      setLatestByDomain(telemetryEngine.getLatestByDomain());
      setPulseTimestamp(Date.now());
      setIsSyncingWeather(false);
    }
  }, []);

  const handleToggleMusic = async () => {
    if (seqStatus.isPlaying) {
      audioDspEngine.stop32BarSequencer();
    } else {
      await audioDspEngine.start32BarSequencer(compositionPlan);
      setPulseTimestamp(Date.now());
    }
  };

  const handleGazeOrb = async () => {
    const prompt =
      focusedDomain === 'all'
        ? `Summarize live conditions across ${weatherCtx.region} (${weatherCtx.temperatureC.toFixed(1)}°C, AQI ${weatherCtx.aqi}) and the ${compositionPlan.bpm} BPM musical telemetry.`
        : `Give a concise reading of live telemetry for ${UNIVERSAL_DOMAINS[focusedDomain].name}.`;
    await submitOracleQuestion(prompt);
  };

  const handleTypedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = typedQuestion.trim();
    if (!q || oracleLoading) return;
    setTypedQuestion('');
    await submitOracleQuestion(q);
  };

  const handleLensChange = (nextDomain: 'all' | DomainCategory) => {
    onChangeFocusedDomain(nextDomain);
    setPulseTimestamp(Date.now());
    speakDomainInstant(nextDomain);
  };

  const focusedReading = focusedDomain === 'all' ? null : vector24[focusedDomain];

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0a0d14] text-[#e6e1d8] select-none">
      {/* 3D WebGL Canvas Mount (Double-click anywhere on orb to query & speak) */}
      <div
        ref={mountRef}
        onDoubleClick={handleGazeOrb}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      />

      {webglFailed && (
        <canvas ref={fallbackCanvasRef} className="absolute inset-0 w-full h-full" />
      )}

      {/* Projected 3D Hover Readout over Orbital Domain Gem or Behind-the-Orb Telemetry Arch Node */}
      {hoverReadout && (
        <div
          style={{
            transform: `translate(${Math.max(
              12,
              Math.min(
                (typeof window !== 'undefined' ? window.innerWidth : 1280) - 228,
                Math.round(hoverReadout.screenX + 14)
              )
            )}px, ${Math.max(
              12,
              Math.min(
                (typeof window !== 'undefined' ? window.innerHeight : 720) - 68,
                Math.round(hoverReadout.screenY - 20)
              )
            )}px)`
          }}
          className="pointer-events-none fixed top-0 left-0 z-20 rounded-xl bg-[#141821]/95 border border-[#c8b28e]/30 px-3 py-1.5 shadow-xl"
        >
          <div className="text-xs font-medium text-[#ede8df] whitespace-nowrap flex items-center gap-2">
            <span>{hoverReadout.name}</span>
            {hoverReadout.isAnomaly && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#d4a96a]">
                Anomaly
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#cfc2aa] flex items-center gap-1.5 whitespace-nowrap">
            <span>{hoverReadout.formattedValue}</span>
            <span aria-hidden="true" className="text-stone-500">·</span>
            <span className="text-[#94b8b1]">{hoverReadout.normalizedPct}%</span>
          </div>
        </div>
      )}

      {/* Top-Left Minimal Wordmark, Dynamic Telemetry Signature & Active Hour */}
      <div className="pointer-events-none fixed top-5 left-6 z-20 max-w-xl space-y-1">
        <h1 className="font-display text-xl sm:text-2xl font-medium tracking-wide text-[#ebe6dc]/92">
          Weather Beats
        </h1>
        <div className="text-xs font-mono tabular-nums text-[#a6a29a] flex flex-wrap items-center gap-2">
          <span>{weatherCtx.region}</span>
          <span aria-hidden="true" className="text-stone-600">·</span>
          <span>{weatherCtx.temperatureC.toFixed(1)}°C</span>
          <span aria-hidden="true" className="text-stone-600">·</span>
          <span>AQI {weatherCtx.aqi}</span>
          <span aria-hidden="true" className="text-stone-600">·</span>
          <span className="text-[#9bb8b3]">{compositionPlan.telemetrySignatureLabel}</span>
          <span aria-hidden="true" className="text-stone-600">·</span>
          <span className="text-[#d4bc94]">
            {compositionPlan.activeTelemetryHour.hourLabel} · {compositionPlan.activeTelemetryHour.mapping.instrument}
          </span>
          {seqStatus.isPlaying && (
            <>
              <span aria-hidden="true" className="text-stone-600">·</span>
              <span className="text-[#99bfa8]">
                Bar {seqStatus.currentBar} · {seqStatus.currentChord}
              </span>
            </>
          )}
          {focusedReading && (
            <>
              <span aria-hidden="true" className="text-stone-600">·</span>
              <span className="text-[#d4bc94]">
                {focusedReading.name}: {focusedReading.rawValue} {focusedReading.unit}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Top-Right Settings Cogwheel */}
      <div className="fixed top-5 right-6 z-30">
        <button
          onClick={onOpenSettings}
          aria-label="Open Settings Drawer"
          title="Open Settings Drawer"
          className="group w-11 h-11 rounded-full bg-[#151a24]/90 hover:bg-[#1d2331] border border-white/[0.1] hover:border-[#c8b28e]/45 flex items-center justify-center text-[#c9c4ba] hover:text-[#e6d5b8] transition-all shadow-lg focus-visible:outline-2 focus-visible:outline-[#c8b28e]"
        >
          <Settings className="w-5 h-5 transition-transform duration-300 group-hover:rotate-45" />
        </button>
      </div>

      {/* Minimal Bottom-Right Play & Controls Bar When Controls Are Hidden By Default (Matches Clean Emulator Startup) */}
      {dockCollapsed && (
        <div className="fixed bottom-4 right-5 z-20 flex items-center gap-2">
          <button
            onClick={handleToggleMusic}
            className={`px-3.5 py-1.5 rounded-xl text-[11px] font-mono font-semibold flex items-center gap-1.5 border whitespace-nowrap transition-colors shadow-lg focus-visible:outline-2 focus-visible:outline-[#c8b28e] ${
              seqStatus.isPlaying
                ? 'bg-[#7fa898] hover:bg-[#8eb5a5] text-[#11151d] border-[#8eb5a5]/70'
                : 'bg-[#c9b18a] hover:bg-[#d5bf9b] text-[#11151d] border-[#d5bf9b]/70'
            }`}
          >
            {seqStatus.isPlaying ? (
              <Square className="w-3 h-3 fill-current" />
            ) : (
              <Play className="w-3 h-3 fill-current" />
            )}
            <span>{seqStatus.isPlaying ? 'Stop Flow' : 'Play Flow'}</span>
          </button>
          <button
            onClick={() => setDockCollapsed(false)}
            aria-expanded={false}
            aria-controls="crystal-ball-control-dock"
            title="Show Controls (Shortcut: H)"
            className="px-3.5 py-1.5 rounded-xl bg-[#151a24]/90 hover:bg-[#1e2534] border border-white/[0.1] hover:border-[#c8b28e]/40 text-[11px] font-mono text-[#c9c4ba] hover:text-[#ede8df] flex items-center gap-1.5 transition-colors shadow-lg focus-visible:outline-2 focus-visible:outline-[#c8b28e]"
          >
            <ChevronUp className="w-3.5 h-3.5 text-[#c8b28e]" />
            <span>Controls</span>
          </button>
        </div>
      )}

      {/* Compact Single Bottom Control Dock (Hidden By Default · Zero Obstruction Over Seer & Crystal Ball) */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-20 w-[min(980px,95vw)] flex flex-col items-center gap-2 pointer-events-none">
        {/* Subtle Faded Ambient Seer Whisper Subtitle (Non-Obstructive, Zero Card Box) */}
        <div
          aria-live="polite"
          className={`pointer-events-none max-w-2xl px-4 text-center transition-all duration-700 ease-out motion-reduce:transition-none ${
            activeWhisper && ambientWhispersEnabled
              ? 'opacity-90 translate-y-0'
              : 'opacity-0 translate-y-1'
          }`}
        >
          {activeWhisper && ambientWhispersEnabled && (
            <p className="inline-block px-3.5 py-1.5 rounded-lg bg-[#10141c]/85 border border-white/[0.08] font-display italic text-xs sm:text-sm tracking-wide text-[#efe6d6]">
              <span>“{activeWhisper.text}”</span>
              <span className="not-italic font-mono text-[10px] text-[#a9a49b] ml-2 whitespace-nowrap">
                · {activeWhisper.domainName.replace(' Intelligence', '')}
              </span>
            </p>
          )}
        </div>

        {!dockCollapsed && (
          <>
            <button
              onClick={() => setDockCollapsed(true)}
              aria-expanded={true}
              aria-controls="crystal-ball-control-dock"
              title="Hide Controls (Shortcut: H)"
              className="pointer-events-auto px-3 py-1 rounded-full bg-[#151a24]/95 border border-white/[0.1] text-[11px] font-mono text-[#b5b0a6] hover:text-[#ede8df] flex items-center gap-1.5 transition-colors shadow focus-visible:outline-2 focus-visible:outline-[#c8b28e]"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              <span>Hide Controls</span>
            </button>

            <div
              id="crystal-ball-control-dock"
              className="w-full pointer-events-auto rounded-2xl bg-[#131822]/96 border border-white/[0.09] px-4 py-3 flex flex-col gap-2.5 shadow-2xl"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={handleSyncWeather}
                    disabled={isSyncingWeather}
                    className="px-2.5 py-1.5 rounded-xl bg-[#1b2230] hover:bg-[#232c3d] border border-white/[0.08] text-xs font-medium text-[#a3c2bc] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors disabled:opacity-60"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{isSyncingWeather ? 'Syncing...' : 'Sync Weather'}</span>
                  </button>

                  <button
                    onClick={handleToggleMusic}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border whitespace-nowrap shrink-0 transition-colors ${
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
                    <span>{seqStatus.isPlaying ? 'Stop Flow' : 'Play Flow'}</span>
                  </button>

                  <button
                    onClick={() => audioDspEngine.setLyriaFlowEnabled(!lyriaState.enabled)}
                    aria-pressed={lyriaState.enabled}
                    title="Blend purely instrumental Google Lyria 3 Flow Music seamlessly with the live 24-telemetry synth"
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 border whitespace-nowrap shrink-0 transition-colors ${
                      lyriaState.enabled
                        ? 'bg-[#222938] text-[#a3c2bc] border-[#7fa898]/45 hover:bg-[#293244]'
                        : 'bg-[#1b2230] hover:bg-[#232c3d] text-[#c9c4ba] border-white/[0.08]'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#c9b18a]" />
                    <span>{lyriaState.enabled ? 'Lyria Flow On' : 'Lyria Flow'}</span>
                  </button>

                  <button
                    onClick={() => audioDspEngine.setAmbientWhispersEnabled(!ambientWhispersEnabled)}
                    aria-pressed={ambientWhispersEnabled}
                    title="Toggle subtle ambient telemetry whispers from the fortune teller during playback"
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 border whitespace-nowrap shrink-0 transition-colors ${
                      ambientWhispersEnabled
                        ? 'bg-[#222938] text-[#e0cda9] border-[#c8b28e]/35 hover:bg-[#293244]'
                        : 'bg-[#1b2230] hover:bg-[#232c3d] text-[#949088] border-white/[0.08]'
                    }`}
                  >
                    <Waves className="w-3.5 h-3.5" />
                    <span>{ambientWhispersEnabled ? 'Whispers On' : 'Whispers'}</span>
                  </button>

                  <button
                    onClick={handleToggleListening}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 border whitespace-nowrap shrink-0 transition-colors ${
                      isListening
                        ? 'bg-[#c27d77] text-[#12151c] border-[#d2908a]'
                        : 'bg-[#1b2230] hover:bg-[#232c3d] text-[#d9c39e] border-white/[0.08]'
                    }`}
                  >
                    {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    <span>{isListening ? 'Stop Mic' : 'Ask by Voice'}</span>
                  </button>

                  <button
                    onClick={handleToggleMicVisualizer}
                    aria-pressed={isVisualizerPinned || isMicVisualizerActive}
                    title="Sync nebula core and floating runes to live microphone audio"
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 border whitespace-nowrap shrink-0 transition-colors ${
                      isVisualizerPinned
                        ? 'bg-[#c9b18a] text-[#11151d] border-[#d5bf9b]'
                        : isMicVisualizerActive
                          ? 'bg-[#222938] text-[#e0cda9] border-[#c8b28e]/40'
                          : 'bg-[#1b2230] hover:bg-[#232c3d] text-[#c9c4ba] border-white/[0.08]'
                    }`}
                  >
                    <AudioLines className="w-3.5 h-3.5" />
                    <span>{isVisualizerPinned ? 'Mic Sync On' : 'Mic Sync'}</span>
                  </button>

                  <button
                    onClick={handleToggleLiveVoice}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 border whitespace-nowrap shrink-0 transition-colors ${
                      liveVoiceState === 'connected'
                        ? 'bg-[#7fa898] text-[#11151d] border-[#8eb5a5]'
                        : liveVoiceState === 'connecting'
                          ? 'bg-[#222938] text-[#e0cda9] border-[#c8b28e]/45'
                          : 'bg-[#1b2230] hover:bg-[#232c3d] text-[#a3c2bc] border-white/[0.08]'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>
                      {liveVoiceState === 'connected'
                        ? 'End Live Voice'
                        : liveVoiceState === 'connecting'
                          ? 'Connecting...'
                          : 'Live Voice'}
                    </span>
                  </button>

                  {audioDspEngine.canUndoDirectorPatch() && (
                    <button
                      onClick={() => {
                        const msg = audioDspEngine.revertLastDirectorPatch();
                        setActionNotice(msg ?? 'Reverted last musical direction.');
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-[#1b2230] hover:bg-[#232c3d] border border-white/[0.08] text-xs font-medium text-[#d4bc94] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>Undo Mix</span>
                    </button>
                  )}

                  {oracleResult && (
                    <button
                      onClick={() =>
                        isSpeakingReply ? stopSpeechPlayback() : playVoiceReply(oracleResult)
                      }
                      className="px-2.5 py-1.5 rounded-xl bg-[#1b2230] hover:bg-[#232c3d] border border-white/[0.08] text-xs font-medium text-[#dcd7cd] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                    >
                      {isSpeakingReply ? (
                        <Square className="w-3 h-3 fill-current text-[#d4bc94]" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5 text-[#9bb8b3]" />
                      )}
                      <span>{isSpeakingReply ? 'Silence' : 'Replay'}</span>
                    </button>
                  )}

                  <button
                    onClick={onToggleVoiceReply}
                    aria-label={voiceReplyEnabled ? 'Mute spoken AI voice' : 'Unmute spoken AI voice'}
                    className="px-2.5 py-1.5 rounded-xl bg-[#1b2230] hover:bg-[#232c3d] border border-white/[0.08] text-xs font-medium text-[#c9c4ba] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                  >
                    {voiceReplyEnabled ? (
                      <Volume2 className="w-3.5 h-3.5 text-[#9bb8b3]" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5 text-[#75736e]" />
                    )}
                    <span>{voiceReplyEnabled ? 'Voice On' : 'Muted'}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <label htmlFor="orb-domain-lens" className="text-xs font-mono text-[#9c9991]">
                    Lens
                  </label>
                  <select
                    id="orb-domain-lens"
                    value={focusedDomain}
                    onChange={(e) => handleLensChange(e.target.value as 'all' | DomainCategory)}
                    className="bg-[#0f131b] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#e6e1d8] focus:outline-none focus:border-[#c8b28e]/60 cursor-pointer"
                  >
                    <option value="all">All 24 Domains</option>
                    {ALL_DOMAINS_LIST.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <form onSubmit={handleTypedSubmit} className="flex items-center gap-2">
                <input
                  ref={typedInputRef}
                  type="text"
                  value={typedQuestion}
                  onChange={(e) => setTypedQuestion(e.target.value)}
                  placeholder={
                    isListening
                      ? `Listening: ${liveTranscript || 'speak your question or musical direction...'}`
                      : oracleLoading
                        ? 'Consulting 24 telemetry streams...'
                        : 'Ask telemetry, direct the mix (e.g. Make it warmer with deeper reverb), or create a smart alert...'
                  }
                  className="flex-1 select-text bg-[#0f131b] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-[#ece7df] placeholder:text-[#7e7b74] focus:outline-none focus:border-[#c8b28e]/55"
                />
                <button
                  type="submit"
                  disabled={oracleLoading || !typedQuestion.trim()}
                  className="px-3.5 py-2 rounded-xl bg-[#1b2230] hover:bg-[#232c3d] border border-white/[0.09] text-xs font-medium text-[#d8c4a0] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{oracleLoading ? 'Working...' : 'Send'}</span>
                </button>
              </form>

              {(lyriaState.enabled || lyriaState.errorMessage) && (
                <div className="flex flex-col gap-1.5 rounded-xl bg-[#0f131b] border border-white/[0.08] px-3 py-2 text-[11px] font-mono">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="text-[#c9b18a] whitespace-nowrap">Synth ↔ Lyria</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={lyriaState.blend}
                        onChange={(e) => audioDspEngine.setLyriaFlowBlend(Number(e.target.value))}
                        aria-label="Synth to Google Lyria Flow blend"
                        className="w-28 sm:w-36 accent-[#7fa898] cursor-pointer h-1.5 bg-[#202634] rounded-lg"
                      />
                      <span className="text-[#a3c2bc] tabular-nums whitespace-nowrap">
                        {Math.round(lyriaState.blend * 100)}% Lyria
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 sm:text-right truncate text-[#9c9991]">
                      {lyriaState.errorMessage
                        ? 'Lyria stream paused · Live 24-telemetry synth playing'
                        : !seqStatus.isPlaying
                          ? 'Lyria Clip armed · press Play Flow to stream instrumental blend'
                          : lyriaState.status === 'generating'
                            ? 'Composing instrumental Lyria 3 clip (live synth playing)...'
                            : lyriaState.status === 'crossfading'
                              ? `Crossfading Deck ${lyriaState.activeDeck ?? 'A'} · ${lyriaState.activePromptSummary ?? 'evolving'}`
                              : lyriaState.activeDeck
                                ? `Deck ${lyriaState.activeDeck} live · ${lyriaState.activePromptSummary ?? 'instrumental flow'}`
                                : 'Lyria Flow ready'}
                    </div>
                  </div>
                  {lyriaState.errorMessage && (
                    <div className="text-[#e5a8a3] leading-snug">{lyriaState.errorMessage}</div>
                  )}
                </div>
              )}

              {(actionNotice ||
                liveVoiceError ||
                micError ||
                micVisualizerError ||
                (!voiceReplyEnabled && oracleResult)) && (
                <div className="text-[11px] font-mono text-[#d4bc94] truncate px-1">
                  {actionNotice ||
                    liveVoiceError ||
                    micError ||
                    micVisualizerError ||
                    oracleResult?.answerText}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
