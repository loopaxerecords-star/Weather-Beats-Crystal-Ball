import * as THREE from 'three';
const seerPortraitUrl = new URL(
  '../assets/images/pretty_fortune_teller_portrait_1795261463033.jpg',
  import.meta.url
).href;

export const PARLOR_TABLE_Y = -1.15;
export const CRYSTAL_BALL_SCALE = 0.52;
export const CRYSTAL_BALL_POS_X = 0;
export const CRYSTAL_BALL_POS_Y = PARLOR_TABLE_Y + 1.77 * CRYSTAL_BALL_SCALE - 0.005;
export const CRYSTAL_BALL_POS_Z = 0.68;

export interface StagedAnimationWeights {
  /** Stage 1 (0.0s - 1.8s): Crystal ball core & inner nebula */
  core: number;
  /** Stage 2 (2.0s - 3.8s): Seer gentle breath, gaze tracking & inner hood stars */
  seerBreathGaze: number;
  /** Stage 3 (4.0s - 5.8s): Hovering hands cradling orb, candle warmth sway & incense wisps */
  handsCandlesIncense: number;
  /** Stage 4 (6.0s - 7.8s): Brass astrolabe halo, gimbal rings & equatorial runes */
  astrolabeRings: number;
  /** Stage 5 (8.0s - 9.8s): 24-domain orbital gems, constellation & celestial telemetry arch */
  constellationBackdrop: number;
}

function smoothstep01(edge0: number, edge1: number, x: number): number {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const u = (x - edge0) / (edge1 - edge0);
  return u * u * (3 - 2 * u);
}

/**
 * Pure deterministic 5-stage choreographer: all animation weights are strictly 0 before Play
 * is engaged, then awaken cleanly one by one at 2-second intervals after Play starts.
 */
export function computeStagedAnimationWeights(
  playElapsedSec: number,
  out?: StagedAnimationWeights
): StagedAnimationWeights {
  const t = Number.isFinite(playElapsedSec) ? Math.max(0, playElapsedSec) : 0;
  const core = smoothstep01(0.0, 1.8, t);
  const seerBreathGaze = smoothstep01(2.0, 3.8, t);
  const handsCandlesIncense = smoothstep01(4.0, 5.8, t);
  const astrolabeRings = smoothstep01(6.0, 7.8, t);
  const constellationBackdrop = smoothstep01(8.0, 9.8, t);

  if (out) {
    out.core = core;
    out.seerBreathGaze = seerBreathGaze;
    out.handsCandlesIncense = handsCandlesIncense;
    out.astrolabeRings = astrolabeRings;
    out.constellationBackdrop = constellationBackdrop;
    return out;
  }
  return {
    core,
    seerBreathGaze,
    handsCandlesIncense,
    astrolabeRings,
    constellationBackdrop
  };
}

/**
 * Physiological asymmetric human blink waveform for normalized progress p in [0, 1].
 * - 0.00..0.30: fast ballistic upper-lid descent (~75-90 ms)
 * - 0.30..0.40: brief natural full-contact pause (~25-30 ms)
 * - 0.40..1.00: cushioned, slower levator palpebrae reopening (~160-195 ms)
 */
export function evaluateBlinkEnvelope(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) return 0;
  if (progress < 0.3) {
    const u = progress / 0.3;
    // Slight ballistic acceleration into smooth landing at lid contact
    const curved = Math.pow(u, 1.15);
    return curved * curved * (3 - 2 * curved);
  }
  if (progress <= 0.4) {
    return 1;
  }
  const u = (progress - 0.4) / 0.6;
  // Brisk release off contact, silky cushioned deceleration back to resting open gaze
  const rem = 1 - u;
  const eased = Math.pow(rem, 1.85);
  const smooth = rem * rem * (3 - 2 * rem);
  return Math.max(0, Math.min(1, eased * 0.65 + smooth * 0.35));
}

export interface SeerBlinkSample {
  left: number;
  right: number;
}

/**
 * Organic human blink state machine with stochastic inter-blink intervals (2.6s - 5.8s),
 * occasional natural double-blinks (~14%), calm contemplative slow blinks (~18%),
 * and subtle 7ms binocular micro-asymmetry. Zero per-frame heap allocations.
 */
export class SeerBlinkController {
  private rngState: number;
  private waitRemainingSec: number;
  private blinkElapsedSec = 0;
  private blinkDurationSec = 0.285;
  private blinkPeak = 1.0;
  private isBlinking = false;
  private pendingDoubleBlink = false;
  private eyeLagSign = 1;

  constructor(seed = 0x5e37b1a9) {
    this.rngState = seed >>> 0;
    // First natural blink arrives gently ~1.8s after load so she feels quietly alive right away
    this.waitRemainingSec = 1.8;
  }

