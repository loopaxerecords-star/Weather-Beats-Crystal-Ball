/**
 * Weather Beats Universal Intelligence — Telemetry CSV Exporter
 * RFC 4180 compliant CSV serialization and browser download helper for telemetry event logs.
 */

import { TelemetryEvent } from '../types/telemetry';

export const TELEMETRY_CSV_HEADERS = [
  'event_id',
  'event_time',
  'ingested_at',
  'domain',
  'measurement_id',
  'value',
  'unit',
  'data_class',
  'origin_type',
  'source_id',
  'provider',
  'quality_status',
  'validation_status',
  'quality_score',
  'latitude',
  'longitude',
  'region',
  'country_code',
  'model_id'
] as const;

export function escapeCsvField(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return '';
  }

  const str =
    typeof raw === 'object' ? JSON.stringify(raw) : String(raw);

  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function serializeTelemetryEventsToCsv(events: TelemetryEvent[]): string {
  const headerLine = TELEMETRY_CSV_HEADERS.join(',');
  const rows = events.map((evt) => {
    const fields: unknown[] = [
      evt.event_id,
      evt.event_time,
      evt.ingested_at,
      evt.domain,
      evt.measurement.measurement_id,
      evt.measurement.value,
      evt.measurement.unit,
      evt.data_class,
      evt.origin_type,
      evt.source_id,
      evt.provenance.provider,
      evt.quality.status,
      evt.quality.validation,
      evt.quality.quality_score ?? '',
      evt.location?.latitude ?? '',
      evt.location?.longitude ?? '',
      evt.location?.region ?? '',
      evt.location?.country_code ?? '',
      evt.model_metadata?.model_id ?? ''
    ];

    return fields.map(escapeCsvField).join(',');
  });

  return [headerLine, ...rows].join('\r\n');
}

export function buildTelemetryCsvFilename(
  domainFilter: string,
  date: Date = new Date()
): string {
  const safeDomain = (domainFilter || 'all').replace(/[^a-zA-Z0-9_-]/g, '_');
  const stamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  return `weather-beats-telemetry-${safeDomain}-${stamp}.csv`;
}

export function triggerCsvDownload(csvContent: string, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.setAttribute('download', filename);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}
