/**
 * Weather Beats Universal Intelligence — Generic Telemetry Data Point Schema & Adapter
 * JSON Schema Draft 2020-12 Validator and Canonical 24-Domain Mapper.
 */

import {
  DomainCategory,
  GenericTelemetryDataPoint,
  GenericValidationIssue,
  GenericValidationResult,
  TelemetryEvent
} from '../types/telemetry';
import { UNIVERSAL_DOMAINS } from './domainRegistry';
import { schemaValidator } from './schemaValidator';

export const CANONICAL_DOMAIN_IDS: DomainCategory[] = [
  'weather',
  'atmospheric',
  'environmental',
  'geographic',
  'geological',
  'oceanographic',
  'solar',
  'space',
  'biological',
  'agricultural',
  'industrial',
  'energy',
  'smart_building',
  'transport',
  'network',
  'computing',
  'financial',
  'economic',
  'business',
  'social_information',
  'audio',
  'musical',
  'artificial_intelligence',
  'security'
];

export const GENERIC_DATA_POINT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://weatherbeats.local/schemas/telemetry/1.0.0/generic-data-point.schema.json',
  title: 'Weather Beats Generic Telemetry Data Point',
  description:
    'Standalone lightweight ingestion envelope for generic telemetry data points mapping to the 24-domain canonical telemetry registry.',
  type: 'object',
  additionalProperties: false,
  required: ['timestamp', 'source_id', 'domain', 'payload'],
  properties: {
    timestamp: {
      type: 'string',
      format: 'date-time',
      description:
        'ISO 8601 / RFC 3339 date-time string indicating when the telemetry data point was recorded (e.g., 2026-11-12T21:47:46Z or 2026-11-12T21:47:46-08:00).'
    },
    source_id: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      pattern: '^\\S(.*\\S)?$',
      description:
        'Unique non-empty identifier for the originating data source, sensor node, or external connector.'
    },
    domain: {
      type: 'string',
      enum: CANONICAL_DOMAIN_IDS,
      description:
        "Canonical intelligence domain identifier (e.g., 'weather', 'financial') matching the 24-domain Universal Intelligence registry."
    },
    payload: {
      type: 'object',
      minProperties: 1,
      additionalProperties: true,
      description:
        'Domain-specific telemetry data object holding measurements, metrics, and contextual attributes.'
    }
  }
} as const;

const ISO_8601_DATE_TIME_REGEX =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i;

const SOURCE_ID_PATTERN = /^\S(.*\S)?$/;

function isValidIso8601DateTime(value: string): boolean {
  const match = ISO_8601_DATE_TIME_REGEX.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (hour > 23 || minute > 59 || second > 59) return false;

  // Validate actual calendar date (e.g. reject Feb 30 or Apr 31)
  const checkDate = new Date(Date.UTC(year, month - 1, day));
  if (
    checkDate.getUTCFullYear() !== year ||
    checkDate.getUTCMonth() !== month - 1 ||
    checkDate.getUTCDate() !== day
  ) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates an arbitrary value strictly against generic-data-point.schema.json (Draft 2020-12).
 */
export function validateGenericDataPoint(input: unknown): GenericValidationResult {
  const issues: GenericValidationIssue[] = [];

  if (!isPlainObject(input)) {
    return {
      isValid: false,
      issues: [
        {
          path: '$',
          keyword: 'type',
          message: 'Root value must be a JSON object.'
        }
      ]
    };
  }

  const requiredKeys = ['timestamp', 'source_id', 'domain', 'payload'] as const;
  for (const key of requiredKeys) {
    if (!(key in input) || input[key] === undefined) {
      issues.push({
        path: `$.${key}`,
        keyword: 'required',
        message: `Missing required property '${key}'.`
      });
    }
  }

  // additionalProperties: false at root
  const allowedKeys = new Set<string>(requiredKeys);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: `$.${key}`,
        keyword: 'additionalProperties',
        message: `Property '${key}' is not permitted on root envelope (additionalProperties: false).`
      });
    }
  }

  // Validate timestamp
  if ('timestamp' in input && input.timestamp !== undefined) {
    if (typeof input.timestamp !== 'string') {
      issues.push({
        path: '$.timestamp',
        keyword: 'type',
        message: "Property 'timestamp' must be a string."
      });
    } else if (!isValidIso8601DateTime(input.timestamp)) {
      issues.push({
        path: '$.timestamp',
        keyword: 'format',
        message:
          "Property 'timestamp' must be a valid timezone-aware ISO 8601 date-time (e.g., 2026-11-12T21:47:46Z)."
      });
    }
  }

  // Validate source_id
  if ('source_id' in input && input.source_id !== undefined) {
    if (typeof input.source_id !== 'string') {
      issues.push({
        path: '$.source_id',
        keyword: 'type',
        message: "Property 'source_id' must be a string."
      });
    } else {
      if (input.source_id.length < 1) {
        issues.push({
          path: '$.source_id',
          keyword: 'minLength',
          message: "Property 'source_id' must be at least 1 character long."
        });
      }
      if (input.source_id.length > 256) {
        issues.push({
          path: '$.source_id',
          keyword: 'maxLength',
          message: "Property 'source_id' must not exceed 256 characters."
        });
      }
      if (input.source_id.length >= 1 && !SOURCE_ID_PATTERN.test(input.source_id)) {
        issues.push({
          path: '$.source_id',
          keyword: 'pattern',
          message: "Property 'source_id' cannot be whitespace-only or have leading/trailing spaces."
        });
      }
    }
  }

  // Validate domain
  if ('domain' in input && input.domain !== undefined) {
    if (typeof input.domain !== 'string') {
      issues.push({
        path: '$.domain',
        keyword: 'type',
        message: "Property 'domain' must be a string."
      });
    } else if (!CANONICAL_DOMAIN_IDS.includes(input.domain as DomainCategory)) {
      issues.push({
        path: '$.domain',
        keyword: 'enum',
        message: `Domain '${input.domain}' is not one of the 24 canonical domains (e.g., 'weather', 'financial', 'computing').`
      });
    }
  }

  // Validate payload
  if ('payload' in input && input.payload !== undefined) {
    if (!isPlainObject(input.payload)) {
      issues.push({
        path: '$.payload',
        keyword: 'type',
        message: "Property 'payload' must be a JSON object holding domain-specific data."
      });
    } else if (Object.keys(input.payload).length < 1) {
      issues.push({
        path: '$.payload',
        keyword: 'minProperties',
        message: "Property 'payload' must contain at least one domain-specific property."
      });
    }
  }

  if (issues.length > 0) {
    return {
      isValid: false,
      issues
    };
  }

  return {
    isValid: true,
    issues: [],
    data: {
      timestamp: input.timestamp as string,
      source_id: input.source_id as string,
      domain: input.domain as DomainCategory,
      payload: input.payload as Record<string, any>
    }
  };
}

