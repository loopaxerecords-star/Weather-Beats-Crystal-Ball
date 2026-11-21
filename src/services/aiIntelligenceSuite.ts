import { DomainCategory } from '../types/telemetry';
import { UNIVERSAL_DOMAINS } from './domainRegistry';
import { GeolocationWeatherContext } from './telemetryEngine';
import {
  Composition32BarPlan,
  FmSynthParams,
  FxSlotId,
  NormalizedDomainReading,
  SynthVoiceId,
  TELEMETRY_CLUSTERS,
  VoiceMixChannel
} from './weatherBeatsComposer';

export interface SonicCharacterBias {
  kineticDelta?: number; // -0.35..+0.35
  spaceDelta?: number; // -0.35..+0.35
  polyrhythmDelta?: number; // -0.35..+0.35
  warmthDelta?: number; // -0.35..+0.35
}

export interface MusicalDirectorFxChange {
  slotId: FxSlotId;
  mix?: number;
  primaryValue?: number;
  secondaryValue?: number;
  bypass?: boolean;
}

export interface MusicalDirectorPatch {
  summary: string;
  bpmOffset?: number;
  whispersEnabled?: boolean;
  characterBias?: SonicCharacterBias;
  voiceMixPatch?: Partial<Record<SynthVoiceId, Partial<VoiceMixChannel>>>;
  fmPatch?: Partial<FmSynthParams>;
  fxPatch?: MusicalDirectorFxChange[];
}

export interface AiMotifChord {
  rootOffset: number;
  quality: string;
  intervals: number[];
}

export interface AiMotifProfile {
  id: string;
  title: string;
  scaleName: string;
  scaleIntervals: number[];
  chords: AiMotifChord[];
  koraSteps: number[];
  kalimbaSteps: number[];
  fillIntensity: number;
  telemetryReason: string;
  createdAt: string;
}

export type SmartAlertOperator = 'gt' | 'lt' | 'rising' | 'dropping';
export type SmartAlertMetricKey =
  | 'wind_speed_ms'
  | 'pressure_hpa'
  | 'temperature_c'
  | 'humidity_pct'
  | 'aqi'
  | 'raw'
  | 'normalized';

export interface SmartAlertCondition {
  domain: DomainCategory;
  metric: SmartAlertMetricKey;
  operator: SmartAlertOperator;
  threshold: number;
  unit?: string;
}

export interface SmartAlertRule {
  id: string;
  label: string;
  sourcePrompt: string;
  logic: 'ALL' | 'ANY';
  conditions: SmartAlertCondition[];
  orbTintHex: string;
  sonicIntensityBias?: number;
  summary: string;
  enabled: boolean;
  createdAt: string;
}

export interface SmartAlertEvaluationResult {
  triggeredRules: SmartAlertRule[];
  activeOrbTintHex: string | null;
  activeIntensityBias: number;
  reasonsByRuleId: Record<string, string>;
}

export interface DuckDbNlQueryResponse {
  sql: string;
  explanation: string;
  timestamp: string;
}

export interface ReleaseAiKit {
  title: string;
  album: string;
  genre: string;
  comment: string;
  linerNotes: string;
  artPrompt: string;
  coverArtDataUrl: string | null;
  imageError?: string | null;
  timestamp: string;
}

export type LyriaFlowMode = 'clip' | 'pro';

export interface LyriaFlowRequestPayload {
  mode: LyriaFlowMode;
  bpm: number;
  scaleName: string;
  chordSummary: string;
  telemetrySignatureLabel: string;
  activeHourLabel: string;
  activeDomainName: string;
  activeInstrument: string;
  circadianPhase: string;
  weatherSummary: string;
  directorNote?: string;
  evolutionIndex?: number;
  coverArtDataUrl?: string | null;
}

export interface LyriaFlowResponse {
  audioDataUrl: string;
  mimeType: string;
  model: string;
  mode: LyriaFlowMode;
  promptSummary: string;
  notes: string;
  timestamp: string;
}

export type CrystalBallPromptIntent = 'music_direction' | 'smart_alert' | 'telemetry_question';

const SMART_ALERT_STORAGE_KEY = 'weather_beats_smart_alerts_v1';
const FORBIDDEN_SQL_REGEX =
  /\b(drop|delete|insert|update|alter|create|attach|detach|copy|pragma|export|import|call|load|truncate|replace|merge|grant|revoke|vacuum|checkpoint|install)\b/i;

