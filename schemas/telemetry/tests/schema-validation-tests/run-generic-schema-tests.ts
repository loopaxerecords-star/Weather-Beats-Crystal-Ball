/**
 * Weather Beats Universal Intelligence — Generic Telemetry Data Point Schema Test Suite
 * Verifies Draft 2020-12 schema definition, validation rules, negative rejection cases,
 * and lossless mapping into the 24-domain canonical telemetry registry (v1.0.0).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  GENERIC_DATA_POINT_SCHEMA,
  mapGenericToCanonicalEvent,
  validateGenericDataPoint
} from '../../../../src/services/genericDataPointSchema';
import { schemaValidator } from '../../../../src/services/schemaValidator';

const validDir = 'schemas/telemetry/tests/valid-events';
const invalidDir = 'schemas/telemetry/tests/invalid-events';
fs.mkdirSync(validDir, { recursive: true });
fs.mkdirSync(invalidDir, { recursive: true });

// 1. Verify disk JSON Schema matches TypeScript definition
const diskSchemaRaw = fs.readFileSync('schemas/telemetry/generic-data-point.schema.json', 'utf8');
const diskSchema = JSON.parse(diskSchemaRaw);

assert.equal(diskSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.equal(diskSchema.$id, GENERIC_DATA_POINT_SCHEMA.$id);
assert.equal(diskSchema.additionalProperties, false);
assert.deepEqual(diskSchema.required, ['timestamp', 'source_id', 'domain', 'payload']);
assert.equal(diskSchema.properties.domain.enum.length, 24);
assert.deepEqual(diskSchema, GENERIC_DATA_POINT_SCHEMA);

// 2. Positive test fixtures across domains
const validFixtures = [
  {
    name: 'generic-weather-valid.json',
    data: {
      timestamp: '2026-11-12T21:47:46Z',
      source_id: 'wstation_london_heathrow_01',
      domain: 'weather',
      payload: {
        air_temperature: 14.8,
        relative_humidity: 72,
        unit: '°C',
        latitude: 51.47,
        longitude: -0.4543
      }
    }
  },
  {
    name: 'generic-financial-valid.json',
    data: {
      timestamp: '2026-11-12T21:47:46-05:00',
      source_id: 'feed_nasdaq_l1_node_04',
      domain: 'financial',
      payload: {
        ticker: 'WBUI',
        asset_price: 184.62,
        trade_volume: 42500,
        unit: 'USD'
      }
    }
  },
  {
    name: 'generic-computing-valid.json',
    data: {
      timestamp: '2026-11-12T21:47:46.120Z',
      source_id: 'host_macstudio_m3_01',
      domain: 'computing',
      payload: {
        cpu_usage: 31.4,
        memory_usage: 58.2,
        unit: '%'
      }
    }
  }
];

for (const fixture of validFixtures) {
  fs.writeFileSync(path.join(validDir, fixture.name), JSON.stringify(fixture.data, null, 2));
  const result = validateGenericDataPoint(fixture.data);
  assert.equal(result.isValid, true, `Expected ${fixture.name} to be valid, got: ${JSON.stringify(result.issues)}`);
  assert.ok(result.data, 'Expected validated data to be returned');

  const mapped = mapGenericToCanonicalEvent(result.data);
  assert.equal(mapped.schema_version, '1.0.0');
  assert.equal(mapped.domain, fixture.data.domain);
  assert.equal(mapped.source_id, fixture.data.source_id);
  assert.equal(mapped.event_time, new Date(fixture.data.timestamp).toISOString());
  assert.deepEqual(mapped.extensions?.raw_payload, fixture.data.payload);

  const canonicalReport = schemaValidator.validateEvent(mapped);
  assert.equal(canonicalReport.isValid, true, `Expected canonical mapping for ${fixture.name} to pass validation`);
}

// 3. Negative test fixtures
const invalidFixtures = [
  {
    name: 'generic-invalid-missing-fields.json',
    data: {
      timestamp: '2026-11-12T21:47:46Z',
      domain: 'weather'
    },
    expectedKeyword: 'required'
  },
  {
    name: 'generic-invalid-timestamp-no-tz.json',
    data: {
      timestamp: '2026-11-12T21:47:46',
      source_id: 'sensor_01',
      domain: 'weather',
      payload: { air_temperature: 20 }
    },
    expectedKeyword: 'format'
  },
  {
    name: 'generic-invalid-calendar-date.json',
    data: {
      timestamp: '2026-02-30T21:47:46Z',
      source_id: 'sensor_01',
      domain: 'weather',
      payload: { air_temperature: 20 }
    },
    expectedKeyword: 'format'
  },
  {
    name: 'generic-invalid-source-id-whitespace.json',
    data: {
      timestamp: '2026-11-12T21:47:46Z',
      source_id: '   ',
      domain: 'weather',
      payload: { air_temperature: 20 }
    },
    expectedKeyword: 'pattern'
  },
  {
    name: 'generic-invalid-domain.json',
    data: {
      timestamp: '2026-11-12T21:47:46Z',
      source_id: 'sensor_01',
      domain: 'astrology',
      payload: { reading: 1 }
    },
    expectedKeyword: 'enum'
  },
  {
    name: 'generic-invalid-empty-payload.json',
    data: {
      timestamp: '2026-11-12T21:47:46Z',
      source_id: 'sensor_01',
      domain: 'financial',
      payload: {}
    },
    expectedKeyword: 'minProperties'
  },
  {
    name: 'generic-invalid-extra-root-property.json',
    data: {
      timestamp: '2026-11-12T21:47:46Z',
      source_id: 'sensor_01',
      domain: 'financial',
      payload: { asset_price: 100 },
      unexpected: true
    },
    expectedKeyword: 'additionalProperties'
  }
];

for (const fixture of invalidFixtures) {
  fs.writeFileSync(path.join(invalidDir, fixture.name), JSON.stringify(fixture.data, null, 2));
  const result = validateGenericDataPoint(fixture.data);
  assert.equal(result.isValid, false, `Expected ${fixture.name} to fail validation`);
  assert.ok(
    result.issues.some((i) => i.keyword === fixture.expectedKeyword),
    `Expected ${fixture.name} to contain keyword '${fixture.expectedKeyword}', got: ${JSON.stringify(result.issues)}`
  );
}

console.log(`Generic Telemetry Data Point Schema Tests: ${validFixtures.length} positive & ${invalidFixtures.length} negative fixtures PASSED.`);
