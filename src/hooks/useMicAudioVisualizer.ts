import { useCallback, useEffect, useRef, useState } from 'react';

export interface AudioVisualSyncParams {
  intensity: number;
  swirlBoost: number;
  nebulaPrimaryHex: string;
  nebulaSecondaryHex: string;
  nebulaAccentHex: string;
  runeOuterHex: string;
  runeInnerHex: string;
  runeOpacityBoost: number;
  runeScaleBoost: number;
}

export interface MicVisualizerMetrics extends AudioVisualSyncParams {
  active: boolean;
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  spectralCentroid: number;
  peakHold: number;
}

interface RgbTuple {
  r: number;
  g: number;
  b: number;
}

const PALETTE_BASS_PRIMARY: RgbTuple = { r: 37, g: 99, b: 235 };      // #2563eb deep sapphire
const PALETTE_BASS_SECONDARY: RgbTuple = { r: 67, g: 56, b: 202 };    // #4338ca royal indigo
const PALETTE_BASS_ACCENT: RgbTuple = { r: 56, g: 189, b: 248 };      // #38bdf8 sky plasma

const PALETTE_MID_PRIMARY: RgbTuple = { r: 6, g: 182, b: 212 };       // #06b6d4 luminous cyan
const PALETTE_MID_SECONDARY: RgbTuple = { r: 15, g: 118, b: 110 };    // #0f766e deep teal
const PALETTE_MID_ACCENT: RgbTuple = { r: 52, g: 211, b: 153 };       // #34d399 emerald spark

const PALETTE_TREBLE_PRIMARY: RgbTuple = { r: 245, g: 158, b: 11 };   // #f59e0b celestial amber
const PALETTE_TREBLE_SECONDARY: RgbTuple = { r: 168, g: 85, b: 247 }; // #a855f7 radiant violet
const PALETTE_TREBLE_ACCENT: RgbTuple = { r: 253, g: 224, b: 71 };    // #fde047 solar gold

const RUNE_BASS_OUTER: RgbTuple = { r: 96, g: 165, b: 250 };          // #60a5fa cobalt rune glow
const RUNE_MID_OUTER: RgbTuple = { r: 45, g: 212, b: 191 };           // #2dd4bf teal rune glow
const RUNE_TREBLE_OUTER: RgbTuple = { r: 251, g: 191, b: 36 };        // #fbbf24 golden rune glow

const RUNE_BASS_INNER: RgbTuple = { r: 129, g: 140, b: 248 };         // #818cf8 indigo rune halo
const RUNE_MID_INNER: RgbTuple = { r: 56, g: 189, b: 248 };           // #38bdf8 electric cyan halo
const RUNE_TREBLE_INNER: RgbTuple = { r: 244, g: 114, b: 182 };       // #f472b6 rose-magenta halo

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function byteToHex(channel: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(channel)));
  return clamped.toString(16).padStart(2, '0');
}

function blendThreeRgbHex(
  bassCol: RgbTuple,
  midCol: RgbTuple,
  trebleCol: RgbTuple,
  wBass: number,
  wMid: number,
  wTreble: number
): string {
  const r = bassCol.r * wBass + midCol.r * wMid + trebleCol.r * wTreble;
  const g = bassCol.g * wBass + midCol.g * wMid + trebleCol.g * wTreble;
  const b = bassCol.b * wBass + midCol.b * wMid + trebleCol.b * wTreble;
  return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
}

/**
 * Pure, deterministic spectral-to-visual mapper that converts live microphone bands
 * into nebula core and floating rune ring intensity and color values.
 */
