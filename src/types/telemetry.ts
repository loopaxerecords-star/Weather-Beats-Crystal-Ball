/**
 * Weather Beats Universal Intelligence — Canonical Telemetry Types (Schema v1.0.0)
 * Standard: JSON Schema Draft 2020-12
 * Identifier: "https://weatherbeats.local/schemas/telemetry/1.0.0/registry.schema.json"
 */

export type DomainCategory =
  | 'weather'
  | 'atmospheric'
  | 'environmental'
  | 'geographic'
  | 'geological'
  | 'oceanographic'
  | 'solar'
  | 'space'
  | 'biological'
  | 'agricultural'
  | 'industrial'
  | 'energy'
  | 'smart_building'
  | 'transport'
  | 'network'
  | 'computing'
  | 'financial'
  | 'economic'
  | 'business'
  | 'social_information'
  | 'audio'
  | 'musical'
  | 'artificial_intelligence'
  | 'security';

export type TelemetryStatus =
  | 'LIVE'
  | 'SIMULATED'
  | 'HISTORICAL'
  | 'NOT CONNECTED'
  | 'ERROR'
  | 'PREDICTED';

export type DataClass =
  | 'observation'
  | 'forecast'
  | 'event'
  | 'state'
  | 'metric'
  | 'log'
  | 'trace'
  | 'time_series'
  | 'image'
  | 'audio'
  | 'video'
  | 'prediction'
  | 'derived_measurement';

export type OriginType =
  | 'direct_sensor_measurement'
  | 'third_party_observation'
  | 'modelled_estimate'
  | 'forecast'
  | 'ai_generated_inference'
  | 'derived_calculation'
  | 'user_provided_information'
  | 'imported_record';

export type ProvenanceOrigin =
  | 'sensor'
  | 'api'
  | 'database'
  | 'file_import'
  | 'user'
  | 'internal_service'
  | 'model'
  | 'external_device';

export type QualityStatus =
  | 'valid'
  | 'estimated'
  | 'interpolated'
  | 'corrected'
  | 'suspect'
  | 'degraded'
  | 'invalid';

export type ValidationStatus = 'passed' | 'warning' | 'failed' | 'pending';

export interface MeasurementPayload<T = any> {
  measurement_id: string;
  value: T;
  unit: string;
  raw_value?: any;
  raw_unit?: string;
  normalisation?: {
    method: string;
    factor?: number;
    offset?: number;
    reference?: string;
  };
}

export interface LocationPayload {
  latitude: number;
  longitude: number;
  altitude_m?: number;
  coordinate_reference_system: 'EPSG:4326';
  place_id?: string;
  region?: string;
  country_code?: string; // ISO 3166-1 alpha-2
}

export interface ProvenanceTransformation {
  operation: string;
  performed_at: string; // ISO UTC
  software?: string;
  version?: string;
  parameters?: Record<string, any>;
}

export interface ProvenancePayload {
  origin: ProvenanceOrigin;
  provider: string;
  source_record_id: string;
  source_uri?: string;
  retrieved_at: string; // ISO UTC
  source_version?: string;
  licence?: string;
  attribution?: string;
  transformation_chain?: ProvenanceTransformation[];
  parent_event_ids?: string[];
}

export interface QualityPayload {
  status: QualityStatus;
  validation: ValidationStatus;
  quality_score?: number; // 0.0 to 1.0
  flags?: Array<
    | 'missing'
    | 'estimated'
    | 'interpolated'
    | 'outlier'
    | 'sensor_fault'
    | 'stale'
    | 'clock_skew'
    | 'unit_converted'
    | 'modelled'
    | 'manually_corrected'
    | 'partial'
    | 'duplicate_suspected'
  >;
  validation_messages?: string[];
}

export interface ModelMetadataPayload {
  model_id: string;
  model_version: string;
  generated_at: string; // ISO UTC
  input_dataset: string;
  forecast_horizon_seconds?: number;
  valid_until?: string; // ISO UTC
  confidence_interval?: {
    lower: number;
    upper: number;
    level?: number;
  };
  evaluation_status?: 'not_evaluated' | 'evaluated' | 'under_review' | 'rejected';
}

