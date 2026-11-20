import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DomainCategory, TelemetryEvent } from '../types/telemetry';
import { UNIVERSAL_DOMAINS } from '../services/domainRegistry';
import { telemetryEngine } from '../services/telemetryEngine';
import {
  appendUniqueBreachHistory,
  clearDomainAlertHistory,
  evaluateEventForBreachHistory,
  evaluateThreshold,
  loadAlertHistory,
  loadAllThresholds,
  makeThresholdKey,
  MetricThreshold,
  saveAllThresholds,
  scanEventsForBreaches,
  ThresholdAlertHistoryItem,
  ThresholdEvaluation
} from '../services/thresholdAlerts';
import { detectLocalExtrema } from '../services/metricExtrema';
import { DomainSparkline } from './DomainSparkline';
import { ThresholdAlertHistoryPanel } from './ThresholdAlertHistoryPanel';
import { ThresholdConfigurationModal } from './ThresholdConfigurationModal';
import {
  ArrowDown,
  ArrowUp,
  BarChart2,
  Bell,
  CheckCircle2,
  Database,
  History,
  MapPin,
  ShieldCheck,
  SlidersHorizontal
} from 'lucide-react';

interface DomainDashboardProps {
  domainId: DomainCategory;
}

export const DomainDashboard: React.FC<DomainDashboardProps> = ({ domainId }) => {
  const domainMeta = UNIVERSAL_DOMAINS[domainId];
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string>('');
  const [thresholds, setThresholds] = useState<Record<string, MetricThreshold>>(() =>
    loadAllThresholds()
  );
  const [alertHistory, setAlertHistory] = useState<ThresholdAlertHistoryItem[]>(() =>
    loadAlertHistory()
  );
  const [isAlertPanelOpen, setIsAlertPanelOpen] = useState<boolean>(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState<boolean>(true);
  const thresholdsRef = useRef(thresholds);
  thresholdsRef.current = thresholds;

  useEffect(() => {
    if (domainMeta.sampleMeasurementIds.length > 0) {
      setSelectedMeasurementId(domainMeta.sampleMeasurementIds[0]);
    }

    const unsubscribe = telemetryEngine.subscribe((event) => {
      if (event.domain === domainId) {
        setEvents((prev) => [...prev.slice(-40), event]);
      }

      const breach = evaluateEventForBreachHistory(event, thresholdsRef.current);
      if (breach) {
        setAlertHistory((prev) => appendUniqueBreachHistory(prev, [breach]));
      }
    });

    const initialEvents = telemetryEngine.getBufferedEvents({ domains: [domainId], limit: 40 });
    setEvents(initialEvents);

    const allBuffered = telemetryEngine.getBufferedEvents({ limit: 150 });
    if (allBuffered.length > 0) {
      setAlertHistory((prev) => scanEventsForBreaches(allBuffered, thresholdsRef.current, prev));
    }

    return () => {
      unsubscribe();
    };
  }, [domainId, domainMeta.sampleMeasurementIds]);

  const domainAlertHistory = useMemo(
    () => alertHistory.filter((item) => item.domainId === domainId),
    [alertHistory, domainId]
  );

  const handleClearDomainHistory = () => {
    setAlertHistory((prev) => clearDomainAlertHistory(domainId, prev));
  };

  const latestEvent = events.length > 0 ? events[events.length - 1] : null;

  // Map latest event per measurement_id within this domain
  const latestByMeasurement = useMemo(() => {
    const map: Record<string, TelemetryEvent> = {};
    for (const evt of events) {
      map[evt.measurement.measurement_id] = evt;
    }
    return map;
  }, [events]);

  // Evaluate threshold status for every metric in domainMeta.sampleMeasurementIds
  const metricEvaluations = useMemo(() => {
    const results: Record<string, ThresholdEvaluation> = {};
    for (const measId of domainMeta.sampleMeasurementIds) {
      const key = makeThresholdKey(domainId, measId);
      const rule = thresholds[key];
      const evt = latestByMeasurement[measId] || (latestEvent?.measurement.measurement_id === measId ? latestEvent : undefined);
      const numericVal = evt && typeof evt.measurement.value === 'number' ? evt.measurement.value : undefined;
      results[measId] = evaluateThreshold(numericVal, rule);
    }
    return results;
  }, [domainId, domainMeta.sampleMeasurementIds, thresholds, latestByMeasurement, latestEvent]);

  // Overall header alert indicator: prioritize currently selected metric if breached,
  // otherwise surface the first breached metric in the domain.
  const headerAlert = useMemo(() => {
    const selectedEval = metricEvaluations[selectedMeasurementId];
    if (selectedEval && (selectedEval.status === 'high' || selectedEval.status === 'low')) {
      return {
        measurementId: selectedMeasurementId,
        evaluation: selectedEval
      };
    }

    for (const measId of domainMeta.sampleMeasurementIds) {
      const ev = metricEvaluations[measId];
      if (ev && (ev.status === 'high' || ev.status === 'low')) {
        return {
          measurementId: measId,
          evaluation: ev
        };
      }
    }

    const activeCount = domainMeta.sampleMeasurementIds.filter((measId) => {
      const rule = thresholds[makeThresholdKey(domainId, measId)];
      return Boolean(rule?.enabled && (rule.low !== undefined || rule.high !== undefined));
    }).length;

    return {
      measurementId: selectedMeasurementId,
      evaluation: selectedEval || { status: activeCount > 0 ? 'normal' : 'unconfigured' as const },
      activeRuleCount: activeCount
    };
  }, [domainId, domainMeta.sampleMeasurementIds, metricEvaluations, selectedMeasurementId, thresholds]);

  // Active threshold rule for the currently selected measurement
  const activeKey = makeThresholdKey(domainId, selectedMeasurementId || domainMeta.sampleMeasurementIds[0] || '');
  const activeRule: MetricThreshold = thresholds[activeKey] || { enabled: false };

  const latestValuesByMetric = useMemo(() => {
    const values: Record<string, number | undefined> = {};
    for (const measId of domainMeta.sampleMeasurementIds) {
      const evt = latestByMeasurement[measId];
      values[measId] = evt && typeof evt.measurement.value === 'number' ? evt.measurement.value : undefined;
    }
    return values;
  }, [domainMeta.sampleMeasurementIds, latestByMeasurement]);

  const handleSaveThresholds = (updatedThresholds: Record<string, MetricThreshold>) => {
    setThresholds(updatedThresholds);
    saveAllThresholds(updatedThresholds);
  };

  // Compute time-series values for the selected measurement (fallback to all domain events if single-stream)
  const matchingEvents = useMemo(() => {
    const filtered = events.filter((e) => e.measurement.measurement_id === selectedMeasurementId);
    return filtered.length > 0 ? filtered : events;
  }, [events, selectedMeasurementId]);

  const chartData = useMemo(() => {
    return matchingEvents.map((e) => {
      const timeMs = new Date(e.event_time).getTime();
      const val = typeof e.measurement.value === 'number' ? e.measurement.value : 0;
      return {
        time: new Date(timeMs).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }),
        value: val,
        timestamp: timeMs
      };
    });
  }, [matchingEvents]);

  const numericValues = chartData.map((d) => d.value);
  const minValue = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 0;
  const avgValue =
    numericValues.length > 0
      ? Number((numericValues.reduce((a, b) => a + b, 0) / numericValues.length).toFixed(2))
      : 0;

  const hasInvertedBounds =
    activeRule.low !== undefined &&
    activeRule.high !== undefined &&
    activeRule.low >= activeRule.high;

  // Include active thresholds inside SVG chart y-axis domain so threshold lines stay visible
  const chartMinY = useMemo(() => {
    const candidates = [minValue];
    if (activeRule.enabled && activeRule.low !== undefined && Number.isFinite(activeRule.low)) {
      candidates.push(activeRule.low);
    }
    if (activeRule.enabled && activeRule.high !== undefined && Number.isFinite(activeRule.high)) {
      candidates.push(activeRule.high);
    }
    return candidates.length > 0 ? Math.min(...candidates) : 0;
  }, [minValue, activeRule]);

  const chartMaxY = useMemo(() => {
    const candidates = [maxValue];
    if (activeRule.enabled && activeRule.low !== undefined && Number.isFinite(activeRule.low)) {
      candidates.push(activeRule.low);
    }
    if (activeRule.enabled && activeRule.high !== undefined && Number.isFinite(activeRule.high)) {
      candidates.push(activeRule.high);
    }
    return candidates.length > 0 ? Math.max(...candidates) : 1;
  }, [maxValue, activeRule]);

  // SVG Chart Dimensions
  const chartHeight = 240;
  const chartWidth = 800;
  const padding = 30;
  const yRange = chartMaxY - chartMinY || 1;

  const valueToY = (val: number) =>
    chartHeight - padding - ((val - chartMinY) / yRange) * (chartHeight - padding * 2);

  const chartExtremaByIndex = useMemo(() => {
    const extrema = detectLocalExtrema(numericValues, {
      minProminenceRatio: 0.05,
      includeGlobalEndpointsIfMonotonic: true
    });
    const map = new Map<number, (typeof extrema)[number]>();
    for (const ex of extrema) {
      map.set(ex.index, ex);
    }
    return map;
  }, [numericValues]);

  const chartPoints = chartData.map((d, index) => {
    const x = padding + (index / Math.max(1, chartData.length - 1)) * (chartWidth - padding * 2);
    const y = valueToY(d.value);
    const pointStatus = evaluateThreshold(d.value, activeRule).status;
    return { x, y, value: d.value, status: pointStatus, extremum: chartExtremaByIndex.get(index) };
  });

  const pointsPolyline = chartPoints.map((p) => `${p.x},${p.y}`).join(' ');

  const highThresholdY =
    activeRule.enabled && activeRule.high !== undefined && !hasInvertedBounds
      ? valueToY(activeRule.high)
      : null;

  const lowThresholdY =
    activeRule.enabled && activeRule.low !== undefined && !hasInvertedBounds
      ? valueToY(activeRule.low)
      : null;

  return (
    <div className="flex-1 bg-[#0b0f17] flex flex-col min-w-0 overflow-y-auto p-8 space-y-8 custom-scrollbar">
      {/* Domain Title & Header Status + Threshold Visual Indicator */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 pb-6 border-b border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="w-4 h-4 rounded-full shrink-0"
              style={{ backgroundColor: domainMeta.colorHex }}
            />
            <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight">
              {domainMeta.name}
            </h1>
            <span className="text-sm text-slate-400 font-mono">({domainMeta.id})</span>
            <span
              className={`text-xs font-bold font-mono px-3 py-1 rounded-lg border ${
                domainMeta.isPhase1Priority
                  ? 'bg-cyan-950/80 text-cyan-300 border-cyan-800/80'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              {domainMeta.priorityGroup}
            </span>
          </div>
          <p className="text-sm text-slate-300 mt-2 max-w-4xl leading-relaxed font-normal">
            {domainMeta.description}
          </p>
        </div>

        {/* Right Header Status Cluster: Mini Sparkline + Threshold Alert + Data Class + Configure Button */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {/* Header Mini Sparkline with Local Minima & Maxima Markers */}
          <DomainSparkline
            metricName={selectedMeasurementId || domainMeta.sampleMeasurementIds[0] || 'metric'}
            unit={
              latestByMeasurement[selectedMeasurementId]?.measurement.unit ||
              domainMeta.primaryUnit.split('/')[0]
            }
            colorHex={domainMeta.colorHex}
            data={chartData.slice(-30)}
          />

          {/* Threshold Alert Visual Indicator ('high' / 'low' / 'in range') */}
          <div
            role="status"
            aria-live="polite"
            data-threshold-status={headerAlert.evaluation.status}
            className={`px-4 py-3 rounded-xl border flex items-center gap-3 font-mono ${
              headerAlert.evaluation.status === 'high'
                ? 'bg-rose-950/70 border-rose-500/80 text-rose-200'
                : headerAlert.evaluation.status === 'low'
                ? 'bg-amber-950/70 border-amber-500/80 text-amber-200'
                : headerAlert.evaluation.status === 'normal'
                ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-300'
                : 'bg-[#121929] border-slate-800 text-slate-300'
            }`}
          >
            {headerAlert.evaluation.status === 'high' ? (
              <ArrowUp className="w-5 h-5 text-rose-400 shrink-0" />
            ) : headerAlert.evaluation.status === 'low' ? (
              <ArrowDown className="w-5 h-5 text-amber-400 shrink-0" />
            ) : headerAlert.evaluation.status === 'normal' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <Bell className="w-5 h-5 text-slate-400 shrink-0" />
            )}

            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold opacity-80">
                Threshold Alert
              </div>
              <div className="text-sm font-bold flex items-center gap-2 tabular-nums">
                {headerAlert.evaluation.status === 'high' && (
                  <>
                    <span className="px-2 py-0.5 rounded bg-rose-500 text-slate-950 text-xs font-extrabold">
                      HIGH
                    </span>
                    <span>
                      {headerAlert.measurementId}: {headerAlert.evaluation.value} &gt;{' '}
                      {headerAlert.evaluation.breachedLimit}
                    </span>
                  </>
                )}
                {headerAlert.evaluation.status === 'low' && (
                  <>
                    <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-xs font-extrabold">
                      LOW
                    </span>
                    <span>
                      {headerAlert.measurementId}: {headerAlert.evaluation.value} &lt;{' '}
                      {headerAlert.evaluation.breachedLimit}
                    </span>
                  </>
                )}
                {headerAlert.evaluation.status === 'normal' && (
                  <span>● IN RANGE</span>
                )}
                {headerAlert.evaluation.status === 'unconfigured' && (
                  <span>○ NO THRESHOLD</span>
                )}
              </div>
            </div>
          </div>

          {/* Configure Thresholds Modal Button */}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isAlertPanelOpen}
            onClick={() => setIsAlertPanelOpen(true)}
            className="px-4 py-3 rounded-xl border text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer bg-[#121929] text-slate-200 border-slate-700 hover:text-white hover:border-cyan-500/70"
          >
            <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
            <span>Configure Thresholds</span>
          </button>

          {/* Alert History Side Panel Toggle */}
          <button
            type="button"
            aria-expanded={isHistoryPanelOpen}
            onClick={() => setIsHistoryPanelOpen((open) => !open)}
            className={`px-4 py-3 rounded-xl border text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
              isHistoryPanelOpen
                ? 'bg-slate-800 text-white border-slate-600'
                : 'bg-[#121929] text-slate-200 border-slate-700 hover:text-white hover:border-slate-600'
            }`}
          >
            <History className="w-4 h-4 text-amber-400" />
            <span>History ({domainAlertHistory.length})</span>
          </button>

          {/* Data Class Readout */}
          <div className="flex items-center gap-4 shrink-0 bg-[#121929] px-5 py-3 rounded-xl border border-slate-800">
            <div className="text-right font-mono">
              <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                Data Class
              </div>
              <div className="text-sm font-bold text-cyan-400 flex items-center justify-end gap-2 mt-0.5">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                <span>{latestEvent ? latestEvent.data_class.toUpperCase() : 'INITIALIZING'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Threshold Configuration Modal (persists to localStorage) */}
      <ThresholdConfigurationModal
        isOpen={isAlertPanelOpen}
        initialDomainId={domainId}
        initialMeasurementId={selectedMeasurementId}
        thresholds={thresholds}
        latestValuesByMetric={latestValuesByMetric}
        onSave={handleSaveThresholds}
        onClose={() => setIsAlertPanelOpen(false)}
      />

      {/* Main Workspace + Historical Triggered Threshold Alerts Side Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className={`${isHistoryPanelOpen ? 'xl:col-span-8' : 'xl:col-span-12'} space-y-6 min-w-0`}>
          {/* Primary Key Measurement IDs Grid */}
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 ${
              isHistoryPanelOpen ? '2xl:grid-cols-4' : 'lg:grid-cols-4'
            } gap-6`}
          >
        {domainMeta.sampleMeasurementIds.map((measId) => {
          const isSelected = selectedMeasurementId === measId;
          const matchingEvt = latestByMeasurement[measId];
          const liveVal = matchingEvt ? matchingEvt.measurement.value : '--';
          const measEval = metricEvaluations[measId];
          const rule = thresholds[makeThresholdKey(domainId, measId)];

          return (
            <div
              key={measId}
              onClick={() => setSelectedMeasurementId(measId)}
              className={`p-6 rounded-2xl border transition-colors cursor-pointer ${
                measEval?.status === 'high'
                  ? 'bg-rose-950/25 border-rose-500/80'
                  : measEval?.status === 'low'
                  ? 'bg-amber-950/25 border-amber-500/80'
                  : isSelected
                  ? 'bg-slate-800/90 border-cyan-500/80 ring-1 ring-cyan-500/50'
                  : 'bg-[#121929] border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-sm text-slate-300 font-semibold">
                <span className="truncate">{measId}</span>
                {measEval?.status === 'high' ? (
                  <span className="text-xs font-mono font-extrabold bg-rose-500 text-slate-950 px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                    <ArrowUp className="w-3 h-3" />
                    HIGH
                  </span>
                ) : measEval?.status === 'low' ? (
                  <span className="text-xs font-mono font-extrabold bg-amber-400 text-slate-950 px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                    <ArrowDown className="w-3 h-3" />
                    LOW
                  </span>
                ) : (
                  <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40 shrink-0">
                    SELECT
                  </span>
                )}
              </div>

              <div className="text-3xl lg:text-4xl font-extrabold font-mono text-white mt-3 tabular-nums tracking-tight">
                {typeof liveVal === 'number' ? liveVal.toLocaleString() : String(liveVal)}
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 mt-4 font-mono pt-3 border-t border-slate-800/80 gap-2">
                <span>Unit: {matchingEvt?.measurement.unit || domainMeta.primaryUnit.split('/')[0]}</span>
                {rule?.enabled && (rule.low !== undefined || rule.high !== undefined) ? (
                  <span className="text-slate-300 tabular-nums truncate">
                    {rule.low !== undefined ? `L:${rule.low}` : ''}{' '}
                    {rule.high !== undefined ? `H:${rule.high}` : ''}
                  </span>
                ) : (
                  <span className="text-cyan-400 font-bold">Quality: 98%</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time-Series Graph View with Visual Threshold Lines & Breach Markers */}
      <div className="bg-[#121929] border border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-bold text-white flex flex-wrap items-center gap-2.5">
              <BarChart2 className="w-5 h-5 text-cyan-400" />
              <span>Real-Time Telemetry Stream — {selectedMeasurementId || 'Measurement'}</span>
              {activeRule.enabled && !hasInvertedBounds && (activeRule.low !== undefined || activeRule.high !== undefined) && (
                <span className="text-xs font-mono px-2.5 py-0.5 rounded bg-[#0b0f17] border border-slate-700 text-slate-300">
                  {activeRule.low !== undefined ? `LOW < ${activeRule.low}` : ''}{' '}
                  {activeRule.low !== undefined && activeRule.high !== undefined ? '· ' : ''}
                  {activeRule.high !== undefined ? `HIGH > ${activeRule.high}` : ''}
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              High-frequency temporal observations ingested via Universal Telemetry Bus (Schema v1.0.0)
            </p>
          </div>

          <div className="flex items-center gap-6 text-sm font-mono text-slate-300 bg-[#182238] px-4 py-2 rounded-xl border border-slate-700/60">
            <div>
              Min: <span className="text-white font-bold tabular-nums">{minValue}</span>
            </div>
            <div>
              Avg: <span className="text-cyan-400 font-bold tabular-nums">{avgValue}</span>
            </div>
            <div>
              Max: <span className="text-white font-bold tabular-nums">{maxValue}</span>
            </div>
          </div>
        </div>

        {/* SVG Line Chart + Visual Threshold Bands */}
        <div className="w-full overflow-x-auto py-2">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-64 overflow-visible">
            {/* Baseline Gridlines */}
            <line
              x1={padding}
              y1={padding}
              x2={chartWidth - padding}
              y2={padding}
              stroke="#1e293b"
              strokeDasharray="4 4"
            />
            <line
              x1={padding}
              y1={chartHeight / 2}
              x2={chartWidth - padding}
              y2={chartHeight / 2}
              stroke="#1e293b"
              strokeDasharray="4 4"
            />
            <line
              x1={padding}
              y1={chartHeight - padding}
              x2={chartWidth - padding}
              y2={chartHeight - padding}
              stroke="#334155"
              strokeWidth="2"
            />

            {/* High Breach Zone & Threshold Reference Line */}
            {highThresholdY !== null && (
              <g>
                <rect
                  x={padding}
                  y={padding}
                  width={chartWidth - padding * 2}
                  height={Math.max(0, highThresholdY - padding)}
                  fill="#f43f5e14"
                />
                <line
                  x1={padding}
                  y1={highThresholdY}
                  x2={chartWidth - padding}
                  y2={highThresholdY}
                  stroke="#f43f5e"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />
                <text
                  x={chartWidth - padding - 6}
                  y={Math.max(padding + 12, highThresholdY - 6)}
                  textAnchor="end"
                  fill="#fda4af"
                  fontSize="11"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  HIGH &gt; {activeRule.high}
                </text>
              </g>
            )}

            {/* Low Breach Zone & Threshold Reference Line */}
            {lowThresholdY !== null && (
              <g>
                <rect
                  x={padding}
                  y={lowThresholdY}
                  width={chartWidth - padding * 2}
                  height={Math.max(0, chartHeight - padding - lowThresholdY)}
                  fill="#f59e0b14"
                />
                <line
                  x1={padding}
                  y1={lowThresholdY}
                  x2={chartWidth - padding}
                  y2={lowThresholdY}
                  stroke="#f59e0b"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />
                <text
                  x={chartWidth - padding - 6}
                  y={Math.min(chartHeight - padding - 6, lowThresholdY + 14)}
                  textAnchor="end"
                  fill="#fcd34d"
                  fontSize="11"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  LOW &lt; {activeRule.low}
                </text>
              </g>
            )}

            {/* Telemetry Polyline & Shaded Fill */}
            {pointsPolyline && (
              <polyline
                fill="none"
                stroke={domainMeta.colorHex}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={pointsPolyline}
              />
            )}

            {pointsPolyline && (
              <polygon
                fill={`${domainMeta.colorHex}25`}
                points={`${padding},${chartHeight - padding} ${pointsPolyline} ${
                  chartWidth - padding
                },${chartHeight - padding}`}
              />
            )}

            {/* Highlighted Breach Point Markers & Local Minima/Maxima Markers */}
            {chartPoints.map((pt, idx) => {
              const markers: React.ReactNode[] = [];

              if (pt.status === 'high') {
                markers.push(
                  <circle
                    key={`high-${idx}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={5}
                    fill="#f43f5e"
                    stroke="#0b0f17"
                    strokeWidth="2"
                  />
                );
              } else if (pt.status === 'low') {
                markers.push(
                  <circle
                    key={`low-${idx}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={5}
                    fill="#f59e0b"
                    stroke="#0b0f17"
                    strokeWidth="2"
                  />
                );
              }

              if (pt.extremum) {
                const isMax = pt.extremum.type === 'local_max';
                const markerColor = isMax ? '#10b981' : '#38bdf8';
                const labelY = isMax
                  ? Math.max(padding - 8, pt.y - 14)
                  : Math.min(chartHeight - 6, pt.y + 20);

                markers.push(
                  <g key={`extremum-${idx}`} data-chart-extremum={pt.extremum.type}>
                    <polygon
                      points={
                        isMax
                          ? `${pt.x},${pt.y - 11} ${pt.x - 4.5},${pt.y - 4.5} ${pt.x + 4.5},${pt.y - 4.5}`
                          : `${pt.x},${pt.y + 11} ${pt.x - 4.5},${pt.y + 4.5} ${pt.x + 4.5},${pt.y + 4.5}`
                      }
                      fill={markerColor}
                      stroke="#0b0f17"
                      strokeWidth="1"
                    />
                    {pt.extremum.isGlobal && (
                      <text
                        x={pt.x}
                        y={labelY}
                        textAnchor="middle"
                        fill={markerColor}
                        fontSize="10.5"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        {isMax ? `MAX ${pt.value}` : `MIN ${pt.value}`}
                      </text>
                    )}
                  </g>
                );
              }

              return markers.length > 0 ? <React.Fragment key={`pt-${idx}`}>{markers}</React.Fragment> : null;
            })}
          </svg>
        </div>
      </div>

      {/* Provenance & Source Metadata Inspector */}
      {latestEvent && (
        <div className="bg-[#121929] border border-slate-800 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm font-mono">
          <div className="space-y-2">
            <span className="text-slate-400 flex items-center gap-2 font-semibold">
              <Database className="w-4 h-4 text-cyan-400" />
              Source Provenance
            </span>
            <div className="text-white font-bold truncate text-base">
              {latestEvent.provenance.provider}
            </div>
            <div className="text-slate-400 text-xs truncate">Node: {latestEvent.source_id}</div>
          </div>

          <div className="space-y-2">
            <span className="text-slate-400 flex items-center gap-2 font-semibold">
              <MapPin className="w-4 h-4 text-emerald-400" />
              Geospatial Fix
            </span>
            <div className="text-white font-bold text-base">
              {latestEvent.location?.latitude.toFixed(4)}°,{' '}
              {latestEvent.location?.longitude.toFixed(4)}°
            </div>
            <div className="text-slate-400 text-xs">Region: {latestEvent.location?.region}</div>
          </div>

          <div className="space-y-2">
            <span className="text-slate-400 flex items-center gap-2 font-semibold">
              <ShieldCheck className="w-4 h-4 text-violet-400" />
              Data Validation
            </span>
            <div className="text-white font-bold text-base flex items-center gap-2">
              <span>Status: {latestEvent.quality.status}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                {latestEvent.quality.validation}
              </span>
            </div>
            <div className="text-slate-400 text-xs">
              Quality Score: {((latestEvent.quality.quality_score ?? 1.0) * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      )}
        </div>

        {isHistoryPanelOpen && (
          <div className="xl:col-span-4 min-w-0">
            <ThresholdAlertHistoryPanel
              domainName={domainMeta.name}
              history={domainAlertHistory}
              selectedMeasurementId={selectedMeasurementId}
              onSelectMeasurement={setSelectedMeasurementId}
              onClearHistory={handleClearDomainHistory}
              onCollapse={() => setIsHistoryPanelOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
