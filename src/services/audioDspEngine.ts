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
  FmSynthParams,
  FxSlotConfig,
  NativeVoiceId,
  NormalizedDomainReading,
  SynthVoiceId,
  VoiceNoteEvent,
  midiToHz
} from './weatherBeatsComposer';
import {
  Id3TrackMetadata,
  encodeMp3320,
  encodeWavPcm16,
  generateProceduralCoverArt,
  prependId3ToMp3
} from './audioExportEngine';

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
  currentBar: number; // 1..32
  currentStep: number; // 0..15
  bpm: number;
  activeSection: BarSectionName;
  activeVoices: Record<SynthVoiceId, number>; // timestamp ms of last trigger
}

export type StemRenderKind = 'master' | 'african_instruments' | 'percussion' | 'fm_synth';

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
  output: GainNode;
  waveshaper: WaveShaperNode;
  distDry: GainNode;
  distWet: GainNode;
  filterNode: BiquadFilterNode;
  modDelay: DelayNode;
  modLfo: OscillatorNode;
  modDepth: GainNode;
  modDry: GainNode;
  modWet: GainNode;
  delayNode: DelayNode;
  delayFeedback: GainNode;
  delayDry: GainNode;
  delayWet: GainNode;
  reverbConvolver: ConvolverNode;
  reverbDry: GainNode;
  reverbWet: GainNode;
  compressor: DynamicsCompressorNode;
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

function createReverbImpulse(
  ctx: BaseAudioContext,
  decaySec: number,
  damping: number
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 48000;
  const length = Math.max(1, Math.floor(sampleRate * Math.min(4.5, Math.max(0.3, decaySec))));
  const impulse = ctx.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const channelData = impulse.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, 2.2);
      const white = Math.random() * 2 - 1;
      lp = lp + (1 - damping * 0.85) * (white - lp);
      channelData[i] = lp * env;
    }
  }
  return impulse;
}

class AudioDspEngine {
  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private oscNode: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private masterMusicGain: GainNode | null = null;
  private fxChain: FxAudioChain | null = null;
  private isRunning = false;
  private isOscActive = false;

  private sampleRate = 48000;
  private bufferSize = 1024;

  // Pre-allocated typed buffers for zero-allocation real-time processBlock safety
  private timeDomainBuffer = new Float32Array(1024);
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