  private nextRand(): number {
    // Park-Miller / LCG deterministic PRNG (zero allocations, smooth natural variety)
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  private startBlink(isSecondaryDouble: boolean, reducedMotion: boolean) {
    this.isBlinking = true;
    this.blinkElapsedSec = 0;
    this.eyeLagSign = this.nextRand() > 0.5 ? 1 : -1;

    if (reducedMotion) {
      this.blinkDurationSec = 0.44;
      this.blinkPeak = 1.0;
      this.pendingDoubleBlink = false;
      return;
    }

    if (isSecondaryDouble) {
      this.blinkDurationSec = 0.25 + this.nextRand() * 0.05;
      this.blinkPeak = 0.93 + this.nextRand() * 0.07;
      this.pendingDoubleBlink = false;
      return;
    }

    const roll = this.nextRand();
    if (roll < 0.18) {
      // Calm contemplative slow blink (0.36s - 0.44s)
      this.blinkDurationSec = 0.36 + this.nextRand() * 0.08;
      this.blinkPeak = 1.0;
      this.pendingDoubleBlink = false;
    } else if (roll < 0.32) {
      // Natural double blink: crisp primary followed by quick second blink
      this.blinkDurationSec = 0.245 + this.nextRand() * 0.035;
      this.blinkPeak = 1.0;
      this.pendingDoubleBlink = true;
    } else {
      // Everyday spontaneous blink (0.26s - 0.32s)
      this.blinkDurationSec = 0.26 + this.nextRand() * 0.06;
      this.blinkPeak = 0.98 + this.nextRand() * 0.02;
      this.pendingDoubleBlink = false;
    }
  }

  public step(
    deltaSec: number,
    speakingEnergy: number,
    reducedMotion: boolean,
    out: SeerBlinkSample
  ): SeerBlinkSample {
    const dt = Number.isFinite(deltaSec) ? Math.max(0, Math.min(0.1, deltaSec)) : 0;

    if (!this.isBlinking) {
      this.waitRemainingSec -= dt;
      if (this.waitRemainingSec <= 0) {
        this.startBlink(this.pendingDoubleBlink, reducedMotion);
      }
    }

    if (this.isBlinking) {
      this.blinkElapsedSec += dt;
      const lagSec = reducedMotion ? 0 : 0.007 * this.eyeLagSign;
      const pLeft = (this.blinkElapsedSec + Math.max(0, lagSec)) / this.blinkDurationSec;
      const pRight = (this.blinkElapsedSec + Math.max(0, -lagSec)) / this.blinkDurationSec;

      out.left = evaluateBlinkEnvelope(pLeft) * this.blinkPeak;
      out.right = evaluateBlinkEnvelope(pRight) * this.blinkPeak;

      if (this.blinkElapsedSec >= this.blinkDurationSec + Math.abs(lagSec)) {
        this.isBlinking = false;
        out.left = 0;
        out.right = 0;

        if (this.pendingDoubleBlink) {
          // Short natural pause between double-blink strokes (180ms - 260ms)
          this.waitRemainingSec = 0.18 + this.nextRand() * 0.08;
        } else if (reducedMotion) {
          this.waitRemainingSec = 6.2 + this.nextRand() * 2.5;
        } else {
          // Bell-shaped inter-blink interval (~2.6s to ~5.8s, slightly livelier while speaking)
          const r1 = this.nextRand();
          const r2 = this.nextRand();
          const speakFactor = 1 - Math.min(0.22, Math.max(0, speakingEnergy) * 0.22);
          this.waitRemainingSec = (2.6 + r1 * 1.9 + r2 * 1.3) * speakFactor;
        }
      }
      return out;
    }

    out.left = 0;
    out.right = 0;
    return out;
  }
}

export interface SeerAnimationSignals {
  energy: number;
  bassEnergy: number;
  micEnergy: number;
  speakingEnergy: number;
  beatImpulse: number;
  pointerNdcX: number;
  pointerNdcY: number;
  orbColor: THREE.Color;
  accentColor: THREE.Color;
  reducedMotion: boolean;
  swirlSpeed?: number;
  stageWeights?: StagedAnimationWeights;
}

export interface SeerAnimationPose {
  breathOffset: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  leftHandX: number;
  leftHandY: number;
  leftHandZ: number;
  rightHandX: number;
  rightHandY: number;
  rightHandZ: number;
  speakingGlowIntensity: number;
  eyeEmissiveIntensity: number;
  candleFlickerA: number;
  candleFlickerB: number;
}

/**
 * Pure deterministic pose calculator for the Hooded Celestial Seer & flickering candles.
 * Separates kinematic math from WebGL scene state so it is unit-testable and zero-GC friendly.
 */
export function computeSeerAnimationPose(
  elapsed: number,
  energy: number,
  speakingEnergy: number,
  micEnergy: number,
  pointerNdcX: number,
  pointerNdcY: number,
  out?: SeerAnimationPose
): SeerAnimationPose {
  const safeEnergy = Math.max(0, Math.min(1, Number.isFinite(energy) ? energy : 0));
  const safeSpeak = Math.max(0, Math.min(1, Number.isFinite(speakingEnergy) ? speakingEnergy : 0));
  const safeMic = Math.max(0, Math.min(1, Number.isFinite(micEnergy) ? micEnergy : 0));
  const px = Math.max(-1, Math.min(1, Number.isFinite(pointerNdcX) ? pointerNdcX : 0));
  const py = Math.max(-1, Math.min(1, Number.isFinite(pointerNdcY) ? pointerNdcY : 0));

  const channelDrive = Math.min(1, safeSpeak * 1.1 + safeMic * 0.9 + safeEnergy * 0.35);
  const breathOffset = Math.sin(elapsed * 1.35) * 0.018;

  // Gentle gaze tracking + subtle listening/speaking nod
  const headYaw = Math.max(-0.32, Math.min(0.32, px * 0.24 + Math.sin(elapsed * 0.42) * 0.04));
  const headPitch = Math.max(
    -0.22,
    Math.min(
      0.28,
      0.1 - py * 0.14 + Math.sin(elapsed * 0.85) * 0.025 + Math.sin(elapsed * 5.2) * safeSpeak * 0.045
    )
  );
  const headRoll = Math.sin(elapsed * 0.55) * 0.035 + px * -0.04;

  // Hovering expressive hands cradling the smaller (0.52x) crystal ball cleanly
  const hoverLift = 0.036 * Math.sin(elapsed * 1.45) + channelDrive * 0.07;
  const pullCloser = channelDrive * 0.075;
  const leftHandX = -0.7 + pullCloser + Math.cos(elapsed * 1.05) * 0.035;
  const leftHandY = -0.14 + hoverLift + Math.sin(elapsed * 1.65) * 0.028;
  const leftHandZ = 0.55 + Math.sin(elapsed * 0.85) * 0.042 + channelDrive * 0.03;

  const rightHandX = 0.7 - pullCloser - Math.cos(elapsed * 1.05 + 0.7) * 0.035;
  const rightHandY = -0.14 + hoverLift + Math.sin(elapsed * 1.65 + 1.1) * 0.028;
  const rightHandZ = 0.55 + Math.cos(elapsed * 0.85) * 0.042 + channelDrive * 0.03;

  // Calm, restrained luminosity values (no harsh neon flashing or spikes)
  const speakingGlowIntensity = 0.24 + safeEnergy * 0.14 + safeSpeak * 0.34 + safeMic * 0.22;
  const eyeEmissiveIntensity = 0.22 + safeEnergy * 0.08 + safeSpeak * 0.24 + safeMic * 0.16;

  // Gentle organic candle warmth (no rapid strobe flicker)
  const candleFlickerA =
    0.94 +
    Math.sin(elapsed * 3.1) * 0.028 +
    Math.cos(elapsed * 5.7 + 1.1) * 0.016;
  const candleFlickerB =
    0.94 +
    Math.cos(elapsed * 3.4 + 0.8) * 0.028 +
    Math.sin(elapsed * 5.2 + 2.3) * 0.016;

  if (out) {
    out.breathOffset = breathOffset;
    out.headYaw = headYaw;
    out.headPitch = headPitch;
    out.headRoll = headRoll;
    out.leftHandX = leftHandX;
    out.leftHandY = leftHandY;
    out.leftHandZ = leftHandZ;
    out.rightHandX = rightHandX;
    out.rightHandY = rightHandY;
    out.rightHandZ = rightHandZ;
    out.speakingGlowIntensity = speakingGlowIntensity;
    out.eyeEmissiveIntensity = eyeEmissiveIntensity;
    out.candleFlickerA = candleFlickerA;
    out.candleFlickerB = candleFlickerB;
    return out;
  }

  return {
    breathOffset,
    headYaw,
    headPitch,
    headRoll,
    leftHandX,
    leftHandY,
    leftHandZ,
    rightHandX,
    rightHandY,
    rightHandZ,
    speakingGlowIntensity,
    eyeEmissiveIntensity,
    candleFlickerA,
    candleFlickerB
  };
}

// ---------------------------------------------------------------------------
// Custom GLSL Starry Nebula Cloak Lining Shader & Procedural Canvas Textures
// ---------------------------------------------------------------------------

const NEBULA_LINING_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NEBULA_LINING_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uEnergy;
  uniform float uSpeak;
  uniform vec3 uColorPrimary;
  uniform vec3 uColorAccent;
  varying vec2 vUv;
  varying vec3 vNormal;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec2 uv = vUv * 4.5;
    float t = uTime * 0.2;
    float n1 = vnoise(uv + vec2(t, -t * 0.6));
    float n2 = vnoise(uv * 2.1 - vec2(t * 1.1, t * 0.8) + n1 * 1.6);
    float nebula = smoothstep(0.32, 0.88, n1 * 0.55 + n2 * 0.45);

    vec2 starGrid = floor(vUv * 42.0);
    vec2 starLocal = fract(vUv * 42.0) - 0.5;
    float starSeed = hash21(starGrid);
    float starMask = step(0.935, starSeed);
    float twinkle = 0.55 + 0.45 * sin(uTime * 2.4 + starSeed * 62.0);
    float starDot = smoothstep(0.22, 0.03, length(starLocal)) * starMask * twinkle;

    vec3 deepVoid = vec3(0.026, 0.02, 0.055);
    vec3 col = mix(deepVoid, uColorPrimary * 0.16, nebula * (0.28 + uEnergy * 0.14));
    col += uColorAccent * (nebula * nebula * (0.07 + uSpeak * 0.1));
    col += vec3(0.92, 0.87, 0.76) * starDot * (0.36 + uSpeak * 0.14);

    gl_FragColor = vec4(col, 0.96);
  }
