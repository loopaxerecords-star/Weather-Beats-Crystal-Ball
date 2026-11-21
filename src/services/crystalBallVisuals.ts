import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 1. Multi-Layer Celestial Crystal Shaders (Singularity, Nebula, Fresnel Aura)
// ---------------------------------------------------------------------------

export const SINGULARITY_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vLocalPos;
  varying vec3 vWorldPos;

  void main() {
    vLocalPos = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const SINGULARITY_FRAGMENT_SHADER = `
  precision highp float;

  uniform float uTime;
  uniform float uEnergy;
  uniform float uBeatPulse;
  uniform vec3 uColorPrimary;
  uniform vec3 uColorAccent;

  varying vec3 vNormal;
  varying vec3 vLocalPos;
  varying vec3 vWorldPos;

  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.17);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
          mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
          mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float facing = max(0.0, dot(viewDir, normalize(vNormal)));
    vec3 p = normalize(vLocalPos);

    float t = uTime * 1.45;
    float veins = noise3(p * 6.5 + vec3(t, -t * 0.7, t * 0.5));
    float ribs = noise3(p * 13.0 - vec3(t * 0.9, t * 1.1, -t * 0.6));
    float plasma = smoothstep(0.32, 0.88, veins * 0.65 + ribs * 0.45);

    vec3 hotWhite = vec3(1.0, 0.98, 0.92);
    vec3 baseCol = mix(uColorPrimary, uColorAccent, plasma);
    float coreHotspot = pow(facing, 1.9) * (0.55 + uEnergy * 0.48 + uBeatPulse * 0.36);
    vec3 finalCol = mix(baseCol * (0.82 + uEnergy * 0.55), hotWhite, clamp(coreHotspot * 0.72, 0.0, 0.92));
    finalCol += uColorAccent * pow(1.0 - facing, 2.3) * (0.52 + uBeatPulse * 0.45);

    gl_FragColor = vec4(finalCol * (0.9 + uBeatPulse * 0.32), 0.95);
  }
`;

export const NEBULA_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vLocalPos;
  varying vec3 vWorldPos;

  void main() {
    vLocalPos = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const NEBULA_FRAGMENT_SHADER = `
  precision highp float;

  uniform float uTime;
  uniform float uEnergy;
  uniform float uSwirlSpeed;
  uniform float uBeatPulse;
  uniform vec3 uColorPrimary;
  uniform vec3 uColorSecondary;
  uniform vec3 uColorAccent;

  varying vec3 vNormal;
  varying vec3 vLocalPos;
  varying vec3 vWorldPos;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.52;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.06 + vec3(0.47, -0.31, 0.29);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float ndotv = max(0.0, dot(viewDir, normalize(vNormal)));
    float fresnel = pow(1.0 - ndotv, 2.35);

    float t = uTime * (0.28 + uSwirlSpeed * 0.72);
    float angle = atan(vLocalPos.z, vLocalPos.x) + vLocalPos.y * 1.4 - t * 0.45;
    vec3 spiralPos = vec3(
      cos(angle) * length(vLocalPos.xz),
      vLocalPos.y,
      sin(angle) * length(vLocalPos.xz)
    );

    vec3 q = spiralPos * 2.05 + vec3(sin(t * 0.6), cos(t * 0.45), sin(t * 0.35)) * 0.85;
    float n1 = fbm(q);
    float n2 = fbm(q * 1.9 - vec3(t * 0.38, -t * 0.27, t * 0.22));
    float filaments = pow(clamp(1.0 - abs(n1 - n2) * 3.1, 0.0, 1.0), 2.4);
    float cloud = smoothstep(0.24, 0.86, n1 * 0.58 + n2 * 0.48 + uEnergy * 0.22);

    vec3 col = mix(uColorSecondary * 0.45, uColorPrimary, cloud);
    col = mix(col, uColorAccent, filaments * (0.55 + uEnergy * 0.45 + uBeatPulse * 0.35));
    col += uColorAccent * fresnel * (0.65 + uEnergy * 0.55 + uBeatPulse * 0.35);
    col += uColorPrimary * pow(ndotv, 2.5) * (0.22 + uBeatPulse * 0.25);

    float alpha = 0.26 + cloud * 0.38 + filaments * 0.26 + fresnel * 0.28;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
  }
`;

export const AURA_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const AURA_FRAGMENT_SHADER = `
  precision highp float;

  uniform float uTime;
  uniform float uEnergy;
  uniform float uBeatPulse;
  uniform vec3 uColorPrimary;
  uniform vec3 uColorAccent;

  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float ndotv = abs(dot(viewDir, normalize(vNormal)));
    float haloRim = pow(clamp(1.0 - ndotv, 0.0, 1.0), 3.4);
    float shimmer = 0.88 + 0.12 * sin(uTime * 2.4 + vWorldPos.y * 5.0);
    vec3 col = mix(uColorPrimary, uColorAccent, 0.32 + uBeatPulse * 0.25);
    float alpha = haloRim * (0.19 + uEnergy * 0.21 + uBeatPulse * 0.18) * shimmer;
    gl_FragColor = vec4(col * (0.94 + uBeatPulse * 0.3), clamp(alpha, 0.0, 0.54));
  }
`;

// ---------------------------------------------------------------------------
// 2. Zero-Dependency Procedural Canvas Textures (Runes, Mandala, Brass, Glow)
// ---------------------------------------------------------------------------

const ARCANE_RUNE_GLYPHS = [
  '☉', '☽', '☿', '♀', '♁', '♂', '♃', '♄',
  'ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ',
  'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ', 'ᛇ', 'ᛈ', 'ᛉ', 'ᛊ',
  'ᛏ', 'ᛒ', 'ᛖ', 'ᛗ', 'ᛚ', 'ᛜ', 'ᛞ', 'ᛟ'
];

export function createAstrolabeRuneRingTexture(
  glowHex = '#ffffff',
  secondaryHex = '#e0f2fe'
): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    // Outer & inner arcane rings (high-luminance so material.color shifts hue vividly)
    ctx.strokeStyle = glowHex;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 488, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = secondaryHex;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 342, 0, Math.PI * 2);
    ctx.stroke();

    // Precision degree ticks
    for (let deg = 0; deg < 360; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const isMajor = deg % 15 === 0;
      const rIn = isMajor ? 450 : 468;
      const rOut = 486;
      ctx.strokeStyle = isMajor ? glowHex : 'rgba(255, 255, 255, 0.58)';
      ctx.lineWidth = isMajor ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * rIn, cy + Math.sin(rad) * rIn);
      ctx.lineTo(cx + Math.cos(rad) * rOut, cy + Math.sin(rad) * rOut);
      ctx.stroke();
    }

    // Luminous arcane glyphs around the band
    ctx.save();
    ctx.font = '600 36px "Cinzel", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyphCount = 24;
    for (let i = 0; i < glyphCount; i++) {
      const theta = (i / glyphCount) * Math.PI * 2;
      const rMid = 408;
      const gx = cx + Math.cos(theta) * rMid;
      const gy = cy + Math.sin(theta) * rMid;

      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(theta + Math.PI / 2);
      ctx.shadowColor = i % 2 === 0 ? glowHex : secondaryHex;
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(ARCANE_RUNE_GLYPHS[i % ARCANE_RUNE_GLYPHS.length], 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createAltarMandalaTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;

    const bgGrad = ctx.createRadialGradient(cx, cy, 30, cx, cy, 512);
    bgGrad.addColorStop(0, '#131d31');
    bgGrad.addColorStop(0.55, '#0b111e');
    bgGrad.addColorStop(1, '#060912');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    // Concentric brass inlay circles
    const radii = [170, 250, 340, 430, 476];
    radii.forEach((r, idx) => {
      ctx.strokeStyle = idx % 2 === 0 ? 'rgba(245, 158, 11, 0.42)' : 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = idx === 3 ? 3 : 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // 12-point celestial compass & 24 domain radial spokes
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(251, 191, 36, 0.28)' : 'rgba(148, 163, 184, 0.14)';
      ctx.lineWidth = i % 6 === 0 ? 2.5 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 170, cy + Math.sin(a) * 170);
      ctx.lineTo(cx + Math.cos(a) * 476, cy + Math.sin(a) * 476);
      ctx.stroke();
    }

    // Engraved hexagram / astrolabe geometry
    for (let rot = 0; rot < 2; rot++) {
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.26)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let v = 0; v <= 3; v++) {
        const a = (v / 3) * Math.PI * 2 + (rot * Math.PI) / 3;
        const x = cx + Math.cos(a) * 340;
        const y = cy + Math.sin(a) * 340;
        if (v === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createBrushedBrassRoughnessTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      const shade = 45 + ((y * 37) % 45);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(0, y, size, 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.needsUpdate = true;
  return texture;
}

export function createSoftGlowSpriteTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const cx = size / 2;
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.28, 'rgba(224, 242, 254, 0.72)');
    g.addColorStop(0.65, 'rgba(56, 189, 248, 0.18)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// 3. Zero-Allocation Procedural Lightning / Energy Arc Updater
// ---------------------------------------------------------------------------

/**
 * Updates a pre-allocated Float32Array of LineSegments vertices (`arcCount * segmentsPerArc * 6`)
 * representing crackling plasma filaments from the inner core singularity toward orbital anchor points.
 */
export function updateArcSegmentsBuffer(
  positions: Float32Array,
  arcCount: number,
  segmentsPerArc: number,
  elapsedSec: number,
  intensity: number,
  radius = 1.18
): void {
  const stride = segmentsPerArc * 6;
  const jitterAmp = 0.045 + intensity * 0.095;

  for (let a = 0; a < arcCount; a++) {
    const baseOffset = a * stride;
    const phase = elapsedSec * (2.6 + a * 0.45) + a * 1.91;
    const theta = phase * 0.55 + (a / arcCount) * Math.PI * 2;
    const phi = 0.8 + Math.sin(phase * 0.7 + a) * 0.9;

    const ex = radius * Math.sin(phi) * Math.cos(theta);
    const ey = radius * Math.cos(phi) * 0.92;
    const ez = radius * Math.sin(phi) * Math.sin(theta);

    // Subtle start radius near the singularity core
    const sx = ex * 0.14;
    const sy = ey * 0.14;
    const sz = ez * 0.14;

    let prevX = sx;
    let prevY = sy;
    let prevZ = sz;

    for (let s = 0; s < segmentsPerArc; s++) {
      const t = (s + 1) / segmentsPerArc;
      const env = Math.sin(t * Math.PI); // pin endpoints, bow middle
      const n1 = Math.sin(elapsedSec * 24 + a * 7.3 + s * 3.9);
      const n2 = Math.cos(elapsedSec * 19 + a * 5.1 - s * 4.7);
      const n3 = Math.sin(elapsedSec * 29 - a * 3.7 + s * 6.1);

      const nextX = sx + (ex - sx) * t + n1 * jitterAmp * env;
      const nextY = sy + (ey - sy) * t + n2 * jitterAmp * env;
      const nextZ = sz + (ez - sz) * t + n3 * jitterAmp * env;

      const idx = baseOffset + s * 6;
      positions[idx] = prevX;
      positions[idx + 1] = prevY;
      positions[idx + 2] = prevZ;
      positions[idx + 3] = nextX;
      positions[idx + 4] = nextY;
      positions[idx + 5] = nextZ;

      prevX = nextX;
      prevY = nextY;
      prevZ = nextZ;
    }
  }
}
