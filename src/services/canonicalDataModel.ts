/**
 * Weather Beats Universal Intelligence — Canonical Data Model (v1.0.0)
 * Unified 24-domain telemetry model for ingestion, normalization, raw data preservation,
 * validation (JSON Schema Draft 2020-12), and bidirectional registry projection.
 */

import {
  CanonicalConnectorType,
  CanonicalDataType,
  CanonicalTelemetryRecord,
  CanonicalValidationResult,
  DataClass,
  DomainCategory,
  GenericTelemetryDataPoint,
  GenericValidationIssue,
  LocationPayload,
  NormalizationChange,
  OriginType,
  ProvenanceOrigin,
  TelemetryEvent
} from '../types/telemetry';
import { UNIVERSAL_DOMAINS } from './domainRegistry';
import { CANONICAL_DOMAIN_IDS } from './genericDataPointSchema';
import { schemaValidator } from './schemaValidator';

export const CANONICAL_CONNECTOR_TYPES: CanonicalConnectorType[] = [
  'sensor_stream',
  'rest_api',
  'websocket',
  'webhook',
  'dsp_bus',
  'file_import',
  'model_inference',
  'manual_entry'
];

export const CANONICAL_DATA_TYPES: CanonicalDataType[] = [
  'observation',
  'forecast',
  'prediction',
  'metric',
  'event',
  'time_series',
  'audio'
];

export const CANONICAL_ORIGINS: ProvenanceOrigin[] = [
  'sensor',
  'api',
  'database',
  'file_import',
  'user',
  'internal_service',
  'model',
  'external_device'
];

export const CANONICAL_DATA_MODEL_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://weatherbeats.local/schemas/telemetry/1.0.0/canonical-model.schema.json',
  title: 'Weather Beats Universal Intelligence Canonical Data Model',
  description:
    'Unified canonical telemetry data model accommodating all 24 intelligence domains for consistent ingestion, unit normalization, raw payload preservation, and cross-domain analysis.',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'timestamp', 'source', 'domain', 'data_type', 'payload'],
  properties: {
    schema_version: {
      const: '1.0.0',
      description: 'Semantic version of the Weather Beats Canonical Data Model contract.'
    },
    id: {
      type: 'string',
      format: 'uuid',
      description: 'Optional canonical UUID v4 identifier assigned at ingestion or normalization.'
    },
    timestamp: {
      type: 'string',
      format: 'date-time',
      description:
        'Timezone-aware ISO 8601 / RFC 3339 date-time string normalized to UTC during canonical ingestion.'
    },
    source: {
      $ref: '#/$defs/sourceDescriptor'
    },
    domain: {
      type: 'string',
      enum: CANONICAL_DOMAIN_IDS,
      description:
        'Canonical intelligence domain identifier across all 24 Universal Intelligence domains.'
    },
    data_type: {
      type: 'string',
      enum: CANONICAL_DATA_TYPES,
      description:
        'Canonical telemetry taxonomy separating empirical observations, forecasts, predictions, metrics, discrete events, time series, and audio buffers.'
    },
    payload: {
      $ref: '#/$defs/normalizedPayload'
    },
    location: {
      $ref: '#/$defs/location'
    },
    quality: {
      $ref: '#/$defs/quality'
    },
    model_metadata: {
      $ref: '#/$defs/modelMetadata'
    },
    tags: {
      type: 'array',
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 128
      },
      uniqueItems: true
    }
  },
  allOf: [
    {
      if: {
        properties: {
          data_type: {
            enum: ['forecast', 'prediction']
          }
        },
        required: ['data_type']
      },
      then: {
        required: ['model_metadata']
      }
    }
  ],
  $defs: {
    sourceDescriptor: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'provider', 'connector_type'],
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          maxLength: 256,
          pattern: '^\\S(.*\\S)?$',
          description: 'Unique non-empty identifier for the data source, sensor node, host, or feed.'
        },
        provider: {
          type: 'string',
          minLength: 1,
          maxLength: 256,
          pattern: '^\\S(.*\\S)?$',
          description: 'Originating organization, station network, exchange, or telemetry system.'
        },
        connector_type: {
          type: 'string',
          enum: CANONICAL_CONNECTOR_TYPES,
          description: 'Ingestion transport or adapter mechanism supplying this telemetry record.'
        },
        version: {
          type: 'string',
          minLength: 1,
          maxLength: 64
        },
        origin: {
          type: 'string',
          enum: CANONICAL_ORIGINS
        },
        uri: {
          type: 'string',
          format: 'uri'
        },
        node_id: {
          type: 'string',
          minLength: 1,
          maxLength: 128
        }
      }
    },
    normalizedPayload: {
      type: 'object',
      additionalProperties: false,
      required: ['metrics', 'units', 'context', 'raw_data'],
      properties: {
        metrics: {
          type: 'object',
          minProperties: 1,
          additionalProperties: true,
          description: 'Canonical normalized measurements keyed by standardized metric identifier.'
        },
        units: {
          type: 'object',
          additionalProperties: {
            type: 'string',
            minLength: 1,
            maxLength: 64
          },
          description:
            "Map of metric keys to UCUM-aligned canonical unit strings (use '1' for dimensionless values)."
        },
        context: {
          type: 'object',
          additionalProperties: true,
          description:
            'Domain-specific dimensional attributes (e.g., station_id, ticker, host_id, sample_rate_hz).'
        },
        raw_data: {
          type: 'object',
          minProperties: 1,
          additionalProperties: true,
          description: 'Verbatim un-normalized upstream payload preserved for forensic auditability and replay.'
        }
      }
    },
    location: {
      type: 'object',
      additionalProperties: false,
      required: ['latitude', 'longitude', 'coordinate_reference_system'],
      properties: {
        latitude: {
          type: 'number',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number',
          minimum: -180,
          maximum: 180
        },
        altitude_m: {
          type: 'number'
        },
        coordinate_reference_system: {
          const: 'EPSG:4326'
        },
        place_id: {
          type: 'string'
        },
        region: {
          type: 'string'
        },
        country_code: {
          type: 'string',
          pattern: '^[A-Z]{2}$'
        }
      }
    },
    quality: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'validation'],
      properties: {
        status: {
          type: 'string',
          enum: ['valid', 'estimated', 'interpolated', 'corrected', 'suspect', 'degraded', 'invalid']
        },
        validation: {
          type: 'string',
          enum: ['passed', 'warning', 'failed', 'pending']
        },
        quality_score: {
          type: 'number',
          minimum: 0,
          maximum: 1
        },
        flags: {
          type: 'array',
          items: {
            type: 'string'
          },
          uniqueItems: true
        },
        normalization_applied: {
          type: 'array',
          items: {
            type: 'string'
          }
        },
        validation_messages: {
          type: 'array',
          items: {
            type: 'string'
          }
        }
      }
    },
    modelMetadata: {
      type: 'object',
      additionalProperties: false,
      required: ['model_id', 'model_version', 'generated_at', 'input_dataset'],
      properties: {
        model_id: {
          type: 'string',
          minLength: 1
        },
        model_version: {
          type: 'string',
          minLength: 1
        },
        generated_at: {
          type: 'string',
          format: 'date-time'
        },
        input_dataset: {
          type: 'string',
          minLength: 1
        },
        forecast_horizon_seconds: {
          type: 'integer',
          minimum: 0
        },
        valid_until: {
          type: 'string',
          format: 'date-time'
        },
        confidence_interval: {
          type: 'object',
          additionalProperties: false,
          required: ['lower', 'upper'],
          properties: {
            lower: {
              type: 'number'
            },
            upper: {
              type: 'number'
            },
            level: {
              type: 'number',
              exclusiveMinimum: 0,
              exclusiveMaximum: 1
            }
          }
        },
        evaluation_status: {
          type: 'string',
          enum: ['not_evaluated', 'evaluated', 'under_review', 'rejected']
        }
      }
    }
  }
} as const;

