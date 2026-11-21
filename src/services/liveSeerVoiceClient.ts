/**
 * Bidirectional Live Seer Voice Client
 * Streams 16kHz mono PCM microphone audio over WebSocket (/api/ai/live -> gemini-3.8-live)
 * and schedules gapless 24kHz PCM neural vocal playback through the calibrated stereo ping-pong vocal delay bus.
 */

import { createVoiceHighPass250Hz16dB } from './audioDspEngine';

export type LiveVoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

export interface LiveSeerVoiceCallbacks {
  onStateChange?: (state: LiveVoiceConnectionState, errorMessage?: string | null) => void;
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string) => void;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return uint8ToBase64(new Uint8Array(int16.buffer));
}

function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (Math.abs(sourceRate - 16000) < 50) return input;
  const ratio = sourceRate / 16000;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = Math.min(input.length - 1, Math.floor(i * ratio));
    out[i] = input[idx];
  }
  return out;
}

class LiveSeerVoiceClient {
  private ws: WebSocket | null = null;
  private state: LiveVoiceConnectionState = 'idle';
  private callbacks: LiveSeerVoiceCallbacks = {};

  // Microphone capture (16kHz PCM)
  private micStream: MediaStream | null = null;
  private micCtx: AudioContext | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;

  // Calibrated 24kHz gapless playback + stereo ping-pong vocal delay bus
  private playCtx: AudioContext | null = null;
  private playAnalyser: AnalyserNode | null = null;
  private playEntryNode: AudioNode | null = null;
  private nextStartTime = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private analyserBuf: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(256 * 4));

  public getState(): LiveVoiceConnectionState {
    return this.state;
  }

  public isActive(): boolean {
    return this.state === 'connecting' || this.state === 'connected';
  }

  private setState(next: LiveVoiceConnectionState, errorMessage?: string | null) {
    this.state = next;
    this.callbacks.onStateChange?.(next, errorMessage ?? null);
  }

  private ensurePlaybackBus(): AudioContext | null {
    if (this.playCtx && this.playEntryNode) return this.playCtx;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx({ sampleRate: 24000 });
    this.playCtx = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    // 250 Hz 16 dB/oct 2-stage high-pass voice filter
    const voiceHp = createVoiceHighPass250Hz16dB(ctx);

    const presenceEq = ctx.createBiquadFilter();
    presenceEq.type = 'peaking';
    presenceEq.frequency.value = 2750;
    presenceEq.Q.value = 1.0;
    presenceEq.gain.value = 3.2;

    // Preserves calibrated voice level (matches CrystalBallExperience voiceBoost = 0.59)
    const voiceBoost = ctx.createGain();
    voiceBoost.gain.value = 0.59;

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
    fbL.gain.value = 0.28;
    fbR.gain.value = 0.26;

    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.26;

    const safetyLimiter = ctx.createDynamicsCompressor();
    safetyLimiter.threshold.value = -2.0;
    safetyLimiter.knee.value = 3;
    safetyLimiter.ratio.value = 14;
    safetyLimiter.attack.value = 0.002;
    safetyLimiter.release.value = 0.08;

    analyser.connect(voiceHp.input);
    voiceHp.output.connect(presenceEq);
    presenceEq.connect(voiceBoost);
    voiceBoost.connect(safetyLimiter);

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

    this.playAnalyser = analyser;
    this.playEntryNode = analyser;
    return ctx;
  }

  private flushPlaybackQueue() {
    this.activeSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already-stopped sources
      }
    });
    this.activeSources.clear();
    if (this.playCtx) {
      this.nextStartTime = this.playCtx.currentTime;
    }
  }

  private schedulePcm24kChunk(base64Pcm: string) {
    const ctx = this.ensurePlaybackBus();
    if (!ctx || !this.playEntryNode) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const bytes = base64ToUint8(base64Pcm);
    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (sampleCount <= 0) return;

    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount);
    const buffer = ctx.createBuffer(1, sampleCount, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      channelData[i] = int16[i] / 32768;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.playEntryNode);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.01, this.nextStartTime);
    this.nextStartTime = startAt + buffer.duration;

    this.activeSources.add(src);
    src.onended = () => {
      this.activeSources.delete(src);
    };
    src.start(startAt);
  }

  public async connect(
    telemetrySummary: string,
    weatherMood: string,
    callbacks: LiveSeerVoiceCallbacks
  ): Promise<boolean> {
    this.disconnect();
    this.callbacks = callbacks;
    this.setState('connecting', null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.setState('error', 'Microphone capture is unavailable in this browser.');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      this.micStream = stream;
    } catch {
      this.setState('error', 'Microphone permission is required for Live Voice.');
      return false;
    }

    const playCtx = this.ensurePlaybackBus();
    if (playCtx && playCtx.state === 'suspended') {
      await playCtx.resume().catch(() => {});
    }
    this.nextStartTime = playCtx ? playCtx.currentTime : 0;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/ai/live`;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'init',
            telemetrySummary,
            weatherMood
          })
        );
      };

      ws.onmessage = (event) => {
        let msg: any;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (msg.type === 'ready') {
          this.startMicStreaming();
          this.setState('connected', null);
          if (!settled) {
            settled = true;
            resolve(true);
          }
        } else if (msg.type === 'audio' && typeof msg.data === 'string') {
          this.schedulePcm24kChunk(msg.data);
        } else if (msg.type === 'inputTranscript' && typeof msg.text === 'string') {
          this.callbacks.onInputTranscript?.(msg.text);
        } else if (msg.type === 'outputTranscript' && typeof msg.text === 'string') {
          this.callbacks.onOutputTranscript?.(msg.text);
        } else if (msg.type === 'interrupted') {
          this.flushPlaybackQueue();
        } else if (msg.type === 'error') {
          const errMsg = String(msg.message || 'Live Voice session error.');
          this.disconnect();
          this.setState('error', errMsg);
          if (!settled) {
            settled = true;
            resolve(false);
          }
        } else if (msg.type === 'closed') {
          this.disconnect();
        }
      };

      ws.onerror = () => {
        const errMsg = 'Unable to connect to Live Seer Voice WebSocket.';
        this.disconnect();
        this.setState('error', errMsg);
        if (!settled) {
          settled = true;
          resolve(false);
        }
      };

      ws.onclose = () => {
        if (this.state === 'connected' || this.state === 'connecting') {
          this.disconnect();
        }
      };
    });
  }

  private startMicStreaming() {
    if (!this.micStream) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const micCtx = new AudioCtx({ sampleRate: 16000 });
    this.micCtx = micCtx;
    const src = micCtx.createMediaStreamSource(this.micStream);
    this.micSource = src;

    const processor = micCtx.createScriptProcessor(2048, 1, 1);
    this.micProcessor = processor;

    processor.onaudioprocess = (ev) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = ev.inputBuffer.getChannelData(0);
      const pcm16k = downsampleTo16k(input, micCtx.sampleRate || 16000);
      const b64 = float32ToPcm16Base64(pcm16k);
      this.ws.send(JSON.stringify({ type: 'audio', data: b64 }));
    };

    const silentGain = micCtx.createGain();
    silentGain.gain.value = 0;

    src.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(micCtx.destination);
  }

  public sendTelemetryUpdate(telemetrySummary: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'telemetry_update', telemetrySummary }));
    }
  }

  public getLiveVoiceEnergy(): number {
    if (!this.playAnalyser || this.activeSources.size === 0) return 0;
    this.playAnalyser.getFloatTimeDomainData(this.analyserBuf);
    let sq = 0;
    for (let i = 0; i < this.analyserBuf.length; i++) {
      sq += this.analyserBuf[i] * this.analyserBuf[i];
    }
    return Math.min(1, Math.sqrt(sq / this.analyserBuf.length) * 5.2);
  }

  public disconnect() {
    this.flushPlaybackQueue();

    if (this.micProcessor) {
      this.micProcessor.onaudioprocess = null;
      try {
        this.micProcessor.disconnect();
      } catch {
        // ignore
      }
      this.micProcessor = null;
    }
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {
        // ignore
      }
      this.micSource = null;
    }
    if (this.micCtx) {
      this.micCtx.close().catch(() => {});
      this.micCtx = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      try {
        if (oldWs.readyState === WebSocket.OPEN || oldWs.readyState === WebSocket.CONNECTING) {
          oldWs.close();
        }
      } catch {
        // ignore
      }
    }
    if (this.state !== 'idle') {
      this.setState('idle', null);
    }
  }
}

export const liveSeerVoiceClient = new LiveSeerVoiceClient();
