import React, { useState, useEffect } from 'react';
import { TelemetryEvent } from '../types/telemetry';
import { telemetryEngine } from '../services/telemetryEngine';
import { UNIVERSAL_DOMAINS } from '../services/domainRegistry';
import { Radio, Search, ChevronDown, ChevronRight, CheckCircle, AlertTriangle, FileCode, Download, Check } from 'lucide-react';
import {
  buildTelemetryCsvFilename,
  serializeTelemetryEventsToCsv,
  triggerCsvDownload
} from '../services/csvExport';

export const LiveEventStream: React.FC = () => {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [lastExportCount, setLastExportCount] = useState<number | null>(null);

  useEffect(() => {
    const updateEvents = () => {
      const allEvents = telemetryEngine.getBufferedEvents({ limit: 100 });
      setEvents(allEvents);
    };

    updateEvents();
    const unsubscribe = telemetryEngine.subscribe(() => {
      updateEvents();
    });

    return () => unsubscribe();
  }, []);

  const filteredEvents = events.filter(e => {
    const matchesDomain = selectedDomain === 'all' || e.domain === selectedDomain;
    const matchesSearch = !searchTerm ||
      e.event_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.measurement.measurement_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.provenance.provider.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesDomain && matchesSearch;
  }).reverse();

  const handleDownloadCsv = () => {
    if (filteredEvents.length === 0) return;
    const csv = serializeTelemetryEventsToCsv(filteredEvents);
    const filename = buildTelemetryCsvFilename(selectedDomain);
    triggerCsvDownload(csv, filename);
    setLastExportCount(filteredEvents.length);
    setTimeout(() => setLastExportCount(null), 2200);
  };

  return (
    <div className="flex-1 bg-[#0b0f17] flex flex-col min-w-0 overflow-y-auto p-8 space-y-8 custom-scrollbar">
      {/* Title & Filter Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <Radio className="w-6 h-6 text-indigo-400" />
            <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight">Canonical Telemetry Event Bus Log</h1>
            <span className="text-xs font-mono font-bold px-3 py-1 rounded-lg bg-indigo-950/80 text-indigo-300 border border-indigo-800/80">
              SCHEMA V1.0.0
            </span>
          </div>
          <p className="text-sm text-slate-300 mt-2 max-w-4xl leading-relaxed">
            Real-time event stream enforcing standard 2020-12 JSON schema validation rules, timestamp integrity (event_time, ingested_at, retrieved_at), provenance, and quality flags.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0 font-mono text-sm text-slate-300">
          <div className="bg-[#121929] px-5 py-3 rounded-xl border border-slate-800">
            <span>Displayed: <span className="text-white font-bold tabular-nums">{filteredEvents.length}</span></span>
            <span className="mx-2 text-slate-600">/</span>
            <span>Buffered: <span className="text-cyan-400 font-bold tabular-nums">{events.length}</span></span>
          </div>

          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={filteredEvents.length === 0}
            className={`px-5 py-3 rounded-xl border font-sans text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
              filteredEvents.length > 0
                ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 border-cyan-400 cursor-pointer'
                : 'bg-slate-900 text-slate-500 border-slate-800 cursor-not-allowed'
            }`}
          >
            {lastExportCount !== null ? (
              <>
                <Check className="w-4 h-4" />
                <span>Exported {lastExportCount} rows</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Download CSV</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
          <input
            type="text"
            placeholder="Search event ID, provider, or measurement ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#121929] border border-slate-700/80 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 font-medium shadow-inner"
          />
        </div>

        <select
          value={selectedDomain}
          onChange={(e) => setSelectedDomain(e.target.value)}
          className="bg-[#121929] border border-slate-700/80 text-sm text-white rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 font-semibold cursor-pointer shadow-sm"
        >
          <option value="all">All 24 Domains</option>
          {Object.values(UNIVERSAL_DOMAINS).map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Telemetry Event Table */}
      <div className="bg-[#121929] border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm font-mono">
            <thead>
              <tr className="border-b border-slate-800 bg-[#182238] text-slate-200">
                <th className="p-4 w-10"></th>
                <th className="p-4 font-bold">Event Time (UTC)</th>
                <th className="p-4 font-bold">Domain</th>
                <th className="p-4 font-bold">Measurement ID</th>
                <th className="p-4 font-bold">Data Class</th>
                <th className="p-4 font-bold">Origin Type</th>
                <th className="p-4 font-bold">Provider</th>
                <th className="p-4 font-bold">Quality</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-300">
              {filteredEvents.map((evt) => {
                const isExpanded = expandedEventId === evt.event_id;
                const domainMeta = UNIVERSAL_DOMAINS[evt.domain];

                return (
                  <React.Fragment key={evt.event_id}>
                    <tr
                      onClick={() => setExpandedEventId(isExpanded ? null : evt.event_id)}
                      className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                    >
                      <td className="p-4 text-slate-400">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="p-4 text-slate-300 tabular-nums">
                        {new Date(evt.event_time).toLocaleTimeString()}
                      </td>
                      <td className="p-4">
                        <span
                          className="px-2.5 py-1 rounded-lg text-xs font-bold"
                          style={{
                            backgroundColor: `${domainMeta?.colorHex || '#6366f1'}20`,
                            color: domainMeta?.colorHex || '#6366f1'
                          }}
                        >
                          {evt.domain}
                        </span>
                      </td>
                      <td className="p-4 font-bold text-white">
                        {evt.measurement.measurement_id}: <span className="text-cyan-400">{String(evt.measurement.value)} {evt.measurement.unit}</span>
                      </td>
                      <td className="p-4">
                        <span className={`text-xs font-bold ${
                          evt.data_class === 'observation' ? 'text-emerald-400' :
                          evt.data_class === 'prediction' ? 'text-fuchsia-400' :
                          evt.data_class === 'forecast' ? 'text-cyan-400' : 'text-amber-400'
                        }`}>
                          {evt.data_class}
                        </span>
                      </td>
                      <td className="p-4 text-slate-300 text-xs truncate max-w-xs">{evt.origin_type}</td>
                      <td className="p-4 text-slate-300 truncate max-w-xs">{evt.provenance.provider}</td>
                      <td className="p-4 tabular-nums font-bold">
                        <span className={`flex items-center gap-1.5 ${
                          evt.quality.validation === 'passed' ? 'text-emerald-400' : 'text-amber-400'
                        }`}>
                          {evt.quality.validation === 'passed' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                          {((evt.quality.quality_score ?? 1.0) * 100).toFixed(0)}%
                        </span>
                      </td>
                    </tr>

                    {/* Expanded Canonical Schema Viewer */}
                    {isExpanded && (
                      <tr className="bg-[#0b0f17]">
                        <td colSpan={8} className="p-6 space-y-4 text-xs font-mono">
                          <div className="flex items-center justify-between text-slate-300 font-bold">
                            <span className="flex items-center gap-2.5 text-sm">
                              <FileCode className="w-4 h-4 text-cyan-400" />
                              Canonical Event JSON Payload (Schema $id: https://weatherbeats.local/schemas/telemetry/1.0.0/registry.schema.json)
                            </span>
                            <span className="text-cyan-400">UUID: {evt.event_id}</span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-[#080d17] border border-slate-800 rounded-xl text-slate-200">
                            <div>
                              <span className="text-slate-400 block font-bold mb-1">Timestamps (UTC):</span>
                              <div>event_time: {evt.event_time}</div>
                              <div>ingested_at: {evt.ingested_at}</div>
                              <div>retrieved_at: {evt.provenance.retrieved_at}</div>
                            </div>
                            <div>
                              <span className="text-slate-400 block font-bold mb-1">Location (WGS84):</span>
                              <div>{evt.location ? `${evt.location.latitude}°, ${evt.location.longitude}° (${evt.location.coordinate_reference_system})` : 'N/A'}</div>
                              <div>Region: {evt.location?.region} [{evt.location?.country_code}]</div>
                            </div>
                            <div>
                              <span className="text-slate-400 block font-bold mb-1">Validation & Model:</span>
                              <div>Quality Status: {evt.quality.status} [{evt.quality.validation}]</div>
                              <div>Model: {evt.model_metadata?.model_id || 'N/A'}</div>
                            </div>
                          </div>

                          <pre className="p-4 rounded-xl bg-[#070a11] text-cyan-300 border border-slate-800 overflow-x-auto text-xs">
                            {JSON.stringify(evt, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
