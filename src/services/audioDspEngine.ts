/**
 * Weather Beats Audio DSP Engine & Musical Telemetry Extractor
 * Senior C++ Audio DSP Engineer & JUCE 8 Architecture Standard targeting 48000 Hz baseline sample rate & 1024 block size.
 * Real-time audio thread safety: Zero allocations, zero locks, zero UI calls inside processBlock callback.
 */

import { DomainCategory } from '../types/telemetry';
import { GeolocationWeatherContext } from './telemetryEngine';
import {
  BarSectionName,
  Composition32BarPlan,
  CompositionBar,
  CompositionOptions,
  FmSynthParams,
  FxSlotConfig,
  NativeVoiceId,
  NormalizedDomainReading,
  SynthVoiceId,
  VoiceMixChannel,
  VoiceMixMap,
  VoiceNoteEvent,
  build32BarComposition,
  buildEndlessCompositionSpan,
  createDefaultVoiceMix,
  generateEndlessBar,
  midiToHz
} from './weatherBeatsComposer';
import {
  Id3TrackMetadata,
  convertImageDataUrlToJpeg1024,
  encodeMp3320,
  encodeWavPcm16,
  generateProceduralCoverArt,
  prependId3ToMp3
} from './audioExportEngine';
import {
  SeerWhisperEvent,
  composeCrypticTelemetryWhisper,
  computeWhisperSyllableEnvelope
} from './seerWhisperComposer';
import {
  AiMotifProfile,
  MusicalDirectorPatch,
  SonicCharacterBias,
  buildLyriaTelemetryPayload,
  computeClusterAverages,
  formatApiErrorMessage,
  requestAiMotifEvolution,
  requestLyriaFlowAudio,
  requestNeuralTtsWav
} from './aiIntelligenceSuite';

export const VOICE_HPF_SPEC = {
  cutoffHz: 250,
  slopeDbPerOct: 16,
  stage1FreqHz: 250,
  stage1Q: 0.7071,
  stage2FreqHz: 114,
  stage2Q: 0.58
} as const;

/**
 * 2-stage zero-ringing voice high-pass cascade calibrated to 250 Hz with a ~16 dB/oct roll-off
 * (-16.3 dB at 125 Hz, transparent above 500 Hz). Used identically across Seer whispers,
 * Oracle voice replies, and Live Bidirectional Seer Voice playback chains.
 */
export function createVoiceHighPass250Hz16dB(ctx: BaseAudioContext): {
  input: BiquadFilterNode;
  output: BiquadFilterNode;
} {
  const stage1 = ctx.createBiquadFilter();
  stage1.type = 'highpass';
  stage1.frequency.value = VOICE_HPF_SPEC.stage1FreqHz;
  stage1.Q.value = VOICE_HPF_SPEC.stage1Q;

  const stage2 = ctx.createBiquadFilter();
  stage2.type = 'highpass';
  stage2.frequency.value = VOICE_HPF_SPEC.stage2FreqHz;
  stage2.Q.value = VOICE_HPF_SPEC.stage2Q;

  stage1.connect(stage2);
  return { input: stage1, output: stage2 };
}

export interface AudioDspMetrics {
  sampleRate: number;
  bufferSize: number;
  peakDb: number;
  rmsDb: number;
  spectralCentroidHz: number;
  lufsLoudness: number;
  fftSpectrum32: number[];
  detectedPitchHz: number;
  isOscillatorActive: boolean;
  midiNoteActiveCount: number;
}

export interface SequencerPlaybackStatus {
  isPlaying: boolean;
  currentBar: number; // 1..∞ endless flowing bar index
  currentStep: number; // 0..15
  bpm: number;
  activeSection: BarSectionName;
  currentChord: string;
  telemetrySignatureLabel: string;
  activeMotifTitle: string | null;
  autoEvolveEnabled: boolean;
  activeVoices: Record<SynthVoiceId, number>; // timestamp ms of last trigger
}

export type LyriaFlowStatus = 'idle' | 'generating' | 'playing' | 'crossfading' | 'error';

export interface LyriaFlowEngineState {
  enabled: boolean;
  blend: number; // 0 = 100% Live 24-Telemetry Synth, 1 = 100% Google Lyria Flow
  status: LyriaFlowStatus;
  activeDeck: 'A' | 'B' | null;
  activePromptSummary: string | null;
  clipCount: number;
  errorMessage: string | null;
}

/**
 * Pure equal-power Synth <-> Lyria balance calculator.
 * While Lyria is disabled or still warming up its first clip, the live 24-telemetry
 * synthesizer stays at full unity gain (1.0) so playback never drops out.
 */
export function computeEqualPowerMixGains(
  blend: number,
  lyriaAudible: boolean
): { synthGain: number; lyriaGain: number } {
  const b = Math.max(0, Math.min(1, Number.isFinite(blend) ? blend : 0.55));
  if (!lyriaAudible) {
    return { synthGain: 1.0, lyriaGain: 0.0 };
  }
  const angle = b * Math.PI * 0.5;
  return {
    synthGain: Number(Math.cos(angle).toFixed(4)),
    lyriaGain: Number(Math.sin(angle).toFixed(4))
  };
}

function buildEqualPowerFadeCurve(steps: number, direction: 'in' | 'out'): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / Math.max(1, steps - 1);
    curve[i] = direction === 'in' ? Math.sin(t * Math.PI * 0.5) : Math.cos(t * Math.PI * 0.5);
  }
  return curve;
}

const LYRIA_FADE_IN_CURVE = buildEqualPowerFadeCurve(128, 'in');
const LYRIA_FADE_OUT_CURVE = buildEqualPowerFadeCurve(128, 'out');

interface DirectorUndoSnapshot {
  bpmOffset: number;
  characterBias: SonicCharacterBias;
  voiceMix: VoiceMixMap;
  ambientWhispersEnabled: boolean;
  fmOverrides: Partial<FmSynthParams>;
  fxOverrides: FxSlotConfig[] | null;
  summary: string;
}

export type StemRenderKind =
  | 'master'
  | 'pads_sub'
  | 'african_instruments'
  | 'percussion'
  | 'fm_synth';

export interface RenderedStemItem {
  id: StemRenderKind;
  label: string;
  fileName: string;
  wavBlob: Blob;
  wavUrl: string;
  sizeBytes: number;
}

export interface RenderedReleaseBundle {
  mp3Blob: Blob;
  mp3Url: string;
  mp3FileName: string;
  mp3SizeBytes: number;
  coverDataUrl: string;
  coverFileName: string;
  stems: RenderedStemItem[];
  durationSec: number;
  bpm: number;
  telemetrySignature: string;
}

interface FxAudioChain {
  input: GainNode;
  padDuckInput: GainNode;
  padDuckGain: GainNode;
  musicVoiceDuckGain: GainNode;
  vocalInput: GainNode;
  output: GainNode;
  waveshaper: WaveShaperNode;
  distDry: GainNode;
  distWet: GainNode;
  filterNode: BiquadFilterNode;
  modDelayL: DelayNode;
  modDelayR: DelayNode;
  modLfoL: OscillatorNode;
  modLfoR: OscillatorNode;
  modDepthL: GainNode;
  modDepthR: GainNode;
  modDry: GainNode;
  modWet: GainNode;
  delayL: DelayNode;
  delayR: DelayNode;
  delayFeedbackL: GainNode;
  delayFeedbackR: GainNode;
  delayDry: GainNode;
  delayWet: GainNode;
  reverbConvolver: ConvolverNode;
  reverbDry: GainNode;
  reverbWet: GainNode;
  compressor: DynamicsCompressorNode;
  limiter: DynamicsCompressorNode;
}

interface SharedNoiseBuffers {
  white: AudioBuffer;
  pink: AudioBuffer;
}

const contextNoiseCache = new WeakMap<BaseAudioContext, SharedNoiseBuffers>();

function getSharedNoiseBuffers(ctx: BaseAudioContext): SharedNoiseBuffers {
  const cached = contextNoiseCache.get(ctx);
  if (cached) return cached;

  const sr = ctx.sampleRate || 48000;
  const len = Math.floor(sr * 1.0);
  const white = ctx.createBuffer(1, len, sr);
  const pink = ctx.createBuffer(1, len, sr);
  const wData = white.getChannelData(0);
  const pData = pink.getChannelData(0);

  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    wData[i] = w;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    pData[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + w * 0.1848) * 0.22));
  }

  const pair: SharedNoiseBuffers = { white, pink };
  contextNoiseCache.set(ctx, pair);
  return pair;
}

function makeDistortionCurve(driveDb: number): Float32Array<ArrayBuffer> {
  const samples = 256;
  const buffer = new ArrayBuffer(samples * 4);
  const curve = new Float32Array(buffer);
  const gain = Math.pow(10, Math.max(0, driveDb) / 20);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * gain);
  }
  return curve;
}

/**
 * Generates a wide, decorrelated true-stereo hall impulse response with subtle pre-delay
 * and smooth frequency damping for lush, studio-quality reverb tails.
 */
function createReverbImpulse(
  ctx: BaseAudioContext,
  decaySec: number,
  damping: number
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 48000;
  const clampedDecay = Math.min(4.5, Math.max(0.35, decaySec));
  const preDelaySamples = Math.floor(sampleRate * 0.014);
  const length = Math.max(preDelaySamples + 1, Math.floor(sampleRate * clampedDecay));
  const impulse = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const channelData = impulse.getChannelData(ch);
    let lp = 0;
    const chOffset = ch === 0 ? 0 : Math.floor(sampleRate * 0.004);
    for (let i = preDelaySamples + chOffset; i < length; i++) {
      const t = (i - preDelaySamples) / Math.max(1, length - preDelaySamples);
      const env = Math.pow(1 - t, 2.45);
      const white = Math.random() * 2 - 1;
      lp = lp + (1 - damping * 0.86) * (white - lp);
      channelData[i] = lp * env * 0.82;
    }
  }
  return impulse;
}

function createStereoPannerOrGain(ctx: BaseAudioContext, panValue: number): AudioNode {
  if (typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, panValue));
    return panner;
  }
  return ctx.createGain();
}

class AudioDspEngine {
  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private whisperBus: GainNode | null = null;
  private whisperAnalyserNode: AnalyserNode | null = null;
  private oscNode: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private masterMusicGain: GainNode | null = null;
  private fxChain: FxAudioChain | null = null;
  private isRunning = false;
  private isOscActive = false;

  private sampleRate = 48000;
  private bufferSize = 1024;

