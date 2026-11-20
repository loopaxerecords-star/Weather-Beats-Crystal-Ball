/**
 * Weather Beats Universal Intelligence — Threshold Alert Engine & Persistence
 * Manages per-domain / per-metric low & high threshold rules and breach evaluation.
 */

import { DomainCategory, TelemetryEvent } from '../types/telemetry';

export interface MetricThreshold {
  low?: number;
  high?: number;
  enabled: boolean;
}

export type ThresholdStatus = 'high' | 'low' | 'normal' | 'unconfigured';

export interface ThresholdEvaluation {
  status: ThresholdStatus;
  value?: number;
  threshold?: MetricThreshold;
  breachedLimit?: number;
}

export interface ThresholdBoundHint {
  min: number;
  max: number;
  step: number;
}

const STORAGE_KEY = 'wb_threshold_alerts_v1';

export const DEFAULT_DOMAIN_THRESHOLDS: Partial<
  Record<DomainCategory, Record<string, MetricThreshold>>
> = {
  weather: {
    air_temperature: { low: 16, high: 21, enabled: true },
    relative_humidity: { low: 30, high: 85, enabled: true },
    wind_speed: { low: 0.5, high: 15, enabled: true },
    surface_pressure: { low: 995, high: 1030, enabled: true }
  },
  environmental: {
    pm2_5: { low: 8, high: 16, enabled: true },
    pm10: { low: 10, high: 45, enabled: true },
    carbon_dioxide: { low: 350, high: 1000, enabled: true },
    noise_level: { low: 35, high: 75, enabled: true }
  },
  geographic: {
    latitude: { low: 51.504, high: 51.51, enabled: true }
  },
  energy: {
    power: { low: 380, high: 470, enabled: true },
    voltage: { low: 215, high: 245, enabled: true },
    frequency: { low: 49.8, high: 50.2, enabled: true }
  },
  computing: {
    cpu_usage: { low: 15, high: 40, enabled: true },
    memory_usage: { low: 20, high: 85, enabled: true },
    application_latency: { low: 5, high: 120, enabled: true }
  },
  audio: {
    peak_amplitude: { low: -12, high: 0, enabled: true },
    rms_level: { low: -28, high: -6, enabled: true }
  },
  musical: {
    tempo_bpm: { low: 90, high: 140, enabled: true }
  },
  financial: {
    asset_price: { low: 150, high: 220, enabled: true }
  },
  security: {
    failed_login_count: { low: 0, high: 10, enabled: true }
  }
};

export function makeThresholdKey(domainId: DomainCategory, measurementId: string): string {
  return `${domainId}:${measurementId}`;
}