export function computeAudioVisualSync(
  bassRaw: number,
  midRaw: number,
  trebleRaw: number,
  rmsRaw: number,
  peakHoldRaw: number,
  out?: AudioVisualSyncParams
): AudioVisualSyncParams {
  const bass = clamp01(bassRaw);
  const mid = clamp01(midRaw);
  const treble = clamp01(trebleRaw);
  const rms = clamp01(rmsRaw);
  const peakHold = clamp01(peakHoldRaw);

  const weightedSum = bass * 1.1 + mid * 1.15 + treble * 1.35 + 0.0001;
  const hasSignal = bass + mid + treble > 0.025;
  const wBass = hasSignal ? (bass * 1.1) / weightedSum : 0.25;
  const wMid = hasSignal ? (mid * 1.15) / weightedSum : 0.45;
  const wTreble = hasSignal ? (treble * 1.35) / weightedSum : 0.3;

  const intensity = clamp01(rms * 0.58 + bass * 0.24 + treble * 0.22 + peakHold * 0.24);
  const swirlBoost = Math.min(1.35, rms * 0.72 + treble * 0.45 + peakHold * 0.25);
  const runeOpacityBoost = Math.min(0.42, intensity * 0.34 + treble * 0.12);
  const runeScaleBoost = Math.min(0.14, bass * 0.075 + peakHold * 0.065);

  const nebulaPrimaryHex = blendThreeRgbHex(
    PALETTE_BASS_PRIMARY,
    PALETTE_MID_PRIMARY,
    PALETTE_TREBLE_PRIMARY,
    wBass,
    wMid,
    wTreble
  );
  const nebulaSecondaryHex = blendThreeRgbHex(
    PALETTE_BASS_SECONDARY,
    PALETTE_MID_SECONDARY,
    PALETTE_TREBLE_SECONDARY,
    wBass,
    wMid,
    wTreble
  );
  const nebulaAccentHex = blendThreeRgbHex(
    PALETTE_BASS_ACCENT,
    PALETTE_MID_ACCENT,
    PALETTE_TREBLE_ACCENT,
    wBass,
    wMid,
    wTreble
  );
  const runeOuterHex = blendThreeRgbHex(
    RUNE_BASS_OUTER,
    RUNE_MID_OUTER,
    RUNE_TREBLE_OUTER,
    wBass,
    wMid,
    wTreble
  );
  const runeInnerHex = blendThreeRgbHex(
    RUNE_BASS_INNER,
    RUNE_MID_INNER,
    RUNE_TREBLE_INNER,
    wBass,
    wMid,
    wTreble
  );

  if (out) {
    out.intensity = intensity;
    out.swirlBoost = swirlBoost;
    out.nebulaPrimaryHex = nebulaPrimaryHex;
    out.nebulaSecondaryHex = nebulaSecondaryHex;
    out.nebulaAccentHex = nebulaAccentHex;
    out.runeOuterHex = runeOuterHex;
    out.runeInnerHex = runeInnerHex;
    out.runeOpacityBoost = runeOpacityBoost;
    out.runeScaleBoost = runeScaleBoost;
    return out;
  }

  return {
    intensity,
    swirlBoost,
    nebulaPrimaryHex,
    nebulaSecondaryHex,
    nebulaAccentHex,
    runeOuterHex,
    runeInnerHex,
    runeOpacityBoost,
    runeScaleBoost
  };
}

export interface UseMicAudioVisualizerResult {
  isActive: boolean;
  permissionError: string | null;
  start: () => Promise<boolean>;
  stop: () => void;
  toggle: () => Promise<boolean>;
  clearError: () => void;
  sampleMetrics: () => MicVisualizerMetrics;
}

const FFT_SIZE = 256;
const FREQ_BIN_COUNT = FFT_SIZE / 2;

