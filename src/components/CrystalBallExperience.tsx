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
  Volume2,
  VolumeX,
  Send,
  RotateCcw
} from 'lucide-react';
import { DomainCategory } from '../types/telemetry';
import { ALL_DOMAINS_LIST, UNIVERSAL_DOMAINS } from '../services/domainRegistry';
import { GeolocationWeatherContext, telemetryEngine } from '../services/telemetryEngine';
import { audioDspEngine, SequencerPlaybackStatus } from '../services/audioDspEngine';
import {
  build32BarComposition,
  computeDomainVector24
} from '../services/weatherBeatsComposer';
import { queryVoiceTelemetryOracle } from '../services/geminiService';
import { VoiceQueryResult } from '../services/voiceTelemetryOracle';
import {
  SINGULARITY_VERTEX_SHADER,
  SINGULARITY_FRAGMENT_SHADER,
  NEBULA_VERTEX_SHADER,
  NEBULA_FRAGMENT_SHADER,
  AURA_VERTEX_SHADER,
  AURA_FRAGMENT_SHADER,
  createAstrolabeRuneRingTexture,
  createAltarMandalaTexture,
  createBrushedBrassRoughnessTexture,
  createSoftGlowSpriteTexture,
  updateArcSegmentsBuffer
} from '../services/crystalBallVisuals';

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

  // Mic Capture & Orb Voice Playback Analyser Refs (Strictly separated to avoid feedback)
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micBufferRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(new ArrayBuffer(256 * 4)));
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptDraftRef = useRef<string>('');

  const speechAudioCtxRef = useRef<AudioContext | null>(null);
  const speechAnalyserRef = useRef<AnalyserNode | null>(null);
  const speechSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const speechFallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechBufferRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(new ArrayBuffer(256 * 4)));
  const isSynthSpeakingRef = useRef<boolean>(false);

  const [webglFailed, setWebglFailed] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [weatherCtx, setWeatherCtx] = useState<GeolocationWeatherContext>(() =>
    telemetryEngine.getWeatherContext()
  );
  const [latestByDomain, setLatestByDomain] = useState(() => telemetryEngine.getLatestByDomain());
  const [seqStatus, setSeqStatus] = useState<SequencerPlaybackStatus>(() =>
    audioDspEngine.getSequencerStatus()
  );
  const [isSyncingWeather, setIsSyncingWeather] = useState(false);
  const [typedQuestion, setTypedQuestion] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const [oracleLoading, setOracleLoading] = useState(false);
  const [oracleResult, setOracleResult] = useState<VoiceQueryResult | null>(null);
  const [isSpeakingReply, setIsSpeakingReply] = useState(false);
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
    energy: 0.36,
    bassEnergy: 0.25,
    micEnergy: 0,
    speakingEnergy: 0,
    swirlSpeed: 0.45,
    primaryHex: '#0ea5e9',
    secondaryHex: '#6366f1',
    accentHex: '#f59e0b',
    domainNorms: new Array(24).fill(0.5) as number[],
    domainColors: ALL_DOMAINS_LIST.map((d) => d.colorHex),
    focusedIndex: -1,
    hoveredIndex: -1,
    pulseAge: 10
  });

  useEffect(() => {
    const unsubTel = telemetryEngine.subscribe(() => {
      setLatestByDomain(telemetryEngine.getLatestByDomain());
      setWeatherCtx(telemetryEngine.getWeatherContext());
    });
    const unsubSeq = audioDspEngine.subscribeSequencer((status) => {
      setSeqStatus(status);
    });
    return () => {
      unsubTel();
      unsubSeq();
    };
  }, []);

  const vector24 = useMemo(
    () => computeDomainVector24(latestByDomain, weatherCtx),
    [latestByDomain, weatherCtx]
  );

  const compositionPlan = useMemo(
    () => build32BarComposition(vector24, weatherCtx),
    [vector24, weatherCtx]
  );

  useEffect(() => {
    audioDspEngine.updateCompositionPlan(compositionPlan);
  }, [compositionPlan]);

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
      let fftSum = 0;
      let bassSum = 0;
      for (let i = 0; i < spectrum.length; i++) {
        fftSum += spectrum[i];
        if (i < 6) bassSum += spectrum[i];
      }
      const fftAvg = fftSum / Math.max(1, spectrum.length);
      const bassAvg = bassSum / 6;

      let micRms = 0;
      if (micAnalyserRef.current) {
        const buf = micBufferRef.current;
        micAnalyserRef.current.getFloatTimeDomainData(buf);
        let sq = 0;
        for (let i = 0; i < buf.length; i++) {
          sq += buf[i] * buf[i];
        }
        micRms = Math.min(1, Math.sqrt(sq / buf.length) * 5.2);
      }

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
      const primaryHex = selectedMeta
        ? selectedMeta.colorHex
        : tempNorm > 0.58
          ? '#0ea5e9'
          : '#06b6d4';
      const secondaryHex = selectedMeta ? '#4f46e5' : solarNorm > 0.55 ? '#6d28d9' : '#1d4ed8';
      const accentHex = selectedMeta
        ? '#fbbf24'
        : tempNorm > 0.55
          ? '#f59e0b'
          : '#7dd3fc';

      const voiceEnergyBoost = Math.max(micRms * 0.72, speakRms * 0.85);
      liveStateRef.current.micEnergy = micRms;
      liveStateRef.current.speakingEnergy = speakRms;
      liveStateRef.current.bassEnergy = Math.min(
        1,
        bassAvg * 2.8 + (seqStatus.isPlaying ? 0.25 : 0) + speakRms * 0.5
      );
      liveStateRef.current.energy = Math.min(
        1,
        0.24 + fftAvg * 2.5 + voiceEnergyBoost + (seqStatus.isPlaying ? 0.24 : 0)
      );
      liveStateRef.current.swirlSpeed =
        0.26 + windNorm * 0.65 + vector24.space.normalized * 0.35 + voiceEnergyBoost * 0.85;
      liveStateRef.current.primaryHex = primaryHex;
      liveStateRef.current.secondaryHex = secondaryHex;
      liveStateRef.current.accentHex = accentHex;
      liveStateRef.current.domainNorms = ALL_DOMAINS_LIST.map((d) => vector24[d.id].normalized);
      liveStateRef.current.focusedIndex =
        focusedDomain === 'all' ? -1 : (DOMAIN_INDEX_MAP.get(focusedDomain) ?? -1);
      liveStateRef.current.pulseAge = (Date.now() - pulseTimestamp) / 1000;

      rafId = requestAnimationFrame(sampleSignals);
    };

    rafId = requestAnimationFrame(sampleSignals);
    return () => cancelAnimationFrame(rafId);
  }, [vector24, weatherCtx, focusedDomain, seqStatus.isPlaying, pulseTimestamp]);

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
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.98;
      utterance.pitch = 0.96;
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

      if (result.audioBase64Wav) {
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx) {
            if (!speechAudioCtxRef.current) {
              speechAudioCtxRef.current = new AudioCtx();
              const analyser = speechAudioCtxRef.current.createAnalyser();
              analyser.fftSize = 256;
              analyser.connect(speechAudioCtxRef.current.destination);
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
      setPulseTimestamp(Date.now());
      audioDspEngine.auditionNativeVoice('kora', compositionPlan);

      try {
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
      } finally {
        setOracleLoading(false);
      }
    },
    [compositionPlan, vector24, weatherCtx, voiceReplyEnabled, playVoiceReply]
  );

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
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    micAnalyserRef.current = null;
    if (micAudioCtxRef.current) {
      micAudioCtxRef.current.close().catch(() => {});
      micAudioCtxRef.current = null;
    }
    setIsListening(false);
  }, []);

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
    setLiveTranscript('');
    transcriptDraftRef.current = '';
    stopSpeechPlayback();
    setDockCollapsed(false);

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          // Connect strictly to AnalyserNode (NOT destination) to prevent acoustic speaker feedback
          source.connect(analyser);
          micAudioCtxRef.current = ctx;
          micAnalyserRef.current = analyser;
        }
      }
    } catch {
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
  }, [isListening, stopMicrophoneCapture, stopSpeechPlayback]);

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
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05070e');
    scene.fog = new THREE.FogExp2('#05070e', 0.046);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.95, 7.15);

    const controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 4.0;
    controls.maxDistance = 10.6;
    controls.minPolarAngle = Math.PI * 0.18;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.target.set(0, -0.05, 0);
    controls.update();

    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    if (!isSoftwareGl) {
      composer = new EffectComposer(renderer);
      composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      composer.setSize(width, height);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.58, 0.52, 0.72);
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
    }

    // Warm/Cool Studio Observatory Lighting Rig
    const hemiLight = new THREE.HemisphereLight('#7dd3fc', '#0f172a', 0.78);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#fff5e1', 2.4);
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

    const rimLight = new THREE.DirectionalLight('#38bdf8', 1.85);
    rimLight.position.set(-4.8, 3.6, -4.6);
    scene.add(rimLight);

    const brassBounceLight = new THREE.PointLight('#f59e0b', 1.6, 8, 2);
    brassBounceLight.position.set(0, -0.55, 1.3);
    scene.add(brassBounceLight);

    const corePointLight = new THREE.PointLight('#38bdf8', 2.8, 10, 2);
    corePointLight.position.set(0, 0.35, 0);
    scene.add(corePointLight);

    // Procedural Canvas Textures
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const altarTex = createAltarMandalaTexture();
    altarTex.anisotropy = maxAniso;
    const runeTexPrimary = createAstrolabeRuneRingTexture('#fbbf24', '#38bdf8');
    runeTexPrimary.anisotropy = maxAniso;
    const runeTexSecondary = createAstrolabeRuneRingTexture('#38bdf8', '#a855f7');
    runeTexSecondary.anisotropy = maxAniso;
    const brassRoughTex = createBrushedBrassRoughnessTexture();
    const glowSpriteTex = createSoftGlowSpriteTexture();

    // Composite Celestial Brass Astrolabe Observatory
    const orbAssembly = new THREE.Group();
    scene.add(orbAssembly);

    // 1. Etched Obsidian & Inlaid Brass Altar Floor Disc
    const floorGeo = new THREE.CircleGeometry(5.6, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: altarTex,
      roughness: 0.72,
      metalness: 0.25,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -1.78;
    floorMesh.receiveShadow = true;
    orbAssembly.add(floorMesh);

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
      emissive: '#f59e0b',
      emissiveIntensity: 1.5,
      roughness: 0.12,
      metalness: 0.3
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
      map: runeTexPrimary,
      transparent: true,
      opacity: 0.85,
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
      map: runeTexSecondary,
      transparent: true,
      opacity: 0.72,
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
      opacity: 0.78,
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
      roughness: 0.16,
      metalness: 0.55,
      emissive: '#38bdf8',
      emissiveIntensity: 1.05
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
      color: '#38bdf8',
      transparent: true,
      opacity: 0.085,
      depthWrite: false
    });
    const domeWire = new THREE.LineSegments(domeWireGeo, domeMat);
    domeWire.position.y = 0.65;
    orbAssembly.add(domeWire);

    const constellationPositions = new Float32Array((moteCount + 1) * 6);
    const constellationGeo = new THREE.BufferGeometry();
    constellationGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(constellationPositions, 3)
    );
    const constellationMat = new THREE.LineBasicMaterial({
      color: '#7dd3fc',
      transparent: true,
      opacity: 0.32,
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

    // Raycasting Hover & Click Inspection across the 24 Orbital Domain Gems
    let pointerDownX = 0;
    let pointerDownY = 0;
    let lastRaycastMs = 0;
    const gemWorldPositions = Array.from({ length: moteCount }, () => new THREE.Vector3());

    const updatePointerNdc = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastRaycastMs < 32) return;
      lastRaycastMs = now;

      updatePointerNdc(e.clientX, e.clientY);
      _raycaster.setFromCamera(_pointerNdc, camera);
      const hits = _raycaster.intersectObject(motesInstanced, false);

      if (hits.length > 0 && hits[0].instanceId !== undefined) {
        const idx = hits[0].instanceId;
        liveStateRef.current.hoveredIndex = idx;
        canvas.style.cursor = 'pointer';
        const domainMeta = ALL_DOMAINS_LIST[idx];
        const reading = vector24Ref.current[domainMeta.id];
        _projVec.copy(gemWorldPositions[idx]).project(camera);
        const rect = canvas.getBoundingClientRect();
        const sx = ((_projVec.x + 1) * 0.5) * rect.width;
        const sy = ((-_projVec.y + 1) * 0.5) * rect.height;
        setHoverReadout({
          index: idx,
          domainId: domainMeta.id,
          name: domainMeta.name,
          formattedValue: `${reading.rawValue} ${reading.unit}`,
          normalizedPct: Math.round(reading.normalized * 100),
          screenX: sx,
          screenY: sy
        });
      } else if (liveStateRef.current.hoveredIndex !== -1) {
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
      const hits = _raycaster.intersectObject(motesInstanced, false);
      if (hits.length > 0 && hits[0].instanceId !== undefined) {
        const domainMeta = ALL_DOMAINS_LIST[hits[0].instanceId];
        const nextDomain =
          focusedDomainRef.current === domainMeta.id ? 'all' : domainMeta.id;
        onChangeDomainRef.current(nextDomain);
        setPulseTimestamp(Date.now());
        audioDspEngine.auditionNativeVoice('kora', compositionPlan);
        speakDomainInstantRef.current(nextDomain);
      }
    };

    canvas.addEventListener('pointermove', handlePointerMove);
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

    const tick = () => {
      if (disposed) return;
      const delta = Math.min(0.1, clock.getDelta());
      const elapsed = clock.getElapsedTime();
      const st = liveStateRef.current;

      const motionMul = reducedMotion ? 0.12 : 1.0;
      const pulseDecay = st.pulseAge < 0.9 ? Math.pow(1 - st.pulseAge / 0.9, 1.6) : 0;
      const beatImpulse = Math.min(
        1.0,
        st.bassEnergy * 0.68 + st.micEnergy * 0.9 + st.speakingEnergy * 1.15 + pulseDecay * 0.65
      );

      singularityMat.uniforms.uTime.value = elapsed * motionMul;
      singularityMat.uniforms.uEnergy.value = THREE.MathUtils.damp(
        singularityMat.uniforms.uEnergy.value,
        st.energy,
        5.0,
        delta
      );
      singularityMat.uniforms.uBeatPulse.value = THREE.MathUtils.damp(
        singularityMat.uniforms.uBeatPulse.value,
        beatImpulse,
        10.0,
        delta
      );

      nebulaMat.uniforms.uTime.value = elapsed * motionMul;
      nebulaMat.uniforms.uEnergy.value = singularityMat.uniforms.uEnergy.value;
      nebulaMat.uniforms.uBeatPulse.value = singularityMat.uniforms.uBeatPulse.value;
      nebulaMat.uniforms.uSwirlSpeed.value = THREE.MathUtils.damp(
        nebulaMat.uniforms.uSwirlSpeed.value,
        st.swirlSpeed,
        4.0,
        delta
      );

      auraMat.uniforms.uTime.value = elapsed * motionMul;
      auraMat.uniforms.uEnergy.value = singularityMat.uniforms.uEnergy.value;
      auraMat.uniforms.uBeatPulse.value = singularityMat.uniforms.uBeatPulse.value;

      _tempColor.set(st.primaryHex);
      nebulaMat.uniforms.uColorPrimary.value.lerp(_tempColor, Math.min(1, delta * 3));
      singularityMat.uniforms.uColorPrimary.value.copy(nebulaMat.uniforms.uColorPrimary.value);
      auraMat.uniforms.uColorPrimary.value.copy(nebulaMat.uniforms.uColorPrimary.value);

      _tempColor.set(st.secondaryHex);
      nebulaMat.uniforms.uColorSecondary.value.lerp(_tempColor, Math.min(1, delta * 3));

      _tempColor.set(st.accentHex);
      nebulaMat.uniforms.uColorAccent.value.lerp(_tempColor, Math.min(1, delta * 3));
      singularityMat.uniforms.uColorAccent.value.copy(nebulaMat.uniforms.uColorAccent.value);
      auraMat.uniforms.uColorAccent.value.copy(nebulaMat.uniforms.uColorAccent.value);

      corePointLight.color.copy(nebulaMat.uniforms.uColorPrimary.value);
      corePointLight.intensity = 2.4 + st.energy * 1.9 + beatImpulse * 1.8;

      gimbalOuter.rotation.y += delta * 0.2 * motionMul;
      gimbalOuter.rotation.z += delta * 0.07 * motionMul;
      gimbalInner.rotation.y -= delta * 0.28 * motionMul;
      gimbalInner.rotation.x += delta * 0.09 * motionMul;

      runeRingOuter.rotation.z += delta * (0.14 + st.swirlSpeed * 0.12) * motionMul;
      runeRingInner.rotation.z -= delta * (0.24 + st.swirlSpeed * 0.15) * motionMul;
      runeRingOuterMat.opacity = 0.68 + beatImpulse * 0.28;
      runeRingInnerMat.opacity = 0.56 + beatImpulse * 0.32;

      dustPoints.rotation.y += delta * (0.18 + st.swirlSpeed * 0.22) * motionMul;
      stars.rotation.y += delta * 0.012 * motionMul;
      domeWire.rotation.y -= delta * 0.018 * motionMul;

      updateArcSegmentsBuffer(
        arcVertexPositions,
        arcCount,
        segmentsPerArc,
        elapsed * motionMul,
        st.energy + beatImpulse * 0.65,
        1.14
      );
      arcGeo.attributes.position.needsUpdate = true;
      arcMat.opacity = Math.min(0.96, 0.34 + beatImpulse * 0.64);

      const highlightIdx = st.hoveredIndex >= 0 ? st.hoveredIndex : st.focusedIndex;
      for (let i = 0; i < moteCount; i++) {
        const norm = st.domainNorms[i] ?? 0.5;
        const baseAngle =
          (i / moteCount) * Math.PI * 2 + elapsed * (0.16 + norm * 0.14) * motionMul;
        const tilt = Math.sin(i * 1.65 + elapsed * 0.35) * 0.44;
        const radius = 1.56 + norm * 0.44;
        const gx = Math.cos(baseAngle) * radius;
        const gy = Math.sin(tilt) * 0.62 + 0.14;
        const gz = Math.sin(baseAngle) * radius;

        gemWorldPositions[i].set(gx, gy + 0.35, gz);
        _dummyObj.position.set(gx, gy, gz);

        const isHighlighted = i === highlightIdx;
        const s = (0.68 + norm * 0.72) * (isHighlighted ? 1.65 : 1.0);
        _dummyObj.scale.set(s, s * 1.25, s);
        _dummyObj.rotation.set(elapsed + i, elapsed * 0.75, i);
        _dummyObj.updateMatrix();
        motesInstanced.setMatrixAt(i, _dummyObj.matrix);
      }
      motesInstanced.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < moteCount; i++) {
        const nextIdx = (i + 1) % moteCount;
        const p1 = gemWorldPositions[i];
        const p2 = gemWorldPositions[nextIdx];
        _gemPos.set(p1.x, p1.y - 0.35, p1.z);
        _nextGemPos.set(p2.x, p2.y - 0.35, p2.z);

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
        const hp = gemWorldPositions[highlightIdx];
        constellationPositions[beamOffset] = 0;
        constellationPositions[beamOffset + 1] = 0;
        constellationPositions[beamOffset + 2] = 0;
        constellationPositions[beamOffset + 3] = hp.x;
        constellationPositions[beamOffset + 4] = hp.y - 0.35;
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
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();

      floorGeo.dispose();
      floorMat.dispose();
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

      altarTex.dispose();
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
    <div className="relative w-screen h-screen overflow-hidden bg-[#05070e] text-slate-100 select-none">
      {/* 3D WebGL Canvas Mount (Double-click anywhere on orb to query & speak) */}
      <div
        ref={mountRef}
        onDoubleClick={handleGazeOrb}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      />

      {webglFailed && (
        <canvas ref={fallbackCanvasRef} className="absolute inset-0 w-full h-full" />
      )}

      {/* Projected 3D Hover Readout over Orbital Domain Gem */}
      {hoverReadout && (
        <div
          style={{
            transform: `translate(${Math.round(hoverReadout.screenX + 14)}px, ${Math.round(hoverReadout.screenY - 20)}px)`
          }}
          className="pointer-events-none fixed top-0 left-0 z-20 rounded-lg bg-[#0b0f17]/95 border border-amber-400/50 px-3 py-1.5 shadow-xl"
        >
          <div className="text-xs font-semibold text-white whitespace-nowrap">{hoverReadout.name}</div>
          <div className="text-[11px] font-mono tabular-nums text-amber-300 flex items-center gap-1.5 whitespace-nowrap">
            <span>{hoverReadout.formattedValue}</span>
            <span aria-hidden="true">·</span>
            <span className="text-cyan-300">{hoverReadout.normalizedPct}%</span>
          </div>
        </div>
      )}

      {/* Top-Left Minimal Wordmark & Live Atmospheric Summary */}
      <div className="pointer-events-none fixed top-5 left-6 z-20 max-w-md space-y-1">
        <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-wide text-white">
          Weather Beats
        </h1>
        <div className="text-xs font-mono tabular-nums text-slate-300 flex flex-wrap items-center gap-2">
          <span>{weatherCtx.region}</span>
          <span aria-hidden="true">·</span>
          <span>{weatherCtx.temperatureC.toFixed(1)}°C</span>
          <span aria-hidden="true">·</span>
          <span>AQI {weatherCtx.aqi}</span>
          <span aria-hidden="true">·</span>
          <span>{compositionPlan.bpm} BPM</span>
          {focusedReading && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-300">
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
          className="group w-11 h-11 rounded-full bg-[#0d1322] hover:bg-slate-800 border border-slate-700 hover:border-amber-400/70 flex items-center justify-center text-slate-200 hover:text-amber-300 transition-all shadow-lg focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          <Settings className="w-5 h-5 transition-transform duration-300 group-hover:rotate-45" />
        </button>
      </div>

      {/* Compact Single Bottom Control Dock (Zero Obstruction Over Crystal Ball) */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-20 w-[min(860px,94vw)] flex flex-col items-center gap-1.5 pointer-events-none">
        <button
          onClick={() => setDockCollapsed((c) => !c)}
          className="pointer-events-auto px-3 py-1 rounded-full bg-[#0d1322] border border-slate-700/90 text-[11px] font-mono text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors shadow"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{dockCollapsed ? 'Show Controls' : 'Hide Controls'}</span>
        </button>

        {!dockCollapsed && (
          <div className="w-full pointer-events-auto rounded-2xl bg-[#0d1322] border border-slate-700/85 px-3.5 py-2.5 flex flex-col gap-2 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={handleSyncWeather}
                  disabled={isSyncingWeather}
                  className="px-3 py-1.5 rounded-xl bg-[#151e33] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-cyan-300 flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{isSyncingWeather ? 'Syncing...' : 'Sync Weather'}</span>
                </button>

                <button
                  onClick={handleToggleMusic}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border whitespace-nowrap shrink-0 transition-colors ${
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
                  <span>{seqStatus.isPlaying ? 'Stop Beats' : 'Play 32-Bar'}</span>
                </button>

                <button
                  onClick={handleToggleListening}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border whitespace-nowrap shrink-0 transition-colors ${
                    isListening
                      ? 'bg-rose-500 text-white border-rose-400'
                      : 'bg-[#151e33] hover:bg-slate-800 text-amber-300 border-slate-700'
                  }`}
                >
                  {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  <span>{isListening ? 'Stop Mic' : 'Ask by Voice'}</span>
                </button>

                {oracleResult && (
                  <button
                    onClick={() =>
                      isSpeakingReply ? stopSpeechPlayback() : playVoiceReply(oracleResult)
                    }
                    className="px-2.5 py-1.5 rounded-xl bg-[#151e33] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    {isSpeakingReply ? (
                      <Square className="w-3 h-3 fill-current text-amber-300" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5 text-cyan-300" />
                    )}
                    <span>{isSpeakingReply ? 'Silence' : 'Replay'}</span>
                  </button>
                )}

                <button
                  onClick={onToggleVoiceReply}
                  aria-label={voiceReplyEnabled ? 'Mute spoken AI voice' : 'Unmute spoken AI voice'}
                  className="px-2.5 py-1.5 rounded-xl bg-[#151e33] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  {voiceReplyEnabled ? (
                    <Volume2 className="w-3.5 h-3.5 text-cyan-300" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                  )}
                  <span>{voiceReplyEnabled ? 'Voice On' : 'Muted'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <label htmlFor="orb-domain-lens" className="text-xs font-mono text-slate-400">
                  Lens
                </label>
                <select
                  id="orb-domain-lens"
                  value={focusedDomain}
                  onChange={(e) => handleLensChange(e.target.value as 'all' | DomainCategory)}
                  className="bg-[#0b0f17] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
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
                    ? `Listening: ${liveTranscript || 'speak your telemetry question...'}`
                    : oracleLoading
                      ? 'Crystal ball consulting 24 telemetry streams...'
                      : 'Ask the crystal ball a question (e.g., How is solar energy or security?)...'
                }
                className="flex-1 bg-[#0b0f17] border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
              />
              <button
                type="submit"
                disabled={oracleLoading || !typedQuestion.trim()}
                className="px-3.5 py-1.5 rounded-xl bg-[#151e33] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-cyan-300 flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{oracleLoading ? 'Asking...' : 'Ask'}</span>
              </button>
            </form>

            {(micError || (!voiceReplyEnabled && oracleResult)) && (
              <div className="text-[11px] font-mono text-amber-300 truncate px-1">
                {micError ? micError : oracleResult?.answerText}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
