import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  RotateCcw,
  Save,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { DomainCategory } from '../types/telemetry';
import { UNIVERSAL_DOMAINS } from '../services/domainRegistry';
import {
  DEFAULT_DOMAIN_THRESHOLDS,
  makeThresholdKey,
  MetricThreshold
} from '../services/thresholdAlerts';

interface ThresholdConfigurationModalProps {
  isOpen: boolean;
  initialDomainId: DomainCategory;
  initialMeasurementId: string;
  thresholds: Record<string, MetricThreshold>;
  latestValuesByMetric: Record<string, number | undefined>;
  onSave: (updatedThresholds: Record<string, MetricThreshold>) => void;
  onClose: () => void;
}

export const ThresholdConfigurationModal: React.FC<ThresholdConfigurationModalProps> = ({
  isOpen,
  initialDomainId,
  initialMeasurementId,
  thresholds,
  latestValuesByMetric,
  onSave,
  onClose
}) => {
  const [modalDomainId, setModalDomainId] = useState<DomainCategory>(initialDomainId);
  const [draftThresholds, setDraftThresholds] = useState<Record<string, MetricThreshold>>({});

  useEffect(() => {
    if (!isOpen) return;
    setModalDomainId(initialDomainId);
    const clone: Record<string, MetricThreshold> = {};
    for (const [k, v] of Object.entries(thresholds)) {
      clone[k] = { ...v };
    }
    setDraftThresholds(clone);
  }, [isOpen, initialDomainId, thresholds]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const domainMeta = UNIVERSAL_DOMAINS[modalDomainId];
  const criticalMetrics = domainMeta?.sampleMeasurementIds || [];

  const invalidMetrics = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const [key, rule] of Object.entries(draftThresholds)) {
      if (
        rule.low !== undefined &&
        rule.high !== undefined &&
        Number.isFinite(rule.low) &&
        Number.isFinite(rule.high) &&
        rule.low >= rule.high
      ) {
        errors[key] = `Low (${rule.low}) must be strictly less than High (${rule.high}).`;
      }
    }
    return errors;
  }, [draftThresholds]);

  const hasValidationErrors = Object.keys(invalidMetrics).length > 0;

  if (!isOpen) return null;

  const updateMetricDraft = (measId: string, patch: Partial<MetricThreshold>) => {
    const key = makeThresholdKey(modalDomainId, measId);
    setDraftThresholds((prev) => {
      const existing = prev[key] || { enabled: true };
      return {
        ...prev,
        [key]: {
          ...existing,
          ...patch
        }
      };
    });
  };

  const handleClearMetricDraft = (measId: string) => {
    const key = makeThresholdKey(modalDomainId, measId);
    setDraftThresholds((prev) => ({
      ...prev,
      [key]: { enabled: false }
    }));
  };

  const handleResetDomainDraft = () => {
    const prefix = `${modalDomainId}:`;
    setDraftThresholds((prev) => {
      const next: Record<string, MetricThreshold> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith(prefix)) {
          next[k] = v;
        }
      }
      const defaults = DEFAULT_DOMAIN_THRESHOLDS[modalDomainId];
      if (defaults) {
        for (const [measId, rule] of Object.entries(defaults)) {
          next[makeThresholdKey(modalDomainId, measId)] = { ...rule };
        }
      }
      return next;
    });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasValidationErrors) return;
    onSave(draftThresholds);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="threshold-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[88vh] bg-[#121929] border border-slate-700 rounded-2xl flex flex-col overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-800 bg-[#0e1422] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <SlidersHorizontal className="w-5 h-5 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <h2 id="threshold-modal-title" className="text-lg font-bold text-white truncate">
                Configure Metric Threshold Alerts
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Define custom <span className="font-mono text-amber-300">LOW</span> and{' '}
                <span className="font-mono text-rose-300">HIGH</span> alert boundaries per domain, persisted to browser storage.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close threshold configuration modal"
            className="p-2 rounded-lg bg-[#121929] border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
            {/* Domain Selector Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#0b0f17] border border-slate-800">
              <div className="space-y-0.5">
                <label
                  htmlFor="threshold-domain-select"
                  className="text-xs font-semibold text-slate-400 uppercase tracking-wider block"
                >
                  Target Intelligence Domain
                </label>
                <div className="text-xs font-mono text-slate-300">
                  {criticalMetrics.length} critical {criticalMetrics.length === 1 ? 'metric' : 'metrics'}
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <select
                  id="threshold-domain-select"
                  value={modalDomainId}
                  onChange={(e) => setModalDomainId(e.target.value as DomainCategory)}
                  className="bg-[#121929] border border-slate-700 text-sm text-white rounded-lg px-3.5 py-2 focus:outline-none focus:border-cyan-500 font-semibold cursor-pointer"
                >
                  {Object.values(UNIVERSAL_DOMAINS).map((dom) => (
                    <option key={dom.id} value={dom.id}>
                      {dom.name} ({dom.id})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleResetDomainDraft}
                  className="px-3 py-2 text-xs font-semibold rounded-lg bg-[#121929] border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Defaults</span>
                </button>
              </div>
            </div>

            {/* Per-Metric Threshold Inputs */}
            <div className="space-y-3">
              {criticalMetrics.map((measId) => {
                const key = makeThresholdKey(modalDomainId, measId);
                const rule = draftThresholds[key] || { enabled: false };
                const rowError = invalidMetrics[key];
                const isActiveTarget =
                  modalDomainId === initialDomainId && measId === initialMeasurementId;
                const liveValue =
                  modalDomainId === initialDomainId ? latestValuesByMetric[measId] : undefined;

                return (
                  <div
                    key={measId}
                    className={`p-4 rounded-xl border space-y-3 ${
                      rowError
                        ? 'bg-rose-950/20 border-rose-700/70'
                        : isActiveTarget
                        ? 'bg-[#0b0f17] border-cyan-500/60'
                        : 'bg-[#0b0f17] border-slate-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-sm font-mono font-bold text-white truncate">
                          {measId}
                        </span>
                        {isActiveTarget && (
                          <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-cyan-950 text-cyan-300 border border-cyan-800/70">
                            SELECTED
                          </span>
                        )}
                        {liveValue !== undefined && (
                          <span className="text-xs font-mono text-slate-400 tabular-nums">
                            Current: <span className="text-slate-200 font-semibold">{liveValue}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateMetricDraft(measId, { enabled: !rule.enabled })}
                          className={`px-3 py-1 text-xs font-mono font-bold rounded-md border transition-colors cursor-pointer ${
                            rule.enabled
                              ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700'
                              : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                          }`}
                        >
                          {rule.enabled ? '● ENABLED' : '○ DISABLED'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleClearMetricDraft(measId)}
                          className="px-2.5 py-1 text-xs font-semibold rounded-md bg-[#121929] border border-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor={`modal-low-${measId}`}
                          className="text-xs font-mono font-semibold text-amber-300 flex items-center gap-1.5 mb-1.5"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                          <span>Low Threshold (&lt;)</span>
                        </label>
                        <input
                          id={`modal-low-${measId}`}
                          type="number"
                          step="any"
                          value={rule.low ?? ''}
                          placeholder="Unset"
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            updateMetricDraft(measId, {
                              enabled: true,
                              low: raw === '' ? undefined : Number(raw)
                            });
                          }}
                          className="w-full bg-[#121929] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor={`modal-high-${measId}`}
                          className="text-xs font-mono font-semibold text-rose-300 flex items-center gap-1.5 mb-1.5"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                          <span>High Threshold (&gt;)</span>
                        </label>
                        <input
                          id={`modal-high-${measId}`}
                          type="number"
                          step="any"
                          value={rule.high ?? ''}
                          placeholder="Unset"
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            updateMetricDraft(measId, {
                              enabled: true,
                              high: raw === '' ? undefined : Number(raw)
                            });
                          }}
                          className="w-full bg-[#121929] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-white placeholder-slate-500 focus:outline-none focus:border-rose-400"
                        />
                      </div>
                    </div>

                    {rowError && (
                      <div className="text-xs font-mono text-rose-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{rowError}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sticky Modal Footer */}
          <div className="px-6 py-4 border-t border-slate-800 bg-[#0e1422] flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="text-xs font-mono text-slate-400">
              {hasValidationErrors ? (
                <span className="text-rose-300 font-semibold">
                  Fix invalid Low/High bounds before saving.
                </span>
              ) : (
                <span>Saved thresholds persist in localStorage.</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#121929] border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={hasValidationErrors}
                className={`px-5 py-2 text-sm font-bold rounded-lg transition-colors flex items-center gap-2 ${
                  hasValidationErrors
                    ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                    : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 cursor-pointer'
                }`}
              >
                <Save className="w-4 h-4" />
                <span>Save Thresholds</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
