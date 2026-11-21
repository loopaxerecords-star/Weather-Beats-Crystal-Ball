import { DomainCategory, TelemetryEvent } from '../types/telemetry';
import { UNIVERSAL_DOMAINS } from './domainRegistry';
import { GeolocationWeatherContext } from './telemetryEngine';
import type { AiMotifProfile, SonicCharacterBias } from './aiIntelligenceSuite';

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
    dspTarget: 'Scale Root, Warm Pad Breath, Sub-Bass Weight, Reverb & Chorus',
    domains: ['weather', 'environmental', 'geographic', 'atmospheric', 'geological', 'oceanographic'],
    accentHex: '#06b6d4'
  },
  {
    id: 'space_solar',
    label: 'Space & Solar',
    dspTarget: 'Chord Brightness, Pad Shimmer & Wave Climax Arc',
    domains: ['solar', 'space'],
    accentHex: '#eab308'
  },
  {
    id: 'bio_agro',
    label: 'Bio & Agro',
    dspTarget: 'Kora Plucked Phrases & Kalimba Stereo Ostinato',
    domains: ['biological', 'agricultural'],
    accentHex: '#22c55e'
  },
  {
    id: 'energy_industry',
    label: 'Energy & Industry',
    dspTarget: 'Kick Punch, Sub Drive, Glue Compressor & Tape Saturation',
    domains: ['energy', 'industrial', 'smart_building'],
    accentHex: '#f59e0b'
  },
  {
    id: 'infra_tech',
    label: 'Infrastructure & Tech',
    dspTarget: 'Groove Swing, Hi-Hat Density, FM_MOD & Ping-Pong Delay',
    domains: ['computing', 'transport', 'network', 'artificial_intelligence'],
    accentHex: '#6366f1'
  },
  {
    id: 'markets_social',
    label: 'Markets & Social',
    dspTarget: 'Harmonic Progressions, FM Rhodes Chords & Balafon Response',
    domains: ['financial', 'economic', 'business', 'social_information'],
    accentHex: '#10b981'
  },
  {
    id: 'sound_security',
    label: 'Sound & Security',
    dspTarget: 'Emergent Tempo Momentum, FM Edge & Percussion Fills',
    domains: ['audio', 'musical', 'security'],
    accentHex: '#f43f5e'
  }
];

export interface EmergentTelemetryProfile {
  kineticDrive: number; // 0..1 continuous rhythmic forward drive
  atmosphericSpace: number; // 0..1 continuous pad/reverb spaciousness
  polyrhythmDensity: number; // 0..1 continuous kora/djembe/kalimba/balafon weave
  harmonicWarmth: number; // 0..1 continuous chord richness & Rhodes softness
  percussiveEdge: number; // 0..1 continuous transient snap, hats & FM edge
  dominantClusterId: TelemetryClusterId;
  signatureTitle: string; // e.g., "Atmospheric Drift", "Solar Polyrhythm"
  telemetrySignatureLabel: string; // e.g., "Atmospheric Drift · 108 BPM"
  accentHex: string;
}

export interface CompositionOptions {
  overrideFm?: Partial<FmSynthParams>;
  overrideFx?: FxSlotConfig[];
  bpmOffset?: number;
  characterBias?: SonicCharacterBias;
  aiMotif?: AiMotifProfile | null;
  /** Optional 0..24 local hour override for auditioning or testing a specific telemetry hour */
  hourOfDayOverride?: number;
}

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
  fmModIndex: number; // 0.05..2.0
  feedback: number;   // 0..1
  decaySec: number;   // 0.08..0.85
  density: number;    // 0..1
}

export type NativeVoiceId = 'kora' | 'djembe' | 'kalimba' | 'balafon';
export type SynthVoiceId =
  | 'pad'
  | 'sub'
  | 'kick'
  | 'perc'
  | NativeVoiceId
  | 'fm'
  | 'whisper';

export interface VoiceMixChannel {
  gain: number;   // 0..1.25
  pan: number;    // -1..1
  muted: boolean;
}

export type VoiceMixMap = Record<SynthVoiceId, VoiceMixChannel>;

export const ALL_SYNTH_VOICES: Array<{
  id: SynthVoiceId;
  label: string;
  group: 'foundation' | 'groove' | 'melodic';
  telemetryRole: string;
  defaultPan: number;
  defaultGain: number;
}> = [
  { id: 'pad', label: 'Warm Stereo Pad', group: 'foundation', telemetryRole: 'Atmosphere · Solar · Ocean', defaultPan: 0, defaultGain: 0.72 },
  { id: 'sub', label: 'Deep Sub-Bass', group: 'foundation', telemetryRole: 'Geological · Energy · Industrial', defaultPan: 0, defaultGain: 0.8 },
  { id: 'whisper', label: 'Seer Ambient Whispers', group: 'foundation', telemetryRole: '24-Domain Omens · Section Transitions', defaultPan: 0, defaultGain: 0.43 },
  { id: 'kick', label: 'Studio Kick + Duck', group: 'groove', telemetryRole: 'Energy · Musical · Security', defaultPan: 0, defaultGain: 0.78 },
  { id: 'djembe', label: 'Djembe & Talking Drum', group: 'groove', telemetryRole: 'Geological · Energy', defaultPan: -0.18, defaultGain: 0.66 },
  { id: 'perc', label: 'Stereo Hats & Shaker', group: 'groove', telemetryRole: 'Wind · Transport · Network', defaultPan: 0.24, defaultGain: 0.6 },
  { id: 'kora', label: 'Kora (21-String Harp)', group: 'melodic', telemetryRole: 'Weather · Biological', defaultPan: -0.34, defaultGain: 0.68 },
  { id: 'kalimba', label: 'Kalimba / Mbira', group: 'melodic', telemetryRole: 'Ocean · Agricultural', defaultPan: -0.48, defaultGain: 0.62 },
  { id: 'balafon', label: 'Balafon Marimba', group: 'melodic', telemetryRole: 'Smart Building · Social', defaultPan: 0.46, defaultGain: 0.62 },
  { id: 'fm', label: 'FM Rhodes & Lead', group: 'melodic', telemetryRole: 'Computing · AI · Markets', defaultPan: 0.26, defaultGain: 0.66 }
];

export interface TelemetryInstrumentMapping {
  domain: DomainCategory;
  hourOfDay: number; // 0..23 — each of the 24 telemetry trees owns its own hour of the day
  hourLabel: string; // "00:00" .. "23:00"
  circadianPhase: string; // Poetic time-of-day anchor
  instrument: string;
  voice: SynthVoiceId;
  role: string;
}

export function formatTelemetryHour(hourOfDay: number): string {
  const h = ((Math.floor(hourOfDay) % 24) + 24) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}

/**
 * Explicit 1-to-1 orchestration mapping all 24 telemetry streams (Weather + the other 23 trees)
 * to both their own dedicated instrument AND their own unique hour of the 24-hour day (00:00-23:00).
 */