const ISO_8601_DATE_TIME_REGEX =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i;
const NON_OUTER_WHITESPACE_PATTERN = /^\S(.*\S)?$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/;

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function isValidUri(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.protocol);
  } catch {
    return false;
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
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

function checkUnknownProperties(
  obj: Record<string, any>,
  allowedKeys: string[],
  basePath: string,
  issues: GenericValidationIssue[]
) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      issues.push({
        path: `${basePath}.${key}`,
        keyword: 'additionalProperties',
        message: `Unexpected property '${key}' at ${basePath} (additionalProperties: false).`
      });
    }
  }
}

function validateNonEmptyIdentifier(
  value: unknown,
  path: string,
  maxLength: number,
  issues: GenericValidationIssue[]
) {
  if (typeof value !== 'string') {
    issues.push({ path, keyword: 'type', message: `Property at '${path}' must be a string.` });
    return;
  }
  if (value.length < 1) {
    issues.push({ path, keyword: 'minLength', message: `Property at '${path}' must not be empty.` });
  }
  if (value.length > maxLength) {
    issues.push({ path, keyword: 'maxLength', message: `Property at '${path}' exceeds maxLength ${maxLength}.` });
  }
  if (value.length >= 1 && !NON_OUTER_WHITESPACE_PATTERN.test(value)) {
    issues.push({
      path,
      keyword: 'pattern',
      message: `Property at '${path}' cannot be whitespace-only or have leading/trailing spaces.`
    });
  }
}

/**
 * Validates any JSON value strictly against canonical-model.schema.json (Draft 2020-12).
 */
