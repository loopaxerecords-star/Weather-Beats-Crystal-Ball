import * as THREE from 'three';

export const BACKDROP_ARC_CENTER_X = 0;
export const BACKDROP_ARC_CENTER_Y = 0.42;
export const BACKDROP_ARC_CENTER_Z = -1.78;
export const BACKDROP_ARC_RADIUS = 1.94;
export const BACKDROP_NODE_COUNT = 24;
export const BACKDROP_SPECTRUM_BARS = 32;
export const TELEMETRY_ANOMALY_DEVIATION_THRESHOLD = 0.3;

export interface TelemetryArcNodeLayout {
  index: number;
  angleRad: number;
  x: number;
  y: number;
  z: number;
  barLength: number;
  nodeScale: number;
  isAnomaly: boolean;
  anomalySeverity: number; // 0..1
  isHighlighted: boolean;
}

export interface CelestialBackdropSignals {
  energy: number;
  bassEnergy: number;
  micEnergy: number;
  speakingEnergy: number;
  beatImpulse: number;
  domainNorms: number[];
  domainColors: string[];
  focusedIndex: number;
  hoveredIndex: number;
  fftSpectrum32: Float32Array;
  orbColor: THREE.Color;
  accentColor: THREE.Color;
  reducedMotion: boolean;
  animationWeight?: number;
}

export interface CelestialBackdropHandle {
  group: THREE.Group;
  interactiveNodesMesh: THREE.InstancedMesh;
  nodeWorldPositions: THREE.Vector3[];
  anomalyFlags: boolean[];
  update: (elapsed: number, delta: number, signals: CelestialBackdropSignals) => void;
  dispose: () => void;
}

/**
 * Pure deterministic layout & anomaly classifier for the 24-domain celestial telemetry arch
 * positioned behind the Hooded Celestial Seer and Crystal Ball.
 * Separates spatial math & anomaly detection from WebGL so it is cleanly unit-testable and zero-GC.
 */
export function computeTelemetryArcNodes(
  domainNorms: readonly number[],
  focusedIndex: number,
  hoveredIndex: number,
  out?: TelemetryArcNodeLayout[]
): TelemetryArcNodeLayout[] {
  const result: TelemetryArcNodeLayout[] =
    out && out.length === BACKDROP_NODE_COUNT
      ? out
      : Array.from({ length: BACKDROP_NODE_COUNT }, (_, idx) => ({
          index: idx,
          angleRad: 0,
          x: 0,
          y: 0,
          z: 0,
          barLength: 0.2,
          nodeScale: 1,
          isAnomaly: false,
          anomalySeverity: 0,
          isHighlighted: false
        }));

  // Sweeps symmetrically from right-low (-12 deg) over the top crown (90 deg) to left-low (192 deg)
  const startAngle = -Math.PI * 0.065;
  const endAngle = Math.PI * 1.065;
  const span = endAngle - startAngle;
  const activeHighlight = hoveredIndex >= 0 ? hoveredIndex : focusedIndex;

  for (let i = 0; i < BACKDROP_NODE_COUNT; i++) {
    const rawNorm = domainNorms[i];
    const norm = Math.max(0, Math.min(1, Number.isFinite(rawNorm) ? rawNorm : 0.5));
    const t = i / (BACKDROP_NODE_COUNT - 1);
    const angleRad = startAngle + t * span;

    const deviation = Math.abs(norm - 0.5);
    const isAnomaly = deviation >= TELEMETRY_ANOMALY_DEVIATION_THRESHOLD;
    const anomalySeverity = isAnomaly
      ? Math.min(1, (deviation - TELEMETRY_ANOMALY_DEVIATION_THRESHOLD) / (0.5 - TELEMETRY_ANOMALY_DEVIATION_THRESHOLD))
      : 0;

    const isHighlighted = i === activeHighlight;
    const radialBoost = (isAnomaly ? 0.12 + anomalySeverity * 0.14 : 0) + (isHighlighted ? 0.1 : 0);
    const radius = BACKDROP_ARC_RADIUS + radialBoost;

    const item = result[i];
    item.index = i;
    item.angleRad = angleRad;
    item.x = Math.cos(angleRad) * radius;
    item.y = Math.sin(angleRad) * radius;
    item.z = isHighlighted ? 0.14 : isAnomaly ? 0.07 : 0;
    item.barLength = 0.18 + norm * 0.42 + (isAnomaly ? 0.16 : 0) + (isHighlighted ? 0.1 : 0);
    item.nodeScale = (0.85 + norm * 0.35) * (isHighlighted ? 1.55 : isAnomaly ? 1.24 : 1.0);
    item.isAnomaly = isAnomaly;
    item.anomalySeverity = Number(anomalySeverity.toFixed(3));
    item.isHighlighted = isHighlighted;
  }

  return result;
}