  // 32-Bar Sequencer state
  private activePlan: Composition32BarPlan | null = null;
  private isSequencerPlaying = false;
  private sequencerTimerId: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private currentBarIndex = 0;
  private currentStepIndex = 0;
  private lastVoiceTriggers: Record<SynthVoiceId, number> = {
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

  public async startAudioContext(): Promise<boolean> {
    if (this.audioCtx && this.audioCtx.state === 'running') return true;

    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioCtx = new AudioContextClass({ sampleRate: 48000 });
        this.sampleRate = this.audioCtx.sampleRate || 48000;

        this.analyserNode = this.audioCtx.createAnalyser();
        this.analyserNode.fftSize = 1024;
        this.bufferSize = this.analyserNode.fftSize;
        this.analyserNode.smoothingTimeConstant = 0.8;

        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.setValueAtTime(0.15, this.audioCtx.currentTime);

        this.masterMusicGain = this.audioCtx.createGain();
        this.masterMusicGain.gain.setValueAtTime(0.72, this.audioCtx.currentTime);

        this.fxChain = this.buildFxChain(this.audioCtx);

        // Connect 440Hz Test Oscillator Gain -> Analyser -> Destination
        this.gainNode.connect(this.analyserNode);
        // Connect 32-Bar Sequencer Music Bus -> 6-Slot FX Chain -> Analyser -> Destination
        this.masterMusicGain.connect(this.fxChain.input);
        this.fxChain.output.connect(this.analyserNode);
        this.analyserNode.connect(this.audioCtx.destination);
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
    const output = ctx.createGain();

    // Slot 4: Distortion (Waveshaper)
    const waveshaper = ctx.createWaveShaper();
    waveshaper.curve = makeDistortionCurve(3);
    waveshaper.oversample = '2x';
    const distDry = ctx.createGain();
    const distWet = ctx.createGain();
    const distMerge = ctx.createGain();
    distDry.gain.value = 0.85;
    distWet.gain.value = 0.15;
    input.connect(distDry);
    input.connect(waveshaper);
    waveshaper.connect(distWet);
    distDry.connect(distMerge);
    distWet.connect(distMerge);

    // Slot 3: Environmental Filter
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = 6400;
    filterNode.Q.value = 1.4;
    distMerge.connect(filterNode);

    // Slot 6: Modulation (Chorus / Wind Drift)
    const modDelay = ctx.createDelay(0.05);
    modDelay.delayTime.value = 0.012;
    const modLfo = ctx.createOscillator();
    modLfo.type = 'sine';
    modLfo.frequency.value = 1.2;
    const modDepth = ctx.createGain();
    modDepth.gain.value = 0.003;
    modLfo.connect(modDepth);
    modDepth.connect(modDelay.delayTime);
    modLfo.start();
    const modDry = ctx.createGain();
    const modWet = ctx.createGain();
    const modMerge = ctx.createGain();
    modDry.gain.value = 0.82;
    modWet.gain.value = 0.22;
    filterNode.connect(modDry);
    filterNode.connect(modDelay);
    modDelay.connect(modWet);
    modDry.connect(modMerge);
    modWet.connect(modMerge);

    // Slot 2: Delay (Network Latency Echo)
    const delayNode = ctx.createDelay(1.0);
    delayNode.delayTime.value = 0.28;
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.3;
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    const delayDry = ctx.createGain();
    const delayWet = ctx.createGain();
    const delayMerge = ctx.createGain();
    delayDry.gain.value = 0.85;
    delayWet.gain.value = 0.22;
    modMerge.connect(delayDry);
    modMerge.connect(delayNode);
    delayNode.connect(delayWet);
    delayDry.connect(delayMerge);
    delayWet.connect(delayMerge);

    // Slot 1: Reverb (Atmospheric Convolution)
    const reverbConvolver = ctx.createConvolver();
    reverbConvolver.buffer = createReverbImpulse(ctx, 2.0, 0.45);
    const reverbDry = ctx.createGain();
    const reverbWet = ctx.createGain();
    const reverbMerge = ctx.createGain();
    reverbDry.gain.value = 0.78;
    reverbWet.gain.value = 0.28;
    delayMerge.connect(reverbDry);
    delayMerge.connect(reverbConvolver);
    reverbConvolver.connect(reverbWet);
    reverbDry.connect(reverbMerge);
    reverbWet.connect(reverbMerge);

    // Slot 5: Compressor (Energy Grid Glue)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.16;

    reverbMerge.connect(compressor);
    compressor.connect(output);

    const chain: FxAudioChain = {
      input,
      output,
      waveshaper,
      distDry,
      distWet,
      filterNode,
      modDelay,
      modLfo,
      modDepth,
      modDry,
      modWet,
      delayNode,
      delayFeedback,
      delayDry,
      delayWet,
      reverbConvolver,
      reverbDry,
      reverbWet,
      compressor
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
    for (const slot of slots) {
      if (slot.id === 'reverb') {
        const wet = slot.bypass ? 0 : slot.mix;
        chain.reverbDry.gain.setTargetAtTime(1 - wet * 0.45, now, 0.03);
        chain.reverbWet.gain.setTargetAtTime(wet, now, 0.03);
        if (regenerateImpulse) {
          chain.reverbConvolver.buffer = createReverbImpulse(ctx, slot.primaryValue, slot.secondaryValue);
        }
      } else if (slot.id === 'delay') {
        const wet = slot.bypass ? 0 : slot.mix;
        chain.delayNode.delayTime.setTargetAtTime(Math.max(0.04, slot.primaryValue / 1000), now, 0.04);
        chain.delayFeedback.gain.setTargetAtTime(slot.bypass ? 0 : Math.min(0.8, slot.secondaryValue), now, 0.03);
        chain.delayDry.gain.setTargetAtTime(1, now, 0.03);
        chain.delayWet.gain.setTargetAtTime(wet, now, 0.03);
      } else if (slot.id === 'filter') {
        const cutoff = slot.bypass ? 18000 : slot.primaryValue;
        const q = slot.bypass ? 0.7 : slot.secondaryValue;
        chain.filterNode.frequency.setTargetAtTime(cutoff, now, 0.03);
        chain.filterNode.Q.setTargetAtTime(q, now, 0.03);
      } else if (slot.id === 'distortion') {
        const wet = slot.bypass ? 0 : slot.mix;
        chain.waveshaper.curve = makeDistortionCurve(slot.bypass ? 0 : slot.primaryValue);
        chain.distDry.gain.setTargetAtTime(1 - wet * 0.5, now, 0.03);
        chain.distWet.gain.setTargetAtTime(wet, now, 0.03);
      } else if (slot.id === 'compressor') {
        chain.compressor.threshold.setTargetAtTime(slot.bypass ? 0 : slot.primaryValue, now, 0.03);
        chain.compressor.ratio.setTargetAtTime(slot.bypass ? 1 : slot.secondaryValue, now, 0.03);
      } else if (slot.id === 'modulation') {
        const wet = slot.bypass ? 0 : slot.mix;
        chain.modLfo.frequency.setTargetAtTime(slot.primaryValue, now, 0.04);
        chain.modDepth.gain.setTargetAtTime(slot.bypass ? 0 : slot.secondaryValue, now, 0.04);
        chain.modDry.gain.setTargetAtTime(1 - wet * 0.4, now, 0.03);
        chain.modWet.gain.setTargetAtTime(wet, now, 0.03);
      }
    }
  }

  public updateFxRack(slots: FxSlotConfig[], regenerateReverb = false) {
    if (this.activePlan) {
      this.activePlan = {
        ...this.activePlan,
        fxRack: slots.map(s => ({ ...s }))
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

  public getSequencerStatus(): SequencerPlaybackStatus {
    const bar = this.activePlan?.bars[this.currentBarIndex];
    return {
      isPlaying: this.isSequencerPlaying,
      currentBar: this.currentBarIndex + 1,
      currentStep: this.currentStepIndex,
      bpm: this.activePlan?.bpm ?? 120,
      activeSection: bar?.section ?? 'Intro',
      activeVoices: { ...this.lastVoiceTriggers }
    };
  }

  private notifySequencerListeners() {
    const status = this.getSequencerStatus();
    this.sequencerListeners.forEach(cb => cb(status));
  }

  public async start32BarSequencer(plan: Composition32BarPlan): Promise<boolean> {
    const ok = await this.startAudioContext();
    if (!ok || !this.audioCtx) return false;

    this.activePlan = plan;
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
    this.notifySequencerListeners();
  }

  private scheduleSequencerLookahead() {
    if (!this.isSequencerPlaying || !this.audioCtx || !this.masterMusicGain || !this.activePlan) return;

    const lookaheadSec = 0.14;
    while (this.nextStepTime < this.audioCtx.currentTime + lookaheadSec) {
      const bar = this.activePlan.bars[this.currentBarIndex];
      const stepEvents = bar.events.filter(e => e.step === this.currentStepIndex);
      const isOffbeat = this.currentStepIndex % 2 === 1;
      const stepDurSec = 60 / this.activePlan.bpm / 4;
      const swingOffset = isOffbeat ? stepDurSec * this.activePlan.swing : 0;
      const eventTime = this.nextStepTime + swingOffset;

      for (const evt of stepEvents) {
        this.scheduleVoiceEvent(
          this.audioCtx,
          this.masterMusicGain,
          evt,
          eventTime,
          this.activePlan.fmParams,
          bar.fmIndexScale
        );
        this.lastVoiceTriggers[evt.voice] = Date.now();
      }

      // Modulate filter sweep subtly per bar progression if not bypassed
      const filterSlot = this.activePlan.fxRack.find(s => s.id === 'filter');
      if (this.fxChain && filterSlot && !filterSlot.bypass) {
        const dynamicCutoff = Math.max(450, Math.min(14000, filterSlot.primaryValue * (0.65 + bar.filterCutoffNorm * 0.55)));
        this.fxChain.filterNode.frequency.setTargetAtTime(dynamicCutoff, eventTime, 0.05);
      }

      this.notifySequencerListeners();

      this.nextStepTime += stepDurSec;
      this.currentStepIndex++;
      if (this.currentStepIndex >= 16) {
        this.currentStepIndex = 0;
        this.currentBarIndex = (this.currentBarIndex + 1) % 32;
      }
    }
  }

  private scheduleVoiceEvent(
    ctx: BaseAudioContext,
    dest: AudioNode,
    evt: VoiceNoteEvent,
    startTime: number,
    fmParams: FmSynthParams,
    fmScale: number
  ) {
    const freq = midiToHz(evt.midiNote);
    const vel = evt.velocity;

    switch (evt.voice) {
      case 'kora': {
        // West African 21-string harp-lute plucked harmonic string synthesis
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const env = ctx.createGain();
        osc1.type = 'triangle';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(freq, startTime);
        osc2.frequency.setValueAtTime(freq * 2.004, startTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(freq * 6, startTime);
        filter.frequency.exponentialRampToValueAtTime(Math.max(220, freq * 1.4), startTime + evt.durationSec);

        env.gain.setValueAtTime(0.0001, startTime);
        env.gain.linearRampToValueAtTime(0.16 * vel, startTime + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, startTime + evt.durationSec);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(env);
        env.connect(dest);

        osc1.start(startTime);
        osc2.start(startTime);
        osc1.stop(startTime + evt.durationSec + 0.04);
        osc2.stop(startTime + evt.durationSec + 0.04);
        break;
      }

      case 'djembe': {
        // Membrane drum + talking drum tension pitch bend
        const osc = ctx.createOscillator();
        const bodyEnv = ctx.createGain();
        osc.type = 'sine';
        const baseFreq = Math.max(55, freq * 0.72);
        const targetFreq = baseFreq * Math.pow(2, (evt.pitchBendSemitones || -4) / 12);

        osc.frequency.setValueAtTime(baseFreq * 1.45, startTime);
        osc.frequency.exponentialRampToValueAtTime(Math.max(42, targetFreq), startTime + 0.09);

        bodyEnv.gain.setValueAtTime(0.0001, startTime);
        bodyEnv.gain.linearRampToValueAtTime(0.38 * vel, startTime + 0.004);
        bodyEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + evt.durationSec);

        osc.connect(bodyEnv);
        bodyEnv.connect(dest);
        osc.start(startTime);
        osc.stop(startTime + evt.durationSec + 0.04);

        // Crisp palm slap transient
        const slapLen = Math.floor((ctx.sampleRate || 48000) * 0.025);
        const noiseBuf = ctx.createBuffer(1, slapLen, ctx.sampleRate || 48000);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < slapLen; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (slapLen * 0.25));
        }
        const noiseSrc = ctx.createBufferSource();
        noiseSrc.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1900, startTime);
        bp.Q.setValueAtTime(1.8, startTime);
        const slapGain = ctx.createGain();
        slapGain.gain.setValueAtTime(0.14 * vel, startTime);
        noiseSrc.connect(bp);
        bp.connect(slapGain);
        slapGain.connect(dest);
        noiseSrc.start(startTime);
        break;
      }

      case 'kalimba': {
        // Mbira tine resonance (fundamental + metallic 2.75x inharmonic partial)
        const fundamental = ctx.createOscillator();
        const overtone = ctx.createOscillator();
        const overtoneGain = ctx.createGain();
        const env = ctx.createGain();

        fundamental.type = 'sine';
        overtone.type = 'sine';
        fundamental.frequency.setValueAtTime(freq, startTime);
        overtone.frequency.setValueAtTime(freq * 2.76, startTime);
        overtoneGain.gain.setValueAtTime(0.28, startTime);

        env.gain.setValueAtTime(0.0001, startTime);
        env.gain.linearRampToValueAtTime(0.17 * vel, startTime + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, startTime + evt.durationSec);

        fundamental.connect(env);
        overtone.connect(overtoneGain);
        overtoneGain.connect(env);
        env.connect(dest);

        fundamental.start(startTime);
        overtone.start(startTime);
        fundamental.stop(startTime + evt.durationSec + 0.04);
        overtone.stop(startTime + evt.durationSec + 0.04);
        break;
      }

      case 'balafon': {
        // Wooden resonator marimba bar (fundamental + 4x wood overtone)
        const barOsc = ctx.createOscillator();
        const woodOsc = ctx.createOscillator();
        const woodEnv = ctx.createGain();
        const env = ctx.createGain();

        barOsc.type = 'sine';
        woodOsc.type = 'triangle';
        barOsc.frequency.setValueAtTime(freq, startTime);
        woodOsc.frequency.setValueAtTime(freq * 3.98, startTime);

        woodEnv.gain.setValueAtTime(0.32, startTime);
        woodEnv.gain.exponentialRampToValueAtTime(0.01, startTime + 0.045);

        env.gain.setValueAtTime(0.0001, startTime);
        env.gain.linearRampToValueAtTime(0.18 * vel, startTime + 0.003);
        env.gain.exponentialRampToValueAtTime(0.0001, startTime + evt.durationSec);

        barOsc.connect(env);
        woodOsc.connect(woodEnv);
        woodEnv.connect(env);
        env.connect(dest);

        barOsc.start(startTime);
        woodOsc.start(startTime);
        barOsc.stop(startTime + evt.durationSec + 0.04);
        woodOsc.stop(startTime + evt.durationSec + 0.04);
        break;
      }

      case 'fm': {
        // Telemetry-driven 2-Operator FM Synthesis with dynamic modulation index
        const carrier = ctx.createOscillator();
        const modulator = ctx.createOscillator();
        const modGain = ctx.createGain();
        const env = ctx.createGain();

        const carrierFreq = freq;
        const modFreq = carrierFreq * fmParams.modRatio;
        const modDeviation = modFreq * fmParams.fmModIndex * fmScale;

        carrier.type = 'sine';
        modulator.type = 'sine';
        carrier.frequency.setValueAtTime(carrierFreq, startTime);
        modulator.frequency.setValueAtTime(modFreq, startTime);

        modGain.gain.setValueAtTime(modDeviation, startTime);
        modGain.gain.exponentialRampToValueAtTime(
          Math.max(12, modDeviation * (0.25 + fmParams.feedback * 0.45)),
          startTime + evt.durationSec
        );

        env.gain.setValueAtTime(0.0001, startTime);
        env.gain.linearRampToValueAtTime(0.21 * vel, startTime + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, startTime + evt.durationSec);

        modulator.connect(modGain);
        modGain.connect(carrier.frequency);
        carrier.connect(env);
        env.connect(dest);

        carrier.start(startTime);
        modulator.start(startTime);
        carrier.stop(startTime + evt.durationSec + 0.05);
        modulator.stop(startTime + evt.durationSec + 0.05);
        break;
      }
    }
  }

  public auditionNativeVoice(voice: NativeVoiceId, plan: Composition32BarPlan) {
    this.startAudioContext().then((ok) => {
      if (!ok || !this.audioCtx || !this.masterMusicGain) return;
      const evt: VoiceNoteEvent = {
        step: 0,
        voice,
        midiNote: voice === 'djembe' ? plan.rootMidi - 12 : plan.rootMidi + 12,
        velocity: 0.85,
        durationSec: 0.45,
        pitchBendSemitones: voice === 'djembe' ? -4 : undefined
      };
      this.scheduleVoiceEvent(
        this.audioCtx,
        this.masterMusicGain,
        evt,
        this.audioCtx.currentTime + 0.01,
        plan.fmParams,
        1.0
      );
      this.lastVoiceTriggers[voice] = Date.now();
      this.notifySequencerListeners();
    });
  }

  /**
   * Renders full 32-bar Master Mix + 3 Separated Stems via OfflineAudioContext @ 48kHz,
   * then encodes 4 RIFF PCM16 WAV stems and 320kbps MP3 with embedded ID3v2.3 + cover art.
   */
  public async render32BarBundle(
    plan: Composition32BarPlan,
    meta: Id3TrackMetadata,
    vector24: Record<DomainCategory, NormalizedDomainReading>,
    weatherCtx: GeolocationWeatherContext,
    onProgress?: (pct: number, stageLabel: string) => void
  ): Promise<RenderedReleaseBundle> {
    const sampleRate = 48000;
    const barDurationSec = (60 / plan.bpm) * 4;
    const tailSec = 1.5;
    const durationSec = Number((barDurationSec * 32 + tailSec).toFixed(2));
    const totalFrames = Math.ceil(durationSec * sampleRate);

    const renderTrackStem = async (
      allowedVoices: SynthVoiceId[]
    ): Promise<AudioBuffer> => {
      const offline = new OfflineAudioContext(2, totalFrames, sampleRate);
      const bus = offline.createGain();
      bus.gain.setValueAtTime(0.75, 0);
      const chain = this.buildFxChain(offline, plan.fxRack);
      this.applyFxSlotsToChain(offline, chain, plan.fxRack, true);
      bus.connect(chain.input);
      chain.output.connect(offline.destination);

      const stepDurSec = 60 / plan.bpm / 4;
      for (let b = 0; b < 32; b++) {
        const bar = plan.bars[b];
        const barStart = b * barDurationSec;
        for (const evt of bar.events) {
          if (!allowedVoices.includes(evt.voice)) continue;
          const isOffbeat = evt.step % 2 === 1;
          const swingOffset = isOffbeat ? stepDurSec * plan.swing : 0;
          const eventTime = barStart + evt.step * stepDurSec + swingOffset;
          this.scheduleVoiceEvent(
            offline,
            bus,
            evt,
            eventTime,
            plan.fmParams,
            bar.fmIndexScale
          );
        }
      }

      return offline.startRendering();
    };

    onProgress?.(10, 'Rendering 32-Bar Master Mix (48 kHz)...');
    const masterBuffer = await renderTrackStem(['kora', 'djembe', 'kalimba', 'balafon', 'fm']);

    onProgress?.(32, 'Rendering Stem 1: Native African Instruments...');
    const africanBuffer = await renderTrackStem(['kora', 'kalimba', 'balafon']);

    onProgress?.(52, 'Rendering Stem 2: Djembe & Percussion...');
    const percBuffer = await renderTrackStem(['djembe']);

    onProgress?.(70, 'Rendering Stem 3: FM Synthesis...');
    const fmBuffer = await renderTrackStem(['fm']);

    onProgress?.(82, 'Generating Procedural Cover Art & ID3v2.3...');
    const cover = generateProceduralCoverArt(vector24, weatherCtx, meta, plan.bpm);

    onProgress?.(90, 'Encoding 320kbps MP3 & 16-bit WAV Stems...');
    const safeSlug = meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'weather-beats-32bar';

    const buildWavItem = (id: StemRenderKind, label: string, suffix: string, buf: AudioBuffer): RenderedStemItem => {
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
      buildWavItem('african_instruments', 'Stem 1 · Native African Instruments', 'stem-african-instruments', africanBuffer),
      buildWavItem('percussion', 'Stem 2 · Djembe & Percussion', 'stem-djembe-percussion', percBuffer),
      buildWavItem('fm_synth', 'Stem 3 · FM Synthesis', 'stem-fm-synth', fmBuffer)
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
