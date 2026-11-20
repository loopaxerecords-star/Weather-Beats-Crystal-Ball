import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Braces,
  Check,
  CheckCircle2,
  Copy,
  Layers,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  XCircle
} from 'lucide-react';
import {
  CANONICAL_CONNECTOR_TYPES,
  CANONICAL_DATA_MODEL_SCHEMA,
  CANONICAL_DATA_TYPES,
  canonicalToTelemetryEvent,
  normalizeCanonicalRecord,
  upgradeGenericToCanonical,
  validateCanonicalRecord
} from '../services/canonicalDataModel';
import {
  GENERIC_DATA_POINT_SCHEMA,
  mapGenericToCanonicalEvent,
  validateGenericDataPoint
} from '../services/genericDataPointSchema';
import { telemetryEngine } from '../services/telemetryEngine';
import {
  CanonicalTelemetryRecord,
  NormalizationChange,
  TelemetryEvent
} from '../types/telemetry';

type InspectorMode = 'canonical' | 'generic';

interface GenericPresetFixture {
  id: string;
  label: string;
  isExpectedValid: boolean;
  data: Record<string, any>;
}

interface CanonicalPresetFixture {
  id: string;
  label: string;
  isExpectedValid: boolean;
  data: Record<string, any>;
}

const GENERIC_PRESET_FIXTURES: GenericPresetFixture[] = [
  {
    id: 'weather',
    label: 'Weather',
    isExpectedValid: true,
    data: {
      timestamp: '2026-11-12T21:47:46Z',
      source_id: 'wstation_london_heathrow_01',
      domain: 'weather',
      payload: {
        air_temperature: 58.64,
        relative_humidity: 72,
        surface_pressure: 1015.4,
        wind_speed: 11.6,
        unit: '°F',
        units: {
          air_temperature: '°F',
          relative_humidity: '%',
          surface_pressure: 'hPa',
          wind_speed: 'mph'
        },
        latitude: 51.47,
        longitude: -0.4543
      }
    }
  },
  {
    id: 'financial',
    label: 'Financial',
    isExpectedValid: true,
    data: {
      timestamp: '2026-11-12T21:47:46-05:00',
      source_id: 'feed_nasdaq_l1_node_04',
      domain: 'financial',
      payload: {
        ticker: 'WBUI',
        asset_price: 184.62,
        trade_volume: 42500,
        bid_ask_spread_bps: 1.4,
        unit: 'USD'
      }
    }
  },
  {
    id: 'computing',
    label: 'Computing',
    isExpectedValid: true,
    data: {
      timestamp: '2026-11-12T21:47:46.120Z',
      source_id: 'host_macstudio_m3_01',
      domain: 'computing',
      payload: {
        cpu_usage: 31.4,
        memory_usage: 58.2,
        application_latency: 11.8,
        unit: '%'
      }
    }
  },
  {
    id: 'audio',
    label: 'Audio',
    isExpectedValid: true,
    data: {
      timestamp: '2026-11-12T21:47:46Z',
      source_id: 'mandala_dsp_bus_01',
      domain: 'audio',
      payload: {
        peak_amplitude: -3.2,
        rms_level: -14.6,
        spectral_centroid: 1420,
        sample_rate_hz: 48000,
        unit: 'dBFS'
      }
    }
  },
  {
    id: 'invalid',
    label: 'Invalid Sample',
    isExpectedValid: false,
    data: {
      timestamp: '2026-11-12 21:47:46',
      source_id: '   ',
      domain: 'unknown_domain',
      payload: {},
      extra_root_key: 'rejected_by_strict_schema'
    }
  }
];