export function validateCanonicalRecord(input: unknown): CanonicalValidationResult {
  const issues: GenericValidationIssue[] = [];

  if (!isPlainObject(input)) {
    return {
      isValid: false,
      issues: [{ path: '$', keyword: 'type', message: 'Root canonical record must be a JSON object.' }]
    };
  }

  const requiredRoot = ['schema_version', 'timestamp', 'source', 'domain', 'data_type', 'payload'];
  for (const key of requiredRoot) {
    if (!(key in input) || input[key] === undefined) {
      issues.push({
        path: `$.${key}`,
        keyword: 'required',
        message: `Missing required canonical property '${key}'.`
      });
    }
  }

  const allowedRoot = [
    'schema_version',
    'id',
    'timestamp',
    'source',
    'domain',
    'data_type',
    'payload',
    'location',
    'quality',
    'model_metadata',
    'tags'
  ];
  checkUnknownProperties(input, allowedRoot, '$', issues);

  // schema_version
  if ('schema_version' in input && input.schema_version !== undefined && input.schema_version !== '1.0.0') {
    issues.push({
      path: '$.schema_version',
      keyword: 'const',
      message: `Expected schema_version '1.0.0', got '${String(input.schema_version)}'.`
    });
  }

  // id
  if ('id' in input && input.id !== undefined) {
    if (typeof input.id !== 'string' || !UUID_REGEX.test(input.id)) {
      issues.push({
        path: '$.id',
        keyword: 'format',
        message: "Optional property 'id' must be a valid UUID string."
      });
    }
  }

  // timestamp
  if ('timestamp' in input && input.timestamp !== undefined) {
    if (typeof input.timestamp !== 'string') {
      issues.push({ path: '$.timestamp', keyword: 'type', message: "Property 'timestamp' must be a string." });
    } else if (!isValidIso8601DateTime(input.timestamp)) {
      issues.push({
        path: '$.timestamp',
        keyword: 'format',
        message: "Property 'timestamp' must be a valid timezone-aware ISO 8601 date-time string."
      });
    }
  }

  // source (SourceDescriptor)
  if ('source' in input && input.source !== undefined) {
    if (!isPlainObject(input.source)) {
      issues.push({
        path: '$.source',
        keyword: 'type',
        message: "Property 'source' must be a structured SourceDescriptor object."
      });
    } else {
      const src = input.source;
      for (const reqKey of ['id', 'provider', 'connector_type']) {
        if (!(reqKey in src) || src[reqKey] === undefined) {
          issues.push({
            path: `$.source.${reqKey}`,
            keyword: 'required',
            message: `Missing required SourceDescriptor property '${reqKey}'.`
          });
        }
      }
      checkUnknownProperties(
        src,
        ['id', 'provider', 'connector_type', 'version', 'origin', 'uri', 'node_id'],
        '$.source',
        issues
      );
      if ('id' in src && src.id !== undefined) {
        validateNonEmptyIdentifier(src.id, '$.source.id', 256, issues);
      }
      if ('provider' in src && src.provider !== undefined) {
        validateNonEmptyIdentifier(src.provider, '$.source.provider', 256, issues);
      }
      if ('connector_type' in src && src.connector_type !== undefined) {
        if (typeof src.connector_type !== 'string' || !CANONICAL_CONNECTOR_TYPES.includes(src.connector_type as any)) {
          issues.push({
            path: '$.source.connector_type',
            keyword: 'enum',
            message: `Invalid connector_type '${String(src.connector_type)}'. Allowed: ${CANONICAL_CONNECTOR_TYPES.join(', ')}.`
          });
        }
      }
      if ('origin' in src && src.origin !== undefined) {
        if (typeof src.origin !== 'string' || !CANONICAL_ORIGINS.includes(src.origin as any)) {
          issues.push({
            path: '$.source.origin',
            keyword: 'enum',
            message: `Invalid source origin '${String(src.origin)}'.`
          });
        }
      }
      if ('uri' in src && src.uri !== undefined) {
        if (typeof src.uri !== 'string' || !isValidUri(src.uri)) {
          issues.push({
            path: '$.source.uri',
            keyword: 'format',
            message: "Property 'source.uri' must be a valid URI."
          });
        }
      }
      if ('version' in src && src.version !== undefined) {
        if (typeof src.version !== 'string' || src.version.length < 1 || src.version.length > 64) {
          issues.push({
            path: '$.source.version',
            keyword: 'type',
            message: "Property 'source.version' must be a non-empty string (max 64 chars)."
          });
        }
      }
      if ('node_id' in src && src.node_id !== undefined) {
        if (typeof src.node_id !== 'string' || src.node_id.length < 1 || src.node_id.length > 128) {
          issues.push({
            path: '$.source.node_id',
            keyword: 'type',
            message: "Property 'source.node_id' must be a non-empty string (max 128 chars)."
          });
        }
      }
    }
  }

  // domain
  if ('domain' in input && input.domain !== undefined) {
    if (typeof input.domain !== 'string') {
      issues.push({ path: '$.domain', keyword: 'type', message: "Property 'domain' must be a string." });
    } else if (!CANONICAL_DOMAIN_IDS.includes(input.domain as DomainCategory)) {
      issues.push({
        path: '$.domain',
        keyword: 'enum',
        message: `Domain '${input.domain}' is not one of the 24 canonical intelligence domains.`
      });
    }
  }

  // data_type
  if ('data_type' in input && input.data_type !== undefined) {
    if (typeof input.data_type !== 'string') {
      issues.push({ path: '$.data_type', keyword: 'type', message: "Property 'data_type' must be a string." });
    } else if (!CANONICAL_DATA_TYPES.includes(input.data_type as CanonicalDataType)) {
      issues.push({
        path: '$.data_type',
        keyword: 'enum',
        message: `Invalid data_type '${input.data_type}'. Allowed: ${CANONICAL_DATA_TYPES.join(', ')}.`
      });
    }
  }

  // payload (NormalizedPayload)
  if ('payload' in input && input.payload !== undefined) {
    if (!isPlainObject(input.payload)) {
      issues.push({
        path: '$.payload',
        keyword: 'type',
        message: "Property 'payload' must be a NormalizedPayload object."
      });
    } else {
      const p = input.payload;
      for (const reqKey of ['metrics', 'units', 'context', 'raw_data']) {
        if (!(reqKey in p) || p[reqKey] === undefined) {
          issues.push({
            path: `$.payload.${reqKey}`,
            keyword: 'required',
            message: `Missing required NormalizedPayload property '${reqKey}'.`
          });
        }
      }
      checkUnknownProperties(p, ['metrics', 'units', 'context', 'raw_data'], '$.payload', issues);

      if ('metrics' in p && p.metrics !== undefined) {
        if (!isPlainObject(p.metrics)) {
          issues.push({
            path: '$.payload.metrics',
            keyword: 'type',
            message: "Property 'payload.metrics' must be an object."
          });
        } else if (Object.keys(p.metrics).length < 1) {
          issues.push({
            path: '$.payload.metrics',
            keyword: 'minProperties',
            message: "Property 'payload.metrics' must contain at least one canonical metric."
          });
        }
      }

      if ('units' in p && p.units !== undefined) {
        if (!isPlainObject(p.units)) {
          issues.push({
            path: '$.payload.units',
            keyword: 'type',
            message: "Property 'payload.units' must be an object mapping metric names to unit strings."
          });
        } else {
          for (const [metricKey, unitVal] of Object.entries(p.units)) {
            if (typeof unitVal !== 'string' || unitVal.length < 1 || unitVal.length > 64) {
              issues.push({
                path: `$.payload.units.${metricKey}`,
                keyword: 'type',
                message: `Unit for metric '${metricKey}' must be a non-empty string (max 64 chars).`
              });
            }
          }
        }
      }

      if ('context' in p && p.context !== undefined && !isPlainObject(p.context)) {
        issues.push({
          path: '$.payload.context',
          keyword: 'type',
          message: "Property 'payload.context' must be an object."
        });
      }

      if ('raw_data' in p && p.raw_data !== undefined) {
        if (!isPlainObject(p.raw_data)) {
          issues.push({
            path: '$.payload.raw_data',
            keyword: 'type',
            message: "Property 'payload.raw_data' must be an object preserving upstream source fields."
          });
        } else if (Object.keys(p.raw_data).length < 1) {
          issues.push({
            path: '$.payload.raw_data',
            keyword: 'minProperties',
            message: "Property 'payload.raw_data' must retain at least one upstream field."
          });
        }
      }
    }
  }

  // Optional location
  if ('location' in input && input.location !== undefined) {
    if (!isPlainObject(input.location)) {
      issues.push({ path: '$.location', keyword: 'type', message: "Property 'location' must be an object." });
    } else {
      const loc = input.location;
      for (const reqKey of ['latitude', 'longitude', 'coordinate_reference_system']) {
        if (!(reqKey in loc) || loc[reqKey] === undefined) {
          issues.push({
            path: `$.location.${reqKey}`,
            keyword: 'required',
            message: `Missing required location property '${reqKey}'.`
          });
        }
      }
      checkUnknownProperties(
        loc,
        ['latitude', 'longitude', 'altitude_m', 'coordinate_reference_system', 'place_id', 'region', 'country_code'],
        '$.location',
        issues
      );
      if (typeof loc.latitude !== 'number' || loc.latitude < -90 || loc.latitude > 90) {
        issues.push({
          path: '$.location.latitude',
          keyword: 'minimum',
          message: 'Latitude must be a number in [-90, 90].'
        });
      }
      if (typeof loc.longitude !== 'number' || loc.longitude < -180 || loc.longitude > 180) {
        issues.push({
          path: '$.location.longitude',
          keyword: 'minimum',
          message: 'Longitude must be a number in [-180, 180].'
        });
      }
      if (loc.coordinate_reference_system !== 'EPSG:4326') {
        issues.push({
          path: '$.location.coordinate_reference_system',
          keyword: 'const',
          message: "Location coordinate_reference_system must be 'EPSG:4326'."
        });
      }
      if ('country_code' in loc && loc.country_code !== undefined) {
        if (typeof loc.country_code !== 'string' || !COUNTRY_CODE_REGEX.test(loc.country_code)) {
          issues.push({
            path: '$.location.country_code',
            keyword: 'pattern',
            message: 'country_code must be an uppercase ISO 3166-1 alpha-2 code (e.g., GB, US).'
          });
        }
      }
    }
  }

  // Conditional rule: forecast & prediction require model_metadata
  if (input.data_type === 'forecast' || input.data_type === 'prediction') {
    if (!('model_metadata' in input) || input.model_metadata === undefined) {
      issues.push({
        path: '$.model_metadata',
        keyword: 'required',
        message: `Records with data_type '${input.data_type}' must include 'model_metadata' provenance.`
      });
    }
  }

  // Optional model_metadata validation
  if ('model_metadata' in input && input.model_metadata !== undefined) {
    if (!isPlainObject(input.model_metadata)) {
      issues.push({
        path: '$.model_metadata',
        keyword: 'type',
        message: "Property 'model_metadata' must be an object."
      });
    } else {
      const mm = input.model_metadata;
      for (const reqKey of ['model_id', 'model_version', 'generated_at', 'input_dataset']) {
        if (!(reqKey in mm) || mm[reqKey] === undefined) {
          issues.push({
            path: `$.model_metadata.${reqKey}`,
            keyword: 'required',
            message: `Missing required model_metadata field '${reqKey}'.`
          });
        }
      }
      checkUnknownProperties(
        mm,
        [
          'model_id',
          'model_version',
          'generated_at',
          'input_dataset',
          'forecast_horizon_seconds',
          'valid_until',
          'confidence_interval',
          'evaluation_status'
        ],
        '$.model_metadata',
        issues
      );
      if ('generated_at' in mm && typeof mm.generated_at === 'string' && !isValidIso8601DateTime(mm.generated_at)) {
        issues.push({
          path: '$.model_metadata.generated_at',
          keyword: 'format',
          message: 'model_metadata.generated_at must be a valid ISO 8601 date-time.'
        });
      }
      if ('valid_until' in mm && mm.valid_until !== undefined) {
        if (typeof mm.valid_until !== 'string' || !isValidIso8601DateTime(mm.valid_until)) {
          issues.push({
            path: '$.model_metadata.valid_until',
            keyword: 'format',
            message: 'model_metadata.valid_until must be a valid ISO 8601 date-time.'
          });
        }
      }
    }
  }

  // Optional tags
  if ('tags' in input && input.tags !== undefined) {
    if (!Array.isArray(input.tags)) {
      issues.push({ path: '$.tags', keyword: 'type', message: "Property 'tags' must be an array of strings." });
    } else {
      const seenTags = new Set<string>();
      input.tags.forEach((tag, idx) => {
        if (typeof tag !== 'string' || tag.length < 1 || tag.length > 128) {
          issues.push({
            path: `$.tags[${idx}]`,
            keyword: 'type',
            message: 'Each tag must be a non-empty string (max 128 chars).'
          });
        } else if (seenTags.has(tag)) {
          issues.push({
            path: '$.tags',
            keyword: 'uniqueItems',
            message: `Duplicate tag '${tag}' is not permitted.`
          });
        } else {
          seenTags.add(tag);
        }
      });
    }
  }

  if (issues.length > 0) {
    return { isValid: false, issues };
  }

  return {
    isValid: true,
    issues: [],
    data: input as CanonicalTelemetryRecord
  };
}

