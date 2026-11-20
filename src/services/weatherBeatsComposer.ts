import { DomainCategory, TelemetryEvent } from '../types/telemetry';
import { UNIVERSAL_DOMAINS } from './domainRegistry';
import { GeolocationWeatherContext } from './telemetryEngine';

export type TelemetryClusterId =
  | 'atmosphere_earth'
  | 'space_solar'
  | 'bio_agro'
  | 'energy_industry'
  | 'infra_tech'
  | 'markets_social'
  | 'sound_security';

export interface TelemetryClusterDefinition {
  id: TelemetryClusterId;
  label: string;
  dspTarget: string;
  domains: DomainCategory[];
  accentHex: string;
}

export const TELEMETRY_CLUSTERS: TelemetryClusterDefinition[] = [
  {
    id: 'atmosphere_earth',
    label: 'Atmosphere & Earth',
    dspTarget: 'Scale Root, Kora Shimmer, Djembe Sub, Reverb & Modulation',
    domains: ['weather', 'environmental', 'geographic', 'atmospheric', 'geological', 'oceanographic'],
    accentHex: '#06b6d4'
  },
  {
    id: 'space_solar',
    label: 'Space & Solar',
    dspTarget: '32-Bar Harmonic Brightness & Climax Arc',
    domains: ['solar', 'space'],
    accentHex: '#eab308'
  },
  {
    id: 'bio_agro',
    label: 'Bio & Agro',
    dspTarget: 'Kora Sympathetic Plucked Strings & Kalimba Tine Ostinato',
    domains: ['biological', 'agricultural'],
    accentHex: '#22c55e'
  },
  {
    id: 'energy_industry',
    label: 'Energy & Industry',
    dspTarget: 'Djembe Velocity, Compressor Glue & Distortion Drive',
    domains: ['energy', 'industrial', 'smart_building'],
    accentHex: '#f59e0b'
  },
  {
    id: 'infra_tech',
    label: 'Infrastructure & Tech',
    dspTarget: 'Tempo Swing, FM_MOD Index & Dotted Delay Feedback',
    domains: ['computing', 'transport', 'network', 'artificial_intelligence'],
    accentHex: '#6366f1'
  },
  {
    id: 'markets_social',
    label: 'Markets & Social',
    dspTarget: 'FM Carrier/Mod Ratio, Balafon Call-Response & Dynamics',
    domains: ['financial', 'economic', 'business', 'social_information'],
    accentHex: '#10b981'
  },
  {
    id: 'sound_security',
    label: 'Sound & Security',
    dspTarget: 'BPM, FM Feedback Spread & Saturation Edge',
    domains: ['audio', 'musical', 'security'],
    accentHex: '#f43f5e'
  }
];

export type FxSlotId = 'reverb' | 'delay' | 'filter' | 'distortion' | 'compressor' | 'modulation';

export interface FxSlotConfig {
  id: FxSlotId;
  slotNumber: 1 | 2 | 3 | 4 | 5 | 6;
  name: string;
  telemetrySource: string;
  bypass: boolean;
  telemetryLocked: boolean;
  mix: number; // 0..1
  primaryValue: number;
  primaryLabel: string;
  primaryUnit: string;
  primaryMin: number;
  primaryMax: number;
  secondaryValue: number;
  secondaryLabel: string;
  secondaryUnit: string;
  secondaryMin: number;
  secondaryMax: number;
}

export interface FmSynthParams {
  carrierHz: number;
  modRatio: number;
  fmModIndex: number; // 0.05..2.0 (infographic shows FM_MOD: 0.75)
  feedback: number;   // 0..1
  decaySec: number;   // 0.08..0.85
  density: number;    // 0..1
}

export type NativeVoiceId = 'kora' | 'djembe' | 'kalimba' | 'balafon';
export type SynthVoiceId = NativeVoiceId | 'fm';

export interface VoiceNoteEvent {
  step: number; // 0..15 inside a bar
  voice: SynthVoiceId;
  midiNote: number;
  velocity: number; // 0..1
  durationSec: number;
  pitchBendSemitones?: number;
}

export type BarSectionName = 'Intro' | 'Groove' | 'Poly-Build' | 'Climax' | 'Breakdown' | 'Outro';

export interface CompositionBar {
  barIndex: number; // 0..31 (Display 01..32)
  section: BarSectionName;
  energy: number; // 0..1
  filterCutoffNorm: number; // 0..1
  fmIndexScale: number; // 0.5..1.5
  events: VoiceNoteEvent[];
}