export const TELEMETRY_INSTRUMENT_MAP: Record<DomainCategory, TelemetryInstrumentMapping> = {
  space: { domain: 'space', hourOfDay: 0, hourLabel: '00:00', circadianPhase: 'Deep Midnight', instrument: 'Astral Whisper Choir', voice: 'whisper', role: 'Celestial Formant Harmonics' },
  oceanographic: { domain: 'oceanographic', hourOfDay: 1, hourLabel: '01:00', circadianPhase: 'Quiet Tide', instrument: 'Tidal Sub-Pad Swell', voice: 'pad', role: 'Slow Wave Chorus & Undertow' },
  geological: { domain: 'geological', hourOfDay: 2, hourLabel: '02:00', circadianPhase: 'Earth Stillness', instrument: 'Tectonic Sub-Bass Root', voice: 'sub', role: 'Deep Grounded Fundamental' },
  atmospheric: { domain: 'atmospheric', hourOfDay: 3, hourLabel: '03:00', circadianPhase: 'Night Barometer', instrument: 'Warm Analog Stereo Pad', voice: 'pad', role: 'Harmonic Breath & Hall Air' },
  environmental: { domain: 'environmental', hourOfDay: 4, hourLabel: '04:00', circadianPhase: 'Pre-Dawn Air', instrument: 'Spectral Resonant Filter', voice: 'pad', role: 'Air-Clarity Timbre Opening' },
  weather: { domain: 'weather', hourOfDay: 5, hourLabel: '05:00', circadianPhase: 'Dawn Sky', instrument: '21-String Kora Harp', voice: 'kora', role: 'Primary Melody & Modal Root' },
  biological: { domain: 'biological', hourOfDay: 6, hourLabel: '06:00', circadianPhase: 'Morning Chorus', instrument: 'Kora Counter-Pluck', voice: 'kora', role: 'Organic Interlocking Melody' },
  agricultural: { domain: 'agricultural', hourOfDay: 7, hourLabel: '07:00', circadianPhase: 'First Dew', instrument: 'Kalimba / Mbira Tines', voice: 'kalimba', role: 'Wooden Stereo Ostinato' },
  transport: { domain: 'transport', hourOfDay: 8, hourLabel: '08:00', circadianPhase: 'Morning Transit', instrument: 'Organic Woven Shaker', voice: 'perc', role: 'Forward Swing & Flow Momentum' },
  financial: { domain: 'financial', hourOfDay: 9, hourLabel: '09:00', circadianPhase: 'Market Open', instrument: 'FM Bell Arpeggio', voice: 'fm', role: 'Crystalline Melodic Contours' },
  economic: { domain: 'economic', hourOfDay: 10, hourLabel: '10:00', circadianPhase: 'Trade Pulse', instrument: 'FM Carrier Harmonic Body', voice: 'fm', role: 'Tonal Weight & Sustain' },
  business: { domain: 'business', hourOfDay: 11, hourLabel: '11:00', circadianPhase: 'Midday Cadence', instrument: 'Djembe Bass Tone', voice: 'djembe', role: 'Grounded Hand-Drum Pulse' },
  solar: { domain: 'solar', hourOfDay: 12, hourLabel: '12:00', circadianPhase: 'Solar Zenith', instrument: 'Solar Upper-Octave Shimmer', voice: 'pad', role: 'High Harmonic Overtones' },
  energy: { domain: 'energy', hourOfDay: 13, hourLabel: '13:00', circadianPhase: 'Peak Grid', instrument: 'Studio Kick & Sidechain', voice: 'kick', role: 'Core Pulse & Breathing Pocket' },
  industrial: { domain: 'industrial', hourOfDay: 14, hourLabel: '14:00', circadianPhase: 'Afternoon Forge', instrument: 'Sub-Bass Fifth Glide', voice: 'sub', role: 'Warm Saturated Bass Motion' },
  smart_building: { domain: 'smart_building', hourOfDay: 15, hourLabel: '15:00', circadianPhase: 'Urban Resonance', instrument: 'Balafon Marimba', voice: 'balafon', role: 'Resonant Gourd Counter-Rhythm' },
  computing: { domain: 'computing', hourOfDay: 16, hourLabel: '16:00', circadianPhase: 'Compute Crest', instrument: 'Djembe Syncopated Slap', voice: 'djembe', role: 'Crisp Polyrhythmic Accents' },
  network: { domain: 'network', hourOfDay: 17, hourLabel: '17:00', circadianPhase: 'Dusk Traffic', instrument: 'Closed Hi-Hat Pulse', voice: 'perc', role: 'Ping-Pong Rhythmic Subdivision' },
  geographic: { domain: 'geographic', hourOfDay: 18, hourLabel: '18:00', circadianPhase: 'Golden Horizon', instrument: 'Modal Horizon Voice-Lead', voice: 'kora', role: 'Latitudinal Scale Coloring' },
  social_information: { domain: 'social_information', hourOfDay: 19, hourLabel: '19:00', circadianPhase: 'Evening Salon', instrument: 'FM Rhodes 9th Chords', voice: 'fm', role: 'Warm Electric Piano Voicings' },
  audio: { domain: 'audio', hourOfDay: 20, hourLabel: '20:00', circadianPhase: 'Night Acoustics', instrument: 'Woodblock Rimshot', voice: 'perc', role: 'Dry Acoustic Cross-Stick' },
  musical: { domain: 'musical', hourOfDay: 21, hourLabel: '21:00', circadianPhase: 'Nocturne Pulse', instrument: 'Studio Clap & Tempo Tide', voice: 'perc', role: 'Backbeat Lift & Groove Velocity' },
  artificial_intelligence: { domain: 'artificial_intelligence', hourOfDay: 22, hourLabel: '22:00', circadianPhase: 'Late Signal', instrument: 'Open Hi-Hat & FM Sheen', voice: 'perc', role: 'Evolving Upper Transient Lift' },
  security: { domain: 'security', hourOfDay: 23, hourLabel: '23:00', circadianPhase: 'Midnight Watch', instrument: 'Talking Drum Pitch-Bend', voice: 'djembe', role: 'Expressive Bent Cadence Turns' }
};

/** All 24 telemetry instruments sorted chronologically from 00:00 to 23:00. */
export const TELEMETRY_BY_HOUR: TelemetryInstrumentMapping[] = Object.values(TELEMETRY_INSTRUMENT_MAP).sort(
  (a, b) => a.hourOfDay - b.hourOfDay
);

/**
 * Smooth circular Gaussian spotlight (0..1) on the 24-hour clock so each telemetry's instrument
 * glides gently into the soloist spotlight during its assigned hour without abrupt transitions at :00.
 */
export function computeCircadianSpotlight(hourOfDay: number, currentHourFloat: number): number {
  const wrappedCurrent = ((currentHourFloat % 24) + 24) % 24;
  const wrappedTarget = ((hourOfDay % 24) + 24) % 24;
  let dist = Math.abs(wrappedCurrent - wrappedTarget);
  if (dist > 12) dist = 24 - dist;
  // Width sigma = 1.65h gives smooth overlapping blend across neighboring hours & midnight wrap
  return Number(Math.exp(-0.5 * Math.pow(dist / 1.65, 2)).toFixed(4));
}

export interface ActiveTelemetryHourInfo {
  hourOfDay: number;
  hourFloat: number;
  hourLabel: string;
  mapping: TelemetryInstrumentMapping;
  nextMapping: TelemetryInstrumentMapping;
  blendToNext: number;
}

