import {
  CanonicalTelemetryRecord, DomainCategory, TelemetryEvent, TelemetryStatus, OriginType, DataClass, TelemetryQueryFilter
} from '../types/telemetry';
import { UNIVERSAL_DOMAINS } from './domainRegistry';
import { schemaValidator } from './schemaValidator';
import { canonicalToTelemetryEvent, telemetryEventToCanonical } from './canonicalDataModel';

export type EventListener = (event: TelemetryEvent) => void;
export type StatusListener = (stats: TelemetryEngineStats) => void;

export interface TelemetryEngineStats {
  totalEventsIngested: number;
  eventsPerSecond: number;
  activeSubscribersCount: number;
  bufferQueueSize: number;
  maxBufferQueueSize: number;
  currentMode: TelemetryStatus;
  activeDomainsCount: number;
  lastEventTimestampMs: number;
  validationPassedCount: number;
}

export interface GeolocationWeatherContext {
  latitude: number;
  longitude: number;
  region: string;
  provider: string;
  status: TelemetryStatus;
  temperatureC: number;
  humidityPct: number;
  pressureHpa: number;
  windSpeedMs: number;
  windDirDeg: number;
  rainfallMm: number;
  pm25UgM3: number;
  aqi: number;
  updatedAt: string;
}

const ALL_24_DOMAINS: DomainCategory[] = Object.keys(UNIVERSAL_DOMAINS) as DomainCategory[];

class TelemetryEngine {
  private eventBuffer: TelemetryEvent[] = [];
  private maxBufferSize = 720;
  private listeners: Set<EventListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private latestByDomain: Partial<Record<DomainCategory, TelemetryEvent>> = {};
  private isStreaming = false;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private streamTickCount = 0;

  private totalEventsIngested = 0;
  private validationPassedCount = 0;
  private lastSecondEventCount = 0;
  private currentEps = 0;
  private epsTimer: ReturnType<typeof setInterval> | null = null;
  private currentMode: TelemetryStatus = 'LIVE';

  private weatherContext: GeolocationWeatherContext = {
    latitude: 51.5074,
    longitude: -0.1278,
    region: 'London Met Hub',
    provider: 'Weather Beats Atmospheric Bus',
    status: 'LIVE',
    temperatureC: 18.5,
    humidityPct: 64,
    pressureHpa: 1013.2,
    windSpeedMs: 4.8,
    windDirDeg: 215,
    rainfallMm: 0.0,
    pm25UgM3: 12.4,
    aqi: 38,
    updatedAt: new Date().toISOString()
  };

  constructor() {
    this.seedInitial24Domains();
    this.startEpsCounter();
    this.startStreaming();
  }

  private seedInitial24Domains() {
    const nowIso = new Date().toISOString();
    ALL_24_DOMAINS.forEach((domain) => {
      const secondaryEvents = this.generateSecondaryMeasurementEvents(domain, nowIso);
      secondaryEvents.forEach((evt) => this.ingestEvent(evt));
      const primaryEvent = this.generateCanonicalTelemetryEvent(domain, nowIso);
      this.ingestEvent(primaryEvent);
    });
  }