  // Pre-allocated typed buffers for zero-allocation real-time processBlock & whisper envelope safety
  private timeDomainBuffer = new Float32Array(1024);
  private whisperTimeDomainBuffer: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(256 * 4));
  private frequencyBuffer = new Uint8Array(512);
  private fftSpectrum32 = new Float32Array(32);
  private displaySpectrum32: number[] = new Array(32).fill(0);
  private cachedMetrics: AudioDspMetrics = {
    sampleRate: 48000,
    bufferSize: 1024,
    peakDb: -96,
    rmsDb: -96,
    spectralCentroidHz: 0,
    lufsLoudness: -96,
    fftSpectrum32: this.displaySpectrum32,
    detectedPitchHz: 0,
    isOscillatorActive: false,
    midiNoteActiveCount: 0
  };

  private activeMidiNotes: Set<number> = new Set();
  private midiAccess: any = null;

  // Shared Studio Preferences & AI Director/Motif State (genre-free continuous telemetry)
  private voiceMix: VoiceMixMap = createDefaultVoiceMix();
  private ambientWhispersEnabled = false;
  private oraclePriorityActive = false;
  private bpmOffset = 0;
  private characterBias: SonicCharacterBias = {};
  private alertIntensityBias = 0;
  private fmOverrides: Partial<FmSynthParams> = {};
  private fxOverrides: FxSlotConfig[] | null = null;
  private activeAiMotif: AiMotifProfile | null = null;
  private pendingAiMotif: AiMotifProfile | null = null;
  private autoEvolveEnabled = false;
  private isEvolvingMotif = false;
  private lastMotifError: string | null = null;
  private lastMotifBarIndex = -8;

  // Google Lyria 3 Dual-Deck Seamless Flow Engine (Off by default until enabled by user)
  private synthBalanceGain: GainNode | null = null;
  private lyriaOutputGain: GainNode | null = null;
  private lyriaDuckGain: GainNode | null = null;
  private lyriaState: LyriaFlowEngineState = {
    enabled: false,
    blend: 0.55,
    status: 'idle',
    activeDeck: null,
    activePromptSummary: null,
    clipCount: 0,
    errorMessage: null
  };
  private lyriaListeners: Set<(state: LyriaFlowEngineState) => void> = new Set();
  private lyriaDeckSources: Record<'A' | 'B', AudioBufferSourceNode | null> = { A: null, B: null };
  private lyriaDeckGains: Record<'A' | 'B', GainNode | null> = { A: null, B: null };
  private lyriaPrefetchTimerId: ReturnType<typeof setTimeout> | null = null;
  private lyriaSessionToken = 0;
  private lyriaFetchInFlight = false;
  private lastMotifClusterAverages: Record<string, number> | null = null;
  private lastDirectorSummary: string | null = null;
  private directorUndoStack: DirectorUndoSnapshot[] = [];
  private studioPrefListeners: Set<() => void> = new Set();

  // Live Ambient Whisper State & Telemetry Snapshot
  private whisperVector24: Record<DomainCategory, NormalizedDomainReading> | null = null;
  private whisperWeatherCtx: GeolocationWeatherContext | null = null;
  private whisperFocusedDomain: 'all' | DomainCategory = 'all';
  private activeWhisper: SeerWhisperEvent | null = null;
  private lastWhisperText = '';
  private activeWhisperUtterance: SpeechSynthesisUtterance | null = null;
  private activeNeuralWhisperSource: AudioBufferSourceNode | null = null;
  private activeWhisperRequestId = 0;
  private whisperClearTimerId: ReturnType<typeof setTimeout> | null = null;
  private whisperListeners: Set<(whisper: SeerWhisperEvent | null) => void> = new Set();

  // Endless Flowing Sequencer state (infinite seamless evolution, zero abrupt transitions)
  private activePlan: Composition32BarPlan | null = null;
  private currentLiveBar: CompositionBar | null = null;
  private isSequencerPlaying = false;
  private sequencerTimerId: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private currentBarIndex = 0;
  private currentStepIndex = 0;
  private slewedBpm = 102;
  private lastDistortionDriveDb = -1;
  private smoothedVector24: Record<DomainCategory, NormalizedDomainReading> | null = null;
  private smoothedWeatherCtx: GeolocationWeatherContext | null = null;
  private lastVoiceTriggers: Record<SynthVoiceId, number> = {
    pad: 0,
    sub: 0,
    whisper: 0,
    kick: 0,
    perc: 0,
    kora: 0,
    djembe: 0,
    kalimba: 0,
    balafon: 0,
    fm: 0
  };
  private sequencerListeners: Set<(status: SequencerPlaybackStatus) => void> = new Set();

  constructor() {
    this.initMidi();
  }

  private hourOfDayOverride: number | null = null;

  public getHourOfDayOverride(): number | null {
    return this.hourOfDayOverride;
  }

  public setHourOfDayOverride(hour: number | null) {
    this.hourOfDayOverride =
      typeof hour === 'number' && Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : null;
    this.refreshActivePlanFromState();
    this.notifyStudioPrefListeners();
    this.notifySequencerListeners();
  }

  public getCompositionOptions(): CompositionOptions {
    const mergedBias: SonicCharacterBias = {
      kineticDelta: Math.max(
        -0.35,
        Math.min(0.35, (this.characterBias.kineticDelta ?? 0) + this.alertIntensityBias)
      ),
      spaceDelta: this.characterBias.spaceDelta ?? 0,
      polyrhythmDelta: this.characterBias.polyrhythmDelta ?? 0,
      warmthDelta: this.characterBias.warmthDelta ?? 0
    };
    return {
      overrideFm: Object.keys(this.fmOverrides).length > 0 ? { ...this.fmOverrides } : undefined,
      overrideFx: this.fxOverrides ? this.fxOverrides.map((s) => ({ ...s })) : undefined,
      bpmOffset: this.bpmOffset,
      characterBias: mergedBias,
      aiMotif: this.activeAiMotif,
      hourOfDayOverride: this.hourOfDayOverride ?? undefined
    };
  }

  public getAutoEvolveEnabled(): boolean {
    return this.autoEvolveEnabled;
  }

  public setAutoEvolveEnabled(enabled: boolean) {
    if (this.autoEvolveEnabled === enabled) return;
    this.autoEvolveEnabled = enabled;
    if (enabled) {
      this.lastMotifError = null;
    }
    this.notifyStudioPrefListeners();
    this.notifySequencerListeners();
  }

  public getLastMotifError(): string | null {
    return this.lastMotifError;
  }

  // --- Google Lyria 3 Live Flow Controls (Dual-Deck Equal-Power Crossfade) ---

  public getLyriaFlowState(): LyriaFlowEngineState {
    return { ...this.lyriaState };
  }

  public subscribeLyriaFlow(listener: (state: LyriaFlowEngineState) => void): () => void {
    this.lyriaListeners.add(listener);
    listener(this.getLyriaFlowState());
    return () => this.lyriaListeners.delete(listener);
  }

  private notifyLyriaListeners() {
    const snap = this.getLyriaFlowState();
    this.lyriaListeners.forEach((cb) => cb(snap));
  }

  private applyLyriaMixBalance(immediate = false) {
    if (!this.audioCtx || !this.synthBalanceGain || !this.lyriaOutputGain) return;
    const lyriaAudible =
      this.lyriaState.enabled &&
      this.lyriaState.activeDeck !== null &&
      (this.lyriaState.status === 'playing' || this.lyriaState.status === 'crossfading');
    const { synthGain, lyriaGain } = computeEqualPowerMixGains(this.lyriaState.blend, lyriaAudible);
    const now = this.audioCtx.currentTime;
    const tc = immediate ? 0.02 : 0.35;
    this.synthBalanceGain.gain.setTargetAtTime(synthGain, now, tc);
    // Calibrated +1.5dB Lyria bus headroom match against 24-tree live synth master level
    this.lyriaOutputGain.gain.setTargetAtTime(lyriaGain * 0.62, now, tc);
  }

  public setLyriaFlowBlend(blend: number) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(blend) ? blend : 0.55));
    this.lyriaState.blend = Number(clamped.toFixed(2));
    this.applyLyriaMixBalance(false);
    this.notifyLyriaListeners();
  }

  public setLyriaFlowEnabled(enabled: boolean) {
    if (this.lyriaState.enabled === enabled) {
      if (enabled && this.lyriaState.status === 'error' && this.isSequencerPlaying) {
        this.lyriaState.errorMessage = null;
        this.lyriaState.status = 'idle';
        this.notifyLyriaListeners();
        void this.fetchAndCrossfadeLyriaClip();
      }
      return;
    }

    this.lyriaState.enabled = enabled;
    this.lyriaState.errorMessage = null;

    if (!enabled) {
      this.stopLyriaDecks(false);
      this.lyriaState.status = 'idle';
      this.applyLyriaMixBalance(false);
      this.notifyLyriaListeners();
      return;
    }

    this.notifyLyriaListeners();
    if (this.isSequencerPlaying) {
      void this.fetchAndCrossfadeLyriaClip();
    }
  }

  public async forceEvolveLyriaClip(): Promise<void> {
    if (!this.lyriaState.enabled) {
      this.lyriaState.enabled = true;
    }
    this.lyriaState.errorMessage = null;
    this.notifyLyriaListeners();
    if (!this.isSequencerPlaying) return;
    await this.fetchAndCrossfadeLyriaClip();
  }

  private clearLyriaPrefetchTimer() {
    if (this.lyriaPrefetchTimerId) {
      clearTimeout(this.lyriaPrefetchTimerId);
      this.lyriaPrefetchTimerId = null;
    }
  }

  private stopLyriaDecks(immediate = false) {
    this.lyriaSessionToken++;
    this.lyriaFetchInFlight = false;
    this.clearLyriaPrefetchTimer();

    const now = this.audioCtx?.currentTime ?? 0;
    const fadeSec = immediate ? 0.03 : 0.4;

    (['A', 'B'] as const).forEach((deck) => {
      const src = this.lyriaDeckSources[deck];
      const gain = this.lyriaDeckGains[deck];
      this.lyriaDeckSources[deck] = null;
      this.lyriaDeckGains[deck] = null;
      if (gain && this.audioCtx) {
        try {
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
        } catch {
          // Ignore ramp errors on closing context
        }
      }
      if (src) {
        try {
          src.onended = null;
          src.stop(now + fadeSec + 0.04);
        } catch {
          // Already stopped
        }
      }
    });

    this.lyriaState.activeDeck = null;
    this.applyLyriaMixBalance(immediate);
  }

  private async fetchAndCrossfadeLyriaClip() {
    if (!this.lyriaState.enabled || !this.isSequencerPlaying || this.lyriaFetchInFlight) return;
    if (!this.activePlan || !this.whisperWeatherCtx || !this.audioCtx || !this.lyriaDuckGain) return;

    const token = ++this.lyriaSessionToken;
    this.lyriaFetchInFlight = true;
    this.clearLyriaPrefetchTimer();

    const isFirstClip = this.lyriaState.activeDeck === null;
    this.lyriaState.status = isFirstClip ? 'generating' : 'crossfading';
    this.lyriaState.errorMessage = null;
    this.notifyLyriaListeners();

    try {
      const payload = buildLyriaTelemetryPayload('clip', this.activePlan, this.whisperWeatherCtx, {
        directorNote: this.lastDirectorSummary,
        evolutionIndex: this.lyriaState.clipCount
      });

      const res = await requestLyriaFlowAudio(payload);
      if (token !== this.lyriaSessionToken || !this.lyriaState.enabled || !this.isSequencerPlaying) {
        return;
      }

      const base64Part = res.audioDataUrl.split(',')[1];
      if (!base64Part) {
        throw new Error('Google Lyria returned an unreadable audio stream.');
      }
      const binary = atob(base64Part);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      if (!this.audioCtx || !this.lyriaDuckGain) return;
      const decodedBuffer = await this.audioCtx.decodeAudioData(bytes.buffer.slice(0));
      if (token !== this.lyriaSessionToken || !this.lyriaState.enabled || !this.isSequencerPlaying) {
        return;
      }

      const prevDeck = this.lyriaState.activeDeck;
      const nextDeck: 'A' | 'B' = prevDeck === 'A' ? 'B' : 'A';
      const now = this.audioCtx.currentTime;
      const crossfadeSec = prevDeck ? 4.0 : 3.2;

      // Fade out previous deck cleanly with equal-power cosine curve
      if (prevDeck) {
        const oldGain = this.lyriaDeckGains[prevDeck];
        const oldSrc = this.lyriaDeckSources[prevDeck];
        if (oldGain) {
          oldGain.gain.cancelScheduledValues(now);
          oldGain.gain.setValueCurveAtTime(LYRIA_FADE_OUT_CURVE, now, crossfadeSec);
        }
        if (oldSrc) {
          oldSrc.onended = null;
          try {
            oldSrc.stop(now + crossfadeSec + 0.15);
          } catch {
            // ignore
          }
        }
        this.lyriaDeckSources[prevDeck] = null;
        this.lyriaDeckGains[prevDeck] = null;
      }

      // Start fresh deck with equal-power sine fade-in curve
      const nextSrc = this.audioCtx.createBufferSource();
      nextSrc.buffer = decodedBuffer;
      const nextGain = this.audioCtx.createGain();
      nextGain.gain.setValueAtTime(0.0001, now);
      nextGain.gain.setValueCurveAtTime(LYRIA_FADE_IN_CURVE, now, crossfadeSec);

      nextSrc.connect(nextGain);
      nextGain.connect(this.lyriaDuckGain);
      nextSrc.start(now);

      this.lyriaDeckSources[nextDeck] = nextSrc;
      this.lyriaDeckGains[nextDeck] = nextGain;
      this.lyriaState.activeDeck = nextDeck;
      this.lyriaState.activePromptSummary = res.promptSummary;
      this.lyriaState.clipCount += 1;
      this.lyriaState.status = 'playing';
      this.lyriaState.errorMessage = null;
      this.applyLyriaMixBalance(false);
      this.notifyLyriaListeners();

      // Prefetch next evolved clip ~10s before this clip ends for unbroken infinite flow
      const prefetchDelayMs = Math.max(5000, Math.round((decodedBuffer.duration - 10.5) * 1000));
      this.lyriaPrefetchTimerId = setTimeout(() => {
        if (token === this.lyriaSessionToken && this.lyriaState.enabled && this.isSequencerPlaying) {
          void this.fetchAndCrossfadeLyriaClip();
        }
      }, prefetchDelayMs);
    } catch (err) {
      if (token !== this.lyriaSessionToken) return;
      const cleanMsg = formatApiErrorMessage(err instanceof Error ? err.message : String(err));
      this.lyriaState.status = 'error';
      this.lyriaState.errorMessage = cleanMsg;
      // Keep live 24-telemetry synthesizer playing smoothly at full volume on upstream error
      this.applyLyriaMixBalance(false);
      this.notifyLyriaListeners();
    } finally {
      if (token === this.lyriaSessionToken) {
        this.lyriaFetchInFlight = false;
      }
    }
  }

  public getActiveAiMotif(): AiMotifProfile | null {
    return this.activeAiMotif;
  }

  public getPendingAiMotif(): AiMotifProfile | null {
    return this.pendingAiMotif;
  }

  public getLastDirectorSummary(): string | null {
    return this.lastDirectorSummary;
  }

  public canUndoDirectorPatch(): boolean {
    return this.directorUndoStack.length > 0;
  }

  public getBpmOffset(): number {
    return this.bpmOffset;
  }

  public getCharacterBias(): SonicCharacterBias {
    return { ...this.characterBias };
  }

  public setSmartAlertIntensityBias(bias: number) {
    const clamped = Math.max(-0.25, Math.min(0.35, Number.isFinite(bias) ? bias : 0));
    if (Math.abs(clamped - this.alertIntensityBias) < 0.01) return;
    this.alertIntensityBias = clamped;
    this.refreshActivePlanFromState();
  }

  private refreshActivePlanFromState() {
    if (this.whisperVector24 && this.whisperWeatherCtx) {
      const nextPlan = build32BarComposition(
        this.whisperVector24,
        this.whisperWeatherCtx,
        this.getCompositionOptions()
      );
      this.activePlan = nextPlan;
      if (this.audioCtx && this.fxChain) {
        this.applyFxSlotsToChain(this.audioCtx, this.fxChain, nextPlan.fxRack, false);
      }
    }
    this.notifyStudioPrefListeners();
    this.notifySequencerListeners();
  }

  public applyMusicalDirectorPatch(patch: MusicalDirectorPatch) {
    // Save undo snapshot before mutating live mix/synthesis state
    this.directorUndoStack.push({
      bpmOffset: this.bpmOffset,
      characterBias: { ...this.characterBias },
      voiceMix: this.getVoiceMix(),
      ambientWhispersEnabled: this.ambientWhispersEnabled,
      fmOverrides: { ...this.fmOverrides },
      fxOverrides: this.fxOverrides ? this.fxOverrides.map((s) => ({ ...s })) : null,
      summary: this.lastDirectorSummary || 'Initial Telemetry Mix'
    });
    if (this.directorUndoStack.length > 10) {
      this.directorUndoStack.shift();
    }

    if (typeof patch.bpmOffset === 'number' && Number.isFinite(patch.bpmOffset)) {
      this.bpmOffset = Math.max(-24, Math.min(24, Math.round(patch.bpmOffset)));
    }
    if (patch.characterBias) {
      this.characterBias = {
        kineticDelta:
          patch.characterBias.kineticDelta !== undefined
            ? Math.max(-0.35, Math.min(0.35, patch.characterBias.kineticDelta))
            : this.characterBias.kineticDelta,
        spaceDelta:
          patch.characterBias.spaceDelta !== undefined
            ? Math.max(-0.35, Math.min(0.35, patch.characterBias.spaceDelta))
            : this.characterBias.spaceDelta,
        polyrhythmDelta:
          patch.characterBias.polyrhythmDelta !== undefined
            ? Math.max(-0.35, Math.min(0.35, patch.characterBias.polyrhythmDelta))
            : this.characterBias.polyrhythmDelta,
        warmthDelta:
          patch.characterBias.warmthDelta !== undefined
            ? Math.max(-0.35, Math.min(0.35, patch.characterBias.warmthDelta))
            : this.characterBias.warmthDelta
      };
    }
    if (typeof patch.whispersEnabled === 'boolean') {
      this.ambientWhispersEnabled = patch.whispersEnabled;
      if (!patch.whispersEnabled) this.stopAmbientWhisperSpeech(true);
    }
    if (patch.voiceMixPatch) {
      (Object.keys(patch.voiceMixPatch) as SynthVoiceId[]).forEach((voice) => {
        const chPatch = patch.voiceMixPatch?.[voice];
        if (!chPatch || !this.voiceMix[voice]) return;
        this.voiceMix[voice] = {
          gain:
            typeof chPatch.gain === 'number'
              ? Math.max(0, Math.min(1.25, chPatch.gain))
              : this.voiceMix[voice].gain,
          pan:
            typeof chPatch.pan === 'number'
              ? Math.max(-1, Math.min(1, chPatch.pan))
              : this.voiceMix[voice].pan,
          muted:
            typeof chPatch.muted === 'boolean' ? chPatch.muted : this.voiceMix[voice].muted
        };
      });
    }
    if (patch.fmPatch) {
      this.fmOverrides = { ...this.fmOverrides, ...patch.fmPatch };
    }
    if (patch.fxPatch && patch.fxPatch.length > 0 && this.activePlan) {
      const baseSlots = (this.fxOverrides ?? this.activePlan.fxRack).map((s) => ({ ...s }));
      for (const change of patch.fxPatch) {
        const slot = baseSlots.find((s) => s.id === change.slotId);
        if (!slot) continue;
        if (typeof change.mix === 'number') slot.mix = Math.max(0, Math.min(1, change.mix));
        if (typeof change.primaryValue === 'number') {
          slot.primaryValue = Math.max(slot.primaryMin, Math.min(slot.primaryMax, change.primaryValue));
        }
        if (typeof change.secondaryValue === 'number') {
          slot.secondaryValue = Math.max(
            slot.secondaryMin,
            Math.min(slot.secondaryMax, change.secondaryValue)
          );
        }
        if (typeof change.bypass === 'boolean') slot.bypass = change.bypass;
        slot.telemetryLocked = false;
      }
      this.fxOverrides = baseSlots;
    }

    this.lastDirectorSummary = patch.summary || 'Applied live mix direction';
    this.refreshActivePlanFromState();
  }

  public revertLastDirectorPatch(): string | null {
    const prev = this.directorUndoStack.pop();
    if (!prev) return null;
    this.bpmOffset = prev.bpmOffset;
    this.characterBias = { ...prev.characterBias };
    this.voiceMix = prev.voiceMix;
    this.ambientWhispersEnabled = prev.ambientWhispersEnabled;
    this.fmOverrides = { ...prev.fmOverrides };
    this.fxOverrides = prev.fxOverrides ? prev.fxOverrides.map((s) => ({ ...s })) : null;
    this.lastDirectorSummary = prev.summary;
    this.refreshActivePlanFromState();
    return prev.summary;
  }

  public queueAiMotif(motif: AiMotifProfile) {
    if (this.isSequencerPlaying) {
      // Quantize cleanly to next bar boundary for zero-glitch endless evolution
      this.pendingAiMotif = motif;
      this.notifyStudioPrefListeners();
      this.notifySequencerListeners();
    } else {
      this.activeAiMotif = motif;
      this.pendingAiMotif = null;
      this.lastMotifBarIndex = this.currentBarIndex;
      if (this.whisperVector24) {
        this.lastMotifClusterAverages = computeClusterAverages(this.whisperVector24);
      }
      this.refreshActivePlanFromState();
    }
  }

  public async triggerManualMotifEvolution(): Promise<AiMotifProfile | null> {
    if (!this.whisperVector24 || !this.whisperWeatherCtx || this.isEvolvingMotif) return null;
    this.isEvolvingMotif = true;
    try {
      const motif = await requestAiMotifEvolution({
        telemetryClusters: computeClusterAverages(this.whisperVector24),
        weatherCtx: this.whisperWeatherCtx,
        telemetrySignatureLabel:
          this.activePlan?.telemetrySignatureLabel ?? 'Atmospheric Drift · 108 BPM',
        currentChordSummary: this.activePlan?.chordProgressionSummary ?? 'Cm9 · F9 · Bbmaj9 · Gm7',
        previousMotifTitle: this.activeAiMotif?.title
      });
      this.lastMotifError = null;
      this.queueAiMotif(motif);
      return motif;
    } catch (err) {
      const cleanMsg = formatApiErrorMessage(err instanceof Error ? err.message : String(err));
      this.lastMotifError = cleanMsg;
      this.notifyStudioPrefListeners();
      throw new Error(cleanMsg);
    } finally {
      this.isEvolvingMotif = false;
    }
  }

  private maybeTriggerAutoMotifEvolution() {
    if (
      !this.autoEvolveEnabled ||
      !this.isSequencerPlaying ||
      this.isEvolvingMotif ||
      !this.whisperVector24 ||
      !this.whisperWeatherCtx
    ) {
      return;
    }
    const barsSinceLast = this.currentBarIndex - this.lastMotifBarIndex;
    if (barsSinceLast < 8) return;

    const currentAvgs = computeClusterAverages(this.whisperVector24);
    if (!this.lastMotifClusterAverages) {
      this.lastMotifClusterAverages = currentAvgs;
      return;
    }

    const keys = Object.keys(currentAvgs);
    let totalDrift = 0;
    for (const k of keys) {
      totalDrift += Math.abs((currentAvgs[k] ?? 0.5) - (this.lastMotifClusterAverages[k] ?? 0.5));
    }
    const meanDrift = totalDrift / Math.max(1, keys.length);

    // Auto-evolve smoothly when telemetry clusters shift significantly or after 24 bars of continuous play
    if (meanDrift >= 0.14 || barsSinceLast >= 24) {
      this.lastMotifClusterAverages = currentAvgs;
      this.lastMotifBarIndex = this.currentBarIndex;
      void this.triggerManualMotifEvolution().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        // Pause background auto-evolve cleanly on billing/quota/auth errors so we never spam retries
        if (/credits|quota|billing|api key|unauthorized|402|429|403/i.test(msg)) {
          this.autoEvolveEnabled = false;
          this.lastMotifError = msg;
          this.notifyStudioPrefListeners();
          this.notifySequencerListeners();
        }
      });
    }
  }

  public getVoiceMix(): VoiceMixMap {
    const copy = {} as VoiceMixMap;
    (Object.keys(this.voiceMix) as SynthVoiceId[]).forEach((k) => {
      copy[k] = { ...this.voiceMix[k] };
    });
    return copy;
  }

  public setVoiceMixChannel(voice: SynthVoiceId, patch: Partial<VoiceMixChannel>) {
    this.voiceMix[voice] = {
      ...this.voiceMix[voice],
      ...patch
    };
    this.notifyStudioPrefListeners();
  }

  public resetVoiceMix() {
    this.voiceMix = createDefaultVoiceMix();
    this.notifyStudioPrefListeners();
  }

  public getAmbientWhispersEnabled(): boolean {
    return this.ambientWhispersEnabled;
  }

  public setAmbientWhispersEnabled(enabled: boolean) {
    if (this.ambientWhispersEnabled === enabled) return;
    this.ambientWhispersEnabled = enabled;
    if (!enabled) {
      this.stopAmbientWhisperSpeech(true);
    }
    this.notifyStudioPrefListeners();
  }

  private updateMusicVoiceDucking() {
    if (!this.audioCtx || !this.fxChain) return;
    const now = this.audioCtx.currentTime;
    let targetGain = 1.0;
    let timeConstant = 0.24;

    if (this.oraclePriorityActive) {
      // Strong studio duck (-13 dB) whenever direct Voice Oracle is listening or speaking
      targetGain = 0.22;
      timeConstant = 0.06;
    } else if (this.activeWhisper && this.ambientWhispersEnabled) {
      // Musical broadcast duck (-7.5 dB) whenever the seer whispers so every syllable carries clearly
      targetGain = 0.42;
      timeConstant = 0.08;
    }

    this.fxChain.musicVoiceDuckGain.gain.setTargetAtTime(targetGain, now, timeConstant);
    if (this.lyriaDuckGain) {
      // Gently duck purely instrumental Lyria bed (-3.5 dB during whispers, -11 dB during direct Oracle/Live voice)
      const lyriaDuckTarget = this.oraclePriorityActive
        ? 0.28
        : this.activeWhisper && this.ambientWhispersEnabled
          ? 0.66
          : 1.0;
      this.lyriaDuckGain.gain.setTargetAtTime(lyriaDuckTarget, now, timeConstant);
    }
  }

  public setOracleSpeakingPriority(active: boolean) {
    this.oraclePriorityActive = active;
    if (active) {
      // Yield immediately to direct Voice Oracle so voices never collide
      this.stopAmbientWhisperSpeech(true);
    }
    this.updateMusicVoiceDucking();
  }

  public setWhisperTelemetryContext(
    vector24: Record<DomainCategory, NormalizedDomainReading>,
    weatherCtx: GeolocationWeatherContext,
    focusedDomain: 'all' | DomainCategory = 'all'
  ) {
    this.whisperVector24 = vector24;
    this.whisperWeatherCtx = weatherCtx;
    this.whisperFocusedDomain = focusedDomain;

    // Smooth exponential moving average (EMA) across all 24 telemetry trees so live shifts glide organically
    const alpha = 0.16;
    if (!this.smoothedVector24) {
      const initVec = {} as Record<DomainCategory, NormalizedDomainReading>;
      (Object.keys(vector24) as DomainCategory[]).forEach((k) => {
        initVec[k] = { ...vector24[k] };
      });
      this.smoothedVector24 = initVec;
    } else {
      (Object.keys(vector24) as DomainCategory[]).forEach((k) => {
        const incoming = vector24[k];
        const prev = this.smoothedVector24![k];
        if (!prev) {
          this.smoothedVector24![k] = { ...incoming };
        } else {
          this.smoothedVector24![k] = {
            ...incoming,
            normalized: Number((prev.normalized + (incoming.normalized - prev.normalized) * alpha).toFixed(4))
          };
        }
      });
    }

    if (!this.smoothedWeatherCtx) {
      this.smoothedWeatherCtx = { ...weatherCtx };
    } else {
      this.smoothedWeatherCtx = {
        ...weatherCtx,
        temperatureC:
          this.smoothedWeatherCtx.temperatureC +
          (weatherCtx.temperatureC - this.smoothedWeatherCtx.temperatureC) * alpha,
        humidityPct:
          this.smoothedWeatherCtx.humidityPct +
          (weatherCtx.humidityPct - this.smoothedWeatherCtx.humidityPct) * alpha,
        windSpeedMs:
          this.smoothedWeatherCtx.windSpeedMs +
          (weatherCtx.windSpeedMs - this.smoothedWeatherCtx.windSpeedMs) * alpha,
        pressureHpa:
          this.smoothedWeatherCtx.pressureHpa +
          (weatherCtx.pressureHpa - this.smoothedWeatherCtx.pressureHpa) * alpha
      };
    }
  }

  public getActiveWhisper(): SeerWhisperEvent | null {
    return this.activeWhisper;
  }

  public subscribeWhisper(listener: (whisper: SeerWhisperEvent | null) => void): () => void {
    this.whisperListeners.add(listener);
    listener(this.activeWhisper);
    return () => this.whisperListeners.delete(listener);
  }

  private notifyWhisperListeners() {
    this.whisperListeners.forEach((cb) => cb(this.activeWhisper));
  }

  private stopAmbientWhisperSpeech(clearCaption = true) {
    this.activeWhisperRequestId++;
    if (this.whisperClearTimerId) {
      clearTimeout(this.whisperClearTimerId);
      this.whisperClearTimerId = null;
    }
    if (this.activeNeuralWhisperSource) {
      try {
        this.activeNeuralWhisperSource.stop();
        this.activeNeuralWhisperSource.disconnect();
      } catch {
        // Ignore already-stopped audio source
      }
      this.activeNeuralWhisperSource = null;
    }
    if (
      this.activeWhisperUtterance &&
      typeof window !== 'undefined' &&
      'speechSynthesis' in window
    ) {
      if (!this.oraclePriorityActive) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // Ignore browser speech cancel errors
        }
      }
      this.activeWhisperUtterance = null;
    }
    if (clearCaption && this.activeWhisper !== null) {
      this.activeWhisper = null;
      this.notifyWhisperListeners();
    }
    this.updateMusicVoiceDucking();
  }

  private pickHushedWhisperVoice(): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;
    const english = voices.filter((v) => /^en\b/i.test(v.lang));
    const preferred = english.find((v) =>
      /samantha|serena|victoria|karen|moira|aria|natural|female|google uk english female/i.test(
        v.name
      )
    );
    return preferred ?? english[0] ?? voices[0] ?? null;
  }

  private speakWhisperBrowserFallback(text: string, channelGain: number) {
    if (
      typeof window === 'undefined' ||
      !('speechSynthesis' in window) ||
      typeof SpeechSynthesisUtterance === 'undefined' ||
      this.oraclePriorityActive
    ) {
      return;
    }
    try {
      if (this.activeWhisperUtterance) {
        window.speechSynthesis.cancel();
      }
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = this.pickHushedWhisperVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = 0.86;
      utterance.pitch = 0.92;
      utterance.volume = Math.max(0.22, Math.min(0.4, 0.34 * channelGain));
      utterance.onend = () => {
        if (this.activeWhisperUtterance === utterance) this.activeWhisperUtterance = null;
      };
      utterance.onerror = () => {
        if (this.activeWhisperUtterance === utterance) this.activeWhisperUtterance = null;
      };
      this.activeWhisperUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    } catch {
      this.activeWhisperUtterance = null;
    }
  }

  private triggerLiveCrypticWhisper(
    section: BarSectionName,
    barNumber: number,
    channelGain: number
  ) {
    if (!this.ambientWhispersEnabled || !this.whisperVector24 || !this.whisperWeatherCtx) return;
    if (this.oraclePriorityActive) return;

    const whisperEvt = composeCrypticTelemetryWhisper(
      this.whisperVector24,
      this.whisperWeatherCtx,
      section,
      barNumber,
      this.whisperFocusedDomain,
      this.lastWhisperText
    );
    this.lastWhisperText = whisperEvt.text;
    this.activeWhisper = whisperEvt;
    this.notifyWhisperListeners();
    this.updateMusicVoiceDucking();

    if (this.whisperClearTimerId) {
      clearTimeout(this.whisperClearTimerId);
    }
    this.whisperClearTimerId = setTimeout(() => {
      if (this.activeWhisper?.id === whisperEvt.id) {
        this.activeWhisper = null;
        this.notifyWhisperListeners();
        this.updateMusicVoiceDucking();
      }
      this.whisperClearTimerId = null;
    }, Math.max(whisperEvt.durationMs, 5200));

    // Weather-adapted Neural Seer Voice routed into calibrated stereo ping-pong whisperBus (0.43 gain)
    const reqId = ++this.activeWhisperRequestId;
    void requestNeuralTtsWav(whisperEvt.text, this.whisperWeatherCtx)
      .then(async (tts) => {
        if (
          reqId !== this.activeWhisperRequestId ||
          !this.ambientWhispersEnabled ||
          this.oraclePriorityActive
        ) {
          return;
        }
        if (tts?.audioBase64Wav && this.audioCtx && this.whisperBus) {
          const binary = atob(tts.audioBase64Wav);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const decoded = await this.audioCtx.decodeAudioData(bytes.buffer.slice(0));
          if (
            reqId !== this.activeWhisperRequestId ||
            !this.ambientWhispersEnabled ||
            this.oraclePriorityActive ||
            !this.audioCtx ||
            !this.whisperBus
          ) {
            return;
          }
          if (this.activeNeuralWhisperSource) {
            try {
              this.activeNeuralWhisperSource.stop();
              this.activeNeuralWhisperSource.disconnect();
            } catch {
              // ignore
            }
          }
          const src = this.audioCtx.createBufferSource();
          src.buffer = decoded;
          const gainNode = this.audioCtx.createGain();
          gainNode.gain.setValueAtTime(Math.max(0.25, Math.min(1.1, channelGain * 1.15)), this.audioCtx.currentTime);
          src.connect(gainNode);
          gainNode.connect(this.whisperBus);
          src.onended = () => {
            if (this.activeNeuralWhisperSource === src) {
              this.activeNeuralWhisperSource = null;
            }
            gainNode.disconnect();
          };
          this.activeNeuralWhisperSource = src;
          src.start();
          return;
        }
        this.speakWhisperBrowserFallback(whisperEvt.text, channelGain);
      })
      .catch(() => {
        if (reqId === this.activeWhisperRequestId && !this.oraclePriorityActive) {
          this.speakWhisperBrowserFallback(whisperEvt.text, channelGain);
        }
      });
  }

  /**
   * Zero-allocation real-time ambient whisper acoustic envelope (0..1)
   * combining the isolated Web Audio formant-whisper AnalyserNode RMS
   * with the smooth syllabic whisper cadence envelope for seer speaking glow sync.
   */
  public getWhisperEnvelopeEnergy(): number {
    let busRms = 0;
    if (this.whisperAnalyserNode) {
      this.whisperAnalyserNode.getFloatTimeDomainData(this.whisperTimeDomainBuffer);
      let sq = 0;
      const len = this.whisperTimeDomainBuffer.length;
      for (let i = 0; i < len; i++) {
        const s = this.whisperTimeDomainBuffer[i];
        sq += s * s;
      }
      busRms = Math.min(1, Math.sqrt(sq / len) * 6.8);
    }

    let syllableEnv = 0;
    if (this.activeWhisper && this.ambientWhispersEnabled && !this.oraclePriorityActive) {
      const ch = this.voiceMix.whisper;
      const mixScale = ch && !ch.muted ? Math.min(1.15, ch.gain) : 0;
      if (mixScale > 0.01) {
        syllableEnv =
          computeWhisperSyllableEnvelope(
            Date.now(),
            this.activeWhisper.triggeredAtMs,
            this.activeWhisper.durationMs
          ) *
          0.74 *
          mixScale;
      }
    }

    return Math.min(1, Math.max(busRms, syllableEnv));
  }

  public subscribeStudioPreferences(listener: () => void): () => void {
    this.studioPrefListeners.add(listener);
    return () => this.studioPrefListeners.delete(listener);
  }

  private notifyStudioPrefListeners() {
    this.studioPrefListeners.forEach((cb) => cb());
  }

  public async startAudioContext(): Promise<boolean> {
    if (this.audioCtx && this.audioCtx.state === 'running') return true;

    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioCtx = new AudioContextClass({ sampleRate: 48000 });
        this.sampleRate = this.audioCtx.sampleRate || 48000;

        // Pre-warm shared noise buffers for zero-GC drum/pluck/whisper playback
        getSharedNoiseBuffers(this.audioCtx);

        this.analyserNode = this.audioCtx.createAnalyser();
        this.analyserNode.fftSize = 1024;
        this.bufferSize = this.analyserNode.fftSize;
        this.analyserNode.smoothingTimeConstant = 0.8;

        this.whisperBus = this.audioCtx.createGain();
        this.whisperBus.gain.setValueAtTime(0.43, this.audioCtx.currentTime);
        this.whisperAnalyserNode = this.audioCtx.createAnalyser();
        this.whisperAnalyserNode.fftSize = 256;
        this.whisperAnalyserNode.smoothingTimeConstant = 0.72;

        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.setValueAtTime(0.15, this.audioCtx.currentTime);

        this.masterMusicGain = this.audioCtx.createGain();
        this.masterMusicGain.gain.setValueAtTime(0.54, this.audioCtx.currentTime);

        this.synthBalanceGain = this.audioCtx.createGain();
        this.synthBalanceGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

        this.lyriaDuckGain = this.audioCtx.createGain();
        this.lyriaDuckGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

        this.lyriaOutputGain = this.audioCtx.createGain();
        this.lyriaOutputGain.gain.setValueAtTime(0.0, this.audioCtx.currentTime);

        this.fxChain = this.buildFxChain(this.audioCtx);

        // Pre-warm browser SpeechSynthesis voice list while inside user gesture
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          try {
            window.speechSynthesis.getVoices();
          } catch {
            // Ignore browser speech voice warm-up errors
          }
        }

        // Connect 440Hz Test Oscillator Gain -> Analyser -> Destination
        this.gainNode.connect(this.analyserNode);
        // Connect Seer Whisper Bus -> Isolated Whisper Analyser & Dedicated Vocal Presence Chain (post-music-filter, post-ducking)
        this.whisperBus.connect(this.whisperAnalyserNode);
        this.whisperBus.connect(this.fxChain.vocalInput);
        // Connect 24-Telemetry Synth Bus -> Equal-Power Synth Balance -> Stereo 6-Slot FX Chain -> Voice-Ducker -> Limiter -> Analyser
        this.masterMusicGain.connect(this.synthBalanceGain);
        this.synthBalanceGain.connect(this.fxChain.input);
        this.fxChain.output.connect(this.analyserNode);
        // Connect Google Lyria 3 Dual-Deck Bus -> Voice-Ducker -> Equal-Power Lyria Balance -> Master Analyser
        this.lyriaDuckGain.connect(this.lyriaOutputGain);
        this.lyriaOutputGain.connect(this.analyserNode);
        this.analyserNode.connect(this.audioCtx.destination);
        this.updateMusicVoiceDucking();
        this.applyLyriaMixBalance(true);
      }

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.isRunning = true;
      return true;
    } catch (err) {
      console.warn('WebAudio Context failed to start:', err);
      return false;
    }
  }

  private buildFxChain(ctx: BaseAudioContext, initialFx?: FxSlotConfig[]): FxAudioChain {
    const input = ctx.createGain();
    const padDuckInput = ctx.createGain();
    padDuckInput.gain.value = 0.56;
    const padDuckGain = ctx.createGain();
    padDuckGain.gain.value = 1.0;
    padDuckInput.connect(padDuckGain);
    padDuckGain.connect(input);

    const output = ctx.createGain();

    // Slot 4: Warm Tape Saturation / Distortion (Waveshaper)
    const waveshaper = ctx.createWaveShaper();
    waveshaper.curve = makeDistortionCurve(2.2);
    waveshaper.oversample = '2x';
    const distDry = ctx.createGain();
    const distWet = ctx.createGain();
    const distMerge = ctx.createGain();
    distDry.gain.value = 0.9;
    distWet.gain.value = 0.1;
    input.connect(distDry);
    input.connect(waveshaper);
    waveshaper.connect(distWet);
    distDry.connect(distMerge);
    distWet.connect(distMerge);

    // Slot 3: Environmental Lowpass Filter
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = 7800;
    filterNode.Q.value = 1.1;
    distMerge.connect(filterNode);

    // Slot 6: True Stereo Modulation / Analog Chorus (dual opposing L/R modulated delays)
    const modDelayL = ctx.createDelay(0.06);
    const modDelayR = ctx.createDelay(0.06);
    modDelayL.delayTime.value = 0.011;
    modDelayR.delayTime.value = 0.016;

    const modLfoL = ctx.createOscillator();
    const modLfoR = ctx.createOscillator();
    modLfoL.type = 'sine';
    modLfoR.type = 'sine';
    modLfoL.frequency.value = 0.75;
    modLfoR.frequency.value = 0.92;

    const modDepthL = ctx.createGain();
    const modDepthR = ctx.createGain();
    modDepthL.gain.value = 0.0028;
    modDepthR.gain.value = 0.0032;

    modLfoL.connect(modDepthL);
    modDepthL.connect(modDelayL.delayTime);
    modLfoR.connect(modDepthR);
    modDepthR.connect(modDelayR.delayTime);
    modLfoL.start();
    modLfoR.start();

    const modPanL = createStereoPannerOrGain(ctx, -0.78);
    const modPanR = createStereoPannerOrGain(ctx, 0.78);
    const modDry = ctx.createGain();
    const modWet = ctx.createGain();
    const modMerge = ctx.createGain();
    modDry.gain.value = 0.86;
    modWet.gain.value = 0.22;

    filterNode.connect(modDry);
    filterNode.connect(modDelayL);
    filterNode.connect(modDelayR);
    modDelayL.connect(modPanL);
    modDelayR.connect(modPanR);
    modPanL.connect(modWet);
    modPanR.connect(modWet);
    modDry.connect(modMerge);
    modWet.connect(modMerge);

    // Slot 2: Stereo Ping-Pong Delay with Warm Feedback Damping Filter
    const delayInputHp = ctx.createBiquadFilter();
    delayInputHp.type = 'highpass';
    delayInputHp.frequency.value = 240; // keep sub-bass completely out of delay echoes

    const delayL = ctx.createDelay(1.0);
    const delayR = ctx.createDelay(1.0);
    delayL.delayTime.value = 0.28;
    delayR.delayTime.value = 0.42;

    const delayDampL = ctx.createBiquadFilter();
    delayDampL.type = 'lowpass';
    delayDampL.frequency.value = 3800;
    const delayDampR = ctx.createBiquadFilter();
    delayDampR.type = 'lowpass';
    delayDampR.frequency.value = 3600;

    const delayFeedbackL = ctx.createGain();
    const delayFeedbackR = ctx.createGain();
    delayFeedbackL.gain.value = 0.28;
    delayFeedbackR.gain.value = 0.28;

    const delayPanL = createStereoPannerOrGain(ctx, -0.72);
    const delayPanR = createStereoPannerOrGain(ctx, 0.72);
    const delayDry = ctx.createGain();
    const delayWet = ctx.createGain();
    const delayMerge = ctx.createGain();
    delayDry.gain.value = 1.0;
    delayWet.gain.value = 0.2;

    modMerge.connect(delayDry);
    modMerge.connect(delayInputHp);
    delayInputHp.connect(delayL);
    // Ping-pong cross-feedback L -> R -> L
    delayL.connect(delayDampL);
    delayDampL.connect(delayFeedbackL);
    delayFeedbackL.connect(delayR);
    delayR.connect(delayDampR);
    delayDampR.connect(delayFeedbackR);
    delayFeedbackR.connect(delayL);

    delayDampL.connect(delayPanL);
    delayDampR.connect(delayPanR);
    delayPanL.connect(delayWet);
    delayPanR.connect(delayWet);
    delayDry.connect(delayMerge);
    delayWet.connect(delayMerge);

    // Slot 1: Wide Stereo Hall Reverb (Highpassed at 170 Hz to keep sub-bass crisp & tight)
    const reverbHp = ctx.createBiquadFilter();
    reverbHp.type = 'highpass';
    reverbHp.frequency.value = 170;

    const reverbConvolver = ctx.createConvolver();
    reverbConvolver.buffer = createReverbImpulse(ctx, 2.2, 0.46);
    const reverbDry = ctx.createGain();
    const reverbWet = ctx.createGain();
    const reverbMerge = ctx.createGain();
    reverbDry.gain.value = 0.84;
    reverbWet.gain.value = 0.26;
    delayMerge.connect(reverbDry);
    delayMerge.connect(reverbHp);
    reverbHp.connect(reverbConvolver);
    reverbConvolver.connect(reverbWet);
    reverbDry.connect(reverbMerge);
    reverbWet.connect(reverbMerge);

    // Master Warmth Tilt EQ (Gentle sub warmth + airy top shimmer)
    const warmthShelf = ctx.createBiquadFilter();
    warmthShelf.type = 'lowshelf';
    warmthShelf.frequency.value = 105;
    warmthShelf.gain.value = 2.4;

    const airShelf = ctx.createBiquadFilter();
    airShelf.type = 'highshelf';
    airShelf.frequency.value = 8800;
    airShelf.gain.value = 1.6;

    // Slot 5: Bus Glue Compressor + Mastering Ceiling Limiter
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 14;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.16;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 2;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;

    const musicVoiceDuckGain = ctx.createGain();
    musicVoiceDuckGain.gain.value = 1.0;

    // Dedicated Vocal Presence Chain for Seer Ambient Whispers (bypasses music lowpass & music ducking)
    const vocalInput = ctx.createGain();
    vocalInput.gain.value = 1.0;

    // 250 Hz 16 dB/oct 2-stage high-pass voice filter
    const vocalHp = createVoiceHighPass250Hz16dB(ctx);

    const vocalPresence = ctx.createBiquadFilter();
    vocalPresence.type = 'peaking';
    vocalPresence.frequency.value = 2850;
    vocalPresence.Q.value = 1.05;
    vocalPresence.gain.value = 4.5;

    const vocalDry = ctx.createGain();
    vocalDry.gain.value = 0.94;
    const vocalReverbSend = ctx.createGain();
    vocalReverbSend.gain.value = 0.28;
    const vocalReverb = ctx.createConvolver();
    vocalReverb.buffer = createReverbImpulse(ctx, 1.9, 0.36);

    // Ethereal Stereo Ping-Pong Vocal Delay (3:2 dotted-feel throw with warm dark feedback damping)
    const vocalDelayHp = ctx.createBiquadFilter();
    vocalDelayHp.type = 'highpass';
    vocalDelayHp.frequency.value = 360;

    const vocalDelayL = ctx.createDelay(1.2);
    const vocalDelayR = ctx.createDelay(1.2);
    vocalDelayL.delayTime.value = 0.34;
    vocalDelayR.delayTime.value = 0.51;

    const vocalDelayDampL = ctx.createBiquadFilter();
    vocalDelayDampL.type = 'lowpass';
    vocalDelayDampL.frequency.value = 2650;
    const vocalDelayDampR = ctx.createBiquadFilter();
    vocalDelayDampR.type = 'lowpass';
    vocalDelayDampR.frequency.value = 2400;

    const vocalDelayFbL = ctx.createGain();
    const vocalDelayFbR = ctx.createGain();
    vocalDelayFbL.gain.value = 0.32;
    vocalDelayFbR.gain.value = 0.3;

    const vocalDelayPanL = createStereoPannerOrGain(ctx, -0.68);
    const vocalDelayPanR = createStereoPannerOrGain(ctx, 0.68);
    const vocalDelaySend = ctx.createGain();
    vocalDelaySend.gain.value = 0.34;
    const vocalDelayToReverb = ctx.createGain();
    vocalDelayToReverb.gain.value = 0.24;

    vocalInput.connect(vocalHp.input);
    vocalHp.output.connect(vocalPresence);
    vocalPresence.connect(vocalDry);
    vocalPresence.connect(vocalReverb);
    vocalPresence.connect(vocalDelayHp);

    vocalDelayHp.connect(vocalDelayL);
    vocalDelayL.connect(vocalDelayDampL);
    vocalDelayDampL.connect(vocalDelayFbL);
    vocalDelayFbL.connect(vocalDelayR);
    vocalDelayR.connect(vocalDelayDampR);
    vocalDelayDampR.connect(vocalDelayFbR);
    vocalDelayFbR.connect(vocalDelayL);

    vocalDelayDampL.connect(vocalDelayPanL);
    vocalDelayDampR.connect(vocalDelayPanR);
    vocalDelayPanL.connect(vocalDelaySend);
    vocalDelayPanR.connect(vocalDelaySend);
    vocalDelaySend.connect(limiter);
    vocalDelaySend.connect(vocalDelayToReverb);
    vocalDelayToReverb.connect(vocalReverb);

    vocalReverb.connect(vocalReverbSend);
    vocalDry.connect(limiter);
    vocalReverbSend.connect(limiter);

    reverbMerge.connect(warmthShelf);
    warmthShelf.connect(airShelf);
    airShelf.connect(compressor);
    compressor.connect(musicVoiceDuckGain);
    musicVoiceDuckGain.connect(limiter);
    limiter.connect(output);

    const chain: FxAudioChain = {
      input,
      padDuckInput,
      padDuckGain,
      musicVoiceDuckGain,
      vocalInput,
      output,
      waveshaper,
      distDry,
      distWet,
      filterNode,
      modDelayL,
      modDelayR,
      modLfoL,
      modLfoR,
      modDepthL,
      modDepthR,
      modDry,
      modWet,
      delayL,
      delayR,
      delayFeedbackL,
      delayFeedbackR,
      delayDry,
      delayWet,
      reverbConvolver,
      reverbDry,
      reverbWet,
      compressor,
      limiter
    };

    if (initialFx) {
      this.applyFxSlotsToChain(ctx, chain, initialFx, false);
    }

    return chain;
  }

  private applyFxSlotsToChain(
    ctx: BaseAudioContext,
    chain: FxAudioChain,
    slots: FxSlotConfig[],
    regenerateImpulse = false
  ) {
    const now = ctx.currentTime;
    // Silky analog glide time constants so live telemetry shifts never cause abrupt filter/delay jumps
    const smoothSec = regenerateImpulse ? 0.08 : 0.48;
    const delaySmoothSec = regenerateImpulse ? 0.12 : 0.65;

    for (const slot of slots) {
      if (slot.id === 'reverb') {
        const wet = slot.bypass ? 0 : slot.mix;
        chain.reverbDry.gain.setTargetAtTime(1 - wet * 0.36, now, smoothSec);
        chain.reverbWet.gain.setTargetAtTime(wet, now, smoothSec);
        if (regenerateImpulse) {
          chain.reverbConvolver.buffer = createReverbImpulse(ctx, slot.primaryValue, slot.secondaryValue);
        }
      } else if (slot.id === 'delay') {
        const wet = slot.bypass ? 0 : slot.mix;
        const baseSec = Math.max(0.05, Math.min(0.85, slot.primaryValue / 1000));
        chain.delayL.delayTime.setTargetAtTime(baseSec, now, delaySmoothSec);
        chain.delayR.delayTime.setTargetAtTime(Math.min(0.95, baseSec * 1.5), now, delaySmoothSec);
        const fb = slot.bypass ? 0 : Math.min(0.68, slot.secondaryValue * 0.85);
        chain.delayFeedbackL.gain.setTargetAtTime(fb, now, smoothSec);
        chain.delayFeedbackR.gain.setTargetAtTime(fb, now, smoothSec);
        chain.delayDry.gain.setTargetAtTime(1, now, smoothSec);
        chain.delayWet.gain.setTargetAtTime(wet, now, smoothSec);
      } else if (slot.id === 'filter') {
        const cutoff = slot.bypass ? 18000 : slot.primaryValue;
        const q = slot.bypass ? 0.7 : slot.secondaryValue;
        chain.filterNode.frequency.setTargetAtTime(cutoff, now, smoothSec);
        chain.filterNode.Q.setTargetAtTime(q, now, smoothSec);
      } else if (slot.id === 'distortion') {
        const wet = slot.bypass ? 0 : slot.mix;
        const targetDrive = slot.bypass ? 0 : slot.primaryValue;
        if (Math.abs(targetDrive - this.lastDistortionDriveDb) > 0.45) {
          chain.waveshaper.curve = makeDistortionCurve(targetDrive);
          this.lastDistortionDriveDb = targetDrive;
        }
        chain.distDry.gain.setTargetAtTime(1 - wet * 0.45, now, smoothSec);
        chain.distWet.gain.setTargetAtTime(wet, now, smoothSec);
      } else if (slot.id === 'compressor') {
        chain.compressor.threshold.setTargetAtTime(slot.bypass ? 0 : slot.primaryValue, now, smoothSec);
        chain.compressor.ratio.setTargetAtTime(slot.bypass ? 1 : slot.secondaryValue, now, smoothSec);
      } else if (slot.id === 'modulation') {
        const wet = slot.bypass ? 0 : slot.mix;
        chain.modLfoL.frequency.setTargetAtTime(slot.primaryValue, now, smoothSec);
        chain.modLfoR.frequency.setTargetAtTime(slot.primaryValue * 1.18, now, smoothSec);
        const depth = slot.bypass ? 0 : slot.secondaryValue;
        chain.modDepthL.gain.setTargetAtTime(depth, now, smoothSec);
        chain.modDepthR.gain.setTargetAtTime(depth * 1.12, now, smoothSec);
        chain.modDry.gain.setTargetAtTime(1 - wet * 0.32, now, smoothSec);
        chain.modWet.gain.setTargetAtTime(wet, now, smoothSec);
      }
    }
  }

  public updateFxRack(slots: FxSlotConfig[], regenerateReverb = false) {
    if (this.activePlan) {
      this.activePlan = {
        ...this.activePlan,
        fxRack: slots.map((s) => ({ ...s }))
      };
    }
    if (this.audioCtx && this.fxChain) {
      this.applyFxSlotsToChain(this.audioCtx, this.fxChain, slots, regenerateReverb);
    }
  }

  public updateCompositionPlan(plan: Composition32BarPlan) {
    this.activePlan = plan;
    if (this.audioCtx && this.fxChain) {
      this.applyFxSlotsToChain(this.audioCtx, this.fxChain, plan.fxRack, false);
    }
    this.notifySequencerListeners();
  }

  public subscribeSequencer(listener: (status: SequencerPlaybackStatus) => void): () => void {
    this.sequencerListeners.add(listener);
    listener(this.getSequencerStatus());
    return () => this.sequencerListeners.delete(listener);
  }

  private resolveBarForIndex(barIndex: number): CompositionBar | null {
    if (!this.activePlan) return null;
    if (this.currentLiveBar && this.currentLiveBar.barIndex === barIndex) {
      return this.currentLiveBar;
    }
    const vec = this.smoothedVector24 ?? this.whisperVector24;
    const wCtx = this.smoothedWeatherCtx ?? this.whisperWeatherCtx;
    if (vec && wCtx) {
      this.currentLiveBar = generateEndlessBar(
        barIndex,
        vec,
        wCtx,
        this.getCompositionOptions()
      );
      return this.currentLiveBar;
    }
    if (barIndex < this.activePlan.bars.length) {
      this.currentLiveBar = this.activePlan.bars[barIndex];
      return this.currentLiveBar;
    }
    const fallback = this.activePlan.bars[barIndex % Math.max(1, this.activePlan.bars.length)];
    if (!fallback) return null;
    this.currentLiveBar = { ...fallback, barIndex };
    return this.currentLiveBar;
  }

  public getSequencerStatus(): SequencerPlaybackStatus {
    const bar =
      (this.currentLiveBar && this.currentLiveBar.barIndex === this.currentBarIndex
        ? this.currentLiveBar
        : null) ??
      this.activePlan?.bars[this.currentBarIndex % Math.max(1, this.activePlan?.bars.length ?? 1)];
    return {
      isPlaying: this.isSequencerPlaying,
      currentBar: this.currentBarIndex + 1,
      currentStep: this.currentStepIndex,
      bpm: Math.round(this.isSequencerPlaying ? this.slewedBpm : (this.activePlan?.bpm ?? 102)),
      activeSection: bar?.section ?? 'Intro',
      currentChord: bar?.chordSymbol ?? 'Cm9',
      telemetrySignatureLabel:
        this.activePlan?.telemetrySignatureLabel ?? 'Atmospheric Drift · 102 BPM',
      activeMotifTitle: this.activeAiMotif?.title ?? this.pendingAiMotif?.title ?? null,
      autoEvolveEnabled: this.autoEvolveEnabled,
      activeVoices: { ...this.lastVoiceTriggers }
    };
  }

  private notifySequencerListeners() {
    const status = this.getSequencerStatus();
    this.sequencerListeners.forEach((cb) => cb(status));
  }

  public async start32BarSequencer(plan: Composition32BarPlan): Promise<boolean> {
    const ok = await this.startAudioContext();
    if (!ok || !this.audioCtx) return false;

    this.activePlan = plan;
    this.slewedBpm = plan.bpm;
    this.currentLiveBar = plan.bars[0] ?? null;
    if (this.fxChain) {
      this.applyFxSlotsToChain(this.audioCtx, this.fxChain, plan.fxRack, true);
    }

    if (this.sequencerTimerId) {
      clearInterval(this.sequencerTimerId);
      this.sequencerTimerId = null;
    }

    this.currentBarIndex = 0;
    this.currentStepIndex = 0;
    this.nextStepTime = this.audioCtx.currentTime + 0.05;
    this.isSequencerPlaying = true;
    this.notifySequencerListeners();

    this.sequencerTimerId = setInterval(() => {
      this.scheduleSequencerLookahead();
    }, 25);

    if (this.lyriaState.enabled) {
      void this.fetchAndCrossfadeLyriaClip();
    }

    return true;
  }

  public stop32BarSequencer() {
    if (this.sequencerTimerId) {
      clearInterval(this.sequencerTimerId);
      this.sequencerTimerId = null;
    }
    this.isSequencerPlaying = false;
    this.currentBarIndex = 0;
    this.currentStepIndex = 0;
    this.currentLiveBar = null;
    this.stopAmbientWhisperSpeech(true);
    this.stopLyriaDecks(false);
    if (this.lyriaState.status !== 'idle') {
      this.lyriaState.status = 'idle';
      this.notifyLyriaListeners();
    }
    this.notifySequencerListeners();
  }

  private scheduleSequencerLookahead() {
    if (
      !this.isSequencerPlaying ||
      !this.audioCtx ||
      !this.masterMusicGain ||
      !this.fxChain ||
      !this.activePlan
    ) {
      return;
    }

    const lookaheadSec = 0.14;
    while (this.nextStepTime < this.audioCtx.currentTime + lookaheadSec) {
      const bar = this.resolveBarForIndex(this.currentBarIndex);
      if (!bar) return;

      // Smooth imperceptible tempo glide toward target telemetry BPM (zero tempo jerks)
      const targetBpm = this.activePlan.bpm;
      const bpmDiff = targetBpm - this.slewedBpm;
      const maxStepDelta = 0.22;
      this.slewedBpm += Math.max(-maxStepDelta, Math.min(maxStepDelta, bpmDiff * 0.035));

      const stepEvents = bar.events.filter((e) => e.step === this.currentStepIndex);
      const isOffbeat = this.currentStepIndex % 2 === 1;
      const stepDurSec = 60 / this.slewedBpm / 4;
      const swingOffset = isOffbeat ? stepDurSec * this.activePlan.swing : 0;
      const eventTime = this.nextStepTime + swingOffset;

      for (const evt of stepEvents) {
        const ch = this.voiceMix[evt.voice];
        if (ch?.muted || (ch && ch.gain <= 0.001)) continue;
        if (evt.voice === 'whisper' && !this.ambientWhispersEnabled) continue;

        const targetBus =
          evt.voice === 'pad'
            ? this.fxChain.padDuckInput
            : evt.voice === 'whisper' && this.whisperBus
              ? this.whisperBus
              : this.masterMusicGain;
        this.scheduleVoiceEvent(
          this.audioCtx,
          targetBus,
          evt,
          eventTime,
          this.activePlan.fmParams,
          bar.fmIndexScale,
          ch,
          evt.voice === 'kick' ? this.fxChain.padDuckGain : undefined
        );
        this.lastVoiceTriggers[evt.voice] = Date.now();

        if (evt.voice === 'whisper') {
          this.triggerLiveCrypticWhisper(
            bar.section,
            bar.barIndex + 1,
            ch ? ch.gain : 0.43
          );
        }
      }

      // Gently glide environmental filter sweep without abrupt cutoffs
      const filterSlot = this.activePlan.fxRack.find((s) => s.id === 'filter');
      if (filterSlot && !filterSlot.bypass) {
        const dynamicCutoff = Math.max(
          900,
          Math.min(14500, filterSlot.primaryValue * (0.76 + bar.filterCutoffNorm * 0.38))
        );
        this.fxChain.filterNode.frequency.setTargetAtTime(dynamicCutoff, eventTime, 0.38);
      }

      this.notifySequencerListeners();

      this.nextStepTime += stepDurSec;
      this.currentStepIndex++;
      if (this.currentStepIndex >= 16) {
        this.currentStepIndex = 0;
        this.currentBarIndex++;
        // Seamlessly activate any queued AI Motif cleanly on a 4-bar phrase boundary
        if (this.pendingAiMotif && this.currentBarIndex % 4 === 0) {
          this.activeAiMotif = this.pendingAiMotif;
          this.pendingAiMotif = null;
          this.lastMotifBarIndex = this.currentBarIndex;
          this.currentLiveBar = null;
          this.refreshActivePlanFromState();
        } else {
          this.maybeTriggerAutoMotifEvolution();
        }
      }
    }
  }

  private scheduleVoiceEvent(
    ctx: BaseAudioContext,
    dest: AudioNode,
    evt: VoiceNoteEvent,
    startTime: number,
    fmParams: FmSynthParams,
    fmScale: number,
    mixChannel?: VoiceMixChannel,
    sidechainDuckGain?: GainNode
  ) {
    const channelGain = mixChannel ? mixChannel.gain : 0.85;
    const basePan = mixChannel ? mixChannel.pan : 0;
    const effectivePan = Math.max(-0.95, Math.min(0.95, evt.pan !== undefined ? (evt.pan + basePan) * 0.65 : basePan));
    const vel = evt.velocity * channelGain;
    if (vel <= 0.001) return;

    const freq = midiToHz(evt.midiNote);
    const noiseBufs = getSharedNoiseBuffers(ctx);

    switch (evt.voice) {
      case 'pad': {
        // Lush Warm Analog Stereo Pad: multi-note detuned dual oscillators with stereo L/R spread & resonant LP sweep
        const notes = evt.chordNotes && evt.chordNotes.length > 0 ? evt.chordNotes : [evt.midiNote, evt.midiNote + 7, evt.midiNote + 10];
        const padBus = ctx.createGain();
        const padFilter = ctx.createBiquadFilter();
        padFilter.type = 'lowpass';
        padFilter.Q.setValueAtTime(1.4, startTime);

        const attack = Math.min(0.75, evt.durationSec * 0.34);
        const release = Math.min(0.95, evt.durationSec * 0.42);
        const endTime = startTime + evt.durationSec + release;

        padFilter.frequency.setValueAtTime(520, startTime);
        padFilter.frequency.exponentialRampToValueAtTime(
          Math.min(3400, 1250 + vel * 1550),
          startTime + attack + evt.durationSec * 0.35
        );
        padFilter.frequency.exponentialRampToValueAtTime(640, endTime);

        const noteScale = 0.085 / Math.sqrt(notes.length);
        padBus.gain.setValueAtTime(0.0001, startTime);
        padBus.gain.linearRampToValueAtTime(noteScale * vel, startTime + attack);
        padBus.gain.setValueAtTime(noteScale * vel * 0.88, startTime + evt.durationSec);
        padBus.gain.exponentialRampToValueAtTime(0.0001, endTime);

        padBus.connect(padFilter);
        padFilter.connect(dest);

        notes.forEach((midi, idx) => {
          const f = midiToHz(midi);
          const oscL = ctx.createOscillator();
          const oscR = ctx.createOscillator();
          oscL.type = idx === 0 ? 'triangle' : 'sawtooth';
          oscR.type = 'triangle';
          oscL.frequency.setValueAtTime(f * 0.9965, startTime);
          oscR.frequency.setValueAtTime(f * 1.0038, startTime);

          const spread = (idx % 2 === 0 ? -1 : 1) * (0.48 + idx * 0.1);
          const panL = createStereoPannerOrGain(ctx, Math.max(-0.9, Math.min(0.9, spread)));
          const panR = createStereoPannerOrGain(ctx, Math.max(-0.9, Math.min(0.9, -spread)));

          oscL.connect(panL);
          oscR.connect(panR);
          panL.connect(padBus);
          panR.connect(padBus);

          oscL.start(startTime);
          oscR.start(startTime);
          oscL.stop(endTime + 0.04);
          oscR.stop(endTime + 0.04);
        });
        break;
      }

      case 'sub': {
        // Deep Mono-Centered Studio Sub-Bass: pure sine fundamental + warm saturated triangle 2nd harmonic
        const subOsc = ctx.createOscillator();
        const warmOsc = ctx.createOscillator();
        const warmGain = ctx.createGain();
        const subFilter = ctx.createBiquadFilter();
        const env = ctx.createGain();

        subOsc.type = 'sine';
        warmOsc.type = 'triangle';
        if (evt.articulation === 'glide' && evt.pitchBendSemitones) {
          const startFreq = freq * Math.pow(2, -evt.pitchBendSemitones / 12);
          subOsc.frequency.setValueAtTime(startFreq, startTime);
          subOsc.frequency.exponentialRampToValueAtTime(freq, startTime + 0.08);
          warmOsc.frequency.setValueAtTime(startFreq * 2, startTime);
          warmOsc.frequency.exponentialRampToValueAtTime(freq * 2, startTime + 0.08);
        } else {
          subOsc.frequency.setValueAtTime(freq, startTime);
          warmOsc.frequency.setValueAtTime(freq * 2, startTime);
        }

        warmGain.gain.setValueAtTime(0.24, startTime);
        subFilter.type = 'lowpass';
        subFilter.frequency.setValueAtTime(240, startTime);
        subFilter.Q.setValueAtTime(0.8, startTime);

        const dur = Math.max(0.16, evt.durationSec);
        env.gain.setValueAtTime(0.0001, startTime);
        env.gain.linearRampToValueAtTime(0.32 * vel, startTime + 0.014);
        env.gain.setValueAtTime(0.27 * vel, startTime + dur * 0.72);
        env.gain.exponentialRampToValueAtTime(0.0001, startTime + dur + 0.06);

        subOsc.connect(subFilter);
        warmOsc.connect(warmGain);
        warmGain.connect(subFilter);
        subFilter.connect(env);
        env.connect(dest);

        subOsc.start(startTime);
        warmOsc.start(startTime);
        subOsc.stop(startTime + dur + 0.09);
        warmOsc.stop(startTime + dur + 0.09);
        break;
      }

      case 'kick': {
        // Punchy Studio Kick Drum (pitch drop + subtle beater click + gentle sidechain duck on pads)
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(154, startTime);
        osc.frequency.exponentialRampToValueAtTime(52, startTime + 0.052);
        osc.frequency.exponentialRampToValueAtTime(42, startTime + evt.durationSec);

        env.gain.setValueAtTime(0.0001, startTime);
        env.gain.linearRampToValueAtTime(0.46 * vel, startTime + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.max(0.2, evt.durationSec));

        osc.connect(env);
        env.connect(dest);
        osc.start(startTime);
        osc.stop(startTime + Math.max(0.22, evt.durationSec) + 0.04);

        // Crisp beater transient from pre-allocated noise buffer
        const clickSrc = ctx.createBufferSource();
        clickSrc.buffer = noiseBufs.white;
        const clickBp = ctx.createBiquadFilter();
        clickBp.type = 'bandpass';
        clickBp.frequency.setValueAtTime(2400, startTime);
        clickBp.Q.setValueAtTime(1.4, startTime);
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.11 * vel, startTime);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.018);

        clickSrc.connect(clickBp);
        clickBp.connect(clickGain);
        clickGain.connect(dest);
        clickSrc.start(startTime, 0, 0.025);

        // Subtle studio sidechain breathing on warm stereo pads
        if (sidechainDuckGain) {
          sidechainDuckGain.gain.cancelScheduledValues(startTime);
          sidechainDuckGain.gain.setValueAtTime(1.0, startTime);
          sidechainDuckGain.gain.linearRampToValueAtTime(0.62, startTime + 0.015);
          sidechainDuckGain.gain.setTargetAtTime(1.0, startTime + 0.05, 0.09);
        }
        break;
      }

      case 'perc': {
        // Stereo Studio Percussion: Closed Hat, Open Hat, Organic Shaker, Rimshot, and Multi-Tap Clap
        const panner = createStereoPannerOrGain(ctx, effectivePan);
        panner.connect(dest);

        if (evt.articulation === 'rim') {
          const rimOsc = ctx.createOscillator();
          const rimEnv = ctx.createGain();
          rimOsc.type = 'triangle';
          rimOsc.frequency.setValueAtTime(920, startTime);
          rimOsc.frequency.exponentialRampToValueAtTime(340, startTime + 0.032);
          rimEnv.gain.setValueAtTime(0.0001, startTime);
          rimEnv.gain.linearRampToValueAtTime(0.22 * vel, startTime + 0.002);
          rimEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.055);
          rimOsc.connect(rimEnv);
          rimEnv.connect(panner);
          rimOsc.start(startTime);
          rimOsc.stop(startTime + 0.07);

          const snap = ctx.createBufferSource();
          snap.buffer = noiseBufs.white;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(2200, startTime);
          bp.Q.setValueAtTime(2.6, startTime);
          const sGain = ctx.createGain();
          sGain.gain.setValueAtTime(0.14 * vel, startTime);
          sGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.035);
          snap.connect(bp);
          bp.connect(sGain);
          sGain.connect(panner);
          snap.start(startTime, 0.05, 0.045);
        } else if (evt.articulation === 'clap') {
          const offsets = [0, 0.011, 0.022];
          offsets.forEach((off, i) => {
            const src = ctx.createBufferSource();
            src.buffer = noiseBufs.white;
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(1450 + i * 220, startTime + off);
            bp.Q.setValueAtTime(1.5, startTime + off);
            const env = ctx.createGain();
            const tail = i === 2 ? 0.14 : 0.022;
            env.gain.setValueAtTime(0.15 * vel, startTime + off);
            env.gain.exponentialRampToValueAtTime(0.0001, startTime + off + tail);
            src.connect(bp);
            bp.connect(env);
            env.connect(panner);
            src.start(startTime + off, 0.12 + i * 0.08, tail + 0.02);
          });
        } else {
          // hat_closed, hat_open, or organic shaker
          const src = ctx.createBufferSource();
          src.buffer = evt.articulation === 'shaker' ? noiseBufs.pink : noiseBufs.white;
          const filter = ctx.createBiquadFilter();
          filter.type = evt.articulation === 'shaker' ? 'bandpass' : 'highpass';
          filter.frequency.setValueAtTime(
            evt.articulation === 'shaker' ? 5600 : evt.articulation === 'hat_open' ? 6800 : 8200,
            startTime
          );
          filter.Q.setValueAtTime(evt.articulation === 'shaker' ? 1.8 : 0.9, startTime);

          const env = ctx.createGain();
          const dur =
            evt.articulation === 'hat_open'
              ? 0.22
              : evt.articulation === 'shaker'
                ? 0.075
                : 0.048;
          const atk = evt.articulation === 'shaker' ? 0.014 : 0.002;
          const peak = evt.articulation === 'hat_open' ? 0.12 : evt.articulation === 'shaker' ? 0.11 : 0.1;

          env.gain.setValueAtTime(0.0001, startTime);
          env.gain.linearRampToValueAtTime(peak * vel, startTime + atk);
          env.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

          src.connect(filter);
          filter.connect(env);
          env.connect(panner);
          src.start(startTime, (startTime * 0.37) % 0.5, dur + 0.02);
        }
        break;
      }

      case 'kora': {
        // Upgraded Stereo 21-String Harp-Lute: dual detuned plucked strings + pluck noise transient + resonant body
        const panner = createStereoPannerOrGain(ctx, effectivePan);
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const env = ctx.createGain();

        osc1.type = 'triangle';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(freq, startTime);
        osc2.frequency.setValueAtTime(freq * 2.003, startTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(Math.min(9500, freq * 6.8), startTime);
        filter.frequency.exponentialRampToValueAtTime(Math.max(260, freq * 1.45), startTime + evt.durationSec);
        filter.Q.setValueAtTime(1.6, startTime);

        env.gain.setValueAtTime(0.0001, startTime);
        env.gain.linearRampToValueAtTime(0.16 * vel, startTime + 0.005);
        env.gain.exponentialRampToValueAtTime(0.0001, startTime + evt.durationSec + 0.06);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(env);
        env.connect(panner);
        panner.connect(dest);

        osc1.start(startTime);
        osc2.start(startTime);
        osc1.stop(startTime + evt.durationSec + 0.09);
        osc2.stop(startTime + evt.durationSec + 0.09);

        // Crisp fingernail pluck transient from shared pink noise
        const pluck = ctx.createBufferSource();
        pluck.buffer = noiseBufs.pink;
        const pluckBp = ctx.createBiquadFilter();
        pluckBp.type = 'bandpass';
        pluckBp.frequency.setValueAtTime(Math.min(5500, freq * 3.2), startTime);
        pluckBp.Q.setValueAtTime(2.4, startTime);
        const pluckEnv = ctx.createGain();
        pluckEnv.gain.setValueAtTime(0.075 * vel, startTime);
        pluckEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.022);
        pluck.connect(pluckBp);
        pluckBp.connect(pluckEnv);
        pluckEnv.connect(panner);
        pluck.start(startTime, 0.2, 0.03);
        break;
      }

      case 'djembe': {
        // Membrane drum + talking drum tension pitch bend + pre-buffered crisp palm slap
        const panner = createStereoPannerOrGain(ctx, effectivePan);
        panner.connect(dest);

        const osc = ctx.createOscillator();
        const bodyEnv = ctx.createGain();
        osc.type = 'sine';
        const baseFreq = Math.max(64, freq * 0.78);
        const targetFreq = baseFreq * Math.pow(2, (evt.pitchBendSemitones || -4) / 12);

        osc.frequency.setValueAtTime(baseFreq * 1.42, startTime);
        osc.frequency.exponentialRampToValueAtTime(Math.max(48, targetFreq), startTime + 0.085);

        bodyEnv.gain.setValueAtTime(0.0001, startTime);
        bodyEnv.gain.linearRampToValueAtTime(0.3 * vel, startTime + 0.004);
        bodyEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + evt.durationSec);

        osc.connect(bodyEnv);
        bodyEnv.connect(panner);
        osc.start(startTime);
        osc.stop(startTime + evt.durationSec + 0.04);

        const noiseSrc = ctx.createBufferSource();
        noiseSrc.buffer = noiseBufs.white;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1950, startTime);
        bp.Q.setValueAtTime(1.9, startTime);
        const slapGain = ctx.createGain();
        slapGain.gain.setValueAtTime(0.12 * vel, startTime);
        slapGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.028);
        noiseSrc.connect(bp);
        bp.connect(slapGain);
        slapGain.connect(panner);
        noiseSrc.start(startTime, 0.31, 0.035);
        break;
      }

      case 'kalimba': {
        // Stereo Mbira tine resonance (fundamental + decaying 2.76x & 5.4x metallic partials)
        const panner = createStereoPannerOrGain(ctx, effectivePan);
        panner.connect(dest);

        const fundamental = ctx.createOscillator();
        const overtone1 = ctx.createOscillator();
        const overtone2 = ctx.createOscillator();
        const overtone1Gain = ctx.createGain();
        const overtone2Gain = ctx.createGain();
        const env = ctx.createGain();

        fundamental.type = 'sine';
        overtone1.type = 'sine';
        overtone2.type = 'sine';
        fundamental.frequency.setValueAtTime(freq, startTime);
        overtone1.frequency.setValueAtTime(freq * 2.76, startTime);
        overtone2.frequency.setValueAtTime(freq * 5.4, startTime);

        overtone1Gain.gain.setValueAtTime(0.24, startTime);
        overtone1Gain.gain.exponentialRampToValueAtTime(0.02, startTime + 0.09);
        overtone2Gain.gain.setValueAtTime(0.11, startTime);
        overtone2Gain.gain.exponentialRampToValueAtTime(0.005, startTime + 0.04);

        env.gain.setValueAtTime(0.0001, startTime);
        env.gain.linearRampToValueAtTime(0.15 * vel, startTime + 0.003);
        env.gain.exponentialRampToValueAtTime(0.0001, startTime + evt.durationSec + 0.05);

        fundamental.connect(env);
        overtone1.connect(overtone1Gain);
        overtone1Gain.connect(env);
        overtone2.connect(overtone2Gain);
        overtone2Gain.connect(env);
        env.connect(panner);

        fundamental.start(startTime);
        overtone1.start(startTime);
        overtone2.start(startTime);
        fundamental.stop(startTime + evt.durationSec + 0.08);
        overtone1.stop(startTime + evt.durationSec + 0.08);
        overtone2.stop(startTime + evt.durationSec + 0.08);
        break;
      }

      case 'balafon': {
        // Stereo wooden resonator marimba bar (fundamental + 3.98x wood strike + resonant gourd body)
        const panner = createStereoPannerOrGain(ctx, effectivePan);
        panner.connect(dest);

        const barOsc = ctx.createOscillator();
        const woodOsc = ctx.createOscillator();
        const woodEnv = ctx.createGain();
        const env = ctx.createGain();

        barOsc.type = 'sine';
        woodOsc.type = 'triangle';
        barOsc.frequency.setValueAtTime(freq, startTime);
        woodOsc.frequency.setValueAtTime(freq * 3.98, startTime);

        woodEnv.gain.setValueAtTime(0.28, startTime);
        woodEnv.gain.exponentialRampToValueAtTime(0.008, startTime + 0.042);

        env.gain.setValueAtTime(0.0001, startTime);
        env.gain.linearRampToValueAtTime(0.16 * vel, startTime + 0.003);
        env.gain.exponentialRampToValueAtTime(0.0001, startTime + evt.durationSec);

        barOsc.connect(env);
        woodOsc.connect(woodEnv);
        woodEnv.connect(env);
        env.connect(panner);

        barOsc.start(startTime);
        woodOsc.start(startTime);
        barOsc.stop(startTime + evt.durationSec + 0.05);
        woodOsc.stop(startTime + evt.durationSec + 0.05);
        break;
      }

      case 'fm': {
        // Upgraded Stereo FM Rhodes Chord / Lead Synthesis Engine
        const notes =
          evt.articulation === 'rhodes_chord' && evt.chordNotes && evt.chordNotes.length > 0
            ? evt.chordNotes
            : [evt.midiNote];

        const noteGainScale = (evt.articulation === 'rhodes_chord' ? 0.12 : 0.17) / Math.sqrt(notes.length);

        notes.forEach((midi, idx) => {
          const carrierFreq = midiToHz(midi);
          const modFreq = carrierFreq * fmParams.modRatio;
          const modDeviation =
            modFreq * fmParams.fmModIndex * fmScale * (evt.articulation === 'rhodes_chord' ? 0.65 : 0.95);

          const carrier = ctx.createOscillator();
          const modulator = ctx.createOscillator();
          const modGain = ctx.createGain();
          const env = ctx.createGain();
          const notePan = createStereoPannerOrGain(
            ctx,
            Math.max(-0.85, Math.min(0.85, effectivePan + (idx - (notes.length - 1) * 0.5) * 0.16))
          );

          carrier.type = 'sine';
          modulator.type = 'sine';
          carrier.frequency.setValueAtTime(carrierFreq, startTime);
          modulator.frequency.setValueAtTime(modFreq, startTime);

          modGain.gain.setValueAtTime(modDeviation, startTime);
          modGain.gain.exponentialRampToValueAtTime(
            Math.max(8, modDeviation * (0.18 + fmParams.feedback * 0.35)),
            startTime + evt.durationSec
          );

          env.gain.setValueAtTime(0.0001, startTime);
          env.gain.linearRampToValueAtTime(noteGainScale * vel, startTime + 0.009);
          env.gain.exponentialRampToValueAtTime(0.0001, startTime + evt.durationSec + 0.06);

          modulator.connect(modGain);
          modGain.connect(carrier.frequency);
          carrier.connect(env);
          env.connect(notePan);
          notePan.connect(dest);

          carrier.start(startTime);
          modulator.start(startTime);
          carrier.stop(startTime + evt.durationSec + 0.1);
          modulator.stop(startTime + evt.durationSec + 0.1);
        });
        break;
      }

      case 'whisper': {
        // Hybrid Breathy Formant Choir & Airy Whisper Bed (chord-locked F1/F2/F3 vowel morphing + syllabic breath bursts)
        const dur = Math.max(1.8, evt.durationSec);
        const notes = evt.chordNotes && evt.chordNotes.length > 0 ? evt.chordNotes : [evt.midiNote, evt.midiNote + 7];
        const voiceBus = ctx.createGain();
        voiceBus.gain.setValueAtTime(1.0, startTime);

        // Gentle stereo drift panner
        const panner = createStereoPannerOrGain(ctx, effectivePan);
        if ('pan' in panner && (panner as StereoPannerNode).pan) {
          const stereo = panner as StereoPannerNode;
          const startPan = Math.max(-0.8, Math.min(0.8, effectivePan - 0.24));
          const endPan = Math.max(-0.8, Math.min(0.8, effectivePan + 0.24));
          stereo.pan.setValueAtTime(startPan, startTime);
          stereo.pan.linearRampToValueAtTime(endPan, startTime + dur);
        }
        voiceBus.connect(panner);
        panner.connect(dest);

        // 1. Triple-Bandpass Vowel Formant Filter Bank (morphing oo -> ah -> oh)
        const f1 = ctx.createBiquadFilter();
        f1.type = 'bandpass';
        f1.Q.setValueAtTime(3.2, startTime);
        f1.frequency.setValueAtTime(340, startTime);
        f1.frequency.exponentialRampToValueAtTime(680, startTime + dur * 0.48);
        f1.frequency.exponentialRampToValueAtTime(430, startTime + dur);

        const f2 = ctx.createBiquadFilter();
        f2.type = 'bandpass';
        f2.Q.setValueAtTime(3.8, startTime);
        f2.frequency.setValueAtTime(860, startTime);
        f2.frequency.exponentialRampToValueAtTime(1260, startTime + dur * 0.52);
        f2.frequency.exponentialRampToValueAtTime(920, startTime + dur);

        const f3 = ctx.createBiquadFilter();
        f3.type = 'bandpass';
        f3.Q.setValueAtTime(4.4, startTime);
        f3.frequency.setValueAtTime(2420, startTime);
        f3.frequency.exponentialRampToValueAtTime(2720, startTime + dur * 0.5);
        f3.frequency.exponentialRampToValueAtTime(2380, startTime + dur);

        const f1Gain = ctx.createGain();
        const f2Gain = ctx.createGain();
        const f3Gain = ctx.createGain();
        f1Gain.gain.setValueAtTime(0.76, startTime);
        f2Gain.gain.setValueAtTime(0.6, startTime);
        f3Gain.gain.setValueAtTime(0.36, startTime);

        const choirEnv = ctx.createGain();
        const choirPeak = (0.105 * vel) / Math.sqrt(notes.length);
        choirEnv.gain.setValueAtTime(0.0001, startTime);
        choirEnv.gain.linearRampToValueAtTime(choirPeak, startTime + dur * 0.24);
        choirEnv.gain.setValueAtTime(choirPeak * 0.94, startTime + dur * 0.68);
        choirEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + dur + 0.25);

        f1.connect(f1Gain);
        f2.connect(f2Gain);
        f3.connect(f3Gain);
        f1Gain.connect(choirEnv);
        f2Gain.connect(choirEnv);
        f3Gain.connect(choirEnv);
        choirEnv.connect(voiceBus);

        // Shared gentle vibrato LFO for organic choral shimmer
        const vibLfo = ctx.createOscillator();
        const vibGain = ctx.createGain();
        vibLfo.type = 'sine';
        vibLfo.frequency.setValueAtTime(4.6, startTime);
        vibGain.gain.setValueAtTime(2.6, startTime);
        vibLfo.connect(vibGain);
        vibLfo.start(startTime);
        vibLfo.stop(startTime + dur + 0.3);

        notes.slice(0, 3).forEach((midi, idx) => {
          const baseHz = midiToHz(midi);
          const oscA = ctx.createOscillator();
          const oscB = ctx.createOscillator();
          oscA.type = 'sawtooth';
          oscB.type = 'triangle';
          oscA.frequency.setValueAtTime(baseHz, startTime);
          oscB.frequency.setValueAtTime(baseHz, startTime);
          oscA.detune.setValueAtTime(-7 + idx * 3, startTime);
          oscB.detune.setValueAtTime(7 - idx * 2, startTime);

          vibGain.connect(oscA.detune);
          vibGain.connect(oscB.detune);

          oscA.connect(f1);
          oscA.connect(f2);
          oscB.connect(f2);
          oscB.connect(f3);

          oscA.start(startTime);
          oscB.start(startTime);
          oscA.stop(startTime + dur + 0.3);
          oscB.stop(startTime + dur + 0.3);
        });

        // 2. Airy Syllabic Whisper Breath Layer (pink/white noise shaped by whispered formant sweeps)
        const breathSrc = ctx.createBufferSource();
        breathSrc.buffer = noiseBufs.pink;
        breathSrc.loop = true;

        const breathBp = ctx.createBiquadFilter();
        breathBp.type = 'bandpass';
        breathBp.Q.setValueAtTime(2.8, startTime);
        breathBp.frequency.setValueAtTime(1650, startTime);
        breathBp.frequency.exponentialRampToValueAtTime(3200, startTime + dur * 0.42);
        breathBp.frequency.exponentialRampToValueAtTime(1850, startTime + dur);

        const breathHp = ctx.createBiquadFilter();
        breathHp.type = 'highpass';
        breathHp.frequency.setValueAtTime(950, startTime);

        const breathEnv = ctx.createGain();
        const breathPeak = 0.07 * vel;
        breathEnv.gain.setValueAtTime(0.0001, startTime);
        const pulseCount = 4;
        const pulseSpan = dur / pulseCount;
        for (let p = 0; p < pulseCount; p++) {
          const pStart = startTime + p * pulseSpan;
          const pWeight = p === 0 || p === pulseCount - 1 ? 0.72 : 1.0;
          breathEnv.gain.linearRampToValueAtTime(breathPeak * pWeight, pStart + pulseSpan * 0.32);
          breathEnv.gain.exponentialRampToValueAtTime(
            Math.max(0.0004, breathPeak * 0.22),
            pStart + pulseSpan * 0.92
          );
        }
        breathEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + dur + 0.16);

        breathSrc.connect(breathHp);
        breathHp.connect(breathBp);
        breathBp.connect(breathEnv);
        breathEnv.connect(voiceBus);

        breathSrc.start(startTime, (startTime * 0.23) % 0.5, dur + 0.2);
        break;
      }
    }
  }

  public auditionVoice(voice: SynthVoiceId, plan: Composition32BarPlan) {
    this.startAudioContext().then((ok) => {
      if (!ok || !this.audioCtx || !this.masterMusicGain || !this.fxChain) return;
      const sampleBar =
        plan.bars[this.currentBarIndex % Math.max(1, plan.bars.length)] ?? plan.bars[0];
      const chordNotes = sampleBar?.chordNotes ?? [plan.rootMidi, plan.rootMidi + 3, plan.rootMidi + 7, plan.rootMidi + 10];
      const evt: VoiceNoteEvent = {
        step: 0,
        voice,
        midiNote:
          voice === 'sub'
            ? Math.max(36, plan.rootMidi - 12)
            : voice === 'kick'
              ? 36
              : voice === 'djembe'
                ? plan.rootMidi - 12
                : voice === 'pad' || voice === 'fm'
                  ? plan.rootMidi
                  : plan.rootMidi + 12,
        chordNotes:
          voice === 'pad' || voice === 'fm'
            ? chordNotes
            : voice === 'whisper'
              ? chordNotes.slice(0, 3).map((n) => n + 12)
              : undefined,
        velocity: 0.88,
        durationSec:
          voice === 'whisper' ? 3.4 : voice === 'pad' ? 1.4 : voice === 'sub' ? 0.65 : 0.45,
        pitchBendSemitones: voice === 'djembe' ? -4 : undefined,
        articulation:
          voice === 'whisper'
            ? 'whisper_choir'
            : voice === 'perc'
              ? 'rim'
              : voice === 'fm'
                ? 'rhodes_chord'
                : voice === 'pad'
                  ? 'swell'
                  : undefined
      };
      const targetBus =
        voice === 'pad'
          ? this.fxChain.padDuckInput
          : voice === 'whisper' && this.whisperBus
            ? this.whisperBus
            : this.masterMusicGain;
      this.scheduleVoiceEvent(
        this.audioCtx,
        targetBus,
        evt,
        this.audioCtx.currentTime + 0.01,
        plan.fmParams,
        1.0,
        this.voiceMix[voice],
        voice === 'kick' ? this.fxChain.padDuckGain : undefined
      );
      this.lastVoiceTriggers[voice] = Date.now();
      if (voice === 'whisper') {
        this.triggerLiveCrypticWhisper(
          sampleBar?.section ?? 'Breakdown',
          (sampleBar?.barIndex ?? 0) + 1,
          this.voiceMix.whisper?.gain ?? 0.68
        );
      }
      this.notifySequencerListeners();
    });
  }

  public auditionNativeVoice(voice: NativeVoiceId, plan: Composition32BarPlan) {
    this.auditionVoice(voice, plan);
  }

  /**
   * Renders full 32-bar Master Mix + 4 Separated Stereo Stems via OfflineAudioContext @ 48kHz,
   * then encodes 5 RIFF PCM16 WAV stems and 320kbps MP3 with embedded ID3v2.3 + cover art.
   */
  public async render32BarBundle(
    plan: Composition32BarPlan,
    meta: Id3TrackMetadata,
    vector24: Record<DomainCategory, NormalizedDomainReading>,
    weatherCtx: GeolocationWeatherContext,
    onProgress?: (pct: number, stageLabel: string) => void,
    exportDurationSec?: number,
    customCoverDataUrl?: string | null
  ): Promise<RenderedReleaseBundle> {
    const sampleRate = 48000;
    const barDurationSec = (60 / plan.bpm) * 4;
    const opts = this.getCompositionOptions();
    const renderPlan =
      exportDurationSec && exportDurationSec > 0
        ? buildEndlessCompositionSpan(
            Math.max(8, Math.round(exportDurationSec / barDurationSec)),
            vector24,
            weatherCtx,
            {
              ...opts,
              overrideFm: plan.fmParams,
              overrideFx: plan.fxRack
            }
          )
        : plan;
    const barCount = renderPlan.bars.length;
    const tailSec = 2.0;
    const durationSec = Number((barDurationSec * barCount + tailSec).toFixed(2));
    const totalFrames = Math.ceil(durationSec * sampleRate);

    const renderTrackStem = async (allowedVoices: SynthVoiceId[]): Promise<AudioBuffer> => {
      const offline = new OfflineAudioContext(2, totalFrames, sampleRate);
      getSharedNoiseBuffers(offline);

      const bus = offline.createGain();
      bus.gain.setValueAtTime(0.54, 0);
      const chain = this.buildFxChain(offline, renderPlan.fxRack);
      this.applyFxSlotsToChain(offline, chain, renderPlan.fxRack, true);
      bus.connect(chain.input);
      chain.output.connect(offline.destination);

      const stepDurSec = 60 / renderPlan.bpm / 4;
      for (let b = 0; b < barCount; b++) {
        const bar = renderPlan.bars[b];
        const barStart = b * barDurationSec;
        for (const evt of bar.events) {
          if (!allowedVoices.includes(evt.voice)) continue;
          if (evt.voice === 'whisper' && !this.ambientWhispersEnabled) continue;
          const ch = this.voiceMix[evt.voice];
          if (ch?.muted || (ch && ch.gain <= 0.001)) continue;

          const isOffbeat = evt.step % 2 === 1;
          const swingOffset = isOffbeat ? stepDurSec * renderPlan.swing : 0;
          const eventTime = barStart + evt.step * stepDurSec + swingOffset;
          const targetBus =
            evt.voice === 'pad'
              ? chain.padDuckInput
              : evt.voice === 'whisper'
                ? chain.vocalInput
                : bus;
          this.scheduleVoiceEvent(
            offline,
            targetBus,
            evt,
            eventTime,
            renderPlan.fmParams,
            bar.fmIndexScale,
            ch,
            evt.voice === 'kick' ? chain.padDuckGain : undefined
          );
          if (evt.voice === 'whisper') {
            const duckDur = Math.max(1.8, evt.durationSec);
            chain.musicVoiceDuckGain.gain.setTargetAtTime(0.45, eventTime, 0.08);
            chain.musicVoiceDuckGain.gain.setTargetAtTime(1.0, eventTime + duckDur, 0.24);
          }
        }
      }

      return offline.startRendering();
    };

    onProgress?.(8, `Rendering ${barCount}-Bar Stereo Master Mix (48 kHz)...`);
    const masterBuffer = await renderTrackStem([
      'pad',
      'sub',
      'whisper',
      'kick',
      'perc',
      'kora',
      'djembe',
      'kalimba',
      'balafon',
      'fm'
    ]);

    onProgress?.(28, 'Rendering Stem 1: Warm Pads, Sub-Bass & Seer Choir...');
    const padsSubBuffer = await renderTrackStem(['pad', 'sub', 'whisper']);

    onProgress?.(46, 'Rendering Stem 2: Native African Instruments...');
    const africanBuffer = await renderTrackStem(['kora', 'kalimba', 'balafon']);

    onProgress?.(62, 'Rendering Stem 3: Studio Drums & Percussion...');
    const percBuffer = await renderTrackStem(['kick', 'djembe', 'perc']);

    onProgress?.(76, 'Rendering Stem 4: FM Rhodes & Lead Synthesis...');
    const fmBuffer = await renderTrackStem(['fm']);

    onProgress?.(86, customCoverDataUrl ? 'Encoding AI Cover Art & ID3v2.3...' : 'Generating Procedural Cover Art & ID3v2.3...');
    let cover = generateProceduralCoverArt(vector24, weatherCtx, meta, plan.bpm);
    if (customCoverDataUrl) {
      try {
        const converted = await convertImageDataUrlToJpeg1024(customCoverDataUrl);
        if (converted.jpegBytes.length > 0) {
          cover = converted;
        }
      } catch (err) {
        console.warn('Falling back to procedural cover art:', err);
      }
    }

    onProgress?.(92, 'Encoding 320kbps MP3 & 16-bit Stereo WAV Stems...');
    const safeSlug =
      meta.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'weather-beats-32bar';

    const buildWavItem = (
      id: StemRenderKind,
      label: string,
      suffix: string,
      buf: AudioBuffer
    ): RenderedStemItem => {
      const left = buf.getChannelData(0);
      const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : left;
      const wavBytes = encodeWavPcm16(left, right, sampleRate);
      const wavBlob = new Blob([wavBytes.slice().buffer], { type: 'audio/wav' });
      return {
        id,
        label,
        fileName: `${safeSlug}-${suffix}.wav`,
        wavBlob,
        wavUrl: URL.createObjectURL(wavBlob),
        sizeBytes: wavBlob.size
      };
    };

    const stems: RenderedStemItem[] = [
      buildWavItem('master', 'Master Mix (Stereo WAV)', 'master-mix', masterBuffer),
      buildWavItem('pads_sub', 'Stem 1 · Warm Pads, Sub-Bass & Seer Choir', 'stem-pads-sub-choir', padsSubBuffer),
      buildWavItem('african_instruments', 'Stem 2 · Native African Instruments', 'stem-african-instruments', africanBuffer),
      buildWavItem('percussion', 'Stem 3 · Studio Drums & Percussion', 'stem-drums-percussion', percBuffer),
      buildWavItem('fm_synth', 'Stem 4 · FM Rhodes & Lead Synthesis', 'stem-fm-keys-lead', fmBuffer)
    ];

    const mLeft = masterBuffer.getChannelData(0);
    const mRight = masterBuffer.numberOfChannels > 1 ? masterBuffer.getChannelData(1) : mLeft;
    const rawMp3 = encodeMp3320(mLeft, mRight, sampleRate);
    const taggedMp3 = prependId3ToMp3(rawMp3, meta, cover.jpegBytes);
    const mp3Blob = new Blob([taggedMp3.slice().buffer], { type: 'audio/mpeg' });
    const mp3Url = URL.createObjectURL(mp3Blob);

    onProgress?.(100, 'Render Complete · Files Ready');

    return {
      mp3Blob,
      mp3Url,
      mp3FileName: `${safeSlug}-320kbps.mp3`,
      mp3SizeBytes: mp3Blob.size,
      coverDataUrl: cover.dataUrl,
      coverFileName: `${safeSlug}-cover.jpg`,
      stems,
      durationSec,
      bpm: plan.bpm,
      telemetrySignature: plan.telemetrySignature
    };
  }

  public toggleSynthTone(frequencyHz = 440): boolean {
    if (!this.audioCtx || !this.gainNode) return false;

    if (this.isOscActive) {
      if (this.oscNode) {
        this.oscNode.stop();
        this.oscNode.disconnect();
        this.oscNode = null;
      }
      this.isOscActive = false;
      return false;
    } else {
      this.oscNode = this.audioCtx.createOscillator();
      this.oscNode.type = 'sawtooth';
      this.oscNode.frequency.setValueAtTime(frequencyHz, this.audioCtx.currentTime);
      this.oscNode.connect(this.gainNode);
      this.oscNode.start();
      this.isOscActive = true;
      return true;
    }
  }

  public setSynthFrequency(freqHz: number) {
    if (this.oscNode && this.audioCtx) {
      this.oscNode.frequency.setTargetAtTime(freqHz, this.audioCtx.currentTime, 0.02);
    }
  }

  /**
   * Real-time zero-allocation DSP metrics extraction.
   * Runs in animation frame / polling loop, operating strictly on pre-allocated buffers.
   */
  public processBlock(): AudioDspMetrics {
    if (!this.analyserNode) {
      this.cachedMetrics.sampleRate = 48000;
      this.cachedMetrics.bufferSize = 1024;
      this.cachedMetrics.peakDb = -96;
      this.cachedMetrics.rmsDb = -96;
      this.cachedMetrics.spectralCentroidHz = 0;
      this.cachedMetrics.lufsLoudness = -96;
      this.cachedMetrics.detectedPitchHz = 0;
      this.cachedMetrics.isOscillatorActive = false;
      this.cachedMetrics.midiNoteActiveCount = this.activeMidiNotes.size;
      for (let b = 0; b < 32; b++) {
        this.displaySpectrum32[b] = 0;
      }
      return this.cachedMetrics;
    }

    // Zero-allocation buffer population
    this.analyserNode.getFloatTimeDomainData(this.timeDomainBuffer);
    this.analyserNode.getByteFrequencyData(this.frequencyBuffer);

    let sumSquare = 0;
    let maxPeak = 0;
    const len = this.timeDomainBuffer.length;

    for (let i = 0; i < len; i++) {
      const sample = this.timeDomainBuffer[i];
      const absSample = sample < 0 ? -sample : sample;
      if (absSample > maxPeak) maxPeak = absSample;
      sumSquare += sample * sample;
    }

    const rms = Math.sqrt(sumSquare / len);
    const rmsDb = rms > 0.00001 ? 20 * Math.log10(rms) : -96;
    const peakDb = maxPeak > 0.00001 ? 20 * Math.log10(maxPeak) : -96;

    // Spectral centroid calculation
    let num = 0;
    let den = 0;
    const binCount = this.frequencyBuffer.length;
    const nyquist = this.sampleRate / 2;

    for (let i = 0; i < binCount; i++) {
      const freq = (i / binCount) * nyquist;
      const mag = this.frequencyBuffer[i];
      num += freq * mag;
      den += mag;
    }

    const spectralCentroidHz = den > 0 ? Math.round(num / den) : 0;

    // Downsample 512 FFT bins into 32 display bands (zero heap allocations)
    const binSize = Math.floor(binCount / 32);
    for (let b = 0; b < 32; b++) {
      let bandSum = 0;
      for (let k = 0; k < binSize; k++) {
        bandSum += this.frequencyBuffer[b * binSize + k];
      }
      this.displaySpectrum32[b] = Math.round((bandSum / (binSize * 255)) * 1000) / 1000;
    }

    const lufsLoudness = Math.round((rmsDb - 1.5) * 10) / 10;

    this.cachedMetrics.sampleRate = this.sampleRate;
    this.cachedMetrics.bufferSize = this.bufferSize;
    this.cachedMetrics.peakDb = Math.round(peakDb * 10) / 10;
    this.cachedMetrics.rmsDb = Math.round(rmsDb * 10) / 10;
    this.cachedMetrics.spectralCentroidHz = spectralCentroidHz;
    this.cachedMetrics.lufsLoudness = lufsLoudness;
    this.cachedMetrics.detectedPitchHz = spectralCentroidHz > 100 ? spectralCentroidHz : 440;
    this.cachedMetrics.isOscillatorActive = this.isOscActive;
    this.cachedMetrics.midiNoteActiveCount = this.activeMidiNotes.size;

    return this.cachedMetrics;
  }

  private async initMidi() {
    if (typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator) {
      try {
        this.midiAccess = await (navigator as any).requestMIDIAccess();
        for (const input of this.midiAccess.inputs.values()) {
          input.onmidimessage = (msg: any) => this.handleMidiMessage(msg.data);
        }
      } catch {
        // MIDI access denied or unavailable in origin
      }
    }
  }

  private handleMidiMessage(data: Uint8Array) {
    if (!data || data.length < 3) return;
    const cmd = data[0] >> 4;
    const note = data[1];
    const velocity = data[2];

    if (cmd === 9 && velocity > 0) {
      this.activeMidiNotes.add(note);
      if (this.isOscActive) {
        const freq = 440 * Math.pow(2, (note - 69) / 12);
        this.setSynthFrequency(freq);
      }
    } else if (cmd === 8 || (cmd === 9 && velocity === 0)) {
      this.activeMidiNotes.delete(note);
    }
  }
}

export const audioDspEngine = new AudioDspEngine();
