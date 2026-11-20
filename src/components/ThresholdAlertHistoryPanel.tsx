import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, BellRing, PanelRightClose, Trash2 } from 'lucide-react';
import { ThresholdAlertHistoryItem } from '../services/thresholdAlerts';

interface ThresholdAlertHistoryPanelProps {
  domainName: string;
  history: ThresholdAlertHistoryItem[];
  selectedMeasurementId: string;
  onSelectMeasurement: (measurementId: string) => void;
  onClearHistory: () => void;
  onCollapse?: () => void;
}

export const ThresholdAlertHistoryPanel: React.FC<ThresholdAlertHistoryPanelProps> = ({
  domainName,
  history,
  selectedMeasurementId,
  onSelectMeasurement,
  onClearHistory,
  onCollapse
}) => {
  const [severityFilter, setSeverityFilter] = useState<'all' | 'high' | 'low'>('all');
  const [metricScope, setMetricScope] = useState<'all' | 'selected'>('all');

  const highCount = useMemo(
    () => history.filter((item) => item.breachType === 'high').length,
    [history]
  );
  const lowCount = useMemo(
    () => history.filter((item) => item.breachType === 'low').length,
    [history]
  );

  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      if (severityFilter !== 'all' && item.breachType !== severityFilter) return false;
      if (metricScope === 'selected' && item.measurementId !== selectedMeasurementId) return false;
      return true;
    });
  }, [history, severityFilter, metricScope, selectedMeasurementId]);

  return (
    <aside
      aria-label={`Triggered threshold alert history for ${domainName}`}
      className="bg-[#121929] border border-slate-800 rounded-2xl flex flex-col overflow-hidden"
    >
      {/* Side Panel Header */}
      <div className="px-5 py-4 border-b border-slate-800 bg-[#0e1422] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <BellRing className="w-5 h-5 text-amber-400 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white truncate">Alert History</h2>
            <p className="text-xs font-mono text-slate-400 truncate">
              {history.length} triggered {history.length === 1 ? 'breach' : 'breaches'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onClearHistory}
            disabled={history.length === 0}
            title="Clear domain breach history"
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 ${
              history.length > 0
                ? 'bg-[#121929] border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 cursor-pointer'
                : 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>

          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Collapse alert history panel"
              aria-label="Collapse alert history panel"
              className="p-1.5 rounded-lg bg-[#121929] border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 transition-colors cursor-pointer"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Controls */}
      <div className="px-5 py-3.5 border-b border-slate-800 space-y-2.5 bg-[#0b0f17]/40">
        <div className="flex items-center gap-1.5 p-1 bg-[#0b0f17] rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setSeverityFilter('all')}
            className={`flex-1 px-2.5 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors cursor-pointer ${
              severityFilter === 'all'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({history.length})
          </button>
          <button
            type="button"
            onClick={() => setSeverityFilter('high')}
            className={`flex-1 px-2.5 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors cursor-pointer ${
              severityFilter === 'high'
                ? 'bg-rose-950/90 text-rose-300 border border-rose-700/60'
                : 'text-slate-400 hover:text-rose-300'
            }`}
          >
            HIGH ({highCount})
          </button>
          <button
            type="button"
            onClick={() => setSeverityFilter('low')}
            className={`flex-1 px-2.5 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors cursor-pointer ${
              severityFilter === 'low'
                ? 'bg-amber-950/90 text-amber-300 border border-amber-700/60'
                : 'text-slate-400 hover:text-amber-300'
            }`}
          >
            LOW ({lowCount})
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs font-mono">
          <span className="text-slate-400">Scope:</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMetricScope('all')}
              className={`px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                metricScope === 'all'
                  ? 'bg-cyan-950/70 text-cyan-300 border-cyan-700/70 font-semibold'
                  : 'bg-[#0b0f17] text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              All Metrics
            </button>
            <button
              type="button"
              onClick={() => setMetricScope('selected')}
              className={`px-2.5 py-1 rounded-md border transition-colors truncate max-w-[140px] cursor-pointer ${
                metricScope === 'selected'
                  ? 'bg-cyan-950/70 text-cyan-300 border-cyan-700/70 font-semibold'
                  : 'bg-[#0b0f17] text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
              title={selectedMeasurementId}
            >
              {selectedMeasurementId || 'Selected'}
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Alert History List */}
      <div className="flex-1 overflow-y-auto max-h-[640px] divide-y divide-slate-800/80 custom-scrollbar">
        {filteredHistory.length === 0 ? (
          <div className="p-6 text-center space-y-2">
            <div className="text-sm font-semibold text-slate-300">
              No Threshold Breaches Logged
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Incoming {domainName} telemetry exceeding HIGH or dropping below LOW thresholds will appear here chronologically.
            </p>
          </div>
        ) : (
          filteredHistory.map((item) => {
            const isHigh = item.breachType === 'high';
            const isSelectedMetric = item.measurementId === selectedMeasurementId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectMeasurement(item.measurementId)}
                className={`w-full text-left px-5 py-3.5 transition-colors hover:bg-slate-800/40 cursor-pointer space-y-2 ${
                  isSelectedMetric ? 'bg-slate-800/25' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-mono font-extrabold flex items-center gap-1 shrink-0 ${
                        isHigh
                          ? 'bg-rose-500 text-slate-950'
                          : 'bg-amber-400 text-slate-950'
                      }`}
                    >
                      {isHigh ? (
                        <ArrowUp className="w-3 h-3" />
                      ) : (
                        <ArrowDown className="w-3 h-3" />
                      )}
                      {isHigh ? 'HIGH' : 'LOW'}
                    </span>
                    <span className="text-xs font-mono font-semibold text-white truncate">
                      {item.measurementId}
                    </span>
                  </div>

                  <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                    {new Date(item.triggeredAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
                  <span className={isHigh ? 'text-rose-300 font-bold' : 'text-amber-300 font-bold'}>
                    {item.value} {item.unit}{' '}
                    <span className="text-slate-400 font-normal">
                      ({isHigh ? '>' : '<'} {item.thresholdLimit} {item.unit})
                    </span>
                  </span>
                  <span className="text-slate-400">
                    {isHigh ? `+${item.delta}` : `-${item.delta}`}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-500">
                  <span className="truncate">{item.sourceId}</span>
                  <span className="uppercase shrink-0 text-slate-400">{item.dataClass}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
};