export function loadAllThresholds(): Record<string, MetricThreshold> {
  const defaults: Record<string, MetricThreshold> = {};
  for (const [domain, metrics] of Object.entries(DEFAULT_DOMAIN_THRESHOLDS)) {
    if (!metrics) continue;
    for (const [measId, rule] of Object.entries(metrics)) {
      defaults[makeThresholdKey(domain as DomainCategory, measId)] = { ...rule };
    }
  }

  if (typeof window === 'undefined' || !window.localStorage) {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaults;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function saveAllThresholds(map: Record<string, MetricThreshold>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function resetDomainThresholds(
  domainId: DomainCategory,
  currentMap: Record<string, MetricThreshold>
): Record<string, MetricThreshold> {
  const next: Record<string, MetricThreshold> = {};
  const prefix = `${domainId}:`;

  for (const [key, val] of Object.entries(currentMap)) {
    if (!key.startsWith(prefix)) {
      next[key] = val;
    }
  }

  const defaults = DEFAULT_DOMAIN_THRESHOLDS[domainId];
  if (defaults) {
    for (const [measId, rule] of Object.entries(defaults)) {
      next[makeThresholdKey(domainId, measId)] = { ...rule };
    }
  }

  saveAllThresholds(next);
  return next;
}

export function evaluateThreshold(
  value: unknown,
  threshold?: MetricThreshold
): ThresholdEvaluation {
  if (
    !threshold ||
    !threshold.enabled ||
    (threshold.low === undefined && threshold.high === undefined)
  ) {
    return {
      status: 'unconfigured',
      value: typeof value === 'number' ? value : undefined,
      threshold
    };
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      status: 'normal',
      threshold
    };
  }

  // Guard against invalid inverted bounds
  if (
    threshold.low !== undefined &&
    threshold.high !== undefined &&
    threshold.low >= threshold.high
  ) {
    return {
      status: 'normal',
      value,
      threshold
    };
  }

  if (threshold.high !== undefined && value > threshold.high) {
    return {
      status: 'high',
      value,
      threshold,
      breachedLimit: threshold.high
    };
  }

  if (threshold.low !== undefined && value < threshold.low) {
    return {
      status: 'low',
      value,
      threshold,
      breachedLimit: threshold.low
    };
  }

  return {
    status: 'normal',
    value,
    threshold
  };
}

export function getSliderBoundsForMetric(
  values: number[],
  threshold?: MetricThreshold
): ThresholdBoundHint {
  const samples = [...values];
  if (threshold?.low !== undefined && Number.isFinite(threshold.low)) samples.push(threshold.low);
  if (threshold?.high !== undefined && Number.isFinite(threshold.high)) samples.push(threshold.high);

  if (samples.length === 0) {
    return { min: 0, max: 100, step: 1 };
  }

  const rawMin = Math.min(...samples);
  const rawMax = Math.max(...samples);
  const span = Math.max(rawMax - rawMin, Math.abs(rawMax) * 0.25, 1);

  const min = Number((rawMin - span * 0.4).toFixed(4));
  const max = Number((rawMax + span * 0.4).toFixed(4));
  const totalSpan = max - min;
  const step = totalSpan <= 0.1 ? 0.0005 : totalSpan <= 5 ? 0.1 : totalSpan <= 100 ? 0.5 : 1;

  return { min, max, step };
}

export interface ThresholdAlertHistoryItem {
  id: string;
  eventId: string;
  domainId: DomainCategory;
  measurementId: string;
  breachType: 'high' | 'low';
  value: number;
  unit: string;
  thresholdLimit: number;
  delta: number;
  triggeredAt: string;
  sourceId: string;
  dataClass: string;
}

const HISTORY_STORAGE_KEY = 'wb_threshold_alert_history_v1';
const MAX_HISTORY_ITEMS = 250;

export function loadAlertHistory(): ThresholdAlertHistoryItem[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAlertHistory(items: ThresholdAlertHistoryItem[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS))
    );
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function evaluateEventForBreachHistory(
  event: TelemetryEvent,
  thresholds: Record<string, MetricThreshold>
): ThresholdAlertHistoryItem | null {
  const measId = event.measurement.measurement_id;
  const rule = thresholds[makeThresholdKey(event.domain, measId)];
  const evaluation = evaluateThreshold(event.measurement.value, rule);

  if (
    (evaluation.status !== 'high' && evaluation.status !== 'low') ||
    evaluation.value === undefined ||
    evaluation.breachedLimit === undefined
  ) {
    return null;
  }

  const delta = Number(Math.abs(evaluation.value - evaluation.breachedLimit).toFixed(3));

  return {
    id: `${event.event_id}:${evaluation.status}:${evaluation.breachedLimit}`,
    eventId: event.event_id,
    domainId: event.domain,
    measurementId: measId,
    breachType: evaluation.status,
    value: evaluation.value,
    unit: event.measurement.unit,
    thresholdLimit: evaluation.breachedLimit,
    delta,
    triggeredAt: event.event_time,
    sourceId: event.source_id,
    dataClass: event.data_class
  };
}

export function appendUniqueBreachHistory(
  currentHistory: ThresholdAlertHistoryItem[],
  incoming: ThresholdAlertHistoryItem[]
): ThresholdAlertHistoryItem[] {
  if (incoming.length === 0) return currentHistory;

  const seenEventIds = new Set(currentHistory.map((item) => item.eventId));
  const additions: ThresholdAlertHistoryItem[] = [];

  for (const item of incoming) {
    if (!seenEventIds.has(item.eventId)) {
      seenEventIds.add(item.eventId);
      additions.push(item);
    }
  }

  if (additions.length === 0) return currentHistory;

  const combined = [...additions, ...currentHistory]
    .sort((a, b) => Date.parse(b.triggeredAt) - Date.parse(a.triggeredAt))
    .slice(0, MAX_HISTORY_ITEMS);

  saveAlertHistory(combined);
  return combined;
}

export function scanEventsForBreaches(
  events: TelemetryEvent[],
  thresholds: Record<string, MetricThreshold>,
  currentHistory: ThresholdAlertHistoryItem[]
): ThresholdAlertHistoryItem[] {
  const breaches: ThresholdAlertHistoryItem[] = [];
  for (const evt of events) {
    const item = evaluateEventForBreachHistory(evt, thresholds);
    if (item) breaches.push(item);
  }
  return appendUniqueBreachHistory(currentHistory, breaches);
}

export function clearDomainAlertHistory(
  domainId: DomainCategory,
  currentHistory: ThresholdAlertHistoryItem[]
): ThresholdAlertHistoryItem[] {
  const next = currentHistory.filter((item) => item.domainId !== domainId);
  saveAlertHistory(next);
  return next;
}