  public subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public subscribeStats(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.getStats());
    return () => this.statusListeners.delete(listener);
  }

  public setMode(mode: TelemetryStatus) {
    this.currentMode = mode;
    this.notifyStats();
  }

  public getWeatherContext(): GeolocationWeatherContext {
    return { ...this.weatherContext };
  }

  public getLatestByDomain(): Partial<Record<DomainCategory, TelemetryEvent>> {
    return { ...this.latestByDomain };
  }

  public async syncGeolocationWeather(
    latitude: number,
    longitude: number,
    regionLabel?: string
  ): Promise<GeolocationWeatherContext> {
    const nowIso = new Date().toISOString();
    try {
      const response = await fetch(`/api/connectors/weather?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`);
      if (response.ok) {
        const data = await response.json();
        const metrics = data.metrics || {};
        const tempC = Number(metrics.temperature_c ?? this.weatherContext.temperatureC);
        const humidityPct = Number(metrics.humidity_pct ?? this.weatherContext.humidityPct);
        const pressureHpa = Number(metrics.pressure_hpa ?? this.weatherContext.pressureHpa);
        const windSpeedMs = Number(metrics.wind_speed_ms ?? this.weatherContext.windSpeedMs);
        const windDirDeg = Number(metrics.wind_dir_deg ?? this.weatherContext.windDirDeg);
        const rainfallMm = Number(metrics.rainfall_mm ?? 0);
        const pm25 = Number((8 + Math.max(0, 1020 - pressureHpa) * 0.45 + Math.max(0, 8 - windSpeedMs) * 1.1).toFixed(1));
        const aqi = Math.max(12, Math.min(250, Math.round(pm25 * 2.9)));

        this.weatherContext = {
          latitude,
          longitude,
          region: regionLabel || `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`,
          provider: data.provider || 'Open-Meteo Real-Time',
          status: data.status === 'SIMULATED' ? 'SIMULATED' : 'LIVE',
          temperatureC: Number(tempC.toFixed(2)),
          humidityPct: Number(humidityPct.toFixed(1)),
          pressureHpa: Number(pressureHpa.toFixed(1)),
          windSpeedMs: Number(windSpeedMs.toFixed(2)),
          windDirDeg: Math.round(windDirDeg),
          rainfallMm: Number(rainfallMm.toFixed(2)),
          pm25UgM3: pm25,
          aqi,
          updatedAt: data.timestamp || nowIso
        };

        // Inject real synced events into Weather, Environmental, Geographic, and Atmospheric buses
        this.ingestEvent(this.buildLocationEvent('weather', 'air_temperature', this.weatherContext.temperatureC, '°C', nowIso, this.weatherContext.provider));
        this.ingestEvent(this.buildLocationEvent('environmental', 'pm2_5', this.weatherContext.pm25UgM3, 'µg/m³', nowIso, this.weatherContext.provider));
        this.ingestEvent(this.buildLocationEvent('geographic', 'latitude', Number(latitude.toFixed(6)), 'deg', nowIso, 'Browser Geolocation API'));
        this.ingestEvent(this.buildLocationEvent('atmospheric', 'atmospheric_pressure', this.weatherContext.pressureHpa, 'hPa', nowIso, this.weatherContext.provider));

        this.notifyStats();
        return this.getWeatherContext();
      }
    } catch {
      // Fall through to deterministic geolocation fallback update
    }

    this.weatherContext = {
      ...this.weatherContext,
      latitude,
      longitude,
      region: regionLabel || `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`,
      status: 'SIMULATED',
      updatedAt: nowIso
    };
    this.ingestEvent(this.buildLocationEvent('geographic', 'latitude', Number(latitude.toFixed(6)), 'deg', nowIso, 'Browser Geolocation API'));
    this.notifyStats();
    return this.getWeatherContext();
  }

  private buildLocationEvent(
    domain: DomainCategory,
    measurementId: string,
    value: number,
    unit: string,
    nowIso: string,
    provider: string
  ): TelemetryEvent {
    const event_id = `${domain}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    return {
      schema_version: '1.0.0',
      event_id,
      domain,
      source_id: `src_${domain}_geo_01`,
      connector_id: `conn_${domain}_geo_v1`,
      data_class: 'observation',
      origin_type: 'direct_sensor_measurement',
      event_time: nowIso,
      ingested_at: nowIso,
      original_timezone: 'UTC',
      measurement: {
        measurement_id: measurementId,
        value,
        unit,
        raw_value: value,
        raw_unit: unit
      },
      location: {
        latitude: this.weatherContext.latitude,
        longitude: this.weatherContext.longitude,
        altitude_m: 42.5,
        coordinate_reference_system: 'EPSG:4326',
        region: this.weatherContext.region,
        country_code: 'GB'
      },
      provenance: {
        origin: 'api',
        provider,
        source_record_id: `rec_${event_id}`,
        retrieved_at: nowIso,
        source_version: '1.0.0'
      },
      quality: {
        status: 'valid',
        validation: 'passed',
        quality_score: 0.99,
        flags: []
      }
    };
  }

  public getStats(): TelemetryEngineStats {
    const lastEvent = this.eventBuffer.length > 0 ? this.eventBuffer[this.eventBuffer.length - 1] : null;
    const lastTimestamp = lastEvent ? new Date(lastEvent.event_time).getTime() : Date.now();

    return {
      totalEventsIngested: this.totalEventsIngested,
      eventsPerSecond: this.currentEps,
      activeSubscribersCount: this.listeners.size,
      bufferQueueSize: this.eventBuffer.length,
      maxBufferQueueSize: this.maxBufferSize,
      currentMode: this.currentMode,
      activeDomainsCount: ALL_24_DOMAINS.length,
      lastEventTimestampMs: lastTimestamp,
      validationPassedCount: this.validationPassedCount
    };
  }

  public getBufferedEvents(filter?: TelemetryQueryFilter): TelemetryEvent[] {
    let result = [...this.eventBuffer];
    if (!filter) return result;

    if (filter.domains && filter.domains.length > 0) {
      result = result.filter(e => filter.domains!.includes(e.domain));
    }
    if (filter.dataClasses && filter.dataClasses.length > 0) {
      result = result.filter(e => filter.dataClasses!.includes(e.data_class));
    }
    if (filter.originTypes && filter.originTypes.length > 0) {
      result = result.filter(e => filter.originTypes!.includes(e.origin_type));
    }
    if (filter.minQualityScore !== undefined) {
      result = result.filter(e => (e.quality.quality_score ?? 1.0) >= filter.minQualityScore!);
    }
    if (filter.searchTerm) {
      const term = filter.searchTerm.toLowerCase();
      result = result.filter(e =>
        e.domain.toLowerCase().includes(term) ||
        e.measurement.measurement_id.toLowerCase().includes(term) ||
        e.provenance.provider.toLowerCase().includes(term)
      );
    }
    if (filter.limit && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  public ingestEvent(rawEvent: TelemetryEvent) {
    const report = schemaValidator.validateEvent(rawEvent);
    const event = report.processedEvent;

    this.eventBuffer.push(event);
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift();
    }

    this.latestByDomain[event.domain] = event;
    this.totalEventsIngested++;
    if (report.isValid) this.validationPassedCount++;
    this.lastSecondEventCount++;

    this.listeners.forEach(listener => listener(event));
    this.notifyStats();
  }

  public ingestCanonicalRecord(record: CanonicalTelemetryRecord): TelemetryEvent {
    const projectedEvent = canonicalToTelemetryEvent(record);
    this.ingestEvent(projectedEvent);
    return projectedEvent;
  }

  public getCanonicalRecords(filter?: TelemetryQueryFilter): CanonicalTelemetryRecord[] {
    return this.getBufferedEvents(filter).map(evt => {
      if (evt.extensions?.canonical_record) {
        return evt.extensions.canonical_record as CanonicalTelemetryRecord;
      }
      return telemetryEventToCanonical(evt);
    });
  }

  private notifyStats() {
    const stats = this.getStats();
    this.statusListeners.forEach(listener => listener(stats));
  }

  private startEpsCounter() {
    this.epsTimer = setInterval(() => {
      this.currentEps = this.lastSecondEventCount;
      this.lastSecondEventCount = 0;
      this.notifyStats();
    }, 1000);
  }

  public startStreaming() {
    if (this.isStreaming) return;
    this.isStreaming = true;

    this.timerId = setInterval(() => {
      if (this.currentMode === 'NOT CONNECTED' || this.currentMode === 'ERROR') return;

      const nowIso = new Date().toISOString();
      const phase1Domains: DomainCategory[] = ['weather', 'environmental', 'geographic', 'energy', 'computing', 'audio', 'musical'];
      const expansionDomains = ALL_24_DOMAINS.filter(d => !phase1Domains.includes(d));

      // Emit all 7 Phase 1 core domains every tick, plus rotating 6 expansion domains per tick (all 24 refreshed continuously)
      const batchSize = 6;
      const offset = (this.streamTickCount * batchSize) % expansionDomains.length;
      const expansionSlice: DomainCategory[] = [];
      for (let i = 0; i < batchSize; i++) {
        expansionSlice.push(expansionDomains[(offset + i) % expansionDomains.length]);
      }
      this.streamTickCount++;

      [...phase1Domains, ...expansionSlice].forEach((domain, idx) => {
        if (idx === this.streamTickCount % 7) {
          const secondaryEvents = this.generateSecondaryMeasurementEvents(domain, nowIso);
          if (secondaryEvents.length > 0) {
            this.ingestEvent(secondaryEvents[this.streamTickCount % secondaryEvents.length]);
          }
        }
        const event = this.generateCanonicalTelemetryEvent(domain, nowIso);
        this.ingestEvent(event);
      });
    }, 1200);
  }

  public stopStreaming() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.isStreaming = false;
  }

  private generateCanonicalTelemetryEvent(domain: DomainCategory, nowIso: string): TelemetryEvent {
    const nowSec = Date.now() / 1000;
    const isPrediction = this.currentMode === 'PREDICTED';
    const isForecast = this.currentMode === 'HISTORICAL';

    const dataClass: DataClass = isPrediction ? 'prediction' : isForecast ? 'forecast' : 'observation';
    const originType: OriginType = isPrediction ? 'ai_generated_inference' :
      isForecast ? 'forecast' :
      this.currentMode === 'LIVE' ? 'direct_sensor_measurement' : 'third_party_observation';

    let measurement_id = 'air_temperature';
    let value: number = 20.0;
    let unit = '°C';

    switch (domain) {
      case 'weather':
        measurement_id = 'air_temperature';
        value = Number((this.weatherContext.temperatureC + Math.sin(nowSec / 20) * 1.4).toFixed(2));
        unit = '°C';
        break;
      case 'environmental':
        measurement_id = 'pm2_5';
        value = Number((this.weatherContext.pm25UgM3 + Math.sin(nowSec / 12) * 3.8).toFixed(1));
        unit = 'µg/m³';
        break;
      case 'geographic':
        measurement_id = 'latitude';
        value = Number((this.weatherContext.latitude + Math.sin(nowSec / 100) * 0.004).toFixed(6));
        unit = 'deg';
        break;
      case 'energy':
        measurement_id = 'power';
        value = Number((425.8 + Math.sin(nowSec / 15) * 65.0).toFixed(1));
        unit = 'kW';
        break;
      case 'computing':
        measurement_id = 'cpu_usage';
        value = Number((28.5 + Math.sin(nowSec / 6) * 18.2).toFixed(1));
        unit = '%';
        break;
      case 'audio':
        measurement_id = 'peak_amplitude';
        value = Number((-6.2 + Math.sin(nowSec / 3) * 8.0).toFixed(1));
        unit = 'dB';
        break;
      case 'musical':
        measurement_id = 'tempo_bpm';
        value = Math.round(118 + Math.sin(nowSec / 30) * 8);
        unit = 'BPM';
        break;
      case 'atmospheric':
        measurement_id = 'atmospheric_pressure';
        value = Number((this.weatherContext.pressureHpa + Math.cos(nowSec / 25) * 4.5).toFixed(1));
        unit = 'hPa';
        break;
      case 'geological':
        measurement_id = 'seismic_acceleration';
        value = Number((0.42 + Math.abs(Math.sin(nowSec / 9)) * 1.35).toFixed(2));
        unit = 'mm/s²';
        break;
      case 'oceanographic':
        measurement_id = 'wave_height';
        value = Number((1.65 + Math.sin(nowSec / 14) * 0.85).toFixed(2));
        unit = 'm';
        break;
      case 'solar':
        measurement_id = 'solar_irradiance';
        value = Number((610 + Math.sin(nowSec / 22) * 240).toFixed(1));
        unit = 'W/m²';
        break;
      case 'space':
        measurement_id = 'radiation_flux';
        value = Number((3.2 + Math.sin(nowSec / 18) * 1.9).toFixed(2));
        unit = 'Kp';
        break;
      case 'biological':
        measurement_id = 'biodiversity_index';
        value = Number((0.72 + Math.sin(nowSec / 28) * 0.14).toFixed(3));
        unit = 'Index';
        break;
      case 'agricultural':
        measurement_id = 'soil_moisture';
        value = Number((34.2 + Math.cos(nowSec / 24) * 9.5).toFixed(1));
        unit = '%';
        break;
      case 'industrial':
        measurement_id = 'machine_vibration';
        value = Number((2.8 + Math.sin(nowSec / 7) * 1.6).toFixed(2));
        unit = 'mm/s';
        break;
      case 'smart_building':
        measurement_id = 'occupancy_count';
        value = Math.round(145 + Math.sin(nowSec / 19) * 55);
        unit = 'Count';
        break;
      case 'transport':
        measurement_id = 'vehicle_speed';
        value = Number((48.0 + Math.sin(nowSec / 11) * 16.5).toFixed(1));
        unit = 'km/h';
        break;
      case 'network':
        measurement_id = 'latency';
        value = Number((18.4 + Math.abs(Math.sin(nowSec / 8)) * 22.0).toFixed(1));
        unit = 'ms';
        break;
      case 'financial':
        measurement_id = 'volatility';
        value = Number((16.8 + Math.sin(nowSec / 13) * 6.4).toFixed(2));
        unit = '%';
        break;
      case 'economic':
        measurement_id = 'inflation_rate';
        value = Number((2.65 + Math.sin(nowSec / 40) * 0.45).toFixed(2));
        unit = '%';
        break;
      case 'business':
        measurement_id = 'order_count';
        value = Math.round(320 + Math.sin(nowSec / 16) * 110);
        unit = 'Count';
        break;
      case 'social_information':
        measurement_id = 'sentiment_score';
        value = Number((0.24 + Math.sin(nowSec / 17) * 0.48).toFixed(2));
        unit = 'Score';
        break;
      case 'artificial_intelligence':
        measurement_id = 'throughput';
        value = Number((142.0 + Math.sin(nowSec / 10) * 48.0).toFixed(1));
        unit = 'tok/s';
        break;
      case 'security':
        measurement_id = 'threat_score';
        value = Number((18.0 + Math.abs(Math.sin(nowSec / 11)) * 27.0).toFixed(1));
        unit = 'Score';
        break;
    }

    const event_id = `${domain}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const event: TelemetryEvent = {
      schema_version: '1.0.0',
      event_id,
      domain,
      source_id: `src_${domain}_node_01`,
      connector_id: `conn_${domain}_v1`,
      data_class: dataClass,
      origin_type: originType,
      event_time: nowIso,
      ingested_at: nowIso,
      original_timezone: 'UTC',
      measurement: {
        measurement_id,
        value,
        unit,
        raw_value: value,
        raw_unit: unit
      },
      location: {
        latitude: this.weatherContext.latitude,
        longitude: this.weatherContext.longitude,
        altitude_m: 42.5,
        coordinate_reference_system: 'EPSG:4326',
        region: this.weatherContext.region,
        country_code: 'GB'
      },
      provenance: {
        origin: 'sensor',
        provider: UNIVERSAL_DOMAINS[domain]?.name || 'Universal Telemetry Engine',
        source_record_id: `rec_${event_id}`,
        retrieved_at: nowIso,
        source_version: '1.0.0'
      },
      quality: {
        status: 'valid',
        validation: 'passed',
        quality_score: 0.98,
        flags: []
      }
    };

    if (isPrediction || isForecast) {
      event.model_metadata = {
        model_id: 'weatherbeats_gemini_2_5_predict',
        model_version: '2.5.0',
        generated_at: nowIso,
        input_dataset: 'telemetry_stream_v1',
        forecast_horizon_seconds: 3600,
        evaluation_status: 'evaluated'
      };
    }

    return event;
  }

  private generateSecondaryMeasurementEvents(domain: DomainCategory, nowIso: string): TelemetryEvent[] {
    const meta = UNIVERSAL_DOMAINS[domain];
    if (!meta || !meta.sampleMeasurementIds || meta.sampleMeasurementIds.length <= 1) return [];
    const nowSec = Date.now() / 1000;
    const baseEvent = this.generateCanonicalTelemetryEvent(domain, nowIso);
    const primaryId = baseEvent.measurement.measurement_id;

    return meta.sampleMeasurementIds
      .filter((id) => id !== primaryId)
      .map((measId, idx) => {
        const { value, unit } = this.computeMetricValueAndUnit(domain, measId, nowSec, idx);
        const evtId = `${domain}-${measId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        return {
          ...baseEvent,
          event_id: evtId,
          measurement: {
            measurement_id: measId,
            value,
            unit,
            raw_value: value,
            raw_unit: unit
          },
          provenance: {
            ...baseEvent.provenance,
            source_record_id: `rec_${evtId}`
          }
        };
      });
  }

  private computeMetricValueAndUnit(
    domain: DomainCategory,
    measurementId: string,
    nowSec: number,
    seedIdx: number
  ): { value: number; unit: string } {
    const wave = Math.sin(nowSec / (11 + seedIdx * 3) + seedIdx);
    switch (measurementId) {
      case 'relative_humidity':
        return { value: Number((this.weatherContext.humidityPct + wave * 3).toFixed(1)), unit: '%' };
      case 'surface_pressure':
      case 'atmospheric_pressure':
        return { value: Number((this.weatherContext.pressureHpa + wave * 2.5).toFixed(1)), unit: 'hPa' };
      case 'wind_speed':
        return { value: Number(Math.max(0.2, this.weatherContext.windSpeedMs + wave * 1.4).toFixed(2)), unit: 'm/s' };
      case 'precipitation':
        return { value: Number(Math.max(0, this.weatherContext.rainfallMm + Math.abs(wave) * 0.4).toFixed(2)), unit: 'mm' };
      case 'pm10':
        return { value: Number((this.weatherContext.pm25UgM3 * 1.65 + wave * 4).toFixed(1)), unit: 'µg/m³' };
      case 'carbon_dioxide':
      case 'co2_level':
        return { value: Math.round(418 + wave * 35), unit: 'ppm' };
      case 'noise_level':
        return { value: Number((48 + wave * 9).toFixed(1)), unit: 'dBA' };
      case 'longitude':
        return { value: Number((this.weatherContext.longitude + wave * 0.004).toFixed(6)), unit: 'deg' };
      case 'elevation':
        return { value: Number((42.5 + wave * 1.2).toFixed(1)), unit: 'm' };
      case 'distance':
        return { value: Number((12.4 + Math.abs(wave) * 5.2).toFixed(2)), unit: 'km' };
      case 'energy':
      case 'solar_generation':
        return { value: Number((184 + wave * 45).toFixed(1)), unit: 'kWh' };
      case 'frequency':
        return { value: Number((50.0 + wave * 0.06).toFixed(3)), unit: 'Hz' };
      case 'voltage':
        return { value: Number((230.2 + wave * 2.8).toFixed(1)), unit: 'V' };
      case 'memory_usage':
        return { value: Number((62.4 + wave * 9.5).toFixed(1)), unit: '%' };
      case 'disk_io':
        return { value: Number((118 + Math.abs(wave) * 64).toFixed(1)), unit: 'MB/s' };
      case 'application_latency':
      case 'inference_latency':
        return { value: Number((24.5 + Math.abs(wave) * 14).toFixed(1)), unit: 'ms' };
      case 'rms_level':
        return { value: Number((-14.2 + wave * 4.5).toFixed(1)), unit: 'dBFS' };
      case 'spectral_centroid':
        return { value: Math.round(1420 + wave * 480), unit: 'Hz' };
      case 'loudness_lufs':
        return { value: Number((-14.4 + wave * 2.2).toFixed(1)), unit: 'LUFS' };
      case 'pitch_hz':
        return { value: Number((220 + wave * 65).toFixed(1)), unit: 'Hz' };
      case 'onset_strength':
        return { value: Number((0.64 + wave * 0.25).toFixed(2)), unit: 'Index' };
      case 'midi_note':
        return { value: Math.round(60 + wave * 12), unit: 'MIDI' };
      case 'dew_point':
        return { value: Number((this.weatherContext.temperatureC - 5.5 + wave * 1.8).toFixed(1)), unit: '°C' };
      case 'boundary_layer_height':
        return { value: Math.round(920 + wave * 210), unit: 'm' };
      case 'earthquake_magnitude':
        return { value: Number((1.4 + Math.abs(wave) * 1.2).toFixed(2)), unit: 'Mw' };
      case 'depth':
      case 'orbital_altitude':
        return { value: Number((412 + wave * 18).toFixed(1)), unit: 'km' };
      case 'sea_surface_temperature':
      case 'soil_temperature':
      case 'indoor_temperature':
      case 'machine_temperature':
        return { value: Number((21.4 + wave * 4.2).toFixed(1)), unit: '°C' };
      case 'salinity':
        return { value: Number((35.1 + wave * 0.4).toFixed(2)), unit: 'PSU' };
      case 'sunspot_number':
        return { value: Math.round(94 + wave * 22), unit: 'Count' };
      case 'solar_flare_class':
        return { value: Number((1.8 + Math.abs(wave) * 2.4).toFixed(2)), unit: 'X-Flux' };
      case 'satellite_position':
        return { value: Number((52.4 + wave * 14.0).toFixed(2)), unit: 'deg' };
      case 'biomass':
        return { value: Number((142.5 + wave * 18.0).toFixed(1)), unit: 't/ha' };
      case 'growth_rate':
        return { value: Number((3.4 + wave * 1.1).toFixed(2)), unit: '%/wk' };
      case 'evapotranspiration':
        return { value: Number((4.1 + wave * 1.3).toFixed(2)), unit: 'mm/d' };
      case 'flow_rate':
        return { value: Number((84.2 + wave * 15.0).toFixed(1)), unit: 'L/m' };
      case 'traffic_density':
        return { value: Math.round(42 + wave * 20), unit: 'veh/km' };
      case 'travel_time':
        return { value: Math.round(28 + wave * 9), unit: 'min' };
      case 'packet_loss':
        return { value: Number((0.18 + Math.abs(wave) * 0.45).toFixed(2)), unit: '%' };
      case 'bandwidth':
        return { value: Number((8.4 + wave * 2.1).toFixed(2)), unit: 'Gbps' };
      case 'jitter':
        return { value: Number((3.2 + Math.abs(wave) * 4.1).toFixed(2)), unit: 'ms' };
      case 'asset_price':
        return { value: Number((184.5 + wave * 6.4).toFixed(2)), unit: 'USD' };
      case 'trade_volume':
        return { value: Math.round(48200 + wave * 12400), unit: 'Units' };
      case 'gross_domestic_product':
        return { value: Number((2.8 + wave * 0.3).toFixed(2)), unit: '% YoY' };
      case 'consumer_price_index':
        return { value: Number((314.2 + wave * 1.4).toFixed(1)), unit: 'Index' };
      case 'revenue':
        return { value: Math.round(42500 + wave * 6800), unit: 'USD' };
      case 'customer_count':
        return { value: Math.round(1840 + wave * 120), unit: 'Count' };
      case 'mention_count':
        return { value: Math.round(640 + wave * 210), unit: 'Count' };
      case 'trend_velocity':
        return { value: Number((1.45 + wave * 0.65).toFixed(2)), unit: 'x' };
      case 'token_count':
        return { value: Math.round(18400 + wave * 4200), unit: 'tok' };
      case 'model_accuracy':
        return { value: Number((96.4 + wave * 1.8).toFixed(2)), unit: '%' };
      case 'failed_login_count':
        return { value: Math.round(6 + Math.abs(wave) * 14), unit: 'Count' };
      case 'vulnerability_count':
        return { value: Math.round(2 + Math.abs(wave) * 5), unit: 'Count' };
      default:
        return { value: Number((50 + wave * 22).toFixed(2)), unit: 'Units' };
    }
  }
}

export const telemetryEngine = new TelemetryEngine();