export interface Composition32BarPlan {
  bpm: number;
  rootMidi: number;
  scaleName: string;
  scaleIntervals: number[];
  swing: number; // 0..0.18
  bars: CompositionBar[];
  fmParams: FmSynthParams;
  fxRack: FxSlotConfig[];
  telemetrySignature: string;
}

export interface ClusterOverrideMap {
  [clusterId: string]: {
    locked: boolean;
    value: number; // 0..1
  };
}

export interface NormalizedDomainReading {
  domain: DomainCategory;
  name: string;
  rawValue: number;
  unit: string;
  normalized: number; // 0..1
  colorHex: string;
}

const DOMAIN_RANGES: Record<DomainCategory, [number, number]> = {
  weather: [-10, 40],
  environmental: [0, 80],
  geographic: [-90, 90],
  energy: [200, 700],
  computing: [0, 100],
  audio: [-48, 0],
  musical: [80, 150],
  atmospheric: [980, 1040],
  geological: [0, 3],
  oceanographic: [0, 5],
  solar: [100, 1050],
  space: [0, 8],
  biological: [0.3, 1.0],
  agricultural: [10, 65],
  industrial: [0, 7],
  smart_building: [20, 280],
  transport: [10, 90],
  network: [5, 70],
  financial: [5, 35],
  economic: [1, 5],
  business: [100, 600],
  social_information: [-1, 1],
  artificial_intelligence: [40, 260],
  security: [0, 80]
};

