import React, { useState, useEffect } from 'react';
import { DomainCategory, TelemetryEvent } from '../types/telemetry';
import { UNIVERSAL_DOMAINS } from '../services/domainRegistry';
import { telemetryEngine } from '../services/telemetryEngine';
import { Activity, GitMerge, Sparkles } from 'lucide-react';

export const CrossDomainAnalytics: React.FC = () => {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [domainA, setDomainA] = useState<DomainCategory>('weather');
  const [domainB, setDomainB] = useState<DomainCategory>('energy');

  useEffect(() => {
    const updateEvents = () => {
      const allEvents = telemetryEngine.getBufferedEvents({ limit: 150 });
      setEvents(allEvents);
    };

    updateEvents();
    const interval = setInterval(updateEvents, 1000);
    return () => clearInterval(interval);
  }, []);

  const metaA = UNIVERSAL_DOMAINS[domainA];
  const metaB = UNIVERSAL_DOMAINS[domainB];

  const eventsA = events.filter(e => e.domain === domainA);
  const eventsB = events.filter(e => e.domain === domainB);

  const keyA = metaA.sampleMeasurementIds[0] || '';
  const keyB = metaB.sampleMeasurementIds[0] || '';

  const valuesA = eventsA.map(e => Number(e.measurement.value) || 0);
  const valuesB = eventsB.map(e => Number(e.measurement.value) || 0);

  const sampleSize = Math.min(valuesA.length, valuesB.length);
  const pairedA = valuesA.slice(0, sampleSize);
  const pairedB = valuesB.slice(0, sampleSize);

  let r = 0;
  if (sampleSize > 2) {
    const meanA = pairedA.reduce((a, b) => a + b, 0) / sampleSize;
    const meanB = pairedB.reduce((a, b) => a + b, 0) / sampleSize;

    let num = 0;
    let denA = 0;
    let denB = 0;

    for (let i = 0; i < sampleSize; i++) {
      const diffA = pairedA[i] - meanA;
      const diffB = pairedB[i] - meanB;
      num += diffA * diffB;
      denA += diffA * diffA;
      denB += diffB * diffB;
    }

    const den = Math.sqrt(denA * denB);
    r = den > 0 ? Number((num / den).toFixed(2)) : 0;
  }

  return (
    <div className="flex-1 bg-[#0b0f17] flex flex-col min-w-0 overflow-y-auto p-8 space-y-8 custom-scrollbar">
      {/* Title & Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <GitMerge className="w-6 h-6 text-emerald-400" />
            <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight">Cross-Domain Intelligence Correlation Matrix</h1>
          </div>
          <p className="text-sm text-slate-300 mt-2 max-w-4xl leading-relaxed">
            Multi-domain mathematical analysis identifying physical, environmental, computing, and acoustic telemetry correlations without assuming correlation proves causation.
          </p>
        </div>
      </div>

      {/* Select Domain A & Domain B */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-2xl bg-[#121929] border border-slate-800 space-y-4 shadow-lg">
          <label className="text-sm font-bold text-slate-200 block">Select Domain Alpha:</label>
          <select
            value={domainA}
            onChange={(e) => setDomainA(e.target.value as DomainCategory)}
            className="w-full bg-[#182238] border border-slate-700 rounded-xl px-4 py-3 text-sm text-white font-semibold focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            {Object.values(UNIVERSAL_DOMAINS).map(d => (
              <option key={d.id} value={d.id}>{d.name} ({d.primaryUnit})</option>
            ))}
          </select>
          <div className="text-xs text-slate-400 font-mono">
            Metric Stream: <span className="text-cyan-400 font-bold">{keyA}</span>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-[#121929] border border-slate-800 space-y-4 shadow-lg">
          <label className="text-sm font-bold text-slate-200 block">Select Domain Beta:</label>
          <select
            value={domainB}
            onChange={(e) => setDomainB(e.target.value as DomainCategory)}
            className="w-full bg-[#182238] border border-slate-700 rounded-xl px-4 py-3 text-sm text-white font-semibold focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            {Object.values(UNIVERSAL_DOMAINS).map(d => (
              <option key={d.id} value={d.id}>{d.name} ({d.primaryUnit})</option>
            ))}
          </select>
          <div className="text-xs text-slate-400 font-mono">
            Metric Stream: <span className="text-emerald-400 font-bold">{keyB}</span>
          </div>
        </div>
      </div>

      {/* Correlation Metric Summary Card */}
      <div className="p-6 rounded-2xl bg-[#121929] border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-6 shadow-lg">
        <div className="space-y-2">
          <div className="text-xs text-slate-400 font-mono uppercase tracking-wider font-semibold">Pearson Correlation Coefficient (r)</div>
          <div className="text-4xl lg:text-5xl font-extrabold font-mono text-white tabular-nums tracking-tight">
            r = {r > 0 ? `+${r}` : r}
          </div>
          <p className="text-sm text-slate-300 max-w-xl">
            {Math.abs(r) > 0.7
              ? 'Strong correlation detected between domain metric vectors.'
              : Math.abs(r) > 0.3
              ? 'Moderate correlation observed across temporal streams.'
              : 'Weak or independent domain metric relationship.'}
          </p>
        </div>

        <div className="p-5 rounded-xl bg-[#182238] border border-slate-700/80 space-y-2 text-xs font-mono text-slate-300 max-w-sm">
          <div className="text-cyan-400 font-bold flex items-center gap-2 text-sm">
            <Sparkles className="w-4 h-4" />
            Cross-Domain Insight
          </div>
          <p className="text-xs text-slate-300 leading-relaxed font-sans">
            {metaA.name} ({keyA}) vs {metaB.name} ({keyB}) computed over {sampleSize} live telemetry frames.
          </p>
        </div>
      </div>

      {/* Cross-Domain Scatter Matrix Visualizer */}
      <div className="bg-[#121929] border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg">
        <h3 className="text-base font-bold text-white flex items-center gap-2.5">
          <Activity className="w-5 h-5 text-cyan-400" />
          <span>Bi-Variate Scatter Matrix Plot</span>
        </h3>

        <div className="h-72 w-full bg-[#0e1422] rounded-xl border border-slate-800 relative p-6 flex items-center justify-center overflow-hidden shadow-inner">
          <div className="absolute left-4 top-4 text-xs font-mono text-cyan-400 font-bold">{metaB.name} ↑</div>
          <div className="absolute right-4 bottom-4 text-xs font-mono text-emerald-400 font-bold">{metaA.name} →</div>

          <svg className="w-full h-full overflow-visible">
            {pairedA.map((valA, idx) => {
              const valB = pairedB[idx];
              const minA = Math.min(...pairedA);
              const maxA = Math.max(...pairedA) || 1;
              const minB = Math.min(...pairedB);
              const maxB = Math.max(...pairedB) || 1;

              const normX = ((valA - minA) / (maxA - minA || 1)) * 88 + 6;
              const normY = 92 - (((valB - minB) / (maxB - minB || 1)) * 88 + 6);

              return (
                <circle
                  key={idx}
                  cx={`${normX}%`}
                  cy={`${normY}%`}
                  r="5"
                  fill={metaA.colorHex}
                  opacity="0.85"
                  className="transition-all hover:r-8 cursor-pointer"
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
};