export interface TelemetryEvent<T = any> {
  schema_version: '1.0.0';
  event_id: string; // UUID v4 format
  domain: DomainCategory;
  source_id: string;
  connector_id: string;
  data_class: DataClass;
  origin_type: OriginType;
  event_time: string; // ISO UTC
  ingested_at: string; // ISO UTC
  original_timezone?: string;
  measurement: MeasurementPayload<T>;
  location?: LocationPayload;
  provenance: ProvenancePayload;
  quality: QualityPayload;
  model_metadata?: ModelMetadataPayload;
  tags?: string[];
  extensions?: Record<string, any>;
  context?: Record<string, any>;
}

export interface DomainMetadata {
  id: DomainCategory;
  name: string;
  description: string;
  priorityGroup: 'Phase 1 Core' | 'Next Expansion' | 'Following Expansion' | 'Later Expansion';
  isPhase1Priority: boolean;
  colorHex: string;
  iconName: string;
  primaryUnit: string;
  sampleMeasurementIds: string[];
}

export interface TelemetryQueryFilter {
  domains?: DomainCategory[];
  dataClasses?: DataClass[];
  originTypes?: OriginType[];
  startTime?: string;
  endTime?: string;
  minQualityScore?: number;
  searchTerm?: string;
  limit?: number;
}

export interface GenericTelemetryDataPoint<TPayload extends Record<string, any> = Record<string, any>> {
  timestamp: string;
  source_id: string;
  domain: DomainCategory;
  payload: TPayload;
}

export interface GenericValidationIssue {
  path: string;
  keyword: string;
  message: string;
}

export interface GenericValidationResult {
  isValid: boolean;
  issues: GenericValidationIssue[];
  data?: GenericTelemetryDataPoint;
}

export type CanonicalConnectorType =
  | 'sensor_stream'
  | 'rest_api'
  | 'websocket'
  | 'webhook'
  | 'dsp_bus'
  | 'file_import'
  | 'model_inference'
  | 'manual_entry';

export type CanonicalDataType =
  | 'observation'
  | 'forecast'
  | 'prediction'
  | 'metric'
  | 'event'
  | 'time_series'
  | 'audio';

export interface SourceDescriptor {
  id: string;
  provider: string;
  connector_type: CanonicalConnectorType;
  version?: string;
  origin?: ProvenanceOrigin;
  uri?: string;
  node_id?: string;
}

export interface NormalizedPayload<
  TMetrics extends Record<string, any> = Record<string, any>,
  TContext extends Record<string, any> = Record<string, any>,
  TRaw extends Record<string, any> = Record<string, any>
> {
  metrics: TMetrics;
  units: Record<string, string>;
  context: TContext;
  raw_data: TRaw;
}

export interface CanonicalQualitySummary {
  status: QualityStatus;
  validation: ValidationStatus;
  quality_score?: number;
  flags?: string[];
  normalization_applied?: string[];
  validation_messages?: string[];
}

export interface CanonicalTelemetryRecord<
  TMetrics extends Record<string, any> = Record<string, any>,
  TContext extends Record<string, any> = Record<string, any>,
  TRaw extends Record<string, any> = Record<string, any>
> {
  schema_version: '1.0.0';
  id?: string;
  timestamp: string;
  source: SourceDescriptor;
  domain: DomainCategory;
  data_type: CanonicalDataType;
  payload: NormalizedPayload<TMetrics, TContext, TRaw>;
  location?: LocationPayload;
  quality?: CanonicalQualitySummary;
  model_metadata?: ModelMetadataPayload;
  tags?: string[];
}

export interface NormalizationChange {
  metric: string;
  rawValue: any;
  rawUnit?: string;
  normalizedValue: any;
  normalizedUnit: string;
  rule: string;
}

export interface CanonicalValidationResult {
  isValid: boolean;
  issues: GenericValidationIssue[];
  data?: CanonicalTelemetryRecord;
}