/**
 * Generates a crisp procedural high-resolution engraved celestial telemetry dial arch texture
 * with degree ticks, 24 domain sector hairlines, and astronomical glyphs.
 */
function createCelestialDialArchTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;

    // Subtle luminous celestial arc band
    const startA = -Math.PI * 1.07;
    const endA = Math.PI * 0.07;

    ctx.save();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.46)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.455, startA, endA);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.36)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.415, startA, endA);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(251, 191, 36, 0.24)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.345, startA, endA);
    ctx.stroke();

    // 72 fine astrolabe degree ticks along the upper arch
    const totalTicks = 72;
    for (let i = 0; i <= totalTicks; i++) {
      const t = i / totalTicks;
      const ang = Math.PI + Math.PI * 0.065 - t * (Math.PI * 1.13);
      const isMajor = i % 3 === 0;
      const r0 = size * (isMajor ? 0.398 : 0.41);
      const r1 = size * (isMajor ? 0.456 : 0.435);
      ctx.strokeStyle = isMajor ? 'rgba(253, 224, 71, 0.72)' : 'rgba(125, 211, 252, 0.32)';
      ctx.lineWidth = isMajor ? 2.2 : 1.1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy - Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy - Math.sin(ang) * r1);
      ctx.stroke();
    }

    // 24 engraved celestial numerals/glyph markers along the inner rim
    const glyphs = ['☉', '☽', '☿', '♀', '♂', '♃', '♄', '✧', '△', '◇', '○', '✦'];
    ctx.fillStyle = 'rgba(254, 243, 199, 0.76)';
    ctx.font = '600 18px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < BACKDROP_NODE_COUNT; i++) {
      const t = i / (BACKDROP_NODE_COUNT - 1);
      const ang = -Math.PI * 0.065 + t * (Math.PI * 1.13);
      const rGlyph = size * 0.372;
      const gx = cx + Math.cos(ang) * rGlyph;
      const gy = cy - Math.sin(ang) * rGlyph;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(Math.PI * 0.5 - ang);
      ctx.fillText(glyphs[i % glyphs.length], 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface BuildCelestialBackdropOptions {
  maxAnisotropy: number;
  isSoftwareGl: boolean;
  brassMat: THREE.Material;
  goldMat: THREE.Material;
  glowSpriteTex: THREE.Texture;
}

/**
 * Builds the glowing 3D celestial 24-domain telemetry arc, dynamic anomaly markers,
 * and concentric 32-band radial audio spectrum halo positioned behind the Seer & Crystal Ball.
 */
export function buildCelestialBackdropUi(
  options: BuildCelestialBackdropOptions
): CelestialBackdropHandle {
  const { maxAnisotropy, brassMat, goldMat, glowSpriteTex } = options;

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

  const group = new THREE.Group();
  group.position.set(BACKDROP_ARC_CENTER_X, BACKDROP_ARC_CENTER_Y, BACKDROP_ARC_CENTER_Z);

  // 1. Sculpted Celestial Brass Astrolabe Arch Rails framing the 24-Domain Arc
  const arcStart = -Math.PI * 0.08;
  const arcLength = Math.PI * 1.16;

  const outerRailGeo = trackGeo(new THREE.TorusGeometry(BACKDROP_ARC_RADIUS + 0.16, 0.022, 14, 96, arcLength));
  const outerRail = new THREE.Mesh(outerRailGeo, goldMat);
  outerRail.rotation.z = arcStart;
  group.add(outerRail);

  const innerRailGeo = trackGeo(new THREE.TorusGeometry(BACKDROP_ARC_RADIUS - 0.24, 0.014, 12, 96, arcLength));
  const innerRail = new THREE.Mesh(innerRailGeo, brassMat);
  innerRail.rotation.z = arcStart;
  group.add(innerRail);

  // Luminous translucent astral dial plane with procedural engraved degree markings
  const dialTex = trackTex(createCelestialDialArchTexture());
  dialTex.anisotropy = maxAnisotropy;
  const dialGeo = trackGeo(new THREE.PlaneGeometry(4.7, 4.7));
  const dialMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: dialTex,
      color: '#dec99b',
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  const dialPlane = new THREE.Mesh(dialGeo, dialMat);
  dialPlane.position.z = -0.04;
  dialPlane.renderOrder = 1;
  group.add(dialPlane);

  // Soft celestial moonlight aura sprite nestled behind the Seer's halo (calm, non-neon)
  const backdropGlowMat = trackMat(
    new THREE.SpriteMaterial({
      map: glowSpriteTex,
      color: '#7c8ba1',
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  const backdropGlow = new THREE.Sprite(backdropGlowMat);
  backdropGlow.position.set(0, 0.12, -0.26);
  backdropGlow.scale.set(4.3, 3.85, 1);
  group.add(backdropGlow);

  // 2. 24-Domain Instanced Radial Telemetry Gauge Bars
  const barGeo = trackGeo(new THREE.BoxGeometry(0.034, 1.0, 0.02));
  const barMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      emissive: '#475569',
      emissiveIntensity: 0.22,
      roughness: 0.36,
      metalness: 0.52
    })
  );
  const gaugeBarsInstanced = new THREE.InstancedMesh(barGeo, barMat, BACKDROP_NODE_COUNT);
  gaugeBarsInstanced.frustumCulled = false;
  group.add(gaugeBarsInstanced);

  // 3. 24 Interactive Hoverable & Clickable Domain Telemetry Nodes
  const nodeGeo = trackGeo(new THREE.OctahedronGeometry(0.084, 0));
  const nodeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      emissive: '#64748b',
      emissiveIntensity: 0.28,
      roughness: 0.28,
      metalness: 0.56
    })
  );
  const interactiveNodesMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, BACKDROP_NODE_COUNT);
  interactiveNodesMesh.frustumCulled = false;
  group.add(interactiveNodesMesh);

  // 4. Dynamic Anomaly Beacon Rings & Flare Spikes (restrained brass/amber, zero neon strobe)
  const anomalyRingGeo = trackGeo(new THREE.TorusGeometry(0.142, 0.014, 10, 24));
  const anomalyRingMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#c98a3a',
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  const anomalyRingsInstanced = new THREE.InstancedMesh(
    anomalyRingGeo,
    anomalyRingMat,
    BACKDROP_NODE_COUNT
  );
  anomalyRingsInstanced.frustumCulled = false;
  group.add(anomalyRingsInstanced);

  const anomalySpikeGeo = trackGeo(new THREE.ConeGeometry(0.028, 0.3, 6));
  const anomalySpikeMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#d49a4c',
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  const anomalySpikesInstanced = new THREE.InstancedMesh(
    anomalySpikeGeo,
    anomalySpikeMat,
    BACKDROP_NODE_COUNT
  );
  anomalySpikesInstanced.frustumCulled = false;
  group.add(anomalySpikesInstanced);

  // 5. Concentric 32-Band Radial Audio Spectrum Halo nestled behind the Seer (dormant before Stage 5)
  const specBarGeo = trackGeo(new THREE.BoxGeometry(0.024, 1.0, 0.016));
  const specBarMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#b8c4d4',
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  const spectrumInstanced = new THREE.InstancedMesh(
    specBarGeo,
    specBarMat,
    BACKDROP_SPECTRUM_BARS
  );
  spectrumInstanced.frustumCulled = false;
  spectrumInstanced.position.z = -0.06;
  group.add(spectrumInstanced);

  // Pre-allocated zero-GC scratch objects & world coordinate cache
  const layoutCache = computeTelemetryArcNodes(new Array(BACKDROP_NODE_COUNT).fill(0.5), -1, -1);
  const nodeWorldPositions = Array.from({ length: BACKDROP_NODE_COUNT }, () => new THREE.Vector3());
  const anomalyFlags = new Array<boolean>(BACKDROP_NODE_COUNT).fill(false);
  const smoothedSpectrum = new Float32Array(BACKDROP_SPECTRUM_BARS);
  const _dummy = new THREE.Object3D();
  const _colorA = new THREE.Color();
  const _colorAnomaly = new THREE.Color('#fb7185');
  const _colorAmber = new THREE.Color('#fbbf24');
  const _specColor = new THREE.Color();

  let colorsInitialized = false;
  let stageClock = 0;

  const update = (_elapsed: number, delta: number, signals: CelestialBackdropSignals) => {
    const motionMul = signals.reducedMotion ? 0.12 : 1.0;
    const animWeight = signals.animationWeight !== undefined ? Math.max(0, Math.min(1, signals.animationWeight)) : 1;
    stageClock += delta * motionMul * animWeight;
    const t = stageClock;

    computeTelemetryArcNodes(
      signals.domainNorms,
      signals.focusedIndex,
      signals.hoveredIndex,
      layoutCache
    );

    // Calm atmospheric sheen behind the Seer & arch (zero neon flashing)
    backdropGlowMat.color.copy(signals.orbColor).lerp(signals.accentColor, 0.35 + signals.speakingEnergy * 0.15 * animWeight);
    backdropGlowMat.opacity = THREE.MathUtils.damp(
      backdropGlowMat.opacity,
      0.04 + (signals.energy * 0.03 + signals.speakingEnergy * 0.04) * animWeight,
      3.5,
      delta
    );
    const glowScale = 4.3 + signals.speakingEnergy * 0.15 * animWeight;
    backdropGlow.scale.set(glowScale, glowScale * 0.9, 1);

    dialMat.opacity = THREE.MathUtils.damp(
      dialMat.opacity,
      0.28 + (signals.energy * 0.05 + signals.speakingEnergy * 0.04) * animWeight,
      3.5,
      delta
    );

    anomalyRingMat.opacity = THREE.MathUtils.damp(anomalyRingMat.opacity, 0.12 + 0.22 * animWeight, 4.0, delta);
    anomalySpikeMat.opacity = THREE.MathUtils.damp(anomalySpikeMat.opacity, 0.1 + 0.18 * animWeight, 4.0, delta);
    specBarMat.opacity = THREE.MathUtils.damp(specBarMat.opacity, 0.04 + 0.24 * animWeight, 4.0, delta);

    // Ensure group world matrix is up to date for projected hover readouts
    group.updateMatrixWorld(false);

    // Update 24 telemetry gauge bars, interactive diamond nodes, and dynamic anomaly markers
    for (let i = 0; i < BACKDROP_NODE_COUNT; i++) {
      const node = layoutCache[i];
      const cosA = Math.cos(node.angleRad);
      const sinA = Math.sin(node.angleRad);
      anomalyFlags[i] = node.isAnomaly;

      // Interactive diamond node along the celestial arch (still before Stage 5)
      _dummy.position.set(node.x, node.y, node.z);
      _dummy.rotation.set(t * 0.48 + i * 0.4, t * 0.62, node.angleRad - Math.PI * 0.5);
      const pulse = 1 + (node.isHighlighted ? 0.08 * Math.sin(t * 3.2) * animWeight : 0);
      const ns = node.nodeScale * pulse;
      _dummy.scale.set(ns, ns * 1.24, ns);
      _dummy.updateMatrix();
      interactiveNodesMesh.setMatrixAt(i, _dummy.matrix);

      // Cache world position for accurate screen-space hover tooltip projection
      nodeWorldPositions[i]
        .set(node.x, node.y, node.z)
        .applyMatrix4(group.matrixWorld);

      // Radial telemetry gauge bar extending outward from inner arch rail
      const barBaseR = BACKDROP_ARC_RADIUS - 0.18;
      const barMidR = barBaseR + node.barLength * 0.5;
      _dummy.position.set(cosA * barMidR, sinA * barMidR, -0.02);
      _dummy.rotation.set(0, 0, node.angleRad - Math.PI * 0.5);
      _dummy.scale.set(node.isHighlighted ? 1.4 : 1.0, node.barLength, 1.0);
      _dummy.updateMatrix();
      gaugeBarsInstanced.setMatrixAt(i, _dummy.matrix);

      // Per-domain color with subtle warm amber shift on anomalies
      _colorA.set(signals.domainColors[i] || '#38bdf8');
      if (node.isAnomaly) {
        _colorA.lerp(_colorAmber, 0.3 + node.anomalySeverity * 0.3);
      }
      if (!colorsInitialized || node.isAnomaly || node.isHighlighted) {
        interactiveNodesMesh.setColorAt(i, _colorA);
        gaugeBarsInstanced.setColorAt(i, _colorA);
      }

      // Dynamic Anomaly Marker Beacon Ring + Outward Flare Spike (calm, no beat flash)
      if (node.isAnomaly) {
        const ringPulse = 0.94 + Math.sin(t * 2.4 + i) * 0.08 * animWeight + node.anomalySeverity * 0.18;
        _dummy.position.set(node.x, node.y, node.z + 0.02);
        _dummy.rotation.set(0, 0, t * 0.9 + i);
        _dummy.scale.set(ringPulse, ringPulse, ringPulse);
        _dummy.updateMatrix();
        anomalyRingsInstanced.setMatrixAt(i, _dummy.matrix);

        _colorA.copy(_colorAmber).lerp(_colorAnomaly, node.anomalySeverity * 0.55);
        anomalyRingsInstanced.setColorAt(i, _colorA);

        const spikeR = BACKDROP_ARC_RADIUS + 0.34 + node.anomalySeverity * 0.12;
        _dummy.position.set(cosA * spikeR, sinA * spikeR, 0.04);
        _dummy.rotation.set(0, 0, node.angleRad - Math.PI * 0.5);
        const spScale = 0.72 + node.anomalySeverity * 0.45 * animWeight;
        _dummy.scale.set(0.85, spScale, 0.85);
        _dummy.updateMatrix();
        anomalySpikesInstanced.setMatrixAt(i, _dummy.matrix);
        anomalySpikesInstanced.setColorAt(i, _colorA);
      } else {
        _dummy.position.set(0, 0, -10);
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        anomalyRingsInstanced.setMatrixAt(i, _dummy.matrix);
        anomalySpikesInstanced.setMatrixAt(i, _dummy.matrix);
      }
    }

    colorsInitialized = true;
    interactiveNodesMesh.instanceMatrix.needsUpdate = true;
    gaugeBarsInstanced.instanceMatrix.needsUpdate = true;
    anomalyRingsInstanced.instanceMatrix.needsUpdate = true;
    anomalySpikesInstanced.instanceMatrix.needsUpdate = true;
    if (interactiveNodesMesh.instanceColor) interactiveNodesMesh.instanceColor.needsUpdate = true;
    if (gaugeBarsInstanced.instanceColor) gaugeBarsInstanced.instanceColor.needsUpdate = true;
    if (anomalyRingsInstanced.instanceColor) anomalyRingsInstanced.instanceColor.needsUpdate = true;
    if (anomalySpikesInstanced.instanceColor) anomalySpikesInstanced.instanceColor.needsUpdate = true;

    // 32-Band Radial Audio Spectrum Halo (flat & serene before Stage 5, smooth audio motion after)
    const specStart = -Math.PI * 0.02;
    const specSpan = Math.PI * 1.04;
    const specInnerR = 1.24;

    for (let b = 0; b < BACKDROP_SPECTRUM_BARS; b++) {
      const distFromCenter = Math.abs(b - (BACKDROP_SPECTRUM_BARS - 1) * 0.5) / ((BACKDROP_SPECTRUM_BARS - 1) * 0.5);
      const binIdx = Math.min(31, Math.floor(distFromCenter * 26));
      const fftVal = signals.fftSpectrum32[binIdx] ?? 0;
      const ambientWave =
        (0.06 +
          Math.abs(Math.sin(t * 1.6 + b * 0.42)) * (0.08 + signals.energy * 0.12) +
          signals.speakingEnergy * (0.24 * (1 - distFromCenter * 0.5)) +
          signals.micEnergy * 0.2) *
        animWeight;
      const targetAmp = Math.min(0.85, (fftVal * 1.05 + ambientWave) * animWeight);
      smoothedSpectrum[b] = THREE.MathUtils.damp(smoothedSpectrum[b], targetAmp, 8.0, delta);

      const amp = smoothedSpectrum[b];
      const ang = specStart + (b / (BACKDROP_SPECTRUM_BARS - 1)) * specSpan;
      const barLen = 0.05 + amp * 0.34;
      const midR = specInnerR + barLen * 0.5;

      _dummy.position.set(Math.cos(ang) * midR, Math.sin(ang) * midR, 0);
      _dummy.rotation.set(0, 0, ang - Math.PI * 0.5);
      _dummy.scale.set(0.95 + amp * 0.25, barLen, 1.0);
      _dummy.updateMatrix();
      spectrumInstanced.setMatrixAt(b, _dummy.matrix);

      _specColor.copy(signals.orbColor).lerp(signals.accentColor, Math.min(1, amp * 0.65 + signals.speakingEnergy * 0.25));
      spectrumInstanced.setColorAt(b, _specColor);
    }

    spectrumInstanced.instanceMatrix.needsUpdate = true;
    if (spectrumInstanced.instanceColor) spectrumInstanced.instanceColor.needsUpdate = true;
  };

  const dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  };

  return {
    group,
    interactiveNodesMesh,
    nodeWorldPositions,
    anomalyFlags,
    update,
    dispose
  };
}