export function validateReadOnlySqlClient(rawSql: string): { ok: boolean; sql: string; error?: string } {
  const cleaned = String(rawSql || '').trim();
  if (!cleaned) return { ok: false, sql: '', error: 'SQL query cannot be empty.' };
  const body = cleaned.replace(/;+\s*$/, '').trim();
  if (body.includes(';')) {
    return { ok: false, sql: '', error: 'Multiple SQL statements are blocked for safety.' };
  }
  if (!/^(select|with)\b/i.test(body)) {
    return { ok: false, sql: '', error: 'Only read-only SELECT queries are allowed.' };
  }
  if (FORBIDDEN_SQL_REGEX.test(body)) {
    return { ok: false, sql: '', error: 'Write or administrative SQL statements are blocked.' };
  }
  return { ok: true, sql: `${body};` };
}

/**
 * Derives an expressive neural voice style descriptor from live atmospheric weather conditions.
 */
export function deriveWeatherVoiceStyle(weatherCtx: GeolocationWeatherContext): string {
  const temp = weatherCtx.temperatureC;
  const wind = weatherCtx.windSpeedMs;
  const pressure = weatherCtx.pressureHpa;
  const aqi = weatherCtx.aqi;

  if (wind >= 11 || pressure <= 1002) {
    return 'Hushed, focused, low-cadence atmospheric narrator speaking calmly through gathering storm air';
  }
  if (aqi >= 85) {
    return 'Measured, clear, grounded observatory narrator with steady unhurried pacing';
  }
  if (temp >= 27) {
    return 'Warm, resonant, twilight atmospheric storyteller with smooth gentle cadence';
  }
  if (temp <= 8) {
    return 'Crisp, intimate, crystalline nocturnal observatory voice with calm unhurried breath';
  }
  return 'Calm, intimate, poetic atmospheric observatory narrator with subtle warmth and unhurried pacing';
}

/**
 * Classifies unified Crystal Ball prompt bar input so one calm prompt field handles
 * live sonic direction, conversational smart alert creation, and telemetry oracle questions.
 */
export function classifyCrystalBallPrompt(rawText: string): CrystalBallPromptIntent {
  const t = rawText.trim().toLowerCase();
  if (!t) return 'telemetry_question';

  const alertPattern =
    /\b(alert me|notify me|warn me|swell the (crystal )?orb|tint the orb|create an? alert|when .+ exceeds|if .+ drops|if .+ exceeds|if .+ rises)\b/i;
  if (alertPattern.test(t)) {
    return 'smart_alert';
  }

  const musicPattern =
    /\b(kora|kalimba|balafon|djembe|sub[- ]?bass|hats|hi-?hats|kick|snare|percussion|reverb|delay|filter|rhodes|fm synth|bpm|tempo|groove|nocturnal|darker|warmer|brighter|spacious|hypnotic|polyrhythm|soften the|bring the .+ forward|boost the|mute the|unmute the|turn down the|turn up the|slow down|speed up)\b/i;
  if (musicPattern.test(t) && !/^(what|how|why|which|where|tell me about|is there)\b/i.test(t)) {
    return 'music_direction';
  }

  return 'telemetry_question';
}

/**
 * Unwraps raw nested Gemini JSON error envelopes into concise, user-friendly guidance.
 */
export function formatApiErrorMessage(rawError: unknown, status?: number): string {
  let text = typeof rawError === 'string' ? rawError.trim() : '';
  let code = status ?? 0;

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const inner = parsed?.error ?? parsed;
      if (typeof inner?.code === 'number') code = inner.code;
      if (typeof inner?.message === 'string' && inner.message.trim()) {
        text = inner.message.trim();
      }
    } catch {
      // Keep original text
    }
  }

  const lower = text.toLowerCase();
  if (code === 402 || lower.includes('prepayment credits') || lower.includes('credits are depleted')) {
    return 'Gemini API credits are depleted. Manage billing or choose an active API key in Settings > Secrets.';
  }
  if (code === 429 || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return 'Gemini API quota reached. Check your plan or select a billing-enabled API key in Settings > Secrets.';
  }
  if (code === 401 || code === 403 || lower.includes('api_key_invalid') || lower.includes('permission_denied')) {
    return 'Gemini API key is missing or unauthorized. Please check Settings > Secrets.';
  }
  return text || `Request failed (${code || 'network error'})`;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(formatApiErrorMessage(data?.error, res.status));
  }
  return data as T;
}