const TEMPERATURE_METRICS = new Set([
  'air_temperature',
  'feels_like_temperature',
  'dew_point',
  'soil_temperature',
  'indoor_temperature',
  'machine_temperature',
  'body_temperature',
  'sea_surface_temperature',
  'ground_temperature'
]);

const SPEED_METRICS = new Set(['wind_speed', 'wind_gust', 'current_speed', 'vehicle_speed']);
const PRESSURE_METRICS = new Set(['surface_pressure', 'atmospheric_pressure', 'machine_pressure']);
const POWER_METRICS = new Set(['power', 'energy_generation', 'solar_generation', 'grid_import', 'grid_export']);
const ENERGY_METRICS = new Set(['energy', 'energy_consumption', 'building_energy_consumption']);
const LATENCY_METRICS = new Set(['application_latency', 'inference_latency', 'latency', 'jitter']);
const AUDIO_LEVEL_METRICS = new Set(['peak_amplitude', 'rms_level']);

const DOMAIN_DEFAULT_UNITS: Partial<Record<DomainCategory, string>> = {
  weather: '°C',
  atmospheric: 'hPa',
  environmental: 'µg/m³',
  geographic: 'deg',
  geological: 'M',
  oceanographic: '°C',
  solar: 'W/m²',
  space: 'km',
  biological: 'bpm',
  agricultural: '%',
  industrial: '°C',
  energy: 'kW',
  smart_building: '°C',
  transport: 'm/s',
  network: 'ms',
  computing: '%',
  financial: 'USD',
  economic: '%',
  business: 'USD',
  social_information: '1',
  audio: 'dBFS',
  musical: 'BPM',
  artificial_intelligence: 'ms',
  security: '1'
};