const CANONICAL_PRESET_FIXTURES: CanonicalPresetFixture[] = [
  {
    id: 'weather_norm',
    label: 'Weather (°F → °C)',
    isExpectedValid: true,
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
          air_temperature: 64.4,
          wind_speed: 14.5,
          relative_humidity: 68,
          surface_pressure: 1016.2
        },
        units: {
          air_temperature: '°F',
          wind_speed: 'mph',
          relative_humidity: '%',
          surface_pressure: 'hPa'
        },
        context: {
          station_id: 'KSFO',
          weather_condition: 'partly_cloudy'
        },
        raw_data: {
          temp_f: 64.4,
          wind_mph: 14.5,
          rh_pct: 68,
          pressure_hpa: 1016.2,
          metar_raw: 'KSFO 160345Z 29013KT 10SM FEW025 18/12 A3001'
        }
      },
      location: {
        latitude: 37.6213,
        longitude: -122.379,
        altitude_m: 4,
        coordinate_reference_system: 'EPSG:4326',
        region: 'San Francisco Bay',
        country_code: 'US'
      }
    }
  },
  {
    id: 'audio_dsp',
    label: 'Audio DSP (48 kHz)',
    isExpectedValid: true,
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      source: {
        id: 'mandala_vst3_dsp_01',
        provider: 'Weather Beats DSP Engine',
        connector_type: 'dsp_bus',
        version: '1.0.0',
        origin: 'internal_service',
        node_id: 'coreaudio-48k-node'
      },
      domain: 'audio',
      data_type: 'audio',
      payload: {
        metrics: {
          peak_amplitude: 0.7079,
          rms_level: 0.2512,
          spectral_centroid: 1480
        },
        units: {
          peak_amplitude: 'linear',
          rms_level: 'linear',
          spectral_centroid: 'Hz'
        },
        context: {
          sample_rate_hz: 48000,
          buffer_size: 1024,
          channels: 2,
          plugin_format: 'VST3/AU'
        },
        raw_data: {
          peak_linear: 0.7079,
          rms_linear: 0.2512,
          centroid_hz: 1480,
          sample_rate_hz: 48000,
          block_size: 1024
        }
      }
    }
  },
  {
    id: 'energy_grid',
    label: 'Energy (W → kW)',
    isExpectedValid: true,
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
          power: 425800,
          solar_generation: 128500,
          frequency: 50.02
        },
        units: {
          power: 'W',
          solar_generation: 'W',
          frequency: 'Hz'
        },
        context: {
          site_id: 'london_south_07',
          phase: 'three_phase'
        },
        raw_data: {
          active_power_watts: 425800,
          pv_watts: 128500,
          grid_hz: 50.02
        }
      }
    }
  },
  {
    id: 'financial_ws',
    label: 'Financial',
    isExpectedValid: true,
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
          trade_volume: 61200,
          volatility: 0.194
        },
        units: {
          asset_price: 'USD',
          trade_volume: '1',
          volatility: '1'
        },
        context: {
          ticker: 'WBUI',
          exchange: 'NASDAQ',
          currency: 'USD'
        },
        raw_data: {
          sym: 'WBUI',
          px: 186.42,
          sz: 61200,
          iv: 0.194
        }
      }
    }
  },
  {
    id: 'computing_host',
    label: 'Computing',
    isExpectedValid: true,
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T19:45:00Z',
      source: {
        id: 'host_macbook_pro_16',
        provider: 'OpenTelemetry Node Agent',
        connector_type: 'sensor_stream',
        origin: 'internal_service'
      },
      domain: 'computing',
      data_type: 'metric',
      payload: {
        metrics: {
          cpu_usage: 24.8,
          memory_usage: 61.2,
          application_latency: 0.014
        },
        units: {
          cpu_usage: '%',
          memory_usage: '%',
          application_latency: 's'
        },
        context: {
          host_id: 'mbp-m3-max',
          runtime: 'node-22',
          environment: 'production'
        },
        raw_data: {
          cpu_pct: 24.8,
          mem_pct: 61.2,
          app_latency_sec: 0.014
        }
      }
    }
  },
  {
    id: 'prediction_weather',
    label: 'Prediction (Model)',
    isExpectedValid: true,
    data: {
      schema_version: '1.0.0',
      timestamp: '2026-11-15T20:45:00Z',
      source: {
        id: 'wb_forecast_engine_01',
        provider: 'Weather Beats Inference Pipeline',
        connector_type: 'model_inference',
        version: '2.5.0',
        origin: 'model'
      },
      domain: 'weather',
      data_type: 'prediction',
      payload: {
        metrics: {
          air_temperature: 17.4,
          precipitation: 1.8
        },
        units: {
          air_temperature: '°C',
          precipitation: 'mm'
        },
        context: {
          station_id: 'EGLL',
          horizon_label: '+60m'
        },
        raw_data: {
          predicted_temp_c: 17.4,
          predicted_precip_mm: 1.8,
          model_confidence: 0.91
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
  },
  {
    id: 'canonical_invalid',
    label: 'Invalid Sample',
    isExpectedValid: false,
    data: {
      schema_version: '2.0.0',
      timestamp: '2026-02-30T19:45:00',
      source: {
        id: '   ',
        provider: 'Unknown',
        connector_type: 'magic_pipe'
      },
      domain: 'astrology',
      data_type: 'prediction',
      payload: {
        metrics: {},
        units: 'invalid_units_string',
        context: {},
        raw_data: {}
      }
    }
  }
];

interface SchemaInspectorProps {
  onNavigateToEventLog: () => void;
}

export const SchemaInspector: React.FC<SchemaInspectorProps> = ({ onNavigateToEventLog }) => {
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('canonical');

  // Canonical Data Model State
  const [canonicalLeftTab, setCanonicalLeftTab] = useState<'tester' | 'schema' | 'spec'>('tester');
  const [canonicalPreviewTab, setCanonicalPreviewTab] = useState<'normalized' | 'event'>('normalized');
  const [selectedCanonicalPreset, setSelectedCanonicalPreset] = useState<string>('weather_norm');
  const [canonicalJsonInput, setCanonicalJsonInput] = useState<string>(() =>
    JSON.stringify(CANONICAL_PRESET_FIXTURES[0].data, null, 2)
  );
  const [canonicalIngestedId, setCanonicalIngestedId] = useState<string | null>(null);

  // Generic Ingestion Envelope State
  const [genericLeftTab, setGenericLeftTab] = useState<'tester' | 'schema' | 'contract'>('tester');
  const [selectedGenericPreset, setSelectedGenericPreset] = useState<string>('weather');
  const [genericJsonInput, setGenericJsonInput] = useState<string>(() =>
    JSON.stringify(GENERIC_PRESET_FIXTURES[0].data, null, 2)
  );
  const [genericIngestedId, setGenericIngestedId] = useState<string | null>(null);

  const [copiedSchema, setCopiedSchema] = useState<boolean>(false);

  const canonicalSchemaString = useMemo(
    () => JSON.stringify(CANONICAL_DATA_MODEL_SCHEMA, null, 2),
    []
  );
  const genericSchemaString = useMemo(
    () => JSON.stringify(GENERIC_DATA_POINT_SCHEMA, null, 2),
    []
  );

  // Evaluate Canonical Data Model JSON
  const canonicalEval = useMemo(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(canonicalJsonInput);
    } catch (err: any) {
      return {
        syntaxError: err?.message || 'Invalid JSON syntax',
        validation: null,
        normalized: null as CanonicalTelemetryRecord | null,
        conversions: [] as NormalizationChange[],
        projectedEvent: null as TelemetryEvent | null
      };
    }

    const validation = validateCanonicalRecord(parsed);
    if (!validation.isValid || !validation.data) {
      return {
        syntaxError: null,
        validation,
        normalized: null,
        conversions: [],
        projectedEvent: null
      };
    }

    const { record: normalized, conversions } = normalizeCanonicalRecord(validation.data);
    const projectedEvent = canonicalToTelemetryEvent(normalized);
    return {
      syntaxError: null,
      validation,
      normalized,
      conversions,
      projectedEvent
    };
  }, [canonicalJsonInput]);

  // Evaluate Generic Ingestion Envelope JSON
  const genericEval = useMemo(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(genericJsonInput);
    } catch (err: any) {
      return {
        syntaxError: err?.message || 'Invalid JSON syntax',
        validation: null,
        canonicalEvent: null as TelemetryEvent | null
      };
    }

    const validation = validateGenericDataPoint(parsed);
    const canonicalEvent =
      validation.isValid && validation.data
        ? mapGenericToCanonicalEvent(validation.data)
        : null;

    return {
      syntaxError: null,
      validation,
      canonicalEvent
    };
  }, [genericJsonInput]);

  const handleCopyActiveSchema = async () => {
    const text = inspectorMode === 'canonical' ? canonicalSchemaString : genericSchemaString;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSchema(true);
      setTimeout(() => setCopiedSchema(false), 1800);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  // Canonical handlers
  const handleLoadCanonicalPreset = (fixture: CanonicalPresetFixture) => {
    setSelectedCanonicalPreset(fixture.id);
    setCanonicalJsonInput(JSON.stringify(fixture.data, null, 2));
    setCanonicalIngestedId(null);
    setCanonicalLeftTab('tester');
  };

  const handleFormatCanonical = () => {
    try {
      const parsed = JSON.parse(canonicalJsonInput);
      setCanonicalJsonInput(JSON.stringify(parsed, null, 2));
    } catch {
      // Preserve raw buffer when invalid JSON
    }
  };

  const handleResetCanonical = () => {
    const preset =
      CANONICAL_PRESET_FIXTURES.find((p) => p.id === selectedCanonicalPreset) ||
      CANONICAL_PRESET_FIXTURES[0];
    setCanonicalJsonInput(JSON.stringify(preset.data, null, 2));
    setCanonicalIngestedId(null);
  };

  const handleIngestCanonical = () => {
    if (!canonicalEval.normalized) return;
    const ingested = telemetryEngine.ingestCanonicalRecord(canonicalEval.normalized);
    setCanonicalIngestedId(ingested.event_id);
  };

  // Generic handlers
  const handleLoadGenericPreset = (fixture: GenericPresetFixture) => {
    setSelectedGenericPreset(fixture.id);
    setGenericJsonInput(JSON.stringify(fixture.data, null, 2));
    setGenericIngestedId(null);
    setGenericLeftTab('tester');
  };

  const handleFormatGeneric = () => {
    try {
      const parsed = JSON.parse(genericJsonInput);
      setGenericJsonInput(JSON.stringify(parsed, null, 2));
    } catch {
      // Preserve raw buffer when invalid JSON
    }
  };

  const handleResetGeneric = () => {
    const preset =
      GENERIC_PRESET_FIXTURES.find((p) => p.id === selectedGenericPreset) ||
      GENERIC_PRESET_FIXTURES[0];
    setGenericJsonInput(JSON.stringify(preset.data, null, 2));
    setGenericIngestedId(null);
  };

  const handleIngestGeneric = () => {
    if (!genericEval.validation?.isValid || !genericEval.validation.data) return;
    const eventToIngest = mapGenericToCanonicalEvent(genericEval.validation.data);
    telemetryEngine.ingestEvent(eventToIngest);
    setGenericIngestedId(eventToIngest.event_id);
  };

  const handleUpgradeGenericToCanonical = () => {
    if (!genericEval.validation?.isValid || !genericEval.validation.data) return;
    const { record } = upgradeGenericToCanonical(genericEval.validation.data);
    setCanonicalJsonInput(JSON.stringify(record, null, 2));
    setCanonicalIngestedId(null);
    setInspectorMode('canonical');
    setCanonicalLeftTab('tester');
  };

  const isCanonicalValid = Boolean(!canonicalEval.syntaxError && canonicalEval.validation?.isValid);
  const isGenericValid = Boolean(!genericEval.syntaxError && genericEval.validation?.isValid);

  return (
    <div className="flex-1 bg-[#0b0f17] flex flex-col min-w-0 overflow-y-auto p-8 space-y-6">
      {/* Header Row & Schema Mode Switcher */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5 pb-6 border-b border-slate-800">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            {inspectorMode === 'canonical' ? (
              <Layers className="w-6 h-6 text-cyan-400 shrink-0" />
            ) : (
              <Braces className="w-6 h-6 text-cyan-400 shrink-0" />
            )}
            <h1 className="text-2xl lg:text-3xl font-bold text-white tracking-tight">
              {inspectorMode === 'canonical'
                ? 'Canonical Telemetry Data Model'
                : 'Generic Telemetry Data Point Schema'}
            </h1>
            <span className="px-2.5 py-1 text-xs font-mono font-semibold rounded-md bg-cyan-950/80 text-cyan-300 border border-cyan-800/70">
              Draft 2020-12 · v1.0.0
            </span>
          </div>
          <p className="text-sm text-slate-300 max-w-4xl leading-relaxed">
            {inspectorMode === 'canonical' ? (
              <>
                Unified 24-domain telemetry model enforcing UTC{' '}
                <span className="font-mono text-cyan-300">timestamp</span>, structured{' '}
                <span className="font-mono text-cyan-300">source</span> descriptor, 7-class{' '}
                <span className="font-mono text-cyan-300">data_type</span> taxonomy, and normalized{' '}
                <span className="font-mono text-cyan-300">payload</span> (
                <span className="font-mono text-slate-200">metrics</span>,{' '}
                <span className="font-mono text-slate-200">units</span>,{' '}
                <span className="font-mono text-slate-200">context</span>,{' '}
                <span className="font-mono text-slate-200">raw_data</span>).
              </>
            ) : (
              <>
                Standalone lightweight ingestion envelope enforcing strict root fields (
                <span className="font-mono text-cyan-300">timestamp</span>,{' '}
                <span className="font-mono text-cyan-300">source_id</span>,{' '}
                <span className="font-mono text-cyan-300">domain</span>,{' '}
                <span className="font-mono text-cyan-300">payload</span>) with direct upgrade to the Canonical Data Model.
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {/* Mode Switcher */}
          <div className="flex items-center p-1 bg-[#121929] border border-slate-800 rounded-lg">
            <button
              onClick={() => setInspectorMode('canonical')}
              className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                inspectorMode === 'canonical'
                  ? 'bg-cyan-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Canonical Data Model
            </button>
            <button
              onClick={() => setInspectorMode('generic')}
              className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                inspectorMode === 'generic'
                  ? 'bg-cyan-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Generic Envelope
            </button>
          </div>

          <button
            onClick={handleCopyActiveSchema}
            className="px-4 py-2.5 text-sm font-semibold rounded-lg bg-[#121929] border border-slate-700 text-slate-200 hover:text-white hover:border-slate-600 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            {copiedSchema ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Copy className="w-4 h-4 text-cyan-400" />
            )}
            <span>{copiedSchema ? 'Schema Copied' : 'Copy Schema JSON'}</span>
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MODE 1: CANONICAL TELEMETRY DATA MODEL (v1.0.0)                       */}
      {/* ===================================================================== */}
      {inspectorMode === 'canonical' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left Column: Canonical Editor, Schema JSON & Contract Spec */}
          <div className="xl:col-span-6 bg-[#121929] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-800 bg-[#0e1422]">
              <div className="flex items-center gap-1 p-1 bg-[#141b2d] rounded-lg border border-slate-800">
                <button
                  onClick={() => setCanonicalLeftTab('tester')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    canonicalLeftTab === 'tester'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Canonical Tester
                </button>
                <button
                  onClick={() => setCanonicalLeftTab('schema')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    canonicalLeftTab === 'schema'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Draft 2020-12 JSON
                </button>
                <button
                  onClick={() => setCanonicalLeftTab('spec')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    canonicalLeftTab === 'spec'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Model Specification
                </button>
              </div>

              {canonicalLeftTab === 'tester' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleFormatCanonical}
                    className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  >
                    Format
                  </button>
                  <button
                    onClick={handleResetCanonical}
                    className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                </div>
              )}
            </div>

            {canonicalLeftTab === 'tester' && (
              <div className="p-5 space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-400">
                    Load 24-Domain Canonical Record Fixture
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {CANONICAL_PRESET_FIXTURES.map((fixture) => {
                      const isActive = selectedCanonicalPreset === fixture.id;
                      return (
                        <button
                          key={fixture.id}
                          onClick={() => handleLoadCanonicalPreset(fixture)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                            isActive
                              ? fixture.isExpectedValid
                                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/60'
                                : 'bg-rose-950/80 text-rose-300 border-rose-500/60'
                              : 'bg-[#0b0f17] text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
                          }`}
                        >
                          {fixture.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="canonical-json-editor"
                    className="text-xs font-semibold text-slate-400 block"
                  >
                    Canonical Telemetry Record JSON Input
                  </label>
                  <textarea
                    id="canonical-json-editor"
                    value={canonicalJsonInput}
                    onChange={(e) => {
                      setCanonicalJsonInput(e.target.value);
                      setCanonicalIngestedId(null);
                    }}
                    rows={22}
                    spellCheck={false}
                    className="w-full bg-[#0b0f17] border border-slate-700/80 rounded-lg p-4 text-sm font-mono tabular-nums text-cyan-200 focus:outline-none focus:border-cyan-500 leading-relaxed resize-y"
                  />
                </div>
              </div>
            )}

            {canonicalLeftTab === 'schema' && (
              <div className="p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-400">
                  <span>$id: canonical-model.schema.json</span>
                  <span>additionalProperties: false</span>
                </div>
                <pre className="bg-[#0b0f17] border border-slate-800 rounded-lg p-4 text-xs font-mono text-cyan-300 overflow-x-auto max-h-[600px] leading-relaxed">
                  {canonicalSchemaString}
                </pre>
              </div>
            )}

            {canonicalLeftTab === 'spec' && (
              <div className="p-5 space-y-5">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-xs font-semibold">
                      <th className="pb-3 pr-4">Field</th>
                      <th className="pb-3 pr-4">Structure</th>
                      <th className="pb-3">Contract Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-mono text-xs">
                    <tr>
                      <td className="py-3 pr-4 text-cyan-400 font-semibold">schema_version</td>
                      <td className="py-3 pr-4">const "1.0.0"</td>
                      <td className="py-3 font-sans text-slate-300">
                        Required semantic contract version identifier.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 pr-4 text-cyan-400 font-semibold">timestamp</td>
                      <td className="py-3 pr-4">ISO 8601 UTC</td>
                      <td className="py-3 font-sans text-slate-300">
                        Required timezone-aware event time normalized to UTC at ingestion.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 pr-4 text-cyan-400 font-semibold">source</td>
                      <td className="py-3 pr-4">SourceDescriptor</td>
                      <td className="py-3 font-sans text-slate-300">
                        Required object with <span className="font-mono text-cyan-300">id</span>,{' '}
                        <span className="font-mono text-cyan-300">provider</span>, and{' '}
                        <span className="font-mono text-cyan-300">connector_type</span>.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 pr-4 text-cyan-400 font-semibold">domain</td>
                      <td className="py-3 pr-4">24-domain enum</td>
                      <td className="py-3 font-sans text-slate-300">
                        Required canonical intelligence domain identifier (weather..security).
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 pr-4 text-cyan-400 font-semibold">data_type</td>
                      <td className="py-3 pr-4">7-class taxonomy</td>
                      <td className="py-3 font-sans text-slate-300">
                        {CANONICAL_DATA_TYPES.join(', ')}. Forecasts &amp; predictions require{' '}
                        <span className="font-mono text-amber-300">model_metadata</span>.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 pr-4 text-cyan-400 font-semibold">payload</td>
                      <td className="py-3 pr-4">NormalizedPayload</td>
                      <td className="py-3 font-sans text-slate-300">
                        Typed envelope containing normalized{' '}
                        <span className="font-mono text-emerald-300">metrics</span>,{' '}
                        <span className="font-mono text-emerald-300">units</span>,{' '}
                        <span className="font-mono text-emerald-300">context</span>, and verbatim{' '}
                        <span className="font-mono text-amber-300">raw_data</span>.
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="p-4 rounded-lg bg-[#0b0f17] border border-slate-800 space-y-2">
                  <div className="text-xs font-semibold text-slate-400">
                    Supported Source Connector Types
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {CANONICAL_CONNECTOR_TYPES.map((ct) => (
                      <span
                        key={ct}
                        className="px-2.5 py-1 text-xs font-mono rounded bg-[#121929] border border-slate-800 text-slate-200"
                      >
                        {ct}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Validation, Normalization Diff & Live Projection */}
          <div className="xl:col-span-6 space-y-6">
            {/* Validation & Ingestion Panel */}
            <div className="bg-[#121929] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  {isCanonicalValid ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                  )}
                  <h2 className="text-base font-bold text-white">
                    {canonicalEval.syntaxError
                      ? '✖ JSON SYNTAX ERROR'
                      : isCanonicalValid
                      ? '● VALID — Canonical Data Model v1.0.0'
                      : `✖ INVALID — ${canonicalEval.validation?.issues.length || 0} Schema Violation(s)`}
                  </h2>
                </div>

                <button
                  onClick={handleIngestCanonical}
                  disabled={!isCanonicalValid}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
                    isCanonicalValid
                      ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 cursor-pointer'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Normalize &amp; Ingest</span>
                </button>
              </div>

              {canonicalIngestedId && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-lg bg-emerald-950/50 border border-emerald-800/70 text-xs font-mono text-emerald-300">
                  <span>✓ Normalized &amp; ingested canonical event {canonicalIngestedId}</span>
                  <button
                    onClick={onNavigateToEventLog}
                    className="text-cyan-300 hover:text-cyan-200 underline font-semibold"
                  >
                    Inspect in Event Stream Log
                  </button>
                </div>
              )}

              {canonicalEval.syntaxError && (
                <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800/70 text-sm font-mono text-rose-300">
                  {canonicalEval.syntaxError}
                </div>
              )}

              {!canonicalEval.syntaxError &&
                canonicalEval.validation &&
                !canonicalEval.validation.isValid && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="pb-2.5 pr-3">JSON Path</th>
                          <th className="pb-2.5 pr-3">Keyword</th>
                          <th className="pb-2.5">Diagnostic</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 text-rose-300">
                        {canonicalEval.validation.issues.map((issue, idx) => (
                          <tr key={idx}>
                            <td className="py-2.5 pr-3 font-semibold text-white whitespace-nowrap">
                              {issue.path}
                            </td>
                            <td className="py-2.5 pr-3 text-amber-300 whitespace-nowrap">
                              {issue.keyword}
                            </td>
                            <td className="py-2.5 font-sans text-slate-200">{issue.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              {isCanonicalValid && canonicalEval.normalized && (
                <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
                  <span className="px-2.5 py-1 rounded bg-[#0b0f17] border border-slate-800 text-cyan-300">
                    domain: {canonicalEval.normalized.domain}
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded border font-semibold ${
                      canonicalEval.normalized.data_type === 'prediction' ||
                      canonicalEval.normalized.data_type === 'forecast'
                        ? 'bg-violet-950/60 border-violet-700/70 text-violet-300'
                        : 'bg-emerald-950/50 border-emerald-800/70 text-emerald-300'
                    }`}
                  >
                    data_type: {canonicalEval.normalized.data_type.toUpperCase()}
                  </span>
                  <span className="px-2.5 py-1 rounded bg-[#0b0f17] border border-slate-800 text-slate-200">
                    connector: {canonicalEval.normalized.source.connector_type}
                  </span>
                  {canonicalEval.conversions.length > 0 && (
                    <span className="px-2.5 py-1 rounded bg-amber-950/60 border border-amber-700/70 text-amber-300 font-semibold">
                      UNIT CONVERTED ({canonicalEval.conversions.length})
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Payload Normalization Diff (raw_data -> metrics & units) */}
            <div className="bg-[#121929] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <h2 className="text-base font-bold text-white">
                    Normalization Pipeline (raw_data → metrics &amp; units)
                  </h2>
                </div>
                {canonicalEval.normalized && (
                  <span className="text-xs font-mono tabular-nums text-slate-400">
                    UTC: {canonicalEval.normalized.timestamp}
                  </span>
                )}
              </div>

              {canonicalEval.normalized ? (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="pb-2.5 pr-3">Metric</th>
                          <th className="pb-2.5 pr-3">Normalized Value</th>
                          <th className="pb-2.5 pr-3">Unit</th>
                          <th className="pb-2.5">Transform</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {Object.entries(canonicalEval.normalized.payload.metrics).map(
                          ([metricKey, normValue]) => {
                            const conv = canonicalEval.conversions.find(
                              (c) => c.metric === metricKey
                            );
                            const unit = canonicalEval.normalized?.payload.units[metricKey] || '1';
                            return (
                              <tr key={metricKey}>
                                <td className="py-2.5 pr-3 text-cyan-300 font-semibold">
                                  {metricKey}
                                </td>
                                <td className="py-2.5 pr-3 text-white font-semibold">
                                  {typeof normValue === 'object'
                                    ? JSON.stringify(normValue)
                                    : String(normValue)}
                                </td>
                                <td className="py-2.5 pr-3 text-emerald-300">{unit}</td>
                                <td className="py-2.5">
                                  {conv ? (
                                    <span className="text-amber-300">
                                      {conv.rawValue} {conv.rawUnit} → {conv.normalizedValue}{' '}
                                      {conv.normalizedUnit} ({conv.rule})
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">identity (preserved)</span>
                                  )}
                                </td>
                              </tr>
                            );
                          }
                        )}
                      </tbody>
                    </table>
                  </div>

                  {Object.keys(canonicalEval.normalized.payload.context).length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80 text-xs font-mono">
                      <span className="text-slate-400">context:</span>
                      {Object.entries(canonicalEval.normalized.payload.context).map(([k, v]) => (
                        <span
                          key={k}
                          className="px-2 py-0.5 rounded bg-[#0b0f17] border border-slate-800 text-slate-300"
                        >
                          {k}={typeof v === 'object' ? JSON.stringify(v) : String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-5 rounded-lg bg-[#0b0f17] border border-slate-800 text-sm text-slate-400 font-mono">
                  Fix schema validation errors to inspect normalized metrics, units, and preserved raw_data.
                </div>
              )}
            </div>

            {/* Canonical JSON / Registry Event Projection Preview */}
            <div className="bg-[#121929] border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-base font-bold text-white">Canonical Output Preview</h2>
                </div>

                <div className="flex items-center gap-1 p-1 bg-[#0b0f17] rounded-lg border border-slate-800">
                  <button
                    onClick={() => setCanonicalPreviewTab('normalized')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                      canonicalPreviewTab === 'normalized'
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Normalized Canonical
                  </button>
                  <button
                    onClick={() => setCanonicalPreviewTab('event')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                      canonicalPreviewTab === 'event'
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Registry Event v1.0.0
                  </button>
                </div>
              </div>

              {canonicalEval.normalized && canonicalEval.projectedEvent ? (
                <pre className="bg-[#0b0f17] border border-slate-800 rounded-lg p-4 text-xs font-mono text-emerald-300 overflow-x-auto max-h-[300px] leading-relaxed">
                  {JSON.stringify(
                    canonicalPreviewTab === 'normalized'
                      ? canonicalEval.normalized
                      : canonicalEval.projectedEvent,
                    null,
                    2
                  )}
                </pre>
              ) : (
                <div className="p-5 rounded-lg bg-[#0b0f17] border border-slate-800 text-sm text-slate-400 font-mono">
                  Valid canonical records project losslessly into the 24-domain Registry Event pipeline.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODE 2: GENERIC INGESTION ENVELOPE                                    */}
      {/* ===================================================================== */}
      {inspectorMode === 'generic' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left Column: Interactive JSON Editor & Schema Spec */}
          <div className="xl:col-span-6 bg-[#121929] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-800 bg-[#0e1422]">
              <div className="flex items-center gap-1 p-1 bg-[#141b2d] rounded-lg border border-slate-800">
                <button
                  onClick={() => setGenericLeftTab('tester')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    genericLeftTab === 'tester'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Payload Tester
                </button>
                <button
                  onClick={() => setGenericLeftTab('schema')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    genericLeftTab === 'schema'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Draft 2020-12 JSON
                </button>
                <button
                  onClick={() => setGenericLeftTab('contract')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    genericLeftTab === 'contract'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Field Rules
                </button>
              </div>

              {genericLeftTab === 'tester' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleFormatGeneric}
                    className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  >
                    Format
                  </button>
                  <button
                    onClick={handleResetGeneric}
                    className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                </div>
              )}
            </div>

            {genericLeftTab === 'tester' && (
              <div className="p-5 space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-400">
                    Load Sample Telemetry Fixture
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {GENERIC_PRESET_FIXTURES.map((fixture) => {
                      const isActive = selectedGenericPreset === fixture.id;
                      return (
                        <button
                          key={fixture.id}
                          onClick={() => handleLoadGenericPreset(fixture)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                            isActive
                              ? fixture.isExpectedValid
                                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/60'
                                : 'bg-rose-950/80 text-rose-300 border-rose-500/60'
                              : 'bg-[#0b0f17] text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
                          }`}
                        >
                          {fixture.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="generic-json-editor"
                    className="text-xs font-semibold text-slate-400 block"
                  >
                    Telemetry Data Point JSON Input
                  </label>
                  <textarea
                    id="generic-json-editor"
                    value={genericJsonInput}
                    onChange={(e) => {
                      setGenericJsonInput(e.target.value);
                      setGenericIngestedId(null);
                    }}
                    rows={18}
                    spellCheck={false}
                    className="w-full bg-[#0b0f17] border border-slate-700/80 rounded-lg p-4 text-sm font-mono tabular-nums text-cyan-200 focus:outline-none focus:border-cyan-500 leading-relaxed resize-y"
                  />
                </div>
              </div>
            )}

            {genericLeftTab === 'schema' && (
              <div className="p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-400">
                  <span>$schema: draft/2020-12</span>
                  <span>additionalProperties: false</span>
                </div>
                <pre className="bg-[#0b0f17] border border-slate-800 rounded-lg p-4 text-xs font-mono text-cyan-300 overflow-x-auto max-h-[520px] leading-relaxed">
                  {genericSchemaString}
                </pre>
              </div>
            )}

            {genericLeftTab === 'contract' && (
              <div className="p-5">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-xs font-semibold">
                      <th className="pb-3 pr-4">Field</th>
                      <th className="pb-3 pr-4">Type &amp; Format</th>
                      <th className="pb-3">Constraint</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-mono text-xs">
                    <tr>
                      <td className="py-3.5 pr-4 text-cyan-400 font-semibold">timestamp</td>
                      <td className="py-3.5 pr-4">string (date-time)</td>
                      <td className="py-3.5 font-sans text-slate-300">
                        Required. Valid timezone-aware ISO 8601 timestamp.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3.5 pr-4 text-cyan-400 font-semibold">source_id</td>
                      <td className="py-3.5 pr-4">string (1..256)</td>
                      <td className="py-3.5 font-sans text-slate-300">
                        Required. Unique non-empty identifier without outer whitespace.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3.5 pr-4 text-cyan-400 font-semibold">domain</td>
                      <td className="py-3.5 pr-4">string (enum)</td>
                      <td className="py-3.5 font-sans text-slate-300">
                        Required. Must match one of the 24 canonical intelligence domains.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3.5 pr-4 text-cyan-400 font-semibold">payload</td>
                      <td className="py-3.5 pr-4">object (minProps: 1)</td>
                      <td className="py-3.5 font-sans text-slate-300">
                        Required. Holds domain-specific telemetry measurements and attributes.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right Column: Live Validation Report & Mapped Canonical Event */}
          <div className="xl:col-span-6 space-y-6">
            <div className="bg-[#121929] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  {isGenericValid ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                  )}
                  <h2 className="text-base font-bold text-white">
                    {genericEval.syntaxError
                      ? '✖ JSON SYNTAX ERROR'
                      : isGenericValid
                      ? '● VALID — Conforms to Draft 2020-12'
                      : `✖ INVALID — ${genericEval.validation?.issues.length || 0} Schema Violation(s)`}
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleUpgradeGenericToCanonical}
                    disabled={!isGenericValid}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                      isGenericValid
                        ? 'bg-[#0b0f17] hover:bg-slate-800 text-cyan-300 border-cyan-700/70 cursor-pointer'
                        : 'bg-slate-900 text-slate-500 border-slate-800 cursor-not-allowed'
                    }`}
                  >
                    <span>Upgrade to Canonical</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={handleIngestGeneric}
                    disabled={!isGenericValid}
                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
                      isGenericValid
                        ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                    }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Ingest to Live Bus</span>
                  </button>
                </div>
              </div>

              {genericIngestedId && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-lg bg-emerald-950/50 border border-emerald-800/70 text-xs font-mono text-emerald-300">
                  <span>✓ Mapped &amp; ingested event {genericIngestedId}</span>
                  <button
                    onClick={onNavigateToEventLog}
                    className="text-cyan-300 hover:text-cyan-200 underline font-semibold"
                  >
                    Inspect in Event Stream Log
                  </button>
                </div>
              )}

              {genericEval.syntaxError && (
                <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800/70 text-sm font-mono text-rose-300">
                  {genericEval.syntaxError}
                </div>
              )}

              {!genericEval.syntaxError &&
                genericEval.validation &&
                !genericEval.validation.isValid && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="pb-2.5 pr-3">JSON Path</th>
                          <th className="pb-2.5 pr-3">Keyword</th>
                          <th className="pb-2.5">Diagnostic</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 text-rose-300">
                        {genericEval.validation.issues.map((issue, idx) => (
                          <tr key={idx}>
                            <td className="py-2.5 pr-3 font-semibold text-white whitespace-nowrap">
                              {issue.path}
                            </td>
                            <td className="py-2.5 pr-3 text-amber-300 whitespace-nowrap">
                              {issue.keyword}
                            </td>
                            <td className="py-2.5 font-sans text-slate-200">{issue.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              {isGenericValid && (
                <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-300">
                  <span>timestamp: valid ISO 8601</span>
                  <span aria-hidden="true" className="text-slate-600">
                    ·
                  </span>
                  <span>source_id: {genericEval.validation?.data?.source_id}</span>
                  <span aria-hidden="true" className="text-slate-600">
                    ·
                  </span>
                  <span>domain: {genericEval.validation?.data?.domain}</span>
                </div>
              )}
            </div>

            <div className="bg-[#121929] border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-base font-bold text-white">
                    Canonical 24-Domain Mapping Preview
                  </h2>
                </div>
                <span className="text-xs font-mono text-slate-400">registry.schema.json v1.0.0</span>
              </div>

              {genericEval.canonicalEvent ? (
                <pre className="bg-[#0b0f17] border border-slate-800 rounded-lg p-4 text-xs font-mono text-emerald-300 overflow-x-auto max-h-[360px] leading-relaxed">
                  {JSON.stringify(genericEval.canonicalEvent, null, 2)}
                </pre>
              ) : (
                <div className="p-6 rounded-lg bg-[#0b0f17] border border-slate-800 text-sm text-slate-400 font-mono">
                  Fix schema validation errors to preview the normalized 24-domain canonical telemetry event.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