export async function requestMusicalDirection(
  instruction: string,
  currentState: Record<string, unknown>
): Promise<MusicalDirectorPatch> {
  const res = await postJson<{ patch: MusicalDirectorPatch }>('/api/ai/direct-music', {
    instruction,
    currentState
  });
  return res.patch;
}

export async function requestAiMotifEvolution(payload: {
  telemetryClusters: Record<string, number>;
  weatherCtx: GeolocationWeatherContext;
  telemetrySignatureLabel: string;
  currentChordSummary: string;
  previousMotifTitle?: string;
  reason?: string;
}): Promise<AiMotifProfile> {
  const res = await postJson<{ motif: AiMotifProfile }>('/api/ai/evolve-motif', payload);
  return res.motif;
}

export async function requestNeuralTtsWav(
  text: string,
  weatherCtx: GeolocationWeatherContext,
  voiceName = 'Kore'
): Promise<{ audioBase64Wav: string; audioMimeType: string }> {
  return postJson<{ audioBase64Wav: string; audioMimeType: string }>('/api/ai/tts', {
    text,
    weatherMood: deriveWeatherVoiceStyle(weatherCtx),
    voiceName
  });
}

export async function requestDuckDbSqlFromEnglish(question: string): Promise<DuckDbNlQueryResponse> {
  return postJson<DuckDbNlQueryResponse>('/api/ai/duckdb-query', { question });
}

export async function requestDuckDbResultSummary(
  question: string,
  sql: string,
  columns: string[],
  rows: unknown[][]
): Promise<string> {
  const res = await postJson<{ summary: string }>('/api/ai/duckdb-summarize', {
    question,
    sql,
    columns,
    rows
  });
  return res.summary;
}

export async function compileSmartAlertRule(description: string): Promise<SmartAlertRule> {
  const res = await postJson<{ rule: SmartAlertRule }>('/api/ai/smart-alert', { description });
  return res.rule;
}

export async function requestAiReleaseKit(payload: {
  weatherCtx: GeolocationWeatherContext;
  bpm: number;
  telemetrySignatureLabel: string;
  scaleName: string;
  chordSummary: string;
  motifTitle?: string;
  standoutReadings: Array<{ domain: string; value: number; unit: string; normalizedPct: number }>;
}): Promise<ReleaseAiKit> {
  return postJson<ReleaseAiKit>('/api/ai/release-kit', payload);
}

/**
 * Pure builder translating live 24-hour telemetry & composition state into a
 * strictly instrumental Google Lyria 3 generation payload.
 */
export function buildLyriaTelemetryPayload(
  mode: LyriaFlowMode,
  plan: Composition32BarPlan,
  weatherCtx: GeolocationWeatherContext,
  options?: {
    directorNote?: string | null;
    evolutionIndex?: number;
    coverArtDataUrl?: string | null;
  }
): LyriaFlowRequestPayload {
  const activeHour = plan.activeTelemetryHour;
  const mapping = activeHour.mapping;
  const domainName = UNIVERSAL_DOMAINS[mapping.domain]?.name ?? mapping.domain;
  const weatherSummary = `${weatherCtx.region}: ${weatherCtx.temperatureC.toFixed(1)}°C, wind ${weatherCtx.windSpeedMs.toFixed(1)} m/s, humidity ${Math.round(weatherCtx.humidityPct)}%, pressure ${weatherCtx.pressureHpa.toFixed(1)} hPa, AQI ${Math.round(weatherCtx.aqi)}`;

  return {
    mode,
    bpm: Math.round(plan.bpm),
    scaleName: plan.scaleName,
    chordSummary: plan.chordProgressionSummary,
    telemetrySignatureLabel: plan.telemetrySignatureLabel,
    activeHourLabel: activeHour.hourLabel,
    activeDomainName: domainName,
    activeInstrument: mapping.instrument,
    circadianPhase: mapping.circadianPhase,
    weatherSummary,
    directorNote: options?.directorNote ?? undefined,
    evolutionIndex: options?.evolutionIndex ?? 0,
    coverArtDataUrl: mode === 'pro' ? (options?.coverArtDataUrl ?? null) : null
  };
}

export async function requestLyriaFlowAudio(
  payload: LyriaFlowRequestPayload
): Promise<LyriaFlowResponse> {
  return postJson<LyriaFlowResponse>('/api/ai/lyria-flow', payload as unknown as Record<string, unknown>);
}

export function computeClusterAverages(
  vector24: Record<DomainCategory, NormalizedDomainReading>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cluster of TELEMETRY_CLUSTERS) {
    let sum = 0;
    let count = 0;
    for (const dom of cluster.domains) {
      const r = vector24[dom];
      if (r) {
        sum += r.normalized;
        count++;
      }
    }
    out[cluster.id] = count > 0 ? Number((sum / count).toFixed(3)) : 0.5;
  }
  return out;
}