function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const DEFAULT_DOMAIN_UNITS: Partial<Record<DomainCategory, string>> = {
  weather: '°C',
  environmental: 'µg/m³',
  geographic: 'deg',
  energy: 'kW',
  computing: '%',
  audio: 'dB',
  musical: 'BPM',
  financial: 'USD',
  network: 'ms',
  security: '1'
};

/**
 * Maps a validated generic telemetry data point into a full Canonical TelemetryEvent (v1.0.0).
 */
export function mapGenericToCanonicalEvent(point: GenericTelemetryDataPoint): TelemetryEvent {
  const domainMeta = UNIVERSAL_DOMAINS[point.domain];
  const eventTimeUtc = new Date(point.timestamp).toISOString();
  const ingestedAtUtc = new Date().toISOString();
  const eventId = generateUuidV4();

  const payloadEntries = Object.entries(point.payload);
  const candidateMeasId =
    domainMeta?.sampleMeasurementIds.find((id) => id in point.payload) ||
    payloadEntries[0]?.[0] ||
    'generic_metric';

  const rawValue = point.payload[candidateMeasId];
  const unit =
    typeof point.payload.unit === 'string' && point.payload.unit.length > 0
      ? point.payload.unit
      : DEFAULT_DOMAIN_UNITS[point.domain] || '1';

  const hasCoords =
    typeof point.payload.latitude === 'number' &&
    typeof point.payload.longitude === 'number';

  const candidateEvent: TelemetryEvent = {
    schema_version: '1.0.0',
    event_id: eventId,
    domain: point.domain,
    source_id: point.source_id,
    connector_id: 'generic_envelope_adapter_v1',
    data_class: 'observation',
    origin_type: 'imported_record',
    event_time: eventTimeUtc,
    ingested_at: ingestedAtUtc,
    measurement: {
      measurement_id: candidateMeasId,
      value: rawValue !== undefined ? rawValue : point.payload,
      unit,
      raw_value: typeof rawValue === 'number' || typeof rawValue === 'string' || typeof rawValue === 'boolean' ? rawValue : undefined,
      raw_unit: unit
    },
    ...(hasCoords
      ? {
          location: {
            latitude: point.payload.latitude,
            longitude: point.payload.longitude,
            ...(typeof point.payload.altitude_m === 'number' ? { altitude_m: point.payload.altitude_m } : {}),
            coordinate_reference_system: 'EPSG:4326' as const
          }
        }
      : {}),
    provenance: {
      origin: 'api',
      provider: domainMeta ? `${domainMeta.name} Generic Adapter` : 'Generic Telemetry Adapter',
      source_record_id: `${point.source_id}_${Date.parse(eventTimeUtc)}`,
      retrieved_at: ingestedAtUtc,
      source_version: '1.0.0'
    },
    quality: {
      status: 'valid',
      validation: 'passed',
      quality_score: 1.0,
      flags: []
    },
    extensions: {
      generic_envelope_schema: GENERIC_DATA_POINT_SCHEMA.$id,
      raw_payload: point.payload
    }
  };

  return schemaValidator.validateEvent(candidateEvent).processedEvent;
}
