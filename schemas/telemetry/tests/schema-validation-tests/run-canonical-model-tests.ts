/**
 * Weather Beats Universal Intelligence — Canonical Data Model Test Suite
 * Verifies Draft 2020-12 schema parity, 24-domain validation, unit normalization
 * with verbatim raw_data preservation, negative rejection rules, and adapters.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CANONICAL_CONNECTOR_TYPES,
  CANONICAL_DATA_MODEL_SCHEMA,
  CANONICAL_DATA_TYPES,
  canonicalToTelemetryEvent,
  normalizeCanonicalRecord,
  telemetryEventToCanonical,
  upgradeGenericToCanonical,
  validateCanonicalRecord
} from '../../../../src/services/canonicalDataModel';
import { schemaValidator } from '../../../../src/services/schemaValidator';
import { CanonicalTelemetryRecord, GenericTelemetryDataPoint } from '../../../../src/types/telemetry';

const validDir = 'schemas/telemetry/tests/valid-events';
const invalidDir = 'schemas/telemetry/tests/invalid-events';
fs.mkdirSync(validDir, { recursive: true });
fs.mkdirSync(invalidDir, { recursive: true });

// 1. Verify disk JSON Schema matches TypeScript export identically
const diskSchemaRaw = fs.readFileSync('schemas/telemetry/canonical-model.schema.json', 'utf8');
const diskSchema = JSON.parse(diskSchemaRaw);

assert.equal(diskSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.equal(diskSchema.$id, CANONICAL_DATA_MODEL_SCHEMA.$id);
assert.equal(diskSchema.additionalProperties, false);
assert.deepEqual(diskSchema.required, [
  'schema_version',
  'timestamp',
  'source',
  'domain',
  'data_type',
  'payload'
]);
assert.equal(diskSchema.properties.domain.enum.length, 24);
assert.deepEqual(diskSchema.properties.data_type.enum, CANONICAL_DATA_TYPES);
assert.deepEqual(
  diskSchema.$defs.sourceDescriptor.properties.connector_type.enum,
  CANONICAL_CONNECTOR_TYPES
);
assert.deepEqual(diskSchema, CANONICAL_DATA_MODEL_SCHEMA);

// 2. Positive Canonical Fixtures across diverse domains
const validCanonicalFixtures: Array<{ name: string; data: CanonicalTelemetryRecord }> = [
  {
    name: 'canonical-weather-fahrenheit.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00-08:00',
      source: {
        id: 'noaa_metar_ksfo_01',
        provider: 'NOAA Aviation Weather Center',
        connector_type: 'rest_api',
        version: '2.1.0',
        origin: 'api'
      },
      domain: 'weather',
      data_type: 'observation',
      payload: {
        metrics: {
          air_temperature: 68,
          wind_speed: 10,
          relative_humidity: 65
        },
        units: {
          air_temperature: '°F',
          wind_speed: 'mph',
          relative_humidity: '%'
        },
        context: {
          station_id: 'KSFO',
          weather_condition: 'clear'
        },
        raw_data: {
          temp_f: 68,
          wind_mph: 10,
          rh_pct: 65
        }
      },
      location: {
        latitude: 37.6213,
        longitude: -122.379,
        coordinate_reference_system: 'EPSG:4326',
        country_code: 'US'
      }
    }
  },
  {
    name: 'canonical-financial-ws.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00.250Z',
      source: {
        id: 'nasdaq_itch_feed_02',
        provider: 'NASDAQ L1 Market Stream',
        connector_type: 'websocket',
        origin: 'api'
      },
      domain: 'financial',
      data_type: 'time_series',
      payload: {
        metrics: {
          asset_price: 186.42,
          trade_volume: 61200
        },
        units: {
          asset_price: 'USD',
          trade_volume: '1'
        },
        context: {
          ticker: 'WBUI',
          exchange: 'NASDAQ',
          currency: 'USD'
        },
        raw_data: {
          sym: 'WBUI',
          px: 186.42,
          sz: 61200
        }
      }
    }
  },
  {
    name: 'canonical-audio-dsp.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      source: {
        id: 'mandala_vst3_dsp_01',
        provider: 'Weather Beats DSP Engine',
        connector_type: 'dsp_bus',
        origin: 'internal_service',
        node_id: 'coreaudio-48k-node'
      },
      domain: 'audio',
      data_type: 'audio',
      payload: {
        metrics: {
          peak_amplitude: 0.5,
          spectral_centroid: 1480
        },
        units: {
          peak_amplitude: 'linear',
          spectral_centroid: 'Hz'
        },
        context: {
          sample_rate_hz: 48000,
          buffer_size: 1024
        },
        raw_data: {
          peak_linear: 0.5,
          centroid_hz: 1480,
          sample_rate_hz: 48000,
          block_size: 1024
        }
      }
    }
  },
  {
    name: 'canonical-energy-watts.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      source: {
        id: 'substation_uk_grid_07',
        provider: 'National Grid Telemetry Bus',
        connector_type: 'sensor_stream',
        origin: 'sensor'
      },
      domain: 'energy',
      data_type: 'metric',
      payload: {
        metrics: {
          power: 450000
        },
        units: {
          power: 'W'
        },
        context: {
          site_id: 'london_south_07',
          phase: 'three_phase'
        },
        raw_data: {
          active_power_watts: 450000
        }
      }
    }
  },
  {
    name: 'canonical-security-event.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      source: {
        id: 'siem_edge_gateway_03',
        provider: 'Weather Beats ZeroTrust Sensor',
        connector_type: 'webhook',
        origin: 'internal_service'
      },
      domain: 'security',
      data_type: 'event',
      payload: {
        metrics: {
          failed_login_count: 14
        },
        units: {
          failed_login_count: 'count'
        },
        context: {
          region: 'eu-west-2',
          severity: 'elevated'
        },
        raw_data: {
          failed_auth_attempts: 14,
          gateway_id: 'gw-eu-03'
        }
      }
    }
  },
  {
    name: 'canonical-weather-prediction.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T20:45:00Z',
      source: {
        id: 'wb_forecast_engine_01',
        provider: 'Weather Beats Inference Pipeline',
        connector_type: 'model_inference',
        origin: 'model'
      },
      domain: 'weather',
      data_type: 'prediction',
      payload: {
        metrics: {
          air_temperature: 17.4
        },
        units: {
          air_temperature: '°C'
        },
        context: {
          station_id: 'EGLL'
        },
        raw_data: {
          predicted_temp_c: 17.4
        }
      },
      model_metadata: {
        model_id: 'weatherbeats_temporal_ensemble',
        model_version: '2.5.0',
        generated_at: '2026-11-15T19:45:00Z',
        input_dataset: 'noaa_metar_1h_window',
        forecast_horizon_seconds: 3600,
        evaluation_status: 'evaluated'
      }
    }
  }
];

for (const fixture of validCanonicalFixtures) {
  fs.writeFileSync(path.join(validDir, fixture.name), JSON.stringify(fixture.data, null, 2));
  const validation = validateCanonicalRecord(fixture.data);
  assert.equal(
    validation.isValid,
    true,
    `Expected ${fixture.name} to be valid, got: ${JSON.stringify(validation.issues)}`
  );

  const { record: normalized } = normalizeCanonicalRecord(fixture.data);
  // Verbatim raw_data must always remain intact after normalization
  assert.deepEqual(normalized.payload.raw_data, fixture.data.payload.raw_data);

  // Validate normalized output also conforms to canonical schema
  const postNormValidation = validateCanonicalRecord(normalized);
  assert.equal(
    postNormValidation.isValid,
    true,
    `Expected normalized ${fixture.name} to remain schema-valid, got: ${JSON.stringify(postNormValidation.issues)}`
  );

  // Project to TelemetryEvent v1.0.0 and validate
  const projectedEvent = canonicalToTelemetryEvent(normalized);
  const eventReport = schemaValidator.validateEvent(projectedEvent);
  assert.equal(eventReport.isValid, true);
  assert.equal(projectedEvent.domain, fixture.data.domain);
  assert.equal(projectedEvent.source_id, fixture.data.source.id);

  // Round-trip back to CanonicalTelemetryRecord
  const roundTripped = telemetryEventToCanonical(projectedEvent);
  assert.equal(roundTripped.domain, fixture.data.domain);
  assert.equal(roundTripped.source.id, fixture.data.source.id);
}

// 3. Verify exact unit normalization calculations
const weatherInput = validCanonicalFixtures[0].data;
const weatherNorm = normalizeCanonicalRecord(weatherInput);
assert.equal(weatherNorm.record.timestamp, '2026-11-16T03:45:00.000Z');
assert.equal(weatherNorm.record.payload.metrics.air_temperature, 20);
assert.equal(weatherNorm.record.payload.units.air_temperature, '°C');
assert.equal(weatherNorm.record.payload.metrics.wind_speed, 4.47);
assert.equal(weatherNorm.record.payload.units.wind_speed, 'm/s');
assert.deepEqual(weatherNorm.record.payload.raw_data, weatherInput.payload.raw_data);
assert.ok(weatherNorm.record.quality?.flags?.includes('unit_converted'));

const energyNorm = normalizeCanonicalRecord(validCanonicalFixtures[3].data);
assert.equal(energyNorm.record.payload.metrics.power, 450);
assert.equal(energyNorm.record.payload.units.power, 'kW');

const audioNorm = normalizeCanonicalRecord(validCanonicalFixtures[2].data);
assert.ok(Math.abs(audioNorm.record.payload.metrics.peak_amplitude - -6.02) < 0.05);
assert.equal(audioNorm.record.payload.units.peak_amplitude, 'dBFS');

// 4. Verify GenericTelemetryDataPoint -> CanonicalTelemetryRecord lossless upgrade
const genericPoint: GenericTelemetryDataPoint = {
  timestamp: '2026-11-15T19:45:00Z',
  source_id: 'wstation_generic_01',
  domain: 'weather',
  payload: {
    air_temperature: 77,
    unit: '°F',
    latitude: 51.5,
    longitude: -0.12
  }
};
const upgraded = upgradeGenericToCanonical(genericPoint);
assert.equal(upgraded.record.payload.metrics.air_temperature, 25);
assert.equal(upgraded.record.payload.units.air_temperature, '°C');
assert.deepEqual(upgraded.record.payload.raw_data, genericPoint.payload);
assert.equal(validateCanonicalRecord(upgraded.record).isValid, true);

// 5. Negative Canonical Validation Fixtures
const invalidCanonicalFixtures: Array<{ name: string; data: unknown; expectedKeyword: string }> = [
  {
    name: 'canonical-invalid-missing-source.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      domain: 'weather',
      data_type: 'observation',
      payload: {
        metrics: { air_temperature: 20 },
        units: { air_temperature: '°C' },
        context: {},
        raw_data: { temp: 20 }
      }
    },
    expectedKeyword: 'required'
  },
  {
    name: 'canonical-invalid-connector-type.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      source: {
        id: 'sensor_01',
        provider: 'Test Org',
        connector_type: 'telepathy_bus'
      },
      domain: 'weather',
      data_type: 'observation',
      payload: {
        metrics: { air_temperature: 20 },
        units: { air_temperature: '°C' },
        context: {},
        raw_data: { temp: 20 }
      }
    },
    expectedKeyword: 'enum'
  },
  {
    name: 'canonical-invalid-data-type.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      source: {
        id: 'sensor_01',
        provider: 'Test Org',
        connector_type: 'rest_api'
      },
      domain: 'weather',
      data_type: 'random_blob',
      payload: {
        metrics: { air_temperature: 20 },
        units: { air_temperature: '°C' },
        context: {},
        raw_data: { temp: 20 }
      }
    },
    expectedKeyword: 'enum'
  },
  {
    name: 'canonical-invalid-prediction-missing-model-metadata.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      source: {
        id: 'ml_node_01',
        provider: 'Weather Beats AI',
        connector_type: 'model_inference'
      },
      domain: 'weather',
      data_type: 'prediction',
      payload: {
        metrics: { air_temperature: 21 },
        units: { air_temperature: '°C' },
        context: {},
        raw_data: { temp: 21 }
      }
    },
    expectedKeyword: 'required'
  },
  {
    name: 'canonical-invalid-empty-metrics.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      source: {
        id: 'sensor_01',
        provider: 'Test Org',
        connector_type: 'sensor_stream'
      },
      domain: 'computing',
      data_type: 'metric',
      payload: {
        metrics: {},
        units: {},
        context: {},
        raw_data: { cpu: 10 }
      }
    },
    expectedKeyword: 'minProperties'
  },
  {
    name: 'canonical-invalid-missing-raw-data.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      source: {
        id: 'sensor_01',
        provider: 'Test Org',
        connector_type: 'sensor_stream'
      },
      domain: 'computing',
      data_type: 'metric',
      payload: {
        metrics: { cpu_usage: 22 },
        units: { cpu_usage: '%' },
        context: {}
      }
    },
    expectedKeyword: 'required'
  },
  {
    name: 'canonical-invalid-extra-root-property.json',
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      source: {
        id: 'sensor_01',
        provider: 'Test Org',
        connector_type: 'sensor_stream'
      },
      domain: 'computing',
      data_type: 'metric',
      payload: {
        metrics: { cpu_usage: 22 },
        units: { cpu_usage: '%' },
        context: {},
        raw_data: { cpu_usage: 22 }
      },
      extra_field: 'not_allowed'
    },
    expectedKeyword: 'additionalProperties'
  }
];

for (const fixture of invalidCanonicalFixtures) {
  fs.writeFileSync(path.join(invalidDir, fixture.name), JSON.stringify(fixture.data, null, 2));
  const result = validateCanonicalRecord(fixture.data);
  assert.equal(result.isValid, false, `Expected ${fixture.name} to fail validation`);
  assert.ok(
    result.issues.some((i) => i.keyword === fixture.expectedKeyword),
    `Expected ${fixture.name} to report keyword '${fixture.expectedKeyword}', got: ${JSON.stringify(result.issues)}`
  );
}

console.log(
  `Canonical Data Model Tests: ${validCanonicalFixtures.length} positive + ${invalidCanonicalFixtures.length} negative fixtures + normalization & adapters PASSED.`
);