/**
 * Normalizes units, timestamps, and metadata of a CanonicalTelemetryRecord while
 * strictly preserving payload.raw_data verbatim.
 */
export function normalizeCanonicalRecord(record: CanonicalTelemetryRecord): {
  record: CanonicalTelemetryRecord;
  conversions: NormalizationChange[];
} {
  const normalizedUtc = new Date(record.timestamp).toISOString();
  const preservedRaw = deepClone(record.payload.raw_data);
  const nextMetrics: Record<string, any> = deepClone(record.payload.metrics);
  const nextUnits: Record<string, string> = { ...record.payload.units };
  const nextContext: Record<string, any> = deepClone(record.payload.context);
  const conversions: NormalizationChange[] = [];
  const appliedRules: string[] = [];

  if (normalizedUtc !== record.timestamp) {
    appliedRules.push(`timestamp_utc(${record.timestamp} -> ${normalizedUtc})`);
  }

  for (const [key, value] of Object.entries(nextMetrics)) {
    const unit = nextUnits[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;

    // Temperature -> °C
    if (TEMPERATURE_METRICS.has(key) && (unit === '°F' || unit === 'F')) {
      const converted = Number((((value - 32) * 5) / 9).toFixed(2));
      nextMetrics[key] = converted;
      nextUnits[key] = '°C';
      const rule = 'fahrenheit_to_celsius';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: '°C', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }
    if (TEMPERATURE_METRICS.has(key) && unit === 'K') {
      const converted = Number((value - 273.15).toFixed(2));
      nextMetrics[key] = converted;
      nextUnits[key] = '°C';
      const rule = 'kelvin_to_celsius';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: '°C', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }

    // Speed -> m/s
    if (SPEED_METRICS.has(key) && unit === 'km/h') {
      const converted = Number((value / 3.6).toFixed(2));
      nextMetrics[key] = converted;
      nextUnits[key] = 'm/s';
      const rule = 'kmh_to_ms';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: 'm/s', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }
    if (SPEED_METRICS.has(key) && unit === 'mph') {
      const converted = Number((value * 0.44704).toFixed(2));
      nextMetrics[key] = converted;
      nextUnits[key] = 'm/s';
      const rule = 'mph_to_ms';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: 'm/s', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }
    if (SPEED_METRICS.has(key) && (unit === 'knots' || unit === 'kt')) {
      const converted = Number((value * 0.514444).toFixed(2));
      nextMetrics[key] = converted;
      nextUnits[key] = 'm/s';
      const rule = 'knots_to_ms';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: 'm/s', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }

    // Pressure -> hPa
    if (PRESSURE_METRICS.has(key) && unit === 'Pa') {
      const converted = Number((value / 100).toFixed(2));
      nextMetrics[key] = converted;
      nextUnits[key] = 'hPa';
      const rule = 'pa_to_hpa';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: 'hPa', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }
    if (PRESSURE_METRICS.has(key) && unit === 'kPa') {
      const converted = Number((value * 10).toFixed(2));
      nextMetrics[key] = converted;
      nextUnits[key] = 'hPa';
      const rule = 'kpa_to_hpa';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: 'hPa', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }

    // Power -> kW
    if (POWER_METRICS.has(key) && unit === 'W') {
      const converted = Number((value / 1000).toFixed(3));
      nextMetrics[key] = converted;
      nextUnits[key] = 'kW';
      const rule = 'watts_to_kw';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: 'kW', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }
    if (POWER_METRICS.has(key) && unit === 'MW') {
      const converted = Number((value * 1000).toFixed(2));
      nextMetrics[key] = converted;
      nextUnits[key] = 'kW';
      const rule = 'mw_to_kw';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: 'kW', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }

    // Energy -> kWh
    if (ENERGY_METRICS.has(key) && unit === 'Wh') {
      const converted = Number((value / 1000).toFixed(3));
      nextMetrics[key] = converted;
      nextUnits[key] = 'kWh';
      const rule = 'wh_to_kwh';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: 'kWh', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }
    if (ENERGY_METRICS.has(key) && unit === 'MWh') {
      const converted = Number((value * 1000).toFixed(2));
      nextMetrics[key] = converted;
      nextUnits[key] = 'kWh';
      const rule = 'mwh_to_kwh';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: 'kWh', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }

    // Latency -> ms
    if (LATENCY_METRICS.has(key) && unit === 's') {
      const converted = Number((value * 1000).toFixed(2));
      nextMetrics[key] = converted;
      nextUnits[key] = 'ms';
      const rule = 'seconds_to_ms';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: converted, normalizedUnit: 'ms', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }

    // Audio linear gain [0..1] -> dBFS
    if (AUDIO_LEVEL_METRICS.has(key) && (unit === 'linear' || unit === '1')) {
      const dbfs = Number((20 * Math.log10(Math.max(Math.abs(value), 1e-6))).toFixed(2));
      nextMetrics[key] = dbfs;
      nextUnits[key] = 'dBFS';
      const rule = 'linear_to_dbfs';
      conversions.push({ metric: key, rawValue: value, rawUnit: unit, normalizedValue: dbfs, normalizedUnit: 'dBFS', rule });
      appliedRules.push(`${key}: ${rule}`);
      continue;
    }

    // Ensure every metric has a unit entry
    if (!nextUnits[key]) {
      nextUnits[key] = DOMAIN_DEFAULT_UNITS[record.domain] || '1';
    }
  }

  const existingFlags = record.quality?.flags ? [...record.quality.flags] : [];
  if (conversions.length > 0 && !existingFlags.includes('unit_converted')) {
    existingFlags.push('unit_converted');
  }

  const normalizedRecord: CanonicalTelemetryRecord = {
    ...record,
    id: record.id || generateUuidV4(),
    timestamp: normalizedUtc,
    payload: {
      metrics: nextMetrics,
      units: nextUnits,
      context: nextContext,
      raw_data: preservedRaw
    },
    quality: {
      status: conversions.length > 0 ? 'corrected' : record.quality?.status || 'valid',
      validation: record.quality?.validation || 'passed',
      quality_score: record.quality?.quality_score ?? 1.0,
      flags: existingFlags,
      normalization_applied: appliedRules.length > 0 ? appliedRules : record.quality?.normalization_applied || [],
      ...(record.quality?.validation_messages ? { validation_messages: record.quality.validation_messages } : {})
    }
  };

  return { record: normalizedRecord, conversions };
}

const CONTEXT_KEYS = new Set([
  'unit',
  'units',
  'latitude',
  'longitude',
  'altitude_m',
  'region',
  'country_code',
  'station_id',
  'ticker',
  'currency',
  'exchange',
  'host_id',
  'environment',
  'sample_rate_hz',
  'buffer_size',
  'meter_id',
  'site_id',
  'phase',
  'device_id'
]);

/**
 * Upgrades a lightweight GenericTelemetryDataPoint into a full CanonicalTelemetryRecord,
 * separating metrics/units/context while preserving raw_data verbatim and normalizing units.
 */
export function upgradeGenericToCanonical(
  point: GenericTelemetryDataPoint,
  options?: {
    connector_type?: CanonicalConnectorType;
    data_type?: CanonicalDataType;
    provider?: string;
  }
): { record: CanonicalTelemetryRecord; conversions: NormalizationChange[] } {
  const domainMeta = UNIVERSAL_DOMAINS[point.domain];
  const rawPayload = deepClone(point.payload);
  const metrics: Record<string, any> = {};
  const units: Record<string, string> = {};
  const context: Record<string, any> = {};

  const explicitUnitMap = isPlainObject(rawPayload.units) ? rawPayload.units : null;
  const fallbackUnit =
    typeof rawPayload.unit === 'string' && rawPayload.unit.length > 0
      ? rawPayload.unit
      : DOMAIN_DEFAULT_UNITS[point.domain] || '1';

  for (const [key, val] of Object.entries(rawPayload)) {
    if (CONTEXT_KEYS.has(key)) {
      if (key !== 'unit' && key !== 'units') {
        context[key] = val;
      }
      continue;
    }

    if (typeof val === 'number' || typeof val === 'boolean') {
      metrics[key] = val;
      units[key] =
        explicitUnitMap && typeof explicitUnitMap[key] === 'string'
          ? explicitUnitMap[key]
          : fallbackUnit;
    } else if (typeof val === 'string') {
      // Domain identifiers like ticker or weather_condition go to context unless no numeric metric exists
      context[key] = val;
    } else {
      metrics[key] = val;
      units[key] =
        explicitUnitMap && typeof explicitUnitMap[key] === 'string'
          ? explicitUnitMap[key]
          : '1';
    }
  }

  // Ensure at least 1 metric even for purely textual event/status payloads
  if (Object.keys(metrics).length === 0) {
    const firstEntry = Object.entries(rawPayload)[0];
    if (firstEntry) {
      metrics[firstEntry[0]] = firstEntry[1];
      units[firstEntry[0]] = fallbackUnit;
    }
  }

  const hasCoords =
    typeof rawPayload.latitude === 'number' && typeof rawPayload.longitude === 'number';

  const location: LocationPayload | undefined = hasCoords
    ? {
        latitude: rawPayload.latitude,
        longitude: rawPayload.longitude,
        ...(typeof rawPayload.altitude_m === 'number' ? { altitude_m: rawPayload.altitude_m } : {}),
        coordinate_reference_system: 'EPSG:4326',
        ...(typeof rawPayload.region === 'string' ? { region: rawPayload.region } : {}),
        ...(typeof rawPayload.country_code === 'string' ? { country_code: rawPayload.country_code } : {})
      }
    : undefined;

  const inferredDataType: CanonicalDataType =
    options?.data_type || (point.domain === 'audio' ? 'audio' : 'observation');

  const candidate: CanonicalTelemetryRecord = {
    schema_version: '1.0.0',
    id: generateUuidV4(),
    timestamp: point.timestamp,
    source: {
      id: point.source_id,
      provider: options?.provider || (domainMeta ? `${domainMeta.name} Telemetry Adapter` : 'Universal Telemetry Adapter'),
      connector_type: options?.connector_type || (point.domain === 'audio' ? 'dsp_bus' : 'rest_api'),
      version: '1.0.0',
      origin: point.domain === 'audio' ? 'internal_service' : 'api'
    },
    domain: point.domain,
    data_type: inferredDataType,
    payload: {
      metrics,
      units,
      context,
      raw_data: rawPayload
    },
    ...(location ? { location } : {})
  };

  return normalizeCanonicalRecord(candidate);
}

function mapDataTypeToDataClass(dataType: CanonicalDataType): DataClass {
  switch (dataType) {
    case 'forecast':
      return 'forecast';
    case 'prediction':
      return 'prediction';
    case 'metric':
      return 'metric';
    case 'event':
      return 'event';
    case 'time_series':
      return 'time_series';
    case 'audio':
      return 'audio';
    case 'observation':
    default:
      return 'observation';
  }
}

function mapConnectorToOriginType(record: CanonicalTelemetryRecord): OriginType {
  if (record.data_type === 'prediction') return 'ai_generated_inference';
  if (record.data_type === 'forecast') return 'forecast';
  switch (record.source.connector_type) {
    case 'sensor_stream':
    case 'dsp_bus':
      return 'direct_sensor_measurement';
    case 'model_inference':
      return 'ai_generated_inference';
    case 'file_import':
      return 'imported_record';
    case 'manual_entry':
      return 'user_provided_information';
    default:
      return 'third_party_observation';
  }
}

/**
 * Projects a CanonicalTelemetryRecord into a v1.0.0 TelemetryEvent for live bus
 * streaming and DuckDB analytical ingestion.
 */
export function canonicalToTelemetryEvent(record: CanonicalTelemetryRecord): TelemetryEvent {
  const { record: normalized } = normalizeCanonicalRecord(record);
  const domainMeta = UNIVERSAL_DOMAINS[normalized.domain];
  const metricEntries = Object.entries(normalized.payload.metrics);
  const primaryId =
    domainMeta?.sampleMeasurementIds.find((id) => id in normalized.payload.metrics) ||
    metricEntries[0]?.[0] ||
    'canonical_metric';

  const primaryVal = normalized.payload.metrics[primaryId];
  const primaryUnit = normalized.payload.units[primaryId] || DOMAIN_DEFAULT_UNITS[normalized.domain] || '1';
  const rawCandidate = normalized.payload.raw_data[primaryId];

  const ingestedAt = new Date().toISOString();
  const eventId = normalized.id || generateUuidV4();

  const candidateEvent: TelemetryEvent = {
    schema_version: '1.0.0',
    event_id: eventId,
    domain: normalized.domain,
    source_id: normalized.source.id,
    connector_id: `${normalized.source.connector_type}_canonical_v1`,
    data_class: mapDataTypeToDataClass(normalized.data_type),
    origin_type: mapConnectorToOriginType(normalized),
    event_time: normalized.timestamp,
    ingested_at: ingestedAt,
    original_timezone: 'UTC',
    measurement: {
      measurement_id: primaryId,
      value: primaryVal,
      unit: primaryUnit,
      ...(typeof rawCandidate === 'number' || typeof rawCandidate === 'string' || typeof rawCandidate === 'boolean'
        ? { raw_value: rawCandidate }
        : {}),
      raw_unit: primaryUnit
    },
    ...(normalized.location ? { location: normalized.location } : {}),
    provenance: {
      origin: normalized.source.origin || 'api',
      provider: normalized.source.provider,
      source_record_id: `${normalized.source.id}_${Date.parse(normalized.timestamp)}`,
      ...(normalized.source.uri ? { source_uri: normalized.source.uri } : {}),
      retrieved_at: ingestedAt,
      source_version: normalized.source.version || '1.0.0'
    },
    quality: {
      status: normalized.quality?.status || 'valid',
      validation: normalized.quality?.validation || 'passed',
      quality_score: normalized.quality?.quality_score ?? 1.0,
      flags: (normalized.quality?.flags as any[]) || []
    },
    ...(normalized.model_metadata ? { model_metadata: normalized.model_metadata } : {}),
    ...(normalized.tags ? { tags: normalized.tags } : {}),
    context: normalized.payload.context,
    extensions: {
      canonical_model_schema: CANONICAL_DATA_MODEL_SCHEMA.$id,
      canonical_data_type: normalized.data_type,
      canonical_record: normalized
    }
  };

  return schemaValidator.validateEvent(candidateEvent).processedEvent;
}

/**
 * Converts an existing TelemetryEvent v1.0.0 into a CanonicalTelemetryRecord.
 */
export function telemetryEventToCanonical(event: TelemetryEvent): CanonicalTelemetryRecord {
  const dataType: CanonicalDataType =
    event.data_class === 'forecast' ||
    event.data_class === 'prediction' ||
    event.data_class === 'metric' ||
    event.data_class === 'event' ||
    event.data_class === 'time_series' ||
    event.data_class === 'audio'
      ? event.data_class
      : 'observation';

  const connectorType: CanonicalConnectorType =
    event.origin_type === 'ai_generated_inference'
      ? 'model_inference'
      : event.origin_type === 'direct_sensor_measurement'
      ? event.domain === 'audio'
        ? 'dsp_bus'
        : 'sensor_stream'
      : event.origin_type === 'imported_record'
      ? 'file_import'
      : 'rest_api';

  const measId = event.measurement.measurement_id;
  const rawPayload =
    event.extensions?.raw_payload && isPlainObject(event.extensions.raw_payload)
      ? event.extensions.raw_payload
      : {
          [measId]: event.measurement.raw_value ?? event.measurement.value,
          unit: event.measurement.raw_unit || event.measurement.unit
        };

  return {
    schema_version: '1.0.0',
    id: event.event_id,
    timestamp: new Date(event.event_time).toISOString(),
    source: {
      id: event.source_id,
      provider: event.provenance.provider,
      connector_type: connectorType,
      version: event.provenance.source_version || '1.0.0',
      origin: event.provenance.origin,
      ...(event.provenance.source_uri ? { uri: event.provenance.source_uri } : {})
    },
    domain: event.domain,
    data_type: dataType,
    payload: {
      metrics: {
        [measId]: event.measurement.value
      },
      units: {
        [measId]: event.measurement.unit
      },
      context: event.context ? deepClone(event.context) : {},
      raw_data: deepClone(rawPayload)
    },
    ...(event.location ? { location: event.location } : {}),
    quality: {
      status: event.quality.status,
      validation: event.quality.validation,
      quality_score: event.quality.quality_score,
      flags: event.quality.flags
    },
    ...(event.model_metadata ? { model_metadata: event.model_metadata } : {}),
    ...(event.tags ? { tags: event.tags } : {})
  };
}
