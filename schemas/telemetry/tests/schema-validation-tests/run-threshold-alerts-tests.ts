/**
 * Weather Beats Universal Intelligence — Threshold Alert Engine & History Tests
 * Verifies 'high', 'low', 'normal', and 'unconfigured' evaluations, inverted bound safety,
 * domain threshold defaults/reset helpers, and historical breach tracking/deduplication.
 */

import assert from 'node:assert/strict';
import {
  appendUniqueBreachHistory,
  clearDomainAlertHistory,
  DEFAULT_DOMAIN_THRESHOLDS,
  evaluateEventForBreachHistory,
  evaluateThreshold,
  getSliderBoundsForMetric,
  loadAllThresholds,
  makeThresholdKey,
  resetDomainThresholds,
  saveAllThresholds,
  scanEventsForBreaches,
  ThresholdAlertHistoryItem
} from '../../../../src/services/thresholdAlerts';
import { TelemetryEvent } from '../../../../src/types/telemetry';

// 1. Evaluate high breach
const highResult = evaluateThreshold(24.5, { low: 16, high: 21, enabled: true });
assert.equal(highResult.status, 'high');
assert.equal(highResult.breachedLimit, 21);
assert.equal(highResult.value, 24.5);

// 2. Evaluate low breach
const lowResult = evaluateThreshold(14.2, { low: 16, high: 21, enabled: true });
assert.equal(lowResult.status, 'low');
assert.equal(lowResult.breachedLimit, 16);
assert.equal(lowResult.value, 14.2);

// 3. Evaluate normal in-range
const normalResult = evaluateThreshold(18.5, { low: 16, high: 21, enabled: true });
assert.equal(normalResult.status, 'normal');

// 4. Evaluate disabled / unconfigured
assert.equal(evaluateThreshold(50, { low: 16, high: 21, enabled: false }).status, 'unconfigured');
assert.equal(evaluateThreshold(50, { enabled: true }).status, 'unconfigured');

// 5. Guard against inverted bounds (low >= high)
assert.equal(evaluateThreshold(25, { low: 30, high: 20, enabled: true }).status, 'normal');

// 6. Slider bounds calculation includes active thresholds
const bounds = getSliderBoundsForMetric([18, 19, 20], { low: 10, high: 30, enabled: true });
assert.ok(bounds.min < 10);
assert.ok(bounds.max > 30);

// 7. Load & reset defaults
const loaded = loadAllThresholds();
const weatherKey = makeThresholdKey('weather', 'air_temperature');
assert.deepEqual(loaded[weatherKey], DEFAULT_DOMAIN_THRESHOLDS.weather?.air_temperature);

const modified = { ...loaded, [weatherKey]: { low: 5, high: 45, enabled: false } };
const reset = resetDomainThresholds('weather', modified);
assert.deepEqual(reset[weatherKey], DEFAULT_DOMAIN_THRESHOLDS.weather?.air_temperature);

// 8. Historical breach tracking, deduplication, sorting & domain clearing
const makeWeatherEvent = (id: string, temp: number, time: string): TelemetryEvent => ({
  schema_version: '1.0.0',
  event_id: id,
  domain: 'weather',
  source_id: 'wstation_test_01',
  connector_id: 'sensor_v1',
  data_class: 'observation',
  origin_type: 'direct_sensor_measurement',
  event_time: time,
  ingested_at: time,
  measurement: {
    measurement_id: 'air_temperature',
    value: temp,
    unit: '°C'
  },
  provenance: {
    origin: 'sensor',
    provider: 'Test Met',
    source_record_id: id,
    retrieved_at: time
  },
  quality: {
    status: 'valid',
    validation: 'passed'
  }
});

const eHigh = makeWeatherEvent('evt-high-1', 23.5, '2026-11-15T20:05:00Z');
const eNormal = makeWeatherEvent('evt-norm-1', 18.5, '2026-11-15T20:06:00Z');
const eLow = makeWeatherEvent('evt-low-1', 14.0, '2026-11-15T20:07:00Z');

assert.equal(evaluateEventForBreachHistory(eNormal, loaded), null);
const highBreach = evaluateEventForBreachHistory(eHigh, loaded);
assert.ok(highBreach);
assert.equal(highBreach?.breachType, 'high');
assert.equal(highBreach?.delta, 2.5);

let history: ThresholdAlertHistoryItem[] = [];
history = scanEventsForBreaches([eHigh, eNormal, eLow], loaded, history);
assert.equal(history.length, 2);
// Most recent breach appears first
assert.equal(history[0].eventId, 'evt-low-1');
assert.equal(history[0].breachType, 'low');
assert.equal(history[0].delta, 2);
assert.equal(history[1].eventId, 'evt-high-1');

// Deduplicate identical event IDs
history = appendUniqueBreachHistory(history, [highBreach!]);
assert.equal(history.length, 2);

// Clear only selected domain history
const energyBreachItem: ThresholdAlertHistoryItem = {
  id: 'energy-1:high:470',
  eventId: 'energy-1',
  domainId: 'energy',
  measurementId: 'power',
  breachType: 'high',
  value: 495,
  unit: 'kW',
  thresholdLimit: 470,
  delta: 25,
  triggeredAt: '2026-11-15T20:08:00Z',
  sourceId: 'grid_01',
  dataClass: 'metric'
};
history = appendUniqueBreachHistory(history, [energyBreachItem]);
assert.equal(history.length, 3);

const afterWeatherClear = clearDomainAlertHistory('weather', history);
assert.equal(afterWeatherClear.length, 1);
assert.equal(afterWeatherClear[0].domainId, 'energy');

// 9. Verify localStorage persistence round-trip for custom per-domain thresholds
const mockStorage = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (mockStorage.has(k) ? mockStorage.get(k)! : null),
    setItem: (k: string, v: string) => mockStorage.set(k, v)
  }
};

const customKey = makeThresholdKey('computing', 'cpu_usage');
const customMap = {
  ...loaded,
  [customKey]: { low: 10, high: 75, enabled: true }
};
saveAllThresholds(customMap);
const reloaded = loadAllThresholds();
assert.deepEqual(reloaded[customKey], { low: 10, high: 75, enabled: true });

console.log('Threshold Alert Engine, Persistence & History Tests PASSED.');