// --- Smart Alert Rule Persistence & Live Compound Evaluation ---

const smartAlertListeners = new Set<() => void>();

export function subscribeSmartAlertRules(listener: () => void): () => void {
  smartAlertListeners.add(listener);
  return () => smartAlertListeners.delete(listener);
}

function notifySmartAlertListeners() {
  smartAlertListeners.forEach((cb) => cb());
}

export function loadSmartAlertRules(): SmartAlertRule[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(SMART_ALERT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSmartAlertRules(rules: SmartAlertRule[]) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SMART_ALERT_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // Ignore storage quota errors
  }
  notifySmartAlertListeners();
}

export function addSmartAlertRule(rule: SmartAlertRule): SmartAlertRule[] {
  const existing = loadSmartAlertRules();
  const next = [rule, ...existing];
  saveSmartAlertRules(next);
  return next;
}

export function toggleSmartAlertRule(ruleId: string): SmartAlertRule[] {
  const next = loadSmartAlertRules().map((r) =>
    r.id === ruleId ? { ...r, enabled: !r.enabled } : r
  );
  saveSmartAlertRules(next);
  return next;
}

export function deleteSmartAlertRule(ruleId: string): SmartAlertRule[] {
  const next = loadSmartAlertRules().filter((r) => r.id !== ruleId);
  saveSmartAlertRules(next);
  return next;
}

export interface SmartAlertMetricSnapshot {
  weather: GeolocationWeatherContext;
  vector24: Record<DomainCategory, NormalizedDomainReading>;
}

function readConditionMetric(cond: SmartAlertCondition, snap: SmartAlertMetricSnapshot): number {
  if (cond.metric === 'wind_speed_ms') return snap.weather.windSpeedMs;
  if (cond.metric === 'pressure_hpa') return snap.weather.pressureHpa;
  if (cond.metric === 'temperature_c') return snap.weather.temperatureC;
  if (cond.metric === 'humidity_pct') return snap.weather.humidityPct;
  if (cond.metric === 'aqi') return snap.weather.aqi;
  const reading = snap.vector24[cond.domain];
  if (!reading) return 0;
  if (cond.metric === 'normalized') return reading.normalized * 100;
  return reading.rawValue;
}

/**
 * Evaluates compound multi-domain SmartAlertRules against current & previous telemetry snapshots.
 */
export function evaluateSmartAlertRules(
  rules: SmartAlertRule[],
  current: SmartAlertMetricSnapshot,
  previous?: SmartAlertMetricSnapshot | null
): SmartAlertEvaluationResult {
  const triggeredRules: SmartAlertRule[] = [];
  const reasonsByRuleId: Record<string, string> = {};

  for (const rule of rules) {
    if (!rule.enabled || rule.conditions.length === 0) continue;

    const matchedParts: string[] = [];
    const results = rule.conditions.map((cond) => {
      const currVal = readConditionMetric(cond, current);
      const prevVal = previous ? readConditionMetric(cond, previous) : currVal;
      let pass = false;

      if (cond.operator === 'gt') {
        pass = currVal > cond.threshold;
      } else if (cond.operator === 'lt') {
        pass = currVal < cond.threshold;
      } else if (cond.operator === 'rising') {
        pass = currVal - prevVal > Math.max(0.01, cond.threshold || 0);
      } else if (cond.operator === 'dropping') {
        pass = prevVal - currVal > Math.max(0.01, cond.threshold || 0);
      }

      if (pass) {
        matchedParts.push(`${cond.domain}.${cond.metric}=${currVal.toFixed(1)}`);
      }
      return pass;
    });

    const ruleMatched =
      rule.logic === 'ANY' ? results.some(Boolean) : results.every(Boolean);

    if (ruleMatched) {
      triggeredRules.push(rule);
      reasonsByRuleId[rule.id] = matchedParts.join(' · ');
    }
  }

  const activeIntensityBias = triggeredRules.reduce(
    (sum, r) => sum + (r.sonicIntensityBias ?? 0),
    0
  );

  return {
    triggeredRules,
    activeOrbTintHex: triggeredRules[0]?.orbTintHex ?? null,
    activeIntensityBias: Math.max(-0.35, Math.min(0.35, Number(activeIntensityBias.toFixed(2)))),
    reasonsByRuleId
  };
}
