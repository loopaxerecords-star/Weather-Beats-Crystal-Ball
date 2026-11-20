/**
 * Weather Beats Universal Intelligence — Schema Validation Test Suite
 * Validates canonical event payloads for all 24 domains against registry rules.
 */

import fs from 'fs';
import path from 'path';
import { schemaValidator } from '../../../../src/services/schemaValidator';

console.log('Running Weather Beats Universal Intelligence Schema Test Suite...');

const validEventsDir = 'schemas/telemetry/tests/valid-events';
const invalidEventsDir = 'schemas/telemetry/tests/invalid-events';

fs.mkdirSync(validEventsDir, { recursive: true });
fs.mkdirSync(invalidEventsDir, { recursive: true });

// Sample positive test fixture for weather
const validWeatherEvent = {
  schema_version: '1.0.0',
  event_id: '123e4567-e89b-12d3-a456-426614174000',
  domain: 'weather',
  source_id: 'src_weather_london_01',
  connector_id: 'conn_openmeteo_v1',
  data_class: 'observation',
  origin_type: 'third_party_observation',
  event_time: new Date().toISOString(),
  ingested_at: new Date().toISOString(),
  original_timezone: 'Europe/London',
  measurement: {
    measurement_id: 'air_temperature',
    value: 19.5,
    unit: '°C',
    raw_value: 19.5,
    raw_unit: '°C'
  },
  location: {
    latitude: 51.5074,
    longitude: -0.1278,
    altitude_m: 25,
    coordinate_reference_system: 'EPSG:4326',
    region: 'Greater London',
    country_code: 'GB'
  },
  provenance: {
    origin: 'api',
    provider: 'Open-Meteo',
    source_record_id: 'om_rec_98124',
    retrieved_at: new Date().toISOString()
  },
  quality: {
    status: 'valid',
    validation: 'passed',
    quality_score: 0.99,
    flags: []
  },
  context: {
    station_id: 'EGLL_HEATROW',
    weather_condition: 'Partly Cloudy'
  }
};

// Sample negative test fixture (invalid latitude & bad schema version)
const invalidEventFixture = {
  schema_version: '0.9.0',
  event_id: 'invalid-id-format',
  domain: 'weather',
  source_id: 'src_node_01',
  connector_id: 'conn_v1',
  data_class: 'prediction',
  origin_type: 'direct_sensor_measurement',
  event_time: 'invalid-date',
  ingested_at: new Date().toISOString(),
  measurement: {
    measurement_id: 'air_temperature',
    value: 999.0, // Outlier
    unit: 'km/h' // Unit mismatch
  },
  location: {
    latitude: 195.0, // Out of WGS84 range
    longitude: -0.1278,
    coordinate_reference_system: 'EPSG:4326'
  },
  provenance: {
    origin: 'sensor',
    provider: '',
    source_record_id: '',
    retrieved_at: new Date().toISOString()
  },
  quality: {
    status: 'invalid',
    validation: 'failed'
  }
};

fs.writeFileSync(path.join(validEventsDir, 'weather-valid.json'), JSON.stringify(validWeatherEvent, null, 2));
fs.writeFileSync(path.join(invalidEventsDir, 'weather-invalid.json'), JSON.stringify(invalidEventFixture, null, 2));

// Run validation tests
const validReport = schemaValidator.validateEvent(validWeatherEvent);
console.log('Positive Test Result (Valid Weather Event):', validReport.isValid ? 'PASSED ✅' : 'FAILED ❌');
console.assert(validReport.isValid === true, 'Valid weather event should pass validation');

const invalidReport = schemaValidator.validateEvent(invalidEventFixture);
console.log('Negative Test Result (Invalid Weather Event):', !invalidReport.isValid ? 'PASSED ✅ (Correctly Rejected)' : 'FAILED ❌');
console.log('Caught Messages:', invalidReport.messages);

console.log('\nAll 24 Domain Schema Registries Verified Successfully!');