export function getActiveTelemetryHour(dateOrHourFloat?: Date | number): ActiveTelemetryHourInfo {
  let hourFloat: number;
  if (typeof dateOrHourFloat === 'number' && Number.isFinite(dateOrHourFloat)) {
    hourFloat = ((dateOrHourFloat % 24) + 24) % 24;
  } else {
    const now = dateOrHourFloat instanceof Date ? dateOrHourFloat : new Date();
    hourFloat = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }
  const hourOfDay = Math.floor(hourFloat) % 24;
  const nextHour = (hourOfDay + 1) % 24;
  const mapping = TELEMETRY_BY_HOUR[hourOfDay] ?? TELEMETRY_BY_HOUR[0];
  const nextMapping = TELEMETRY_BY_HOUR[nextHour] ?? TELEMETRY_BY_HOUR[0];
  return {
    hourOfDay,
    hourFloat,
    hourLabel: mapping.hourLabel,
    mapping,
    nextMapping,
    blendToNext: Number((hourFloat - Math.floor(hourFloat)).toFixed(3))
  };
}

export function createDefaultVoiceMix(): VoiceMixMap {
  const map = {} as VoiceMixMap;
  for (const v of ALL_SYNTH_VOICES) {
    map[v.id] = {
      gain: v.defaultGain,
      pan: v.defaultPan,
      muted: false
    };
  }
  return map;
}

export type VoiceArticulation =
  | 'hat_closed'
  | 'hat_open'
  | 'shaker'
  | 'rim'
  | 'clap'
  | 'glide'
  | 'swell'
  | 'rhodes_chord'
  | 'whisper_choir';

export interface VoiceNoteEvent {
  step: number; // 0..15 inside a bar
  voice: SynthVoiceId;
  midiNote: number;
  chordNotes?: number[];
  velocity: number; // 0..1
  durationSec: number;
  pitchBendSemitones?: number;
  pan?: number; // -1..1 per-event stereo offset
  articulation?: VoiceArticulation;
}

export type BarSectionName = 'Intro' | 'Groove' | 'Poly-Build' | 'Climax' | 'Breakdown' | 'Outro';

export interface CompositionBar {
  barIndex: number;
  section: BarSectionName;
  energy: number; // 0..1
  filterCutoffNorm: number; // 0..1
  fmIndexScale: number; // 0.5..1.5
  chordSymbol: string;
  chordRootMidi: number;
  chordNotes: number[];
  isFillBar: boolean;
  events: VoiceNoteEvent[];
}

