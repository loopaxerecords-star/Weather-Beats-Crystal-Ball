/**
 * Weather Beats Universal Intelligence — Telemetry CSV Export Tests
 * Verifies RFC 4180 field escaping, canonical column serialization, and filename formatting.
 */

import assert from 'node:assert/strict';
import {
  buildTelemetryCsvFilename,
  escapeCsvField,
  serializeTelemetryEventsToCsv,
  TELEMETRY_CSV_HEADERS
} from '../../../../src/services/csvExport';
import { TelemetryEvent } from '../../../../src/types/telemetry';

// 1. Escaping rules (commas, quotes, newlines, null/undefined, objects)
assert.equal(escapeCsvField(null), '');
assert.equal(escapeCsvField(undefined), '');
assert.equal(escapeCsvField('simple'), 'simple');
assert.equal(escapeCsvField('London, GB'), '"London, GB"');
assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
assert.equal(escapeCsvField('line1\nline2'), '"line1\nline2"');
assert.equal(escapeCsvField({ a: 1 }), '"{""a"":1}"');

// 2. Empty event list emits header row only
const emptyCsv = serializeTelemetryEventsToCsv([]);
assert.equal(emptyCsv, TELEMETRY_CSV_HEADERS.join(','));

// 3. Full event serialization with special characters & optional blocks
const sampleEvent: TelemetryEvent = {
  schema_version: '1.0.0',
  event_id: 'evt-csv-001',
  domain: 'weather',
  source_id: 'noaa_01',
  connector_id: 'rest_v1',
  data_class: 'observation',
  origin_type: 'direct_sensor_measurement',
  event_time: '2026-11-15T20:14:00Z',
  ingested_at: '2026-11-15T20:14:01Z',
  measurement: {
    measurement_id: 'air_temperature',
    value: 18.4,
    unit: '°C'
  },
  location: {
    latitude: 51.5074,
    longitude: -0.1278,
    coordinate_reference_system: 'EPSG:4326',
    region: 'London, UK',
    country_code: 'GB'
  },
  provenance: {
    origin: 'sensor',
    provider: 'Met Office "Alpha"',
    source_record_id: 'rec-001',
    retrieved_at: '2026-11-15T20:14:00Z'
  },
  quality: {
    status: 'valid',
    validation: 'passed',
    quality_score: 0.99
  }
};

const csvOutput = serializeTelemetryEventsToCsv([sampleEvent]);
const lines = csvOutput.split('\r\n');
assert.equal(lines.length, 2);
assert.equal(lines[0], TELEMETRY_CSV_HEADERS.join(','));
assert.ok(lines[1].includes('"Met Office ""Alpha"""'));
assert.ok(lines[1].includes('"London, UK"'));
assert.ok(lines[1].startsWith('evt-csv-001,2026-11-15T20:14:00Z,2026-11-15T20:14:01Z,weather,air_temperature,18.4,°C'));

// 4. Filename formatting
const filename = buildTelemetryCsvFilename('weather', new Date('2026-11-15T20:14:08.123Z'));
assert.equal(filename, 'weather-beats-telemetry-weather-2026-11-15T20-14-08Z.csv');

console.log('Telemetry CSV Export Tests: RFC 4180 escaping, serialization & filenames PASSED.');