`;

function createIncenseSmokeTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const blobs = [
      { x: 64, y: 64, r: 54, a: 0.32 },
      { x: 52, y: 58, r: 38, a: 0.22 },
      { x: 78, y: 68, r: 36, a: 0.2 },
      { x: 62, y: 46, r: 30, a: 0.16 }
    ];
    for (const b of blobs) {
      const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r);
      g.addColorStop(0, `rgba(226, 232, 240, ${b.a})`);
      g.addColorStop(0.55, `rgba(203, 213, 225, ${b.a * 0.4})`);
      g.addColorStop(1, 'rgba(203, 213, 225, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createVelvetTableclothTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;

    // Deep midnight indigo-plum velvet base
    const grad = ctx.createRadialGradient(cx, cy, 40, cx, cy, 512);
    grad.addColorStop(0, '#2a1847');
    grad.addColorStop(0.45, '#1d1133');
    grad.addColorStop(0.82, '#130b24');
    grad.addColorStop(1, '#0b0616');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Subtle velvet weave micro-grain
    for (let i = 0; i < 4200; i++) {
      const x = ((i * 73) % size);
      const y = ((i * 197 + Math.floor(i / 40) * 13) % size);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(139, 92, 246, 0.045)' : 'rgba(10, 6, 20, 0.14)';
      ctx.fillRect(x, y, 2, 2);
    }

    // Gold embroidered celestial borders
    const rings = [148, 224, 382, 432, 464];
    rings.forEach((r, idx) => {
      ctx.strokeStyle =
        idx === 3 ? 'rgba(251, 191, 36, 0.68)' : idx === 0 ? 'rgba(245, 158, 11, 0.5)' : 'rgba(217, 119, 6, 0.34)';
      ctx.lineWidth = idx === 3 ? 4 : 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Embroidered 12-house astrological rays & miniature stars along border
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(251, 191, 36, 0.35)' : 'rgba(167, 139, 250, 0.18)';
      ctx.lineWidth = i % 6 === 0 ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 148, cy + Math.sin(a) * 148);
      ctx.lineTo(cx + Math.cos(a) * 432, cy + Math.sin(a) * 432);
      ctx.stroke();

      // Tiny gold star motif in outer embroidered border
      const sx = cx + Math.cos(a + Math.PI / 24) * 408;
      const sy = cy + Math.sin(a + Math.PI / 24) * 408;
      ctx.fillStyle = 'rgba(253, 224, 71, 0.65)';
      ctx.beginPath();
      ctx.arc(sx, sy, i % 2 === 0 ? 4.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Center sacred hexagram embroidery under the crystal ball plinth
    for (let rot = 0; rot < 2; rot++) {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.36)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let v = 0; v <= 3; v++) {
        const a = (v / 3) * Math.PI * 2 + (rot * Math.PI) / 3;
        const x = cx + Math.cos(a) * 224;
        const y = cy + Math.sin(a) * 224;
        if (v === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createCelestialShawlTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#271447');
    grad.addColorStop(0.5, '#1b1138');
    grad.addColorStop(1, '#120b26');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Subtle woven gold thread lattice
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.22)';
    ctx.lineWidth = 1.4;
    for (let i = -size; i < size * 2; i += 36) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + size, size);
      ctx.stroke();
    }

    // Gold embroidered border stripe along hem
    ctx.fillStyle = 'rgba(217, 119, 6, 0.62)';
    ctx.fillRect(0, size - 44, size, 8);
    ctx.fillRect(0, size - 22, size, 4);

    // Embroidered moons and stars across shawl
    ctx.fillStyle = 'rgba(253, 224, 71, 0.72)';
    for (let i = 0; i < 42; i++) {
      const x = (i * 89 + 29) % size;
      const y = (i * 61 + 17) % (size - 56);
      const r = i % 5 === 0 ? 4.5 : 2.2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (i % 7 === 0) {
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - 10, y);
        ctx.lineTo(x + 10, y);
        ctx.moveTo(x, y - 10);
        ctx.lineTo(x, y + 10);
        ctx.stroke();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function createTarotCardTexture(
  title: string,
  roman: string,
  motif: 'star' | 'moon' | 'sun' | 'wheel' | 'priestess' | 'back',
  accentHex: string
): THREE.CanvasTexture {
  const w = 256;
  const h = 420;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Ivory parchment or midnight-indigo back
    const isBack = motif === 'back';
    ctx.fillStyle = isBack ? '#160e2c' : '#1b1629';
    ctx.fillRect(0, 0, w, h);

    // Ornate double gold frame
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 7;
    ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.65)';
    ctx.lineWidth = 2;
    ctx.strokeRect(24, 24, w - 48, h - 48);

    const cx = w / 2;
    const cy = h / 2 - (isBack ? 0 : 12);

    if (isBack) {
      // Symmetrical gilded tarot back
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.72)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 62, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * 86, cy + Math.sin(a) * 86);
        ctx.stroke();
      }
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Inner illuminated arch
      const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 125);
      grad.addColorStop(0, accentHex);
      grad.addColorStop(0.55, '#1e1638');
      grad.addColorStop(1, '#120d22');
      ctx.fillStyle = grad;
      ctx.fillRect(32, 54, w - 64, h - 134);

      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      if (motif === 'star' || motif === 'sun') {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const r = i % 2 === 0 ? 64 : 38;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          ctx.stroke();
        }
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, Math.PI * 2);
        ctx.fill();
      } else if (motif === 'moon') {
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.arc(cx, cy, 44, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1b1533';
        ctx.beginPath();
        ctx.arc(cx + 18, cy - 8, 38, 0, Math.PI * 2);
        ctx.fill();
      } else if (motif === 'wheel') {
        ctx.beginPath();
        ctx.arc(cx, cy, 56, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * 56, cy + Math.sin(a) * 56);
          ctx.stroke();
        }
      } else {
        // High Priestess twin pillars + crescent crown
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(cx - 56, cy - 48, 18, 108);
        ctx.fillStyle = '#334155';
        ctx.fillRect(cx + 38, cy - 48, 18, 108);
        ctx.strokeStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(cx, cy - 18, 22, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Roman numeral header & card title footer
      ctx.fillStyle = '#fef3c7';
      ctx.font = '700 22px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(roman, cx, 46);
      ctx.font = '700 18px Georgia, serif';
      ctx.fillText(title, cx, h - 38);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface FortuneTellerParlorRig {
  group: THREE.Group;
  update: (elapsed: number, delta: number, signals: SeerAnimationSignals) => void;
  dispose: () => void;
}

// Reusable zero-GC pose & color objects
const _pose: SeerAnimationPose = {
  breathOffset: 0,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  leftHandX: -0.7,
  leftHandY: -0.14,
  leftHandZ: 0.55,
  rightHandX: 0.7,
  rightHandY: -0.14,
  rightHandZ: 0.55,
  speakingGlowIntensity: 0.3,
  eyeEmissiveIntensity: 0.25,
  candleFlickerA: 0.94,
  candleFlickerB: 0.94
};
const _eyeTargetColor = new THREE.Color();

export function buildFortuneTellerParlorRig(options: {
  maxAnisotropy: number;
  isSoftwareGl: boolean;
  brassMat: THREE.Material;
  goldMat: THREE.Material;
  glowSpriteTex: THREE.Texture;
}): FortuneTellerParlorRig {
  const { maxAnisotropy, isSoftwareGl, brassMat, goldMat, glowSpriteTex } = options;

  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  // =========================================================================
  // 1. VELVET-DRAPED PARLOR TABLE (Top Surface Flush at y = PARLOR_TABLE_Y)
  // =========================================================================
  const velvetTex = trackTex(createVelvetTableclothTexture());
  velvetTex.anisotropy = maxAnisotropy;

  const shawlTex = trackTex(createCelestialShawlTexture());
  shawlTex.anisotropy = maxAnisotropy;

  const velvetTableMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      map: velvetTex,
      roughness: 0.9,
      metalness: 0.06,
      sheen: 0.85,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color('#8b5cf6')
    })
  );

  const velvetSkirtMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: '#1b1031',
      roughness: 0.92,
      metalness: 0.04,
      sheen: 0.8,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color('#7c3aed')
    })
  );

  const tableTopGeo = trackGeo(new THREE.CircleGeometry(2.65, 72));
  const tableTop = new THREE.Mesh(tableTopGeo, velvetTableMat);
  tableTop.rotation.x = -Math.PI / 2;
  tableTop.position.y = PARLOR_TABLE_Y;
  tableTop.receiveShadow = true;
  group.add(tableTop);

  // Draped pleated velvet skirt overhanging the circular wooden tabletop
  const skirtPoints = [
    new THREE.Vector2(2.65, PARLOR_TABLE_Y),
    new THREE.Vector2(2.74, PARLOR_TABLE_Y - 0.08),
    new THREE.Vector2(2.8, PARLOR_TABLE_Y - 0.45),
    new THREE.Vector2(2.94, PARLOR_TABLE_Y - 1.25),
    new THREE.Vector2(3.08, PARLOR_TABLE_Y - 2.05)
  ];
  const skirtGeo = trackGeo(new THREE.LatheGeometry(skirtPoints, 72));
  // Add gentle organic fabric drape folds along the hanging tablecloth
  const skirtPos = skirtGeo.attributes.position;
  for (let i = 0; i < skirtPos.count; i++) {
    const x = skirtPos.getX(i);
    const y = skirtPos.getY(i);
    const z = skirtPos.getZ(i);
    const dropFactor = Math.max(0, (PARLOR_TABLE_Y - y) / 2.05);
    const ang = Math.atan2(z, x);
    const fold = Math.sin(ang * 14) * 0.055 * dropFactor + Math.cos(ang * 7) * 0.03 * dropFactor;
    const r = Math.hypot(x, z);
    if (r > 0.01) {
      const scale = (r + fold) / r;
      skirtPos.setX(i, x * scale);
      skirtPos.setZ(i, z * scale);
    }
  }
  skirtGeo.computeVertexNormals();
  const tableSkirt = new THREE.Mesh(skirtGeo, velvetSkirtMat);
  tableSkirt.receiveShadow = true;
  group.add(tableSkirt);

  // Braided gold trim cord circling the rim of the velvet table
  const tableRimGeo = trackGeo(new THREE.TorusGeometry(2.66, 0.028, 14, 96));
  const tableRim = new THREE.Mesh(tableRimGeo, goldMat);
  tableRim.rotation.x = Math.PI / 2;
  tableRim.position.y = PARLOR_TABLE_Y - 0.012;
  group.add(tableRim);

  // Soft dark parlor floor beneath table so lower orbit angles stay grounded
  const parlorFloorGeo = trackGeo(new THREE.CircleGeometry(9.0, 48));
  const parlorFloorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#070912',
      roughness: 0.94,
      metalness: 0.08
    })
  );
  const parlorFloor = new THREE.Mesh(parlorFloorGeo, parlorFloorMat);
  parlorFloor.rotation.x = -Math.PI / 2;
  parlorFloor.position.y = PARLOR_TABLE_Y - 2.05;
  group.add(parlorFloor);

  // =========================================================================
  // 2. TURNED BRASS CANDLESTICKS, BEESWAX PILLARS & ANIMATED FLAMES
  // =========================================================================
  const waxMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#f5ebd6',
      emissive: '#92400e',
      emissiveIntensity: 0.2,
      roughness: 0.52,
      metalness: 0.02
    })
  );

  const wickMat = trackMat(
    new THREE.MeshStandardMaterial({ color: '#1f1916', roughness: 0.95 })
  );

  const flameCoreMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#fef9c3',
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );

  const flameOuterMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#fb923c',
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );

  const candleHaloMat = trackMat(
    new THREE.SpriteMaterial({
      map: glowSpriteTex,
      color: '#f59e0b',
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );

  const holderPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.24, 0.0),
    new THREE.Vector2(0.22, 0.045),
    new THREE.Vector2(0.11, 0.08),
    new THREE.Vector2(0.055, 0.14),
    new THREE.Vector2(0.085, 0.24),
    new THREE.Vector2(0.048, 0.34),
    new THREE.Vector2(0.06, 0.44),
    new THREE.Vector2(0.15, 0.48),
    new THREE.Vector2(0.13, 0.52),
    new THREE.Vector2(0.09, 0.5)
  ];
  const holderGeo = trackGeo(new THREE.LatheGeometry(holderPoints, 28));
  const flameGeo = trackGeo(new THREE.ConeGeometry(0.036, 0.14, 12));
  const flameOuterGeo = trackGeo(new THREE.ConeGeometry(0.056, 0.19, 12));
  const wickGeo = trackGeo(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 6));

  interface CandleHandle {
    flameGroup: THREE.Group;
    halo: THREE.Sprite;
    baseY: number;
    phase: number;
  }
  const candleHandles: CandleHandle[] = [];

  const candleSpecs = [
    { x: -1.62, z: 0.34, scale: 1.0, waxH: 0.42, phase: 0.0 },
    { x: 1.56, z: 0.44, scale: 0.94, waxH: 0.36, phase: 1.9 },
    { x: -1.26, z: -0.22, scale: 0.78, waxH: 0.5, phase: 3.4 }
  ];

  candleSpecs.forEach((spec) => {
    const cGroup = new THREE.Group();
    cGroup.position.set(spec.x, PARLOR_TABLE_Y, spec.z);
    cGroup.scale.setScalar(spec.scale);

    const holder = new THREE.Mesh(holderGeo, brassMat);
    holder.castShadow = !isSoftwareGl;
    holder.receiveShadow = true;
    cGroup.add(holder);

    const waxGeo = trackGeo(new THREE.CylinderGeometry(0.072, 0.078, spec.waxH, 20));
    const wax = new THREE.Mesh(waxGeo, waxMat);
    wax.position.y = 0.5 + spec.waxH * 0.5;
    wax.castShadow = !isSoftwareGl;
    cGroup.add(wax);

    const topY = 0.5 + spec.waxH;
    const wick = new THREE.Mesh(wickGeo, wickMat);
    wick.position.y = topY + 0.015;
    cGroup.add(wick);

    const flameGroup = new THREE.Group();
    flameGroup.position.y = topY + 0.075;
    const core = new THREE.Mesh(flameGeo, flameCoreMat);
    const outer = new THREE.Mesh(flameOuterGeo, flameOuterMat);
    outer.position.y = 0.015;
    flameGroup.add(core);
    flameGroup.add(outer);
    cGroup.add(flameGroup);

    const halo = new THREE.Sprite(candleHaloMat);
    halo.position.y = topY + 0.095;
    halo.scale.set(0.58, 0.58, 1);
    cGroup.add(halo);

    group.add(cGroup);
    candleHandles.push({ flameGroup, halo, baseY: topY + 0.075, phase: spec.phase });
  });

  // Two warm flickering candlelight point lights illuminating hands, shawl, and tarot cards
  const candleLightLeft = new THREE.PointLight('#fb923c', 2.4, 7.5, 1.8);
  candleLightLeft.position.set(-1.55, PARLOR_TABLE_Y + 1.12, 0.32);
  group.add(candleLightLeft);

  const candleLightRight = new THREE.PointLight('#f59e0b', 2.1, 7.2, 1.8);
  candleLightRight.position.set(1.52, PARLOR_TABLE_Y + 1.02, 0.44);
  group.add(candleLightRight);

  // =========================================================================
  // 3. FANNED GILDED TAROT CARD SPREAD ON THE VELVET TABLE
  // =========================================================================
  const cardGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.008, 0.52));
  const cardEdgeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#d97706',
      metalness: 0.82,
      roughness: 0.28
    })
  );
  const cardBackTex = trackTex(createTarotCardTexture('', '', 'back', '#fbbf24'));
  cardBackTex.anisotropy = maxAnisotropy;
  const cardBackMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: cardBackTex,
      roughness: 0.42,
      metalness: 0.22
    })
  );

  const tarotSpecs: Array<{
    title: string;
    roman: string;
    motif: 'star' | 'moon' | 'sun' | 'wheel' | 'priestess' | 'back';
    accent: string;
    x: number;
    z: number;
    rotY: number;
    layer: number;
    faceDown?: boolean;
  }> = [
    { title: 'THE STAR', roman: 'XVII', motif: 'star', accent: '#38bdf8', x: -1.16, z: 1.18, rotY: 0.42, layer: 0 },
    { title: 'THE MOON', roman: 'XVIII', motif: 'moon', accent: '#818cf8', x: -0.94, z: 1.38, rotY: 0.22, layer: 1 },
    { title: 'THE SUN', roman: 'XIX', motif: 'sun', accent: '#f59e0b', x: -0.68, z: 1.52, rotY: 0.04, layer: 2 },
    { title: 'WHEEL', roman: 'X', motif: 'wheel', accent: '#a855f7', x: 0.86, z: 1.44, rotY: -0.26, layer: 0 },
    { title: 'PRIESTESS', roman: 'II', motif: 'priestess', accent: '#2dd4bf', x: 1.14, z: 1.24, rotY: -0.48, layer: 1 },
    { title: 'BACK', roman: '', motif: 'back', accent: '#fbbf24', x: 1.34, z: 0.96, rotY: -0.78, layer: 2, faceDown: true }
  ];

  tarotSpecs.forEach((spec) => {
    const faceTex = trackTex(createTarotCardTexture(spec.title, spec.roman, spec.motif, spec.accent));
    faceTex.anisotropy = maxAnisotropy;
    const faceMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: faceTex,
        roughness: 0.44,
        metalness: 0.18
      })
    );
    const topMat = spec.faceDown ? cardBackMat : faceMat;
    const cardMesh = new THREE.Mesh(cardGeo, [
      cardEdgeMat,
      cardEdgeMat,
      topMat,
      cardBackMat,
      cardEdgeMat,
      cardEdgeMat
    ]);
    cardMesh.position.set(spec.x, PARLOR_TABLE_Y + 0.008 + spec.layer * 0.011, spec.z);
    cardMesh.rotation.y = spec.rotY;
    cardMesh.receiveShadow = true;
    group.add(cardMesh);
  });

  // Small ornate brass incense censer on right-back of table
  const censerPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.16, 0.0),
    new THREE.Vector2(0.12, 0.05),
    new THREE.Vector2(0.2, 0.16),
    new THREE.Vector2(0.16, 0.25),
    new THREE.Vector2(0.06, 0.34),
    new THREE.Vector2(0.0, 0.38)
  ];
  const censerGeo = trackGeo(new THREE.LatheGeometry(censerPoints, 24));
  const censerMesh = new THREE.Mesh(censerGeo, brassMat);
  censerMesh.position.set(1.32, PARLOR_TABLE_Y, -0.32);
  censerMesh.castShadow = !isSoftwareGl;
  group.add(censerMesh);

  // Volumetric Curling Incense Smoke Wisps rising continuously from the brass censer nozzle
  const smokeTex = trackTex(createIncenseSmokeTexture());
  const smokeWispCount = 20;
  interface SmokeWispHandle {
    sprite: THREE.Sprite;
    mat: THREE.SpriteMaterial;
    phase: number;
    driftDir: number;
    speed: number;
  }
  const smokeWisps: SmokeWispHandle[] = [];
  for (let i = 0; i < smokeWispCount; i++) {
    const sMat = trackMat(
      new THREE.SpriteMaterial({
        map: smokeTex,
        color: '#cbd5e1',
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    );
    const sprite = new THREE.Sprite(sMat);
    sprite.position.set(1.32, PARLOR_TABLE_Y + 0.39, -0.32);
    sprite.scale.set(0.12, 0.12, 1);
    group.add(sprite);
    smokeWisps.push({
      sprite,
      mat: sMat,
      phase: i / smokeWispCount,
      driftDir: Math.sin(i * 2.3) * 0.45,
      speed: 0.14 + (i % 4) * 0.018
    });
  }

  // =========================================================================
  // 4. PRETTY FEMALE CELESTIAL FORTUNE TELLER (Curved 3D Feathered Portrait
  //    Framed by 3D Brass Astrolabe Halo & Expressive 3D Hovering Hands)
  // =========================================================================
  const seerRoot = new THREE.Group();
  seerRoot.position.set(0, PARLOR_TABLE_Y - 0.03, -1.04);
  group.add(seerRoot);

  const robeVelvetMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: '#1b0f26',
      roughness: 0.88,
      metalness: 0.06,
      sheen: 0.85,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color('#5b2166')
    })
  );

  const hoodVelvetMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: '#16102c',
      roughness: 0.86,
      metalness: 0.08,
      sheen: 0.88,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color('#4c1d95'),
      side: THREE.DoubleSide
    })
  );

  // Warm natural skin tone matched to the candlelit female portrait
  const skinMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#d9ae90',
      roughness: 0.54,
      metalness: 0.02
    })
  );

  const diademGemMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#f6dfba',
      emissive: new THREE.Color('#b45309'),
      emissiveIntensity: 0.24,
      roughness: 0.2,
      metalness: 0.32
    })
  );

  // Starry Nebula Inner Bell-Sleeve Lining ShaderMaterial
  const nebulaLiningMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: NEBULA_LINING_VERTEX_SHADER,
      fragmentShader: NEBULA_LINING_FRAGMENT_SHADER,
      side: THREE.BackSide,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0.4 },
        uSpeak: { value: 0 },
        uColorPrimary: { value: new THREE.Color('#38bdf8') },
        uColorAccent: { value: new THREE.Color('#fbbf24') }
      }
    })
  );

  // --- Breathing Pivot & Gaze-Tracking Portrait Plane ---
  const torsoGroup = new THREE.Group();
  seerRoot.add(torsoGroup);

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.72, 0.06);
  torsoGroup.add(headGroup);

  // Load photorealistic candlelit pretty female fortune teller portrait
  const portraitTexLoader = new THREE.TextureLoader();
  const portraitTex = trackTex(portraitTexLoader.load(seerPortraitUrl));
  portraitTex.colorSpace = THREE.SRGBColorSpace;
  portraitTex.minFilter = THREE.LinearMipmapLinearFilter;
  portraitTex.magFilter = THREE.LinearFilter;
  portraitTex.anisotropy = Math.min(8, maxAnisotropy);

  // Gently curved 3:4 portrait surface so she has natural sculptural 3D presence behind the orb
  const portraitWidth = 2.38;
  const portraitHeight = 3.17;
  const portraitGeo = trackGeo(new THREE.PlaneGeometry(portraitWidth, portraitHeight, 28, 28));
  const pPos = portraitGeo.attributes.position;
  for (let i = 0; i < pPos.count; i++) {
    const x = pPos.getX(i);
    const y = pPos.getY(i);
    const nx = x / (portraitWidth * 0.5);
    const ny = y / (portraitHeight * 0.5);
    // Subtle convex curve forward at face/chest, wrapping softly back at outer shawl edges
    const zCurve = -0.15 * nx * nx - 0.04 * ny * ny;
    pPos.setZ(i, zCurve);
  }
  portraitGeo.computeVertexNormals();

  const portraitMat = trackMat(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        uPortraitMap: { value: portraitTex },
        uWarmBreath: { value: 0.0 },
        uSpeakWarmth: { value: 0.0 },
        uOrbTint: { value: new THREE.Color('#e8caa0') },
        uBlinkLeft: { value: 0.0 },
        uBlinkRight: { value: 0.0 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPortraitMap;
        uniform float uWarmBreath;
        uniform float uSpeakWarmth;
        uniform vec3 uOrbTint;
        uniform float uBlinkLeft;
        uniform float uBlinkRight;
        varying vec2 vUv;

        /**
         * Photorealistic anatomical eyelid blink shader calibrated directly to the
         * portrait's measured sub-pixel eye landmarks. Pulls real photographed upper-eyelid
         * skin downward with spherical eyeball dome shading, subtle lower-lid rise,
         * moving cast shadow over the exposed iris, and a feathered curved espresso lash seam.
         */
        vec3 applyNaturalEyeBlink(
          vec3 baseCol,
          vec2 uv,
          vec2 innerPt,
          vec2 outerPt,
          float upperLift,
          float lowerDrop,
          float creaseLift,
          float keyBias,
          float blink
        ) {
          if (blink <= 0.002) return baseCol;

          float spanU = outerPt.x - innerPt.x;
          float t = (uv.x - innerPt.x) / spanU; // 0 = inner tear duct, 1 = outer corner
          if (t < -0.09 || t > 1.09) return baseCol;

          float tc = clamp(t, 0.0, 1.0);
          float hMask = smoothstep(-0.045, 0.045, t) * smoothstep(1.045, 0.955, t);

          // Exact asymmetric almond eye fissure curves
          float archSin = sin(3.14159265 * tc);
          float vChord = mix(innerPt.y, outerPt.y, tc);
          float upperShape = pow(max(0.0, archSin), 0.78) * (1.0 + 0.12 * (0.48 - tc));
          float lowerShape = pow(max(0.0, archSin), 0.90) * (1.0 + 0.08 * (tc - 0.50));

          float vUpperOpen = vChord + upperLift * upperShape;
          float vLowerOpen = vChord - lowerDrop * lowerShape;

          // Natural closed lash seam sits gently curved along the lower quarter of the eye
          float vClosedSeam = mix(vLowerOpen, vChord, 0.14);

          // Upper eyelid fold region anchored safely below the eyebrow
          float vCreaseTop = vUpperOpen + creaseLift * (0.46 + 0.54 * pow(max(0.0, archSin), 0.55));

          // Animated upper lid descent (~86% travel) + subtle lower lid rise (~14% travel)
          float vUpperCurr = mix(vUpperOpen, vClosedSeam, blink);
          float vLowerCurr = mix(vLowerOpen, vClosedSeam, blink * 0.20);

          vec3 col = baseCol;

          // 1. Subtle lower-eyelid & lower-cheek upward orbicularis micro-lift
          float lowerLiftAmt = (vLowerCurr - vLowerOpen);
          float lowerZone =
            smoothstep(vLowerOpen - 0.0095, vLowerOpen - 0.002, uv.y) *
            smoothstep(vLowerCurr + 0.0014, vLowerCurr - 0.0008, uv.y) *
            hMask;
          if (lowerZone > 0.001 && lowerLiftAmt > 0.00005) {
            vec2 liftedUv = vec2(uv.x, uv.y - lowerLiftAmt * 0.92);
            vec3 lowerSkin = texture2D(uPortraitMap, liftedUv).rgb;
            col = mix(col, lowerSkin, lowerZone * smoothstep(0.08, 0.45, blink));
          }

          // 2. Soft moving cast shadow thrown by the descending upper lid onto exposed iris/sclera
          float openGapMask =
            smoothstep(vLowerCurr - 0.0008, vLowerCurr + 0.0012, uv.y) *
            smoothstep(vUpperCurr + 0.0006, vUpperCurr - 0.0008, uv.y) *
            hMask;
          if (openGapMask > 0.001) {
            float distBelowUpper = max(0.0, vUpperCurr - uv.y);
            float castShadow = exp(-distBelowUpper / 0.0036) * (0.38 * blink + 0.12 * blink * blink);
            col *= (1.0 - castShadow * openGapMask);
          }

          // 3. Descending Upper Eyelid Curtain (real photographic eyelid skin + 3D eyeball dome lighting)
          float lidSpan = max(0.0006, vCreaseTop - vUpperCurr);
          float s = clamp((uv.y - vUpperCurr) / lidSpan, 0.0, 1.0);
          float curtainMask =
            smoothstep(vUpperCurr - 0.0010, vUpperCurr + 0.0009, uv.y) *
            smoothstep(vCreaseTop + 0.0018, vCreaseTop - 0.0018, uv.y) *
            hMask *
            smoothstep(0.015, 0.11, blink);

          if (curtainMask > 0.001) {
            // Pull clean lash-free photographic upper-eyelid skin smoothly downward over the eye
            // Sampling above vUpperOpen + 0.0026 prevents any ghost double-eyelash artifact
            float vSkinStart = vUpperOpen + 0.0028 + 0.0016 * blink;
            float vSampled = mix(vSkinStart, vCreaseTop, pow(s, 0.92));
            float vSrc = mix(uv.y, vSampled, smoothstep(0.0, 0.24, blink));

            // Soft 3-tap horizontal skin kernel on stretched dome to preserve real pores without streaks
            vec3 lidCenter = texture2D(uPortraitMap, vec2(uv.x, vSrc)).rgb;
            vec3 lidLeft = texture2D(uPortraitMap, vec2(uv.x - 0.0024, min(vCreaseTop, vSrc + 0.0007))).rgb;
            vec3 lidRight = texture2D(uPortraitMap, vec2(uv.x + 0.0024, min(vCreaseTop, vSrc + 0.0007))).rgb;
            vec3 lidSoft = lidCenter * 0.50 + (lidLeft + lidRight) * 0.25;
            vec3 lidCol = mix(lidCenter, lidSoft, (1.0 - s) * blink * 0.85);

            // Spherical eyeball dome light sculpting (warm overhead light + soft supratarsal crease)
            float horizDome = pow(max(0.0, sin(3.14159265 * clamp(tc + keyBias, 0.0, 1.0))), 0.75);
            float vertDome = sin(3.14159265 * clamp(s * 1.28, 0.0, 1.0));
            float domeLight = horizDome * vertDome * 0.075 * blink;

            // Gentle supratarsal fold shadow near top of lid + soft lash-root occlusion at bottom
            float creaseShade = exp(-pow((s - 0.76) / 0.14, 2.0)) * (0.45 + 0.55 * archSin) * 0.11 * blink;
            float rootShade = exp(-pow(s / 0.16, 2.0)) * 0.17 * blink;
            float cornerAmbient = (1.0 - pow(max(0.0, archSin), 0.55)) * 0.06 * blink;

            lidCol *= (1.0 + domeLight - creaseShade - rootShade - cornerAmbient);
            col = mix(col, lidCol, curtainMask);
          }

          // 4. Delicate Moving Upper Eyelash Margin & Closed Lash Seam
          float vLashCenter = vUpperCurr - 0.00035 * blink;
          float lashDist = abs(uv.y - vLashCenter);
          // Natural taper: slender near tear duct, fuller across center-outer arch, soft wing at outer tip
          float lashTaper = smoothstep(0.02, 0.22, tc) * smoothstep(1.03, 0.84, tc);
          float lashWidth = (0.00105 + 0.00055 * smoothstep(0.35, 0.82, tc)) * (0.82 + 0.22 * blink);
          float lashBand = exp(-pow(lashDist / max(0.0003, lashWidth), 2.0));

          // Subtle organic micro-strand variation along the closed lash line
          float fineLashGrain = 0.86 + 0.14 * sin(tc * 86.0 + keyBias * 9.0);
          float lashStrength = lashBand * lashTaper * hMask * smoothstep(0.05, 0.26, blink) * (0.76 + 0.14 * blink) * fineLashGrain;

          // Warm dark-espresso natural lash tone (linear space, never harsh flat black)
          vec3 espressoLash = vec3(0.022, 0.013, 0.010);
          col = mix(col, espressoLash, clamp(lashStrength, 0.0, 0.88));

          // Soft hairline micro-shadow directly under the closed seam for photographic depth
          float seamUnderDist = (vLashCenter - 0.0012) - uv.y;
          float seamUnder = exp(-pow(seamUnderDist / 0.0015, 2.0)) * lashTaper * hMask * smoothstep(0.45, 0.95, blink);
          col *= (1.0 - seamUnder * 0.18);

          return col;
        }

        void main() {
          vec4 tex = texture2D(uPortraitMap, vUv);
          vec3 portraitRgb = tex.rgb;

          // Apply anatomically calibrated natural blinking to both eyes (zero cost when open)
          if (uBlinkLeft > 0.002 || uBlinkRight > 0.002) {
            // Viewer-left eye (her right eye): inner canthus (0.471, 0.684), outer corner (0.404, 0.6875)
            portraitRgb = applyNaturalEyeBlink(
              portraitRgb,
              vUv,
              vec2(0.471, 0.6840),
              vec2(0.404, 0.6875),
              0.0112,
              0.0062,
              0.0115,
              0.06,
              uBlinkLeft
            );
            // Viewer-right eye (her left eye): inner canthus (0.534, 0.685), outer corner (0.601, 0.6895)
            portraitRgb = applyNaturalEyeBlink(
              portraitRgb,
              vUv,
              vec2(0.534, 0.6850),
              vec2(0.601, 0.6895),
              0.0116,
              0.0060,
              0.0118,
              -0.08,
              uBlinkRight
            );
          }

          // Perceptual sRGB space for clean dark-studio backdrop keying without affecting dark hair or plum velvet
          vec3 perc = pow(max(tex.rgb, vec3(0.0)), vec3(1.0 / 2.2));
          vec3 bgRef = vec3(0.032, 0.056, 0.084);
          float bgDist = length((perc - bgRef) * vec3(1.25, 1.15, 1.0));
          float luma = dot(perc, vec3(0.299, 0.587, 0.114));
          // Plum shawl & gold embroidery have warm red/gold channel lift over cool studio backdrop
          float warmLift = max(0.0, perc.r - perc.b * 0.72);
          float keySignal = bgDist + warmLift * 0.95 + smoothstep(0.075, 0.18, luma) * 0.25;
          float silhouetteAlpha = smoothstep(0.045, 0.145, keySignal);

          // Protect inner face, dark wavy hair & inner hood interior from any accidental transparency
          vec2 faceD = (vUv - vec2(0.50, 0.66)) / vec2(0.21, 0.19);
          float faceCore = 1.0 - smoothstep(0.72, 1.08, length(faceD));

          // Protect central plum velvet shawl drape
          vec2 shawlD = (vUv - vec2(0.50, 0.34)) / vec2(0.32, 0.17);
          float shawlCore = 1.0 - smoothstep(0.72, 1.12, length(shawlD));

          float alpha = max(silhouetteAlpha, max(faceCore, shawlCore));

          // Smooth perimeter & bottom hem feather (cleanly hides cropped bottom forearms behind tabletop)
          float edgeX = smoothstep(0.02, 0.11, vUv.x) * smoothstep(0.02, 0.11, 1.0 - vUv.x);
          float edgeTop = smoothstep(0.03, 0.13, 1.0 - vUv.y);
          float edgeBottom = smoothstep(0.14, 0.29, vUv.y);
          alpha *= edgeX * edgeTop * edgeBottom;

          if (alpha < 0.01) discard;

          // Subtle candlelit warmth from the crystal ball & beeswax tapers below (zero neon glare)
          float lowerGlowMask = smoothstep(0.72, 0.24, vUv.y) * smoothstep(0.14, 0.36, vUv.y);
          vec3 candleReflect = mix(vec3(1.0, 0.88, 0.72), uOrbTint, 0.22);
          vec3 col = portraitRgb * (0.98 + uWarmBreath * 0.035);
          col += col * candleReflect * lowerGlowMask * (0.04 + uSpeakWarmth * 0.07);

          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    })
  );

  const portraitMesh = new THREE.Mesh(portraitGeo, portraitMat);
  portraitMesh.position.set(0, 0.0, 0.0);
  portraitMesh.renderOrder = 2;
  headGroup.add(portraitMesh);

  // Floating Articulated Brass Astrolabe Halo Crown suspended cleanly behind her head (eyes at local y ~ 2.12)
  const haloGroup = new THREE.Group();
  haloGroup.position.set(0, 2.26, -0.26);
  torsoGroup.add(haloGroup);

  const haloOuterRingGroup = new THREE.Group();
  haloGroup.add(haloOuterRingGroup);
  const haloOuterGeo = trackGeo(new THREE.TorusGeometry(0.82, 0.018, 14, 72));
  haloOuterRingGroup.add(new THREE.Mesh(haloOuterGeo, goldMat));

  const haloBevelGeo = trackGeo(new THREE.TorusGeometry(0.72, 0.01, 10, 64));
  haloOuterRingGroup.add(new THREE.Mesh(haloBevelGeo, brassMat));

  // 12 Radial Brass Sunburst Spikes crowning the floating halo
  const spikeGeo = trackGeo(new THREE.ConeGeometry(0.024, 0.22, 5));
  for (let s = 0; s < 12; s++) {
    const ang = (s / 12) * Math.PI * 2;
    const isLong = s % 2 === 0;
    const sp = new THREE.Mesh(spikeGeo, isLong ? goldMat : brassMat);
    const r = isLong ? 0.95 : 0.9;
    sp.position.set(Math.cos(ang) * r, Math.sin(ang) * r, 0);
    sp.rotation.z = ang - Math.PI * 0.5;
    sp.scale.set(isLong ? 1.05 : 0.78, isLong ? 1.15 : 0.72, 1.0);
    haloOuterRingGroup.add(sp);
  }

  // Counter-rotating inner filigree ring with 4 lunar-phase medallions
  const haloInnerRingGroup = new THREE.Group();
  haloGroup.add(haloInnerRingGroup);
  const haloInnerGeo = trackGeo(new THREE.TorusGeometry(0.61, 0.012, 10, 64));
  haloInnerRingGroup.add(new THREE.Mesh(haloInnerGeo, goldMat));

  const lunarOrbGeo = trackGeo(new THREE.OctahedronGeometry(0.042, 0));
  for (let m = 0; m < 4; m++) {
    const ang = (m / 4) * Math.PI * 2 + Math.PI * 0.25;
    const med = new THREE.Mesh(lunarOrbGeo, m % 2 === 0 ? diademGemMat : goldMat);
    med.position.set(Math.cos(ang) * 0.61, Math.sin(ang) * 0.61, 0.01);
    haloInnerRingGroup.add(med);
  }

  // Subtle warm sheen ring nestled inside the brass halo (non-flashing)
  const haloGlowRingGeo = trackGeo(new THREE.RingGeometry(0.62, 0.8, 64));
  const haloGlowRingMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#c9a66b',
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  const haloGlowRing = new THREE.Mesh(haloGlowRingGeo, haloGlowRingMat);
  haloGlowRing.position.z = -0.02;
  haloGroup.add(haloGlowRing);

  // Soft warm ambient light illuminating the 3D brass astrolabe halo & nearby hands
  const seerGlowLight = new THREE.PointLight('#e6caa4', 0.42, 3.2, 1.85);
  seerGlowLight.position.set(0, 1.85, 0.48);
  torsoGroup.add(seerGlowLight);

  // --- Articulated 3D Hovering Hands & Billowing Velvet Bell Sleeves Cradling the Smaller Crystal Ball ---
  const buildArmAndHand = (side: -1 | 1) => {
    const handGroup = new THREE.Group();
    // Poised gracefully flanking the smaller (0.52x) crystal ball
    handGroup.position.set(side * 0.72, -0.22, 0.58);
    handGroup.scale.setScalar(0.96);
    group.add(handGroup);

    // Sculpted Palm
    const palmGeo = trackGeo(new THREE.SphereGeometry(0.084, 18, 16));
    const palm = new THREE.Mesh(palmGeo, skinMat);
    palm.scale.set(0.86, 0.4, 1.12);
    palm.castShadow = !isSoftwareGl;
    handGroup.add(palm);

    // 4 Gracefully Curved Fingers + Thumb with Delicate Gold Rings
    const fingerSpecs = [
      { x: -0.05, z: 0.082, len: 0.112, spread: -0.16, curl: 0.34, hasRing: false },
      { x: -0.017, z: 0.092, len: 0.128, spread: -0.05, curl: 0.3, hasRing: true },
      { x: 0.017, z: 0.089, len: 0.122, spread: 0.06, curl: 0.32, hasRing: true },
      { x: 0.05, z: 0.076, len: 0.095, spread: 0.18, curl: 0.38, hasRing: false }
    ];
    const ringGeo = trackGeo(new THREE.TorusGeometry(0.014, 0.0038, 8, 14));

    fingerSpecs.forEach((f) => {
      const fGeo = trackGeo(new THREE.CylinderGeometry(0.0085, 0.013, f.len, 10));
      const finger = new THREE.Mesh(fGeo, skinMat);
      finger.position.set(f.x * side, -0.016, f.z + f.len * 0.35);
      finger.rotation.x = Math.PI * 0.5 + f.curl;
      finger.rotation.z = f.spread * side;
      handGroup.add(finger);

      if (f.hasRing) {
        const ring = new THREE.Mesh(ringGeo, goldMat);
        ring.position.set(f.x * side, -0.004, f.z + f.len * 0.18);
        ring.rotation.x = f.curl;
        handGroup.add(ring);
      }
    });

    const thumbGeo = trackGeo(new THREE.CylinderGeometry(0.01, 0.015, 0.088, 10));
    const thumb = new THREE.Mesh(thumbGeo, skinMat);
    thumb.position.set(-0.074 * side, -0.014, 0.034);
    thumb.rotation.x = Math.PI * 0.45;
    thumb.rotation.z = 0.55 * side;
    handGroup.add(thumb);

    // Stacked Hammered Brass Wrist Bangles (3 cuffs)
    const bangleGeo = trackGeo(new THREE.TorusGeometry(0.06, 0.01, 10, 24));
    for (let b = 0; b < 3; b++) {
      const bangle = new THREE.Mesh(bangleGeo, b === 1 ? goldMat : brassMat);
      bangle.position.set(0, 0.005, -0.105 - b * 0.026);
      handGroup.add(bangle);
    }

    // Draped Velvet Bell-Sleeve Cuff with Starry Nebula Inner Lining
    const cuffGeo = trackGeo(new THREE.ConeGeometry(0.15, 0.32, 20, 1, true));
    const cuff = new THREE.Mesh(cuffGeo, hoodVelvetMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, -0.02, -0.25);
    handGroup.add(cuff);

    const cuffLining = new THREE.Mesh(cuffGeo, nebulaLiningMat);
    cuffLining.rotation.x = Math.PI / 2;
    cuffLining.position.set(0, -0.02, -0.246);
    cuffLining.scale.set(0.96, 0.98, 0.96);
    handGroup.add(cuffLining);

    const cuffTrimGeo = trackGeo(new THREE.TorusGeometry(0.145, 0.009, 8, 24));
    const cuffTrim = new THREE.Mesh(cuffTrimGeo, goldMat);
    cuffTrim.position.set(0, -0.02, -0.095);
    handGroup.add(cuffTrim);

    // Orient hand inward to cradle the crystal ball
    handGroup.rotation.set(0.18, -side * 0.6, side * 0.22);

    // Draped Velvet Sleeve receding cleanly behind the portrait's plum velvet shawl shoulders
    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.78, PARLOR_TABLE_Y + 0.76, -0.92),
      new THREE.Vector3(side * 0.96, PARLOR_TABLE_Y + 0.64, -0.46),
      new THREE.Vector3(side * 0.9, PARLOR_TABLE_Y + 0.72, 0.08),
      new THREE.Vector3(side * 0.75, -0.24, 0.34)
    ]);
    const armGeo = trackGeo(new THREE.TubeGeometry(armCurve, 24, 0.132, 14, false));
    const armMesh = new THREE.Mesh(armGeo, robeVelvetMat);
    armMesh.castShadow = !isSoftwareGl;
    group.add(armMesh);

    return handGroup;
  };

  const leftHandGroup = buildArmAndHand(-1);
  const rightHandGroup = buildArmAndHand(1);

  // =========================================================================
  // 5. ZERO-GC STAGED FRAME ANIMATION UPDATE (SERENE STILLNESS BEFORE PLAY)
  // =========================================================================
  let seerClock = 0;
  let handsClock = 0;
  let haloClock = 0;
  const blinkController = new SeerBlinkController();
  const blinkSample: SeerBlinkSample = { left: 0, right: 0 };

  const update = (_elapsed: number, delta: number, signals: SeerAnimationSignals) => {
    const motionMul = signals.reducedMotion ? 0.12 : 1.0;
    const sw = signals.stageWeights;
    const wBreath = sw ? sw.seerBreathGaze : 1;
    const wHands = sw ? sw.handsCandlesIncense : 1;
    const wHalo = sw ? sw.astrolabeRings : 1;

    // Per-stage accumulated phase clocks so each stage wakes smoothly from rest with zero snap
    seerClock += delta * motionMul * wBreath;
    handsClock += delta * motionMul * wHands;
    haloClock += delta * motionMul * wHalo;

    computeSeerAnimationPose(
      seerClock,
      signals.energy * wBreath,
      signals.speakingEnergy * wBreath,
      signals.micEnergy * wBreath,
      signals.pointerNdcX * wBreath,
      signals.pointerNdcY * wBreath,
      _pose
    );

    // Stage 2: Gentle breathing rise/fall & subtle portrait parallax lean (kept subtle so portrait stays natural)
    torsoGroup.position.y = THREE.MathUtils.damp(
      torsoGroup.position.y,
      _pose.breathOffset * 0.85 * wBreath,
      4.0,
      delta
    );

    headGroup.rotation.y = THREE.MathUtils.damp(headGroup.rotation.y, _pose.headYaw * 0.24 * wBreath, 4.2, delta);
    headGroup.rotation.x = THREE.MathUtils.damp(
      headGroup.rotation.x,
      (_pose.headPitch - 0.12) * 0.16 * wBreath,
      4.5,
      delta
    );
    headGroup.rotation.z = THREE.MathUtils.damp(headGroup.rotation.z, _pose.headRoll * 0.42 * wBreath, 4.0, delta);

    // Portrait subtle candlelit warmth modulation (zero neon glare)
    portraitMat.uniforms.uWarmBreath.value = THREE.MathUtils.damp(
      portraitMat.uniforms.uWarmBreath.value,
      (Math.sin(seerClock * 0.85) * 0.5 + 0.5) * wBreath,
      3.5,
      delta
    );
    portraitMat.uniforms.uSpeakWarmth.value = THREE.MathUtils.damp(
      portraitMat.uniforms.uSpeakWarmth.value,
      Math.min(1, (signals.speakingEnergy * 0.85 + signals.energy * 0.25) * wBreath),
      4.0,
      delta
    );
    portraitMat.uniforms.uOrbTint.value.set('#e8caa0').lerp(signals.orbColor, 0.22 * wBreath);

    // Natural living eye blinking (serene resting blink cadence at idle, subtly responsive when speaking)
    blinkController.step(delta, signals.speakingEnergy * wBreath, signals.reducedMotion, blinkSample);
    portraitMat.uniforms.uBlinkLeft.value = blinkSample.left;
    portraitMat.uniforms.uBlinkRight.value = blinkSample.right;

    // Stage 3: Hovering expressive hands cradling the smaller crystal ball (rest poised before Stage 3)
    const handEnergyDrive = Math.min(1, signals.speakingEnergy * 1.0 + signals.micEnergy * 0.85 + signals.energy * 0.35) * wHands;
    const handHoverLift = (0.032 * Math.sin(handsClock * 1.45) + handEnergyDrive * 0.058) * wHands;
    const handPullCloser = handEnergyDrive * 0.06;

    const targetLeftX = -0.72 + handPullCloser + Math.cos(handsClock * 1.05) * 0.028 * wHands;
    const targetLeftY = -0.22 + handHoverLift + Math.sin(handsClock * 1.65) * 0.022 * wHands;
    const targetLeftZ = 0.58 + Math.sin(handsClock * 0.85) * 0.034 * wHands + handEnergyDrive * 0.024;

    const targetRightX = 0.72 - handPullCloser - Math.cos(handsClock * 1.05 + 0.7) * 0.028 * wHands;
    const targetRightY = -0.22 + handHoverLift + Math.sin(handsClock * 1.65 + 1.1) * 0.022 * wHands;
    const targetRightZ = 0.58 + Math.cos(handsClock * 0.85) * 0.034 * wHands + handEnergyDrive * 0.024;

    leftHandGroup.position.x = THREE.MathUtils.damp(leftHandGroup.position.x, targetLeftX, 5.0, delta);
    leftHandGroup.position.y = THREE.MathUtils.damp(leftHandGroup.position.y, targetLeftY, 5.0, delta);
    leftHandGroup.position.z = THREE.MathUtils.damp(leftHandGroup.position.z, targetLeftZ, 5.0, delta);
    leftHandGroup.rotation.x = THREE.MathUtils.damp(
      leftHandGroup.rotation.x,
      0.18 + (Math.sin(handsClock * 1.6) * 0.065 + signals.speakingEnergy * 0.1) * wHands,
      5.0,
      delta
    );
    leftHandGroup.rotation.z = THREE.MathUtils.damp(
      leftHandGroup.rotation.z,
      -0.22 - Math.cos(handsClock * 1.3) * 0.05 * wHands,
      5.0,
      delta
    );

    rightHandGroup.position.x = THREE.MathUtils.damp(rightHandGroup.position.x, targetRightX, 5.0, delta);
    rightHandGroup.position.y = THREE.MathUtils.damp(rightHandGroup.position.y, targetRightY, 5.0, delta);
    rightHandGroup.position.z = THREE.MathUtils.damp(rightHandGroup.position.z, targetRightZ, 5.0, delta);
    rightHandGroup.rotation.x = THREE.MathUtils.damp(
      rightHandGroup.rotation.x,
      0.18 + (Math.sin(handsClock * 1.6 + 0.9) * 0.065 + signals.speakingEnergy * 0.1) * wHands,
      5.0,
      delta
    );
    rightHandGroup.rotation.z = THREE.MathUtils.damp(
      rightHandGroup.rotation.z,
      0.22 + Math.cos(handsClock * 1.3 + 0.9) * 0.05 * wHands,
      5.0,
      delta
    );

    // Calm, restrained halo gem & ambient warmth (zero neon flashing)
    _eyeTargetColor.set('#c9a66b').lerp(signals.accentColor, 0.2 * wHalo);
    diademGemMat.emissive.lerp(_eyeTargetColor, Math.min(1, delta * 2.5));
    diademGemMat.emissiveIntensity = THREE.MathUtils.damp(
      diademGemMat.emissiveIntensity,
      Math.min(0.42, 0.22 + (signals.speakingEnergy * 0.16 + signals.micEnergy * 0.1) * wHalo),
      3.5,
      delta
    );

    seerGlowLight.color.set('#e6caa4').lerp(signals.orbColor, 0.14 * wBreath);
    seerGlowLight.intensity = THREE.MathUtils.damp(
      seerGlowLight.intensity,
      0.38 + (_pose.speakingGlowIntensity - 0.24) * 0.18 * wBreath,
      3.2,
      delta
    );

    // Stage 3: Starry Nebula Bell-Sleeve Lining shader uniforms
    nebulaLiningMat.uniforms.uTime.value = handsClock;
    nebulaLiningMat.uniforms.uEnergy.value = THREE.MathUtils.damp(
      nebulaLiningMat.uniforms.uEnergy.value,
      signals.energy * 0.42 * wHands,
      3.0,
      delta
    );
    nebulaLiningMat.uniforms.uSpeak.value = THREE.MathUtils.damp(
      nebulaLiningMat.uniforms.uSpeak.value,
      signals.speakingEnergy * 0.42 * wHands,
      4.0,
      delta
    );
    nebulaLiningMat.uniforms.uColorPrimary.value.copy(signals.orbColor);
    nebulaLiningMat.uniforms.uColorAccent.value.copy(signals.accentColor);

    // Stage 4: Floating Articulated Brass Astrolabe Halo counter-rotation & subtle gaze echo
    haloGroup.position.y = THREE.MathUtils.damp(
      haloGroup.position.y,
      2.26 + (Math.sin(haloClock * 1.15) * 0.02 + signals.speakingEnergy * 0.014) * wHalo,
      3.2,
      delta
    );
    haloGroup.rotation.y = THREE.MathUtils.damp(haloGroup.rotation.y, _pose.headYaw * 0.36 * wHalo, 3.0, delta);
    haloGroup.rotation.x = THREE.MathUtils.damp(haloGroup.rotation.x, _pose.headPitch * 0.2 * wHalo, 3.0, delta);
    haloOuterRingGroup.rotation.z += delta * (0.08 + signals.energy * 0.06) * motionMul * wHalo;
    haloInnerRingGroup.rotation.z -= delta * (0.14 + signals.speakingEnergy * 0.1) * motionMul * wHalo;
    haloGlowRingMat.color.set('#c9a66b').lerp(signals.accentColor, 0.18 * wHalo);
    haloGlowRingMat.opacity = THREE.MathUtils.damp(
      haloGlowRingMat.opacity,
      0.03 + (signals.energy * 0.022 + signals.speakingEnergy * 0.028) * wHalo,
      3.2,
      delta
    );

    // Stage 3: Curling Volumetric Incense Smoke Wisps (dormant before Play, wake gently at Stage 3)
    const windDrift = 0.2 + (signals.swirlSpeed ?? 0.4) * 0.28;
    for (let i = 0; i < smokeWisps.length; i++) {
      const wisp = smokeWisps[i];
      const life = (handsClock * wisp.speed + wisp.phase) % 1;
      const riseY = life * 1.55;
      const curlX =
        Math.sin(life * Math.PI * 3.1 + handsClock * 1.1 + wisp.phase * 6.28) * (0.04 + life * 0.16) +
        life * wisp.driftDir * windDrift;
      const curlZ =
        Math.cos(life * Math.PI * 2.4 + handsClock * 0.85 + wisp.phase * 4.2) * (0.03 + life * 0.12) -
        life * 0.12;
      wisp.sprite.position.set(1.32 + curlX, PARLOR_TABLE_Y + 0.39 + riseY, -0.32 + curlZ);
      const scale = 0.11 + life * 0.46;
      wisp.sprite.scale.set(scale, scale * 1.18, 1);
      const alpha = Math.sin(life * Math.PI) * (0.19 + signals.speakingEnergy * 0.03) * wHands;
      wisp.mat.opacity = Math.max(0, Math.min(0.24, alpha));
      wisp.mat.color.set('#cbd5e1').lerp(signals.accentColor, 0.12 + life * 0.08);
    }

    // Stage 3: Calm warm beeswax candlelight (perfectly steady before Play, gentle warm sway at Stage 3)
    const flickerA = 0.94 + (Math.sin(handsClock * 2.8) * 0.022 + Math.cos(handsClock * 4.9 + 1.1) * 0.012) * wHands;
    const flickerB = 0.94 + (Math.cos(handsClock * 3.1 + 0.8) * 0.022 + Math.sin(handsClock * 4.6 + 2.3) * 0.012) * wHands;
    candleLightLeft.intensity = 1.95 * flickerA;
    candleLightRight.intensity = 1.78 * flickerB;

    for (let i = 0; i < candleHandles.length; i++) {
      const ch = candleHandles[i];
      const f = i % 2 === 0 ? flickerA : flickerB;
      const sway = Math.sin(handsClock * 2.5 + ch.phase) * 0.04 * wHands;
      ch.flameGroup.scale.set(0.95 + (f - 0.94) * 0.3, 0.96 + (f - 0.94) * 0.4, 0.95 + (f - 0.94) * 0.3);
      ch.flameGroup.rotation.z = sway;
      ch.flameGroup.position.y = ch.baseY + (f - 0.94) * 0.01;
      ch.halo.scale.setScalar(0.38 + (f - 0.94) * 0.16);
    }
  };

  const dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  };

  return { group, update, dispose };
}