export function useMicAudioVisualizer(): UseMicAudioVisualizerResult {
  const [isActive, setIsActive] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeRef = useRef<boolean>(false);

  // Pre-allocated audio buffers and metrics struct for zero-GC 60fps sampling
  const timeBufferRef = useRef<Float32Array<ArrayBuffer>>(
    new Float32Array(new ArrayBuffer(FFT_SIZE * 4))
  );
  const freqBufferRef = useRef<Uint8Array<ArrayBuffer>>(
    new Uint8Array(new ArrayBuffer(FREQ_BIN_COUNT))
  );
  const peakHoldRef = useRef<number>(0);

  const metricsRef = useRef<MicVisualizerMetrics>({
    active: false,
    rms: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    spectralCentroid: 0,
    peakHold: 0,
    intensity: 0,
    swirlBoost: 0,
    nebulaPrimaryHex: '#06b6d4',
    nebulaSecondaryHex: '#4338ca',
    nebulaAccentHex: '#fbbf24',
    runeOuterHex: '#fbbf24',
    runeInnerHex: '#38bdf8',
    runeOpacityBoost: 0,
    runeScaleBoost: 0
  });

  const stop = useCallback(() => {
    activeRef.current = false;
    peakHoldRef.current = 0;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }

    const m = metricsRef.current;
    m.active = false;
    m.rms = 0;
    m.bass = 0;
    m.mid = 0;
    m.treble = 0;
    m.spectralCentroid = 0;
    m.peakHold = 0;
    m.intensity = 0;
    m.swirlBoost = 0;
    m.runeOpacityBoost = 0;
    m.runeScaleBoost = 0;

    setIsActive(false);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (activeRef.current && analyserRef.current) {
      if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume().catch(() => {});
      }
      return true;
    }

    setPermissionError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermissionError('Live microphone audio capture is unavailable in this browser.');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioCtx) {
        stream.getTracks().forEach((t) => t.stop());
        setPermissionError('Web Audio API is unavailable in this browser.');
        return false;
      }

      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.78;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -18;

      // Connect strictly to AnalyserNode (NEVER to ctx.destination) to prevent acoustic feedback
      source.connect(analyser);

      streamRef.current = stream;
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      activeRef.current = true;
      metricsRef.current.active = true;
      setIsActive(true);
      return true;
    } catch {
      setPermissionError('Microphone permission denied or no audio input detected.');
      stop();
      return false;
    }
  }, [stop]);

  const toggle = useCallback(async (): Promise<boolean> => {
    if (activeRef.current) {
      stop();
      return false;
    }
    return start();
  }, [start, stop]);

  const clearError = useCallback(() => {
    setPermissionError(null);
  }, []);

  const sampleMetrics = useCallback((): MicVisualizerMetrics => {
    const m = metricsRef.current;
    const analyser = analyserRef.current;
    if (!activeRef.current || !analyser) {
      m.active = false;
      m.rms = 0;
      m.bass = 0;
      m.mid = 0;
      m.treble = 0;
      m.spectralCentroid = 0;
      m.peakHold = 0;
      m.intensity = 0;
      m.swirlBoost = 0;
      m.runeOpacityBoost = 0;
      m.runeScaleBoost = 0;
      return m;
    }

    const timeBuf = timeBufferRef.current;
    const freqBuf = freqBufferRef.current;
    analyser.getFloatTimeDomainData(timeBuf);
    analyser.getByteFrequencyData(freqBuf);

    let sqSum = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const sample = timeBuf[i];
      sqSum += sample * sample;
    }
    const rawRms = Math.sqrt(sqSum / timeBuf.length);
    const rms = clamp01(rawRms * 5.6);

    // 128 bins at ~48kHz -> ~187.5 Hz per bin:
    // Bass: bins 1..6 (~187Hz - 1.1kHz warm lows/fundamentals)
    // Mid:  bins 7..28 (~1.3kHz - 5.2kHz vocal formants & instruments)
    // Treble: bins 29..84 (~5.4kHz - 15.7kHz brilliance & harmonics)
    let bassAcc = 0;
    for (let i = 1; i <= 6; i++) bassAcc += freqBuf[i];
    const bass = clamp01((bassAcc / (6 * 255)) * 1.45);

    let midAcc = 0;
    for (let i = 7; i <= 28; i++) midAcc += freqBuf[i];
    const mid = clamp01((midAcc / (22 * 255)) * 1.55);

    let trebleAcc = 0;
    for (let i = 29; i <= 84; i++) trebleAcc += freqBuf[i];
    const treble = clamp01((trebleAcc / (56 * 255)) * 1.95);

    let centroidNum = 0;
    let centroidDen = 0;
    for (let i = 1; i < 85; i++) {
      const mag = freqBuf[i];
      centroidNum += i * mag;
      centroidDen += mag;
    }
    const spectralCentroid = centroidDen > 0 ? clamp01(centroidNum / (centroidDen * 84)) : 0;

    const instantPeak = Math.max(rms, bass * 0.9, mid * 0.85, treble * 0.95);
    peakHoldRef.current = Math.max(instantPeak, peakHoldRef.current * 0.92);

    m.active = true;
    m.rms = rms;
    m.bass = bass;
    m.mid = mid;
    m.treble = treble;
    m.spectralCentroid = spectralCentroid;
    m.peakHold = peakHoldRef.current;

    computeAudioVisualSync(bass, mid, treble, rms, peakHoldRef.current, m);
    return m;
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isActive,
    permissionError,
    start,
    stop,
    toggle,
    clearError,
    sampleMetrics
  };
}