const SCALES: Array<{ name: string; intervals: number[] }> = [
  { name: 'Kora Pentatonic Minor', intervals: [0, 3, 5, 7, 10] },
  { name: 'West African Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'Mbira Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'Sahel Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] }
];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function computeDomainVector24(
  latestByDomain: Partial<Record<DomainCategory, TelemetryEvent>>,
  weatherCtx: GeolocationWeatherContext,
  overrides?: ClusterOverrideMap
): Record<DomainCategory, NormalizedDomainReading> {
  const allDomains = Object.keys(UNIVERSAL_DOMAINS) as DomainCategory[];
  const result = {} as Record<DomainCategory, NormalizedDomainReading>;

  for (const domain of allDomains) {
    const meta = UNIVERSAL_DOMAINS[domain];
    const evt = latestByDomain[domain];
    let rawValue = 0;
    let unit = meta.primaryUnit.split('/')[0].trim();

    if (evt && typeof evt.measurement.value === 'number') {
      rawValue = evt.measurement.value;
      unit = evt.measurement.unit || unit;
    } else if (domain === 'weather') {
      rawValue = weatherCtx.temperatureC;
      unit = '°C';
    } else if (domain === 'environmental') {
      rawValue = weatherCtx.pm25UgM3;
      unit = 'µg/m³';
    } else if (domain === 'atmospheric') {
      rawValue = weatherCtx.pressureHpa;
      unit = 'hPa';
    } else {
      const [minVal, maxVal] = DOMAIN_RANGES[domain];
      rawValue = (minVal + maxVal) * 0.5;
    }

    const [minVal, maxVal] = DOMAIN_RANGES[domain];
    let normalized = clamp01((rawValue - minVal) / Math.max(0.0001, maxVal - minVal));

    // Apply cluster override if locked
    if (overrides) {
      const cluster = TELEMETRY_CLUSTERS.find(c => c.domains.includes(domain));
      if (cluster && overrides[cluster.id]?.locked) {
        normalized = clamp01(overrides[cluster.id].value);
      }
    }

    result[domain] = {
      domain,
      name: meta.name,
      rawValue: Number(rawValue.toFixed(2)),
      unit,
      normalized: Number(normalized.toFixed(3)),
      colorHex: meta.colorHex
    };
  }

  return result;
}

export function deriveDefaultFxRack(
  vector: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext
): FxSlotConfig[] {
  const humNorm = clamp01(weatherCtx.humidityPct / 100);
  const windNorm = clamp01(weatherCtx.windSpeedMs / 20);
  const atmNorm = vector.atmospheric.normalized;
  const netNorm = vector.network.normalized;
  const envNorm = vector.environmental.normalized;
  const indNorm = vector.industrial.normalized;
  const secNorm = vector.security.normalized;
  const bizNorm = vector.business.normalized;
  const engNorm = vector.energy.normalized;
  const ocnNorm = vector.oceanographic.normalized;

  return [
    {
      id: 'reverb',
      slotNumber: 1,
      name: 'Reverb',
      telemetrySource: 'Atmospheric · Humidity',
      bypass: false,
      telemetryLocked: true,
      mix: Number((0.18 + humNorm * 0.34).toFixed(2)),
      primaryValue: Number((1.2 + atmNorm * 2.6).toFixed(2)),
      primaryLabel: 'Decay',
      primaryUnit: 's',
      primaryMin: 0.4,
      primaryMax: 4.5,
      secondaryValue: Number((0.25 + humNorm * 0.55).toFixed(2)),
      secondaryLabel: 'Damping',
      secondaryUnit: '',
      secondaryMin: 0.1,
      secondaryMax: 0.95
    },
    {
      id: 'delay',
      slotNumber: 2,
      name: 'Delay',
      telemetrySource: 'Network Latency · Jitter',
      bypass: false,
      telemetryLocked: true,
      mix: Number((0.16 + netNorm * 0.28).toFixed(2)),
      primaryValue: Math.round(180 + netNorm * 260),
      primaryLabel: 'Time',
      primaryUnit: 'ms',
      primaryMin: 80,
      primaryMax: 650,
      secondaryValue: Number((0.2 + netNorm * 0.42).toFixed(2)),
      secondaryLabel: 'Feedback',
      secondaryUnit: '',
      secondaryMin: 0.05,
      secondaryMax: 0.78
    },
    {
      id: 'filter',
      slotNumber: 3,
      name: 'Filter',
      telemetrySource: 'Env PM2.5 · AQI',
      bypass: false,
      telemetryLocked: true,
      mix: 1.0,
      primaryValue: Math.round(8500 - envNorm * 5800),
      primaryLabel: 'Cutoff',
      primaryUnit: 'Hz',
      primaryMin: 600,
      primaryMax: 12000,
      secondaryValue: Number((0.9 + envNorm * 3.8).toFixed(2)),
      secondaryLabel: 'Resonance',
      secondaryUnit: 'Q',
      secondaryMin: 0.5,
      secondaryMax: 8.0
    },
    {
      id: 'distortion',
      slotNumber: 4,
      name: 'Distortion',
      telemetrySource: 'Industrial · Security',
      bypass: false,
      telemetryLocked: true,
      mix: Number((0.1 + ((indNorm + secNorm) * 0.5) * 0.35).toFixed(2)),
      primaryValue: Number((1.2 + ((indNorm + secNorm) * 0.5) * 14).toFixed(1)),
      primaryLabel: 'Drive',
      primaryUnit: 'dB',
      primaryMin: 0,
      primaryMax: 24,
      secondaryValue: Number((0.45 + indNorm * 0.45).toFixed(2)),
      secondaryLabel: 'Tone',
      secondaryUnit: '',
      secondaryMin: 0.1,
      secondaryMax: 1.0
    },
    {
      id: 'compressor',
      slotNumber: 5,
      name: 'Compressor',
      telemetrySource: 'Business · Energy Grid',
      bypass: false,
      telemetryLocked: true,
      mix: 1.0,
      primaryValue: Number((-12 - ((bizNorm + engNorm) * 0.5) * 16).toFixed(1)),
      primaryLabel: 'Threshold',
      primaryUnit: 'dB',
      primaryMin: -36,
      primaryMax: -4,
      secondaryValue: Number((2.5 + engNorm * 5.5).toFixed(1)),
      secondaryLabel: 'Ratio',
      secondaryUnit: ':1',
      secondaryMin: 1.5,
      secondaryMax: 12.0
    },
    {
      id: 'modulation',
      slotNumber: 6,
      name: 'Modulation',
      telemetrySource: 'Wind Speed · Ocean',
      bypass: false,
      telemetryLocked: true,
      mix: Number((0.15 + ((windNorm + ocnNorm) * 0.5) * 0.4).toFixed(2)),
      primaryValue: Number((0.35 + windNorm * 3.8).toFixed(2)),
      primaryLabel: 'Rate',
      primaryUnit: 'Hz',
      primaryMin: 0.1,
      primaryMax: 6.0,
      secondaryValue: Number((0.002 + ocnNorm * 0.008).toFixed(4)),
      secondaryLabel: 'Depth',
      secondaryUnit: 's',
      secondaryMin: 0.0005,
      secondaryMax: 0.015
    }
  ];
}

export function deriveFmParams(
  vector: Record<DomainCategory, NormalizedDomainReading>
): FmSynthParams {
  const cpuNorm = vector.computing.normalized;
  const aiNorm = vector.artificial_intelligence.normalized;
  const finNorm = vector.financial.normalized;
  const ecoNorm = vector.economic.normalized;
  const audNorm = vector.audio.normalized;

  const modRatios = [1.0, 1.5, 2.0, 1.414, 3.0];
  const ratioIdx = Math.min(modRatios.length - 1, Math.floor(finNorm * modRatios.length));

  return {
    carrierHz: Math.round(130 + ecoNorm * 190),
    modRatio: modRatios[ratioIdx],
    fmModIndex: Number((0.45 + ((cpuNorm + aiNorm) * 0.5) * 1.15).toFixed(2)),
    feedback: Number((0.12 + audNorm * 0.45).toFixed(2)),
    decaySec: Number((0.22 + (1 - finNorm) * 0.38).toFixed(2)),
    density: Number((0.35 + aiNorm * 0.55).toFixed(2))
  };
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function getSectionForBar(barIndex: number): BarSectionName {
  if (barIndex < 4) return 'Intro';
  if (barIndex < 12) return 'Groove';
  if (barIndex < 20) return 'Poly-Build';
  if (barIndex < 26) return 'Climax';
  if (barIndex < 30) return 'Breakdown';
  return 'Outro';
}

function sectionEnergyBase(section: BarSectionName): number {
  switch (section) {
    case 'Intro': return 0.34;
    case 'Groove': return 0.65;
    case 'Poly-Build': return 0.80;
    case 'Climax': return 0.98;
    case 'Breakdown': return 0.45;
    case 'Outro': return 0.30;
  }
}

export function build32BarComposition(
  vector: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext,
  overrideFm?: Partial<FmSynthParams>,
  overrideFx?: FxSlotConfig[]
): Composition32BarPlan {
  const bpm = Math.round(
    94 + vector.musical.normalized * 26 + vector.transport.normalized * 14
  );

  const scaleIndex = Math.floor(
    ((vector.weather.normalized + vector.geographic.normalized) * 0.5) * SCALES.length
  ) % SCALES.length;
  const chosenScale = SCALES[scaleIndex];

  const rootOffsets = [48, 50, 52, 53, 55, 57]; // C3..A3
  const rootMidi = rootOffsets[Math.floor(vector.weather.normalized * rootOffsets.length) % rootOffsets.length];
  const swing = Number((0.02 + vector.transport.normalized * 0.08).toFixed(3));

  const fmParams: FmSynthParams = {
    ...deriveFmParams(vector),
    ...(overrideFm || {})
  };

  const fxRack: FxSlotConfig[] = overrideFx
    ? overrideFx.map(slot => ({ ...slot }))
    : deriveDefaultFxRack(vector, weatherCtx);

  const koraDensity = 0.4 + ((vector.biological.normalized + vector.weather.normalized) * 0.5) * 0.55;
  const djembeDrive = 0.45 + ((vector.geological.normalized + vector.energy.normalized) * 0.5) * 0.55;
  const kalimbaPulse = 0.35 + ((vector.oceanographic.normalized + vector.agricultural.normalized) * 0.5) * 0.55;
  const balafonDrive = 0.3 + ((vector.smart_building.normalized + vector.social_information.normalized) * 0.5) * 0.6;
  const solarLift = (vector.solar.normalized + vector.space.normalized) * 0.5;

  const bars: CompositionBar[] = [];

  for (let b = 0; b < 32; b++) {
    const section = getSectionForBar(b);
    const baseEnergy = sectionEnergyBase(section);
    const barWave = Math.sin((b / 32) * Math.PI * 4 + solarLift * Math.PI) * 0.08;
    const energy = clamp01(baseEnergy + barWave);
    const events: VoiceNoteEvent[] = [];

    const scaleLen = chosenScale.intervals.length;
    const stepBeatSec = 60 / bpm / 4; // 16th note duration

    for (let step = 0; step < 16; step++) {
      // Deterministic pseudo-random selector per (bar, step, domain seed)
      const seed = Math.abs(Math.sin((b + 1) * 17.31 + (step + 1) * 7.91 + solarLift * 5.3));

      // 1. Kora (21-string harp arpeggios, shimmering upper octaves)
      const isKoraBeat = (step % 2 === 0 || (section === 'Poly-Build' || section === 'Climax')) && seed < koraDensity;
      if (isKoraBeat && section !== 'Outro') {
        const degree = (b * 3 + step + Math.floor(vector.biological.normalized * 5)) % scaleLen;
        const octave = (step % 4 === 0 ? 24 : 12);
        events.push({
          step,
          voice: 'kora',
          midiNote: rootMidi + octave + chosenScale.intervals[degree],
          velocity: clamp01(0.45 + energy * 0.42),
          durationSec: stepBeatSec * 2.4
        });
      }

      // 2. Djembe & Talking Drum (Afro-polyrhythmic 3:2 / 4:3 groove)
      const isDownbeat = step % 4 === 0;
      const isPolySlap = step === 3 || step === 6 || step === 10 || step === 14;
      if (section !== 'Intro' || step % 8 === 0) {
        if (isDownbeat || (isPolySlap && seed < djembeDrive && section !== 'Breakdown')) {
          const isBass = step === 0 || step === 8;
          events.push({
            step,
            voice: 'djembe',
            midiNote: isBass ? rootMidi - 12 : rootMidi - 5,
            velocity: clamp01((isBass ? 0.85 : 0.62) * (0.65 + energy * 0.35)),
            durationSec: isBass ? 0.32 : 0.18,
            pitchBendSemitones: isBass ? -5 : (step === 14 ? 4.5 : -2.5)
          });
        }
      }

      // 3. Kalimba / Mbira (cyclical thumb-piano motif)
      if ((step % 3 === 0 || (step === 11 && b % 2 === 1)) && seed < kalimbaPulse + 0.18) {
        const degree = (step + b) % scaleLen;
        events.push({
          step,
          voice: 'kalimba',
          midiNote: rootMidi + 12 + chosenScale.intervals[degree],
          velocity: clamp01(0.42 + energy * 0.35),
          durationSec: stepBeatSec * 1.8
        });
      }

      // 4. Balafon (wooden marimba syncopated stabs in Groove / Poly-Build / Climax)
      if ((section === 'Groove' || section === 'Poly-Build' || section === 'Climax') && (step === 2 || step === 6 || step === 12) && seed < balafonDrive + 0.25) {
        const degree = (b + step * 2) % scaleLen;
        events.push({
          step,
          voice: 'balafon',
          midiNote: rootMidi + chosenScale.intervals[degree],
          velocity: clamp01(0.5 + energy * 0.4),
          durationSec: stepBeatSec * 1.5
        });
      }

      // 5. FM Synthesis (atmospheric bass/lead harmonics driven by Computing/AI/Markets)
      const fmTrigger =
        (section === 'Breakdown' && step % 8 === 0) ||
        (section === 'Intro' && step === 0 && b % 2 === 0) ||
        ((section === 'Groove' || section === 'Poly-Build' || section === 'Climax') &&
          (step === 0 || step === 6 || step === 10 || (section === 'Climax' && step === 14)) &&
          seed < fmParams.density + 0.35);

      if (fmTrigger) {
        const degree = (b + Math.floor(step / 2)) % scaleLen;
        const octave = section === 'Climax' && step === 14 ? 12 : 0;
        events.push({
          step,
          voice: 'fm',
          midiNote: rootMidi + octave + chosenScale.intervals[degree],
          velocity: clamp01(0.48 + energy * 0.45),
          durationSec: Math.max(0.14, fmParams.decaySec * (section === 'Breakdown' ? 1.5 : 1.0))
        });
      }
    }

    bars.push({
      barIndex: b,
      section,
      energy: Number(energy.toFixed(3)),
      filterCutoffNorm: clamp01(0.35 + energy * 0.55 + solarLift * 0.1),
      fmIndexScale: Number((0.75 + energy * 0.65).toFixed(2)),
      events
    });
  }

  const telemetrySignature = `${bpm}BPM|${chosenScale.name}|T:${weatherCtx.temperatureC.toFixed(1)}C|PM25:${weatherCtx.pm25UgM3}|FM:${fmParams.fmModIndex}`;

  return {
    bpm,
    rootMidi,
    scaleName: chosenScale.name,
    scaleIntervals: chosenScale.intervals,
    swing,
    bars,
    fmParams,
    fxRack,
    telemetrySignature
  };
}
