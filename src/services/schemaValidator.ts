/**
 * Weather Beats Universal Intelligence — Telemetry Semantic Validation Engine
 * Enforces the 10 Semantic Rules accompanying the Canonical Schema Registry v1.0.0.
 */

import { TelemetryEvent, QualityPayload, ValidationStatus } from '../types/telemetry';

export interface ValidationReport {
  isValid: boolean;
  validationStatus: ValidationStatus;
  qualityScore: number;
  flags: string[];
  messages: string[];
  processedEvent: TelemetryEvent;
}

// Allowed unit rules per measurement identifier (Rule 2: Unit Validation)
const ALLOWED_UNITS: Record<string, string[]> = {
  air_temperature: ['°C', 'K', '°F'],
  feels_like_temperature: ['°C', 'K', '°F'],
  relative_humidity: ['%', '1'],
  surface_pressure: ['hPa', 'Pa', 'bar'],
  wind_speed: ['m/s', 'km/h', 'knots'],
  wind_direction: ['deg', 'rad'],
  precipitation: ['mm', 'm'],
  rainfall: ['mm', 'm'],
  pm2_5: ['µg/m³', 'mg/m³'],
  pm10: ['µg/m³', 'mg/m³'],
  carbon_dioxide: ['ppm', '1'],
  noise_level: ['dBA', 'dB'],
  latitude: ['deg', 'EPSG:4326'],
  longitude: ['deg', 'EPSG:4326'],
  elevation: ['m', 'ft'],
  power: ['kW', 'W', 'MW'],
  energy: ['kWh', 'MWh', 'J'],
  voltage: ['V', 'mV', 'kV'],
  frequency: ['Hz', 'kHz'],
  cpu_usage: ['%', '1'],
  memory_usage: ['%', 'MB', 'GB'],
  peak_amplitude: ['dB', 'dBFS'],
  rms_level: ['dB', 'dBFS'],
  spectral_centroid: ['Hz'],
  tempo_bpm: ['BPM', '1'],
  inference_latency: ['ms', 's'],
  failed_login_count: ['count', '1']
};

class SchemaValidator {
  private seenEventIds: Set<string> = new Set();

  public validateEvent(event: TelemetryEvent): ValidationReport {
    const flags: string[] = [];
    const messages: string[] = [];
    let isValid = true;
    let qualityScore = 1.0;

    // Rule 10: Schema Evolution / Version check
    if (event.schema_version !== '1.0.0') {
      flags.push('invalid_schema_version');
      messages.push(`Unsupported schema version: ${event.schema_version}. Expected 1.0.0.`);
      isValid = false;
      qualityScore *= 0.0;
    }

    // Rule 1: Timestamp Integrity
    const eventTimeMs = new Date(event.event_time).getTime();
    const ingestedAtMs = new Date(event.ingested_at).getTime();
    const retrievedAtMs = new Date(event.provenance.retrieved_at).getTime();
    const nowMs = Date.now();

    if (isNaN(eventTimeMs) || isNaN(ingestedAtMs) || isNaN(retrievedAtMs)) {
      flags.push('stale');
      messages.push('One or more timestamps are invalid ISO date-time strings.');
      isValid = false;
      qualityScore *= 0.5;
    } else {
      // Clock skew detection (> 10 seconds into the future)
      if (eventTimeMs > nowMs + 10000) {
        flags.push('clock_skew');
        messages.push('Event time detected in future (>10s clock skew).');
        qualityScore *= 0.8;
      }
    }

    // Rule 2: Unit Validation (UCUM Compatibility)
    const measId = event.measurement.measurement_id;
    const suppliedUnit = event.measurement.unit;
    if (ALLOWED_UNITS[measId] && !ALLOWED_UNITS[measId].includes(suppliedUnit)) {
      flags.push('unit_converted');
      messages.push(`Unit mismatch for ${measId}: '${suppliedUnit}' is non-standard. Expected one of: ${ALLOWED_UNITS[measId].join(', ')}`);
      qualityScore *= 0.85;
    }

    // Rule 3: Measurement Range Checks
    const val = event.measurement.value;
    if (typeof val === 'number') {
      if (measId === 'air_temperature' && (val < -100 || val > 70)) {
        flags.push('outlier');
        messages.push(`Air temperature value ${val}°C exceeds physical range [-100, 70].`);
        qualityScore *= 0.4;
      } else if (measId === 'relative_humidity' && (val < 0 || val > 100)) {
        flags.push('outlier');
        messages.push(`Relative humidity ${val}% exceeds valid range [0, 100].`);
        qualityScore *= 0.4;
      } else if (measId === 'latitude' && (val < -90 || val > 90)) {
        flags.push('outlier');
        messages.push(`Latitude ${val} exceeds WGS84 range [-90, 90].`);
        isValid = false;
      }
    }

    // Rule 4: Provenance
    if (!event.provenance.provider || !event.provenance.source_record_id) {
      flags.push('partial');
      messages.push('Missing provider or source record ID in provenance payload.');
      qualityScore *= 0.9;
    }

    // Rule 6: Prediction Integrity (Forecasts and predictions must include model_metadata)
    if (event.data_class === 'forecast' || event.data_class === 'prediction') {
      if (!event.model_metadata || !event.model_metadata.model_id) {
        flags.push('modelled');
        messages.push(`Data class '${event.data_class}' requires valid model_metadata payload.`);
        qualityScore *= 0.7;
      }
    }

    // Rule 7: Location Validation (EPSG:4326)
    if (event.location) {
      if (event.location.coordinate_reference_system !== 'EPSG:4326') {
        flags.push('unit_converted');
        messages.push(`Location CRS must be EPSG:4326. Got: ${event.location.coordinate_reference_system}`);
      }
      if (Math.abs(event.location.latitude) > 90 || Math.abs(event.location.longitude) > 180) {
        flags.push('outlier');
        messages.push(`Invalid location coordinates: lat ${event.location.latitude}, lon ${event.location.longitude}`);
        isValid = false;
      }
    }

    // Rule 8: Duplicate Detection
    if (this.seenEventIds.has(event.event_id)) {
      flags.push('duplicate_suspected');
      messages.push(`Event ID '${event.event_id}' has already been ingested.`);
      qualityScore *= 0.5;
    } else {
      this.seenEventIds.add(event.event_id);
      if (this.seenEventIds.size > 10000) {
        // Prevent unbounded memory growth
        const first = this.seenEventIds.values().next().value;
        if (first) this.seenEventIds.delete(first);
      }
    }

    const validationStatus: ValidationStatus = !isValid
      ? 'failed'
      : flags.length > 0
      ? 'warning'
      : 'passed';

    const qualityStatus = qualityScore >= 0.9 ? 'valid' : qualityScore >= 0.7 ? 'estimated' : 'degraded';

    // Update quality payload on event
    const updatedQuality: QualityPayload = {
      status: qualityStatus,
      validation: validationStatus,
      quality_score: Number(qualityScore.toFixed(2)),
      flags: flags as any[],
      validation_messages: messages
    };

    const processedEvent: TelemetryEvent = {
      ...event,
      quality: updatedQuality
    };

    return {
      isValid,
      validationStatus,
      qualityScore: Number(qualityScore.toFixed(2)),
      flags,
      messages,
      processedEvent
    };
  }
}

export const schemaValidator = new SchemaValidator();