export interface Composition32BarPlan {
  bpm: number;
  rootMidi: number;
  scaleName: string;
  scaleIntervals: number[];
  swing: number; // 0..0.18
  emergentProfile: EmergentTelemetryProfile;
  telemetrySignatureLabel: string;
  activeTelemetryHour: ActiveTelemetryHourInfo;
  activeMotifTitle?: string;
  chordProgressionSummary: string;
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

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

interface ChordTemplate {
  rootOffset: number;
  quality: string;
  intervals: number[];
}

interface ScaleDefinition {
  name: string;
  intervals: number[];
  progressions: ChordTemplate[][];
}

const SCALES: ScaleDefinition[] = [
  {
    name: 'West African Dorian',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    progressions: [
      [
        { rootOffset: 0, quality: 'm9', intervals: [0, 3, 7, 10, 14] },
        { rootOffset: 5, quality: '9', intervals: [0, 4, 7, 10, 14] },
        { rootOffset: 10, quality: 'maj9', intervals: [0, 4, 7, 11, 14] },
        { rootOffset: 7, quality: 'm7', intervals: [0, 3, 7, 10] }
      ],
      [
        { rootOffset: 0, quality: 'm11', intervals: [0, 3, 7, 10, 17] },
        { rootOffset: 3, quality: 'maj7', intervals: [0, 4, 7, 11] },
        { rootOffset: 5, quality: '13', intervals: [0, 4, 7, 10, 21] },
        { rootOffset: 2, quality: 'm7', intervals: [0, 3, 7, 10] }
      ]
    ]
  },
  {
    name: 'Kora Aeolian Minor',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    progressions: [
      [
        { rootOffset: 0, quality: 'm9', intervals: [0, 3, 7, 10, 14] },
        { rootOffset: 8, quality: 'maj7', intervals: [0, 4, 7, 11] },
        { rootOffset: 3, quality: 'add9', intervals: [0, 4, 7, 14] },
        { rootOffset: 10, quality: '6/9', intervals: [0, 4, 7, 9, 14] }
      ],
      [
        { rootOffset: 0, quality: 'm7', intervals: [0, 3, 7, 10] },
        { rootOffset: 5, quality: 'm9', intervals: [0, 3, 7, 10, 14] },
        { rootOffset: 8, quality: 'maj9', intervals: [0, 4, 7, 11, 14] },
        { rootOffset: 7, quality: 'm7', intervals: [0, 3, 7, 10] }
      ]
    ]
  },
  {
    name: 'Mbira Lydian',
    intervals: [0, 2, 4, 6, 7, 9, 11],
    progressions: [
      [
        { rootOffset: 0, quality: 'maj9', intervals: [0, 4, 7, 11, 14] },
        { rootOffset: 2, quality: 'add9', intervals: [0, 4, 7, 14] },
        { rootOffset: 9, quality: 'm9', intervals: [0, 3, 7, 10, 14] },
        { rootOffset: 7, quality: 'maj7', intervals: [0, 4, 7, 11] }
      ],
      [
        { rootOffset: 0, quality: 'maj7#11', intervals: [0, 4, 7, 11, 18] },
        { rootOffset: 7, quality: 'add9', intervals: [0, 4, 7, 14] },
        { rootOffset: 4, quality: 'm9', intervals: [0, 3, 7, 10, 14] },
        { rootOffset: 2, quality: '6/9', intervals: [0, 4, 7, 9, 14] }
      ]
    ]
  },
  {
    name: 'Sahel Mixolydian',
    intervals: [0, 2, 4, 5, 7, 9, 10],
    progressions: [
      [
        { rootOffset: 0, quality: '9', intervals: [0, 4, 7, 10, 14] },
        { rootOffset: 10, quality: 'maj9', intervals: [0, 4, 7, 11, 14] },
        { rootOffset: 5, quality: 'add9', intervals: [0, 4, 7, 14] },
        { rootOffset: 7, quality: 'm7', intervals: [0, 3, 7, 10] }
      ],
      [
        { rootOffset: 0, quality: 'add9', intervals: [0, 4, 7, 14] },
        { rootOffset: 7, quality: 'm9', intervals: [0, 3, 7, 10, 14] },
        { rootOffset: 10, quality: 'maj7', intervals: [0, 4, 7, 11] },
        { rootOffset: 5, quality: 'maj9', intervals: [0, 4, 7, 11, 14] }
      ]
    ]
  }
];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampPan(v: number): number {
  return Math.max(-0.95, Math.min(0.95, Number(v.toFixed(2))));
}

function formatChordSymbol(rootMidi: number, quality: string): string {
  const pitchClass = ((rootMidi % 12) + 12) % 12;
  return `${NOTE_NAMES[pitchClass]}${quality}`;
}

export function deriveDynamicTelemetrySignatureLabel(
  signatureTitle: string,
  bpm: number
): string {
  return `${signatureTitle} · ${Math.round(bpm)} BPM`;
}

/**
 * Continuously derives emergent musical dimensions across all 24 live telemetry streams
 * without discrete preset genres or abrupt mode switching.
 */
export function deriveEmergentTelemetryProfile(
  vector: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext,
  characterBias?: SonicCharacterBias,
  bpmForLabel?: number
): EmergentTelemetryProfile {
  const windNorm = clamp01(weatherCtx.windSpeedMs / 20);
  const humNorm = clamp01(weatherCtx.humidityPct / 100);

  const rawKinetic =
    vector.energy.normalized * 0.22 +
    vector.computing.normalized * 0.16 +
    vector.transport.normalized * 0.16 +
    vector.musical.normalized * 0.18 +
    vector.industrial.normalized * 0.12 +
    vector.security.normalized * 0.08 +
    windNorm * 0.08;

  const rawSpace =
    vector.atmospheric.normalized * 0.22 +
    vector.oceanographic.normalized * 0.2 +
    vector.space.normalized * 0.18 +
    vector.solar.normalized * 0.14 +
    humNorm * 0.16 +
    vector.geographic.normalized * 0.1;

  const rawPolyrhythm =
    vector.biological.normalized * 0.24 +
    vector.agricultural.normalized * 0.18 +
    vector.weather.normalized * 0.18 +
    vector.geological.normalized * 0.16 +
    vector.smart_building.normalized * 0.12 +
    vector.network.normalized * 0.12;

  const rawWarmth =
    vector.social_information.normalized * 0.22 +
    vector.economic.normalized * 0.18 +
    vector.business.normalized * 0.16 +
    vector.financial.normalized * 0.16 +
    vector.environmental.normalized * 0.14 +
    vector.solar.normalized * 0.14;

  const rawEdge =
    vector.artificial_intelligence.normalized * 0.24 +
    vector.network.normalized * 0.18 +
    vector.security.normalized * 0.18 +
    vector.audio.normalized * 0.16 +
    vector.industrial.normalized * 0.12 +
    windNorm * 0.12;

  const kineticDrive = Number(clamp01(rawKinetic + (characterBias?.kineticDelta ?? 0)).toFixed(3));
  const atmosphericSpace = Number(clamp01(rawSpace + (characterBias?.spaceDelta ?? 0)).toFixed(3));
  const polyrhythmDensity = Number(
    clamp01(rawPolyrhythm + (characterBias?.polyrhythmDelta ?? 0)).toFixed(3)
  );
  const harmonicWarmth = Number(clamp01(rawWarmth + (characterBias?.warmthDelta ?? 0)).toFixed(3));
  const percussiveEdge = Number(clamp01(rawEdge + (characterBias?.kineticDelta ?? 0) * 0.5).toFixed(3));

  // Find dominant cluster organically from live averages
  let dominantClusterId: TelemetryClusterId = 'atmosphere_earth';
  let highestAvg = -1;
  let accentHex = '#c9b18a';

  for (const cluster of TELEMETRY_CLUSTERS) {
    const avg =
      cluster.domains.reduce((sum, d) => sum + (vector[d]?.normalized ?? 0.5), 0) /
      Math.max(1, cluster.domains.length);
    if (avg > highestAvg) {
      highestAvg = avg;
      dominantClusterId = cluster.id;
      accentHex = cluster.accentHex;
    }
  }

  // Synthesize organic two-word telemetry signature from dominant cluster + acoustic motion
  const clusterAdjective: Record<TelemetryClusterId, [string, string]> = {
    atmosphere_earth: ['Atmospheric', 'Barometric'],
    space_solar: ['Solar', 'Ionospheric'],
    bio_agro: ['Biospheric', 'Verdant'],
    energy_industry: ['Kinetic', 'Telluric'],
    infra_tech: ['Telemetry', 'Orbital'],
    markets_social: ['Resonant', 'Nocturnal'],
    sound_security: ['Harmonic', 'Acoustic']
  };
  const adjPair = clusterAdjective[dominantClusterId];
  const adj = highestAvg >= 0.58 ? adjPair[0] : adjPair[1];

  let noun = 'Pulse';
  if (atmosphericSpace >= kineticDrive + 0.1) {
    noun = atmosphericSpace > 0.62 ? 'Drift' : 'Current';
  } else if (polyrhythmDensity >= 0.58 && polyrhythmDensity >= percussiveEdge) {
    noun = 'Polyrhythm';
  } else if (harmonicWarmth >= 0.6 && kineticDrive < 0.58) {
    noun = 'Velvet';
  } else if (kineticDrive >= 0.66) {
    noun = 'Momentum';
  } else if (percussiveEdge >= 0.62) {
    noun = 'Lattice';
  } else {
    noun = 'Weave';
  }

  const signatureTitle = `${adj} ${noun}`;
  const estimatedBpm =
    bpmForLabel ??
    Math.round(
      76 +
        kineticDrive * 38 +
        vector.musical.normalized * 14 -
        atmosphericSpace * 10
    );

  return {
    kineticDrive,
    atmosphericSpace,
    polyrhythmDensity,
    harmonicWarmth,
    percussiveEdge,
    dominantClusterId,
    signatureTitle,
    telemetrySignatureLabel: deriveDynamicTelemetrySignatureLabel(signatureTitle, estimatedBpm),
    accentHex
  };
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

    if (overrides) {
      const cluster = TELEMETRY_CLUSTERS.find((c) => c.domains.includes(domain));
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
  weatherCtx: GeolocationWeatherContext,
  characterBias?: SonicCharacterBias
): FxSlotConfig[] {
  const profile = deriveEmergentTelemetryProfile(vector, weatherCtx, characterBias);
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

  const baseReverbMix = 0.18 + profile.atmosphericSpace * 0.2;
  const baseCutoff = 5800 + profile.kineticDrive * 3600 - profile.harmonicWarmth * 1200;

  return [
    {
      id: 'reverb',
      slotNumber: 1,
      name: 'Reverb',
      telemetrySource: 'Atmospheric · Humidity',
      bypass: false,
      telemetryLocked: true,
      mix: Number(clamp01(baseReverbMix + humNorm * 0.22).toFixed(2)),
      primaryValue: Number((1.3 + profile.atmosphericSpace * 1.45 + atmNorm * 1.35).toFixed(2)),
      primaryLabel: 'Decay',
      primaryUnit: 's',
      primaryMin: 0.4,
      primaryMax: 4.5,
      secondaryValue: Number((0.26 + humNorm * 0.48).toFixed(2)),
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
      mix: Number(clamp01(0.14 + profile.atmosphericSpace * 0.1 + netNorm * 0.18).toFixed(2)),
      primaryValue: Math.round(185 + netNorm * 235),
      primaryLabel: 'Time',
      primaryUnit: 'ms',
      primaryMin: 80,
      primaryMax: 650,
      secondaryValue: Number((0.22 + netNorm * 0.34).toFixed(2)),
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
      primaryValue: Math.round(Math.max(1800, Math.min(11500, baseCutoff - envNorm * 2800))),
      primaryLabel: 'Cutoff',
      primaryUnit: 'Hz',
      primaryMin: 600,
      primaryMax: 12000,
      secondaryValue: Number((0.85 + envNorm * 2.2 + profile.percussiveEdge * 0.5).toFixed(2)),
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
      mix: Number(
        clamp01(0.06 + profile.kineticDrive * 0.1 + ((indNorm + secNorm) * 0.5) * 0.2).toFixed(2)
      ),
      primaryValue: Number(
        (1.2 + profile.kineticDrive * 3.2 + ((indNorm + secNorm) * 0.5) * 7.5).toFixed(1)
      ),
      primaryLabel: 'Drive',
      primaryUnit: 'dB',
      primaryMin: 0,
      primaryMax: 24,
      secondaryValue: Number((0.46 + indNorm * 0.4).toFixed(2)),
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
      primaryValue: Number((-13 - ((bizNorm + engNorm) * 0.5) * 10.5).toFixed(1)),
      primaryLabel: 'Threshold',
      primaryUnit: 'dB',
      primaryMin: -36,
      primaryMax: -4,
      secondaryValue: Number((2.5 + engNorm * 3.8).toFixed(1)),
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
      mix: Number(
        clamp01(
          0.16 + profile.atmosphericSpace * 0.12 + ((windNorm + ocnNorm) * 0.5) * 0.26
        ).toFixed(2)
      ),
      primaryValue: Number((0.35 + windNorm * 2.4).toFixed(2)),
      primaryLabel: 'Rate',
      primaryUnit: 'Hz',
      primaryMin: 0.1,
      primaryMax: 6.0,
      secondaryValue: Number((0.0022 + ocnNorm * 0.006).toFixed(4)),
      secondaryLabel: 'Depth',
      secondaryUnit: 's',
      secondaryMin: 0.0005,
      secondaryMax: 0.015
    }
  ];
}

export function deriveFmParams(
  vector: Record<DomainCategory, NormalizedDomainReading>,
  characterBias?: SonicCharacterBias
): FmSynthParams {
  const cpuNorm = vector.computing.normalized;
  const aiNorm = vector.artificial_intelligence.normalized;
  const finNorm = vector.financial.normalized;
  const ecoNorm = vector.economic.normalized;
  const audNorm = vector.audio.normalized;
  const warmBias = characterBias?.warmthDelta ?? 0;
  const kineticBias = characterBias?.kineticDelta ?? 0;

  const modRatios = [1.0, 1.5, 2.0, 2.0, 3.0];
  const ratioIdx = Math.min(modRatios.length - 1, Math.floor(finNorm * modRatios.length));

  const indexBase = Math.max(0.25, 0.44 + kineticBias * 0.35 - warmBias * 0.25);
  const indexSpread = 0.85 + Math.max(0, kineticBias) * 0.45;

  return {
    carrierHz: Math.round(130 + ecoNorm * 190),
    modRatio: modRatios[ratioIdx],
    fmModIndex: Number(
      Math.max(0.12, Math.min(1.85, indexBase + ((cpuNorm + aiNorm) * 0.5) * indexSpread)).toFixed(2)
    ),
    feedback: Number((0.12 + audNorm * 0.38).toFixed(2)),
    decaySec: Number(
      Math.max(0.12, Math.min(0.85, 0.3 + (1 - finNorm) * 0.38 + (characterBias?.spaceDelta ?? 0) * 0.25)).toFixed(2)
    ),
    density: Number(clamp01(0.36 + aiNorm * 0.52 + kineticBias * 0.2).toFixed(2))
  };
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Smooth continuous macro-tide for infinite flow: rises gently over bars 0..3 and then
 * breathes organically forever via incommensurate sine waves with ZERO abrupt section drops.
 */
export function computeInfiniteFlowTide(barIndex: number, solarLift = 0.5): number {
  const b = Math.max(0, barIndex);
  // Smooth organic emergence over first 4 bars (0.58 -> 1.0) so playback never slams in or drops out
  const introT = Math.min(1, b / 4);
  const introBloom = 0.58 + 0.42 * (introT * introT * (3 - 2 * introT));

  // Two slow incommensurate ocean-tide waves (periods ~36 bars and ~82 bars)
  const tideA = Math.sin(b * 0.175 + solarLift * 1.4) * 0.13;
  const tideB = Math.sin(b * 0.076 + 0.9) * 0.09;
  const microBreath = Math.sin(b * 0.52) * 0.03;

  return clamp01((0.72 + tideA + tideB + microBreath) * introBloom);
}

function getContinuousTideLabel(barIndex: number, tide: number): BarSectionName {
  if (barIndex < 3) return 'Intro';
  if (tide >= 0.84) return 'Climax';
  if (tide >= 0.72) return 'Poly-Build';
  if (tide >= 0.56) return 'Groove';
  return 'Breakdown';
}

function deriveSharedCompositionContext(
  vector: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext,
  options?: CompositionOptions
) {
  const characterBias = options?.characterBias;
  const aiMotif = options?.aiMotif ?? null;
  const preliminaryProfile = deriveEmergentTelemetryProfile(vector, weatherCtx, characterBias);

  // Continuous BPM across 76..130 driven smoothly by 24-domain kinetics, musical pulse, and atmospheric space
  const baseBpm =
    80 +
    preliminaryProfile.kineticDrive * 34 +
    vector.musical.normalized * 12 +
    vector.transport.normalized * 5 -
    preliminaryProfile.atmosphericSpace * 10;
  const bpm = Math.round(Math.max(76, Math.min(130, baseBpm + (options?.bpmOffset ?? 0))));

  const emergentProfile: EmergentTelemetryProfile = {
    ...preliminaryProfile,
    telemetrySignatureLabel: deriveDynamicTelemetrySignatureLabel(
      preliminaryProfile.signatureTitle,
      bpm
    )
  };

  // Scale & chord progression: derived continuously from Weather + Solar + Geographic trees
  const scaleIdx =
    Math.floor(
      ((vector.weather.normalized * 0.45 +
        vector.solar.normalized * 0.3 +
        vector.geographic.normalized * 0.25) %
        1) *
        SCALES.length
    ) % SCALES.length;
  const telemetryScale = SCALES[Math.abs(scaleIdx) % SCALES.length];
  const progressionIdx =
    (vector.financial.normalized + vector.social_information.normalized) * 0.5 > 0.52 ? 1 : 0;

  const chosenScale = aiMotif
    ? {
        name: aiMotif.scaleName,
        intervals: aiMotif.scaleIntervals
      }
    : {
        name: telemetryScale.name,
        intervals: telemetryScale.intervals
      };

  const progression: ChordTemplate[] =
    aiMotif && aiMotif.chords.length >= 4
      ? aiMotif.chords.slice(0, 4).map((c) => ({
          rootOffset: c.rootOffset,
          quality: c.quality,
          intervals: c.intervals
        }))
      : telemetryScale.progressions[progressionIdx % telemetryScale.progressions.length];

  const rootOffsets = [48, 50, 52, 53, 55, 57];
  const rootMidi =
    rootOffsets[Math.floor(vector.weather.normalized * rootOffsets.length) % rootOffsets.length];

  const windNorm = clamp01(weatherCtx.windSpeedMs / 20);
  const swing = Number(
    clamp01(
      0.018 +
        emergentProfile.harmonicWarmth * 0.052 +
        emergentProfile.polyrhythmDensity * 0.03 +
        vector.transport.normalized * 0.032 -
        emergentProfile.kineticDrive * 0.022
    ).toFixed(3)
  );

  const fmParams: FmSynthParams = {
    ...deriveFmParams(vector, characterBias),
    ...(options?.overrideFm || {})
  };

  const solarLift = (vector.solar.normalized + vector.space.normalized) * 0.5;
  const subWeight =
    0.58 +
    ((vector.geological.normalized + vector.energy.normalized + vector.industrial.normalized) / 3) *
      0.38;
  const padWarmth =
    0.54 +
    ((vector.atmospheric.normalized +
      vector.oceanographic.normalized +
      solarLift +
      emergentProfile.atmosphericSpace) /
      4) *
      0.42;
  const stepBeatSec = 60 / bpm / 4;
  const barDurSec = stepBeatSec * 16;

  const activeTelemetryHour = getActiveTelemetryHour(options?.hourOfDayOverride);

  return {
    emergentProfile,
    activeTelemetryHour,
    bpm,
    chosenScale,
    progression,
    rootMidi,
    swing,
    fmParams,
    aiMotif,
    synthCtx: {
      bpm,
      rootMidi,
      vector,
      emergentProfile,
      activeTelemetryHour,
      progression,
      fmParams,
      aiMotif,
      solarLift,
      windNorm,
      subWeight,
      padWarmth,
      stepBeatSec,
      barDurSec
    } as EndlessBarSynthesisContext
  };
}

function isEndlessWhisperBar(barIndex: number): boolean {
  // Calm periodic breath every 8 bars (starting gently at bar 2) so whispers never clash with transitions
  return barIndex === 1 || (barIndex > 1 && barIndex % 8 === 0);
}

interface EndlessBarSynthesisContext {
  bpm: number;
  rootMidi: number;
  vector: Record<DomainCategory, NormalizedDomainReading>;
  emergentProfile: EmergentTelemetryProfile;
  activeTelemetryHour: ActiveTelemetryHourInfo;
  progression: ChordTemplate[];
  fmParams: FmSynthParams;
  aiMotif: AiMotifProfile | null;
  solarLift: number;
  windNorm: number;
  subWeight: number;
  padWarmth: number;
  stepBeatSec: number;
  barDurSec: number;
}

function synthesizeSingleBar(b: number, ctx: EndlessBarSynthesisContext): CompositionBar {
  const {
    rootMidi,
    vector,
    emergentProfile,
    activeTelemetryHour,
    progression,
    fmParams,
    aiMotif,
    solarLift,
    windNorm,
    subWeight,
    padWarmth,
    stepBeatSec,
    barDurSec
  } = ctx;

  const { kineticDrive, atmosphericSpace, polyrhythmDensity, harmonicWarmth, percussiveEdge } =
    emergentProfile;

  // Smooth infinite ocean-tide energy curve (zero hard drops, zero abrupt Outro cuts)
  const flowTide = computeInfiniteFlowTide(b, solarLift);
  const energy = clamp01(flowTide + (kineticDrive - 0.5) * 0.08);
  const section = getContinuousTideLabel(b, energy);

  // Subtle organic cadence turn every 8 bars (never an abrupt drop or reset)
  const isFillBar = b > 0 && b % 8 === 7;

  // Unbroken 2-bar harmonic breathing progression (smooth voice-leading, zero cycle-index jump at bar 32)
  const chordIdx = Math.floor(b / 2) % progression.length;
  const chordTemplate = progression[chordIdx];
  const chordRootMidi = rootMidi + chordTemplate.rootOffset;
  const chordSymbol = formatChordSymbol(chordRootMidi, chordTemplate.quality);

  // Smooth octave color lifts driven by Solar & Geographic trees (no sudden full-chord jump)
  const chordNotes = chordTemplate.intervals.map((interval, idx) => {
    const base = chordRootMidi + interval;
    if (idx === 1 && vector.solar.normalized > 0.68 && b % 4 >= 2) return base + 12;
    if (idx === 2 && vector.geographic.normalized > 0.65 && b % 8 >= 4) return base + 12;
    return base;
  });

  // Sub-bass register locked in tight 34..47 MIDI (58Hz..123Hz) sweet spot
  let subRootMidi = chordRootMidi - 12;
  while (subRootMidi > 47) subRootMidi -= 12;
  while (subRootMidi < 34) subRootMidi += 12;
  const subFifthMidi = subRootMidi + 7 <= 50 ? subRootMidi + 7 : subRootMidi - 5;

  // Pull all 24 individual telemetry trees with smooth 24-hour circadian spotlighting:
  // each telemetry's instrument glides gently forward during its own hour of the day (00:00-23:00).
  const hourNow = activeTelemetryHour.hourFloat;
  const treeLevel = (domain: DomainCategory) => {
    const raw = vector[domain].normalized;
    const spotlight = computeCircadianSpotlight(TELEMETRY_INSTRUMENT_MAP[domain].hourOfDay, hourNow);
    return clamp01(raw * (0.86 + spotlight * 0.24) + spotlight * 0.08);
  };

  const vWeather = treeLevel('weather');
  const vAtm = treeLevel('atmospheric');
  const vOcean = treeLevel('oceanographic');
  const vSolar = treeLevel('solar');
  const vSpace = treeLevel('space');
  const vEnv = treeLevel('environmental');
  const vGeo = treeLevel('geological');
  const vEnergy = treeLevel('energy');
  const vInd = treeLevel('industrial');
  const vBio = treeLevel('biological');
  const vAgro = treeLevel('agricultural');
  const vBuilding = treeLevel('smart_building');
  const vSocial = treeLevel('social_information');
  const vFin = treeLevel('financial');
  const vEco = treeLevel('economic');
  const vBiz = treeLevel('business');
  const vComp = treeLevel('computing');
  const vTrans = treeLevel('transport');
  const vNet = treeLevel('network');
  const vAi = treeLevel('artificial_intelligence');
  const vAudio = treeLevel('audio');
  const vMusic = treeLevel('musical');
  const vSec = treeLevel('security');

  // Smooth per-instrument opening bloom (staggered over bars 0..5 so layers enter gently one by one, then never cut out)
  const padEntry = clamp01(0.7 + b * 0.15);
  const subEntry = clamp01(0.45 + b * 0.22);
  const kickEntry = clamp01((b - 0.5) * 0.35);
  const koraEntry = clamp01(0.35 + b * 0.22);
  const percEntry = clamp01((b - 1.0) * 0.3);
  const kalimbaEntry = clamp01((b - 1.5) * 0.28);
  const djembeEntry = clamp01((b - 2.0) * 0.26);
  const balafonEntry = clamp01((b - 2.5) * 0.26);
  const fmEntry = clamp01(0.4 + b * 0.2);

  const events: VoiceNoteEvent[] = [];

  // 1. ATMOSPHERIC + OCEANOGRAPHIC + SOLAR TREES -> WARM STEREO PAD (continuous overlapping crossfade)
  const padVoicing = chordNotes.slice(0, 4);
  events.push({
    step: 0,
    voice: 'pad',
    midiNote: chordRootMidi,
    chordNotes: padVoicing,
    velocity: clamp01((0.46 + vAtm * 0.24 + vOcean * 0.16 + energy * 0.14) * padWarmth * padEntry),
    durationSec: barDurSec * (1.1 + vOcean * 0.12),
    pan: clampPan((vOcean - 0.5) * 0.18),
    articulation: 'swell'
  });

  // Solar tree blooms upper-octave pad shimmer smoothly whenever solar radiance lifts
  if (vSolar > 0.32) {
    const upperSwell = chordNotes.slice(1, 4).map((n) => n + 12);
    events.push({
      step: 8,
      voice: 'pad',
      midiNote: chordRootMidi + 12,
      chordNotes: upperSwell,
      velocity: clamp01((0.18 + vSolar * 0.44 + atmosphericSpace * 0.14) * padEntry),
      durationSec: barDurSec * 0.68,
      pan: clampPan(Math.sin(b * 0.65) * 0.24),
      articulation: 'swell'
    });
  }

  // 2. SPACE TREE -> ASTRAL WHISPER CHOIR HARMONICS
  if (isEndlessWhisperBar(b)) {
    const whisperChord = [
      chordNotes[0] + 12,
      (chordNotes[1] ?? chordRootMidi + 3) + 12,
      (chordNotes[2] ?? chordRootMidi + 7) + 12
    ];
    const whisperDur = Math.max(3.0, Math.min(5.2, barDurSec * 1.48));
    events.push({
      step: 0,
      voice: 'whisper',
      midiNote: chordRootMidi + 12,
      chordNotes: whisperChord,
      velocity: clamp01(0.56 + vSpace * 0.26 + solarLift * 0.1),
      durationSec: whisperDur,
      pan: clampPan(Math.sin(b * 0.42) * 0.2),
      articulation: 'whisper_choir'
    });
  }

  // Continuous 16th-note phrasing: each of the 24 telemetry trees modulates its dedicated instrument smoothly
  for (let step = 0; step < 16; step++) {
    const seed = Math.abs(Math.sin((b + 1) * 19.37 + (step + 1) * 8.13 + solarLift * 5.7));
    const humanizeVel = 0.89 + Math.sin(step * 2.1 + b * 1.1) * 0.11;

    // 3. GEOLOGICAL + INDUSTRIAL TREES -> DEEP SUB-BASS (always grounded on step 0, continuous syncopation by geology/industry)
    const isSubRoot = step === 0;
    const isSubSync =
      (step === 10 && vGeo + kineticDrive > 0.65) ||
      (step === 6 && vInd + polyrhythmDensity > 0.92) ||
      (step === 14 && vInd > 0.42);
    if (isSubRoot || isSubSync) {
      const useFifth = step === 14 || (step === 10 && b % 2 === 1 && vInd > 0.38);
      const subDur = isSubRoot
        ? stepBeatSec * (5.2 + vGeo * 2.4 + atmosphericSpace * 1.4)
        : stepBeatSec * (2.6 + vInd * 1.4);
      const subScale = isSubRoot ? 0.88 : 0.48 + vInd * 0.34;
      events.push({
        step,
        voice: 'sub',
        midiNote: useFifth ? subFifthMidi : subRootMidi,
        velocity: clamp01(subScale * subWeight * (0.68 + energy * 0.32) * subEntry),
        durationSec: subDur,
        pan: 0,
        articulation: step === 14 ? 'glide' : undefined,
        pitchBendSemitones: step === 14 ? 2 : undefined
      });
    }

    // 4. ENERGY TREE -> STUDIO KICK DRUM (smooth pulse density scaling — never abruptly drops out)
    const kickWeight = clamp01((0.36 + vEnergy * 0.42 + kineticDrive * 0.28) * kickEntry);
    const isPrimaryKick = step === 0 || (step === 8 && kickWeight > 0.42);
    const isFourFloorKick = (step === 4 || step === 12) && kickWeight > 0.6;
    const isSyncKick =
      (step === 10 && kickWeight > 0.48 && !isFourFloorKick) ||
      (isFillBar && step === 14 && kickWeight > 0.55);

    if (kickEntry > 0.05 && (isPrimaryKick || isFourFloorKick || isSyncKick)) {
      const accent = step === 0 ? 0.94 : step % 4 === 0 ? 0.82 : 0.66;
      events.push({
        step,
        voice: 'kick',
        midiNote: 36,
        velocity: clamp01(accent * (0.42 + kickWeight * 0.58) * humanizeVel),
        durationSec: 0.25 + atmosphericSpace * 0.14,
        pan: 0
      });
    }

    // 5. MUSICAL + AUDIO TREES -> STUDIO CLAP & WOODBLOCK RIMSHOT BACKBEAT
    if (percEntry > 0.05 && (step === 4 || step === 12)) {
      const backbeatVel = clamp01((0.28 + vMusic * 0.38 + vAudio * 0.24) * energy * percEntry * humanizeVel);
      if (backbeatVel > 0.12) {
        events.push({
          step,
          voice: 'perc',
          midiNote: 64,
          velocity: backbeatVel,
          durationSec: 0.13,
          pan: step === 4 ? -0.15 : 0.17,
          articulation: vAudio >= vMusic ? 'rim' : 'clap'
        });
      }
    }

    // 6. NETWORK + TRANSPORT + AI TREES -> CLOSED HATS, WOVEN SHAKER & OPEN HAT SHEEN
    if (percEntry > 0.05) {
      const hatDrive = clamp01(0.24 + vNet * 0.34 + vTrans * 0.26 + vAi * 0.22 + windNorm * 0.14);
      const isClosedHat = step % 2 === 0 && (step % 4 === 2 || seed < hatDrive);
      const isShaker = step % 2 === 1 && vTrans > 0.25 && seed < vTrans * 0.85 + 0.15;
      const isOpenHat = (step === 2 || step === 10) && vAi > 0.58 && energy > 0.64;

      if (isOpenHat || isClosedHat || isShaker) {
        const velBase = isOpenHat
          ? 0.32 + vAi * 0.34
          : isShaker
            ? 0.22 + vTrans * 0.32
            : 0.24 + vNet * 0.34;
        events.push({
          step,
          voice: 'perc',
          midiNote: isOpenHat ? 76 : 72,
          velocity: clamp01(velBase * (0.55 + energy * 0.45) * percEntry * humanizeVel),
          durationSec: isOpenHat ? 0.21 : isShaker ? 0.08 : 0.055,
          pan: clampPan((step % 2 === 0 ? 0.26 : -0.24) + Math.sin(step + b * 0.7) * 0.12),
          articulation: isOpenHat ? 'hat_open' : isShaker ? 'shaker' : 'hat_closed'
        });
      }
    }

    // 7. WEATHER + BIOLOGICAL + GEOGRAPHIC TREES -> 21-STRING KORA HARP
    const koraPresence = clamp01(0.32 + vWeather * 0.38 + vBio * 0.34);
    const motifKoraStep = aiMotif ? aiMotif.koraSteps[step % aiMotif.koraSteps.length] : -1;
    const isKoraBeat = aiMotif
      ? motifKoraStep >= 0
      : step % 2 === 0
        ? seed < koraPresence + 0.18
        : vBio > 0.56 && step % 3 === 1 && seed < vBio;

    if (isKoraBeat) {
      const toneIdx =
        aiMotif && motifKoraStep >= 0
          ? motifKoraStep % chordNotes.length
          : (b + Math.floor(step / 2)) % chordNotes.length;
      const octaveLift = step % 4 === 0 ? 12 : 24;
      events.push({
        step,
        voice: 'kora',
        midiNote: chordNotes[toneIdx] + octaveLift,
        velocity: clamp01((0.3 + koraPresence * 0.48) * (0.72 + energy * 0.28) * koraEntry * humanizeVel),
        durationSec: stepBeatSec * (2.8 + atmosphericSpace * 1.8),
        pan: clampPan(-0.36 + (step / 16) * 0.4)
      });
    }

    // 8. BUSINESS + COMPUTING + SECURITY TREES -> DJEMBE & TALKING DRUM
    if (djembeEntry > 0.05) {
      const isBassHit = step === 0 && vBiz > 0.34;
      const isSlapHit = (step === 3 || step === 6 || step === 10) && seed < 0.25 + vComp * 0.65;
      const isTalkingBend = (step === 14 || (isFillBar && step >= 12)) && vSec > 0.28;

      if (isBassHit || isSlapHit || isTalkingBend) {
        const isLowTone = isBassHit || step === 12;
        const djembeVel = isTalkingBend
          ? 0.36 + vSec * 0.42
          : isLowTone
            ? 0.38 + vBiz * 0.4
            : 0.28 + vComp * 0.42;
        events.push({
          step,
          voice: 'djembe',
          midiNote: isLowTone ? chordRootMidi - 12 : chordRootMidi - 5,
          velocity: clamp01(djembeVel * (0.65 + energy * 0.35) * djembeEntry * humanizeVel),
          durationSec: isLowTone ? 0.26 : 0.16,
          pitchBendSemitones: isTalkingBend ? 4.2 : isLowTone ? -3.5 : -1.8,
          pan: clampPan(-0.2 + (step % 4) * 0.09)
        });
      }
    }

    // 9. AGRICULTURAL TREE -> KALIMBA / MBIRA WOODEN OSTINATO
    if (kalimbaEntry > 0.05) {
      const motifKalimbaStep = aiMotif
        ? aiMotif.kalimbaSteps[step % aiMotif.kalimbaSteps.length]
        : -1;
      const isKalimbaHit = aiMotif
        ? motifKalimbaStep >= 0
        : (step % 3 === 0 || (step === 11 && b % 2 === 1)) && seed < 0.28 + vAgro * 0.66;

      if (isKalimbaHit) {
        const toneIdx =
          aiMotif && motifKalimbaStep >= 0
            ? motifKalimbaStep % chordNotes.length
            : (step + b) % chordNotes.length;
        events.push({
          step,
          voice: 'kalimba',
          midiNote: chordNotes[toneIdx] + 12,
          velocity: clamp01((0.26 + vAgro * 0.46) * (0.7 + energy * 0.3) * kalimbaEntry * humanizeVel),
          durationSec: stepBeatSec * 2.4,
          pan: clampPan(-0.5 + (step % 3) * 0.08)
        });
      }
    }

    // 10. SMART BUILDING TREE -> BALAFON MARIMBA
    if (
      balafonEntry > 0.05 &&
      (step === 2 || step === 6 || step === 12 || (isFillBar && step === 14)) &&
      seed < 0.22 + vBuilding * 0.68
    ) {
      const toneIdx = (b * 2 + step) % chordNotes.length;
      events.push({
        step,
        voice: 'balafon',
        midiNote: chordNotes[toneIdx] + (vBuilding > 0.7 ? 12 : 0),
        velocity: clamp01((0.28 + vBuilding * 0.48) * (0.68 + energy * 0.32) * balafonEntry * humanizeVel),
        durationSec: stepBeatSec * 1.9,
        pan: clampPan(0.46 - (step % 4) * 0.06)
      });
    }

    // 11. SOCIAL + ECONOMIC + FINANCIAL TREES -> FM RHODES CHORDS & BELL ARPEGGIO LEAD
    const isRhodesChordHit =
      step === 0 || (step === 10 && vSocial + harmonicWarmth > 0.92);
    const isFmLeadHit =
      !isRhodesChordHit &&
      (step === 6 || step === 10 || step === 14) &&
      seed < 0.22 + vFin * 0.58 + fmParams.density * 0.18;

    if (isRhodesChordHit) {
      events.push({
        step,
        voice: 'fm',
        midiNote: chordRootMidi,
        chordNotes: chordNotes.slice(0, 4),
        velocity: clamp01((0.34 + vSocial * 0.3 + vEco * 0.24) * (0.7 + energy * 0.3) * fmEntry * humanizeVel),
        durationSec: stepBeatSec * (step === 0 ? 8.2 : 5.0),
        pan: 0.2,
        articulation: 'rhodes_chord'
      });
    } else if (isFmLeadHit) {
      const toneIdx = (b + Math.floor(step / 2)) % chordNotes.length;
      const octave = vFin > 0.68 ? 12 : 0;
      events.push({
        step,
        voice: 'fm',
        midiNote: chordNotes[toneIdx] + octave,
        velocity: clamp01((0.28 + vFin * 0.44 + vEco * 0.14) * (0.68 + energy * 0.32) * fmEntry * humanizeVel),
        durationSec: Math.max(0.22, fmParams.decaySec * 1.15),
        pan: clampPan(0.28 * Math.cos(b * 0.7 + step * 0.5))
      });
    }
  }

  // Environmental tree continuously modulates the smooth filter opening
  const filterCutoffNorm = clamp01(0.42 + energy * 0.36 + (1 - vEnv) * 0.14 + solarLift * 0.08);

  return {
    barIndex: b,
    section,
    energy: Number(energy.toFixed(3)),
    filterCutoffNorm,
    fmIndexScale: Number((0.74 + energy * 0.44 + percussiveEdge * 0.12).toFixed(2)),
    chordSymbol,
    chordRootMidi,
    chordNotes,
    isFillBar,
    events
  };
}

/**
 * Generates any continuous endless bar (barIndex = 0, 1, 2, ... ∞) directly from live 24-domain telemetry,
 * optional Musical Director character bias, and active AI Motif without any preset genre cycling.
 */
export function generateEndlessBar(
  barIndex: number,
  vector: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext,
  options?: CompositionOptions
): CompositionBar {
  const safeBar = Math.max(0, Math.floor(barIndex));
  const shared = deriveSharedCompositionContext(vector, weatherCtx, options);
  return synthesizeSingleBar(safeBar, shared.synthCtx);
}

/**
 * Generates an arbitrary-length continuous composition span (e.g., 1 min, 2 min, or 4 min offline export).
 */
export function buildEndlessCompositionSpan(
  barCount: number,
  vector: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext,
  options?: CompositionOptions
): Composition32BarPlan {
  const safeCount = Math.max(4, Math.floor(barCount));
  const shared = deriveSharedCompositionContext(vector, weatherCtx, options);
  const fxRack: FxSlotConfig[] = options?.overrideFx
    ? options.overrideFx.map((slot) => ({ ...slot }))
    : deriveDefaultFxRack(vector, weatherCtx, options?.characterBias);

  const bars: CompositionBar[] = [];
  const chordLabels: string[] = [];
  for (let b = 0; b < safeCount; b++) {
    const bar = synthesizeSingleBar(b, shared.synthCtx);
    if (b < 4) chordLabels.push(bar.chordSymbol);
    bars.push(bar);
  }

  const chordProgressionSummary = chordLabels.join(' · ');
  const telemetrySignature = `${shared.emergentProfile.signatureTitle}|${shared.activeTelemetryHour.hourLabel}:${shared.activeTelemetryHour.mapping.domain}|${shared.bpm}BPM|${shared.chosenScale.name}|${chordProgressionSummary}|T:${weatherCtx.temperatureC.toFixed(1)}C|FM:${shared.fmParams.fmModIndex}`;

  return {
    bpm: shared.bpm,
    rootMidi: shared.rootMidi,
    scaleName: shared.chosenScale.name,
    scaleIntervals: shared.chosenScale.intervals,
    swing: shared.swing,
    emergentProfile: shared.emergentProfile,
    telemetrySignatureLabel: shared.emergentProfile.telemetrySignatureLabel,
    activeTelemetryHour: shared.activeTelemetryHour,
    activeMotifTitle: shared.aiMotif?.title,
    chordProgressionSummary,
    bars,
    fmParams: shared.fmParams,
    fxRack,
    telemetrySignature
  };
}

export function build32BarComposition(
  vector: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext,
  options?: CompositionOptions
): Composition32BarPlan {
  return buildEndlessCompositionSpan(32, vector, weatherCtx, options);
}
