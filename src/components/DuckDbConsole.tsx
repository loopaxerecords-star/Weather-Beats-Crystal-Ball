import React, { useState, useEffect } from 'react';
import { duckDbService, QueryResult } from '../services/duckdbService';
import { telemetryEngine } from '../services/telemetryEngine';
import { Database, Play, CheckCircle, Code } from 'lucide-react';

export const DuckDbConsole: React.FC = () => {
  const [sqlQuery, setSqlQuery] = useState<string>(
    'SELECT domain, COUNT(*) as event_count, AVG(quality_score) as avg_quality FROM telemetry_events GROUP BY domain;'
  );
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [engineInfo, setEngineInfo] = useState(duckDbService.getEngineInfo());

  useEffect(() => {
    duckDbService.init().then(() => {
      setEngineInfo(duckDbService.getEngineInfo());
      const events = telemetryEngine.getBufferedEvents({ limit: 200 });
      duckDbService.insertEvents(events);
    });

    const unsubscribe = telemetryEngine.subscribe((event) => {
      duckDbService.insertEvents([event]);
      setEngineInfo(duckDbService.getEngineInfo());
    });

    return () => unsubscribe();
  }, []);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      const result = await duckDbService.executeSql(sqlQuery);
      setQueryResult(result);
    } catch (err: any) {
      console.error('SQL Execution Error:', err);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="flex-1 bg-[#0b0f17] flex flex-col min-w-0 overflow-y-auto p-8 space-y-8 custom-scrollbar">
      {/* Title & Engine Verification Status */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <Database className="w-6 h-6 text-amber-400" />
            <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight">DuckDB Analytical Query Console</h1>
            <span className={`text-xs font-mono font-bold px-3 py-1 rounded-lg border ${
              engineInfo.isDuckDbWasmActive
                ? 'bg-amber-950/80 text-amber-300 border-amber-800/80'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}>
              {engineInfo.engineName}
            </span>
          </div>
          <p className="text-sm text-slate-300 mt-2 max-w-4xl leading-relaxed">
            Analytical engine executing high-speed SQL queries over live telemetry and historical Parquet buffers.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0 font-mono text-sm text-slate-300 bg-[#121929] px-5 py-3 rounded-xl border border-slate-800">
          <span>In-Memory Records: <span className="text-white font-bold">{engineInfo.recordCount}</span></span>
        </div>
      </div>

      {/* SQL Editor Area */}
      <div className="bg-[#121929] border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg">
        <div className="flex items-center justify-between">
          <label className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Code className="w-5 h-5 text-amber-400" />
            <span>SQL Query Statement:</span>
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSqlQuery('SELECT domain, COUNT(*) as count FROM telemetry_events GROUP BY domain;')}
              className="text-xs font-mono text-slate-300 hover:text-white bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700"
            >
              [Group Summary]
            </button>
            <button
              onClick={() => setSqlQuery('SELECT event_id, domain, measurement_id, data_class, origin_type, event_time FROM telemetry_events LIMIT 25;')}
              className="text-xs font-mono text-slate-300 hover:text-white bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700"
            >
              [Recent Events]
            </button>
          </div>
        </div>

        <textarea
          value={sqlQuery}
          onChange={(e) => setSqlQuery(e.target.value)}
          rows={4}
          className="w-full bg-[#0b0f17] border border-slate-700/80 rounded-xl p-4 text-sm font-mono text-cyan-300 placeholder-slate-500 focus:outline-none focus:border-amber-500 shadow-inner"
        />

        <div className="flex items-center justify-between pt-2">
          <div className="text-xs font-mono text-slate-400">
            Engine: <span className="text-amber-400 font-semibold">{engineInfo.engineName}</span>
          </div>

          <button
            onClick={handleExecute}
            disabled={isExecuting}
            className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm rounded-xl transition-all flex items-center gap-2.5 shadow-lg shadow-amber-950/40"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>{isExecuting ? 'Executing SQL...' : 'Run Analytical Query'}</span>
          </button>
        </div>
      </div>

      {/* SQL Query Results Grid */}
      {queryResult && (
        <div className="bg-[#121929] border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800 text-sm font-mono">
            <div className="flex items-center gap-2.5 text-emerald-400 font-bold">
              <CheckCircle className="w-5 h-5" />
              <span>Query Executed Successfully</span>
            </div>
            <div className="flex items-center gap-6 text-slate-300">
              <span>Time: <span className="text-white font-bold">{queryResult.executionTimeMs} ms</span></span>
              <span>Rows: <span className="text-white font-bold">{queryResult.rowCount}</span></span>
              <span>Engine: <span className="text-amber-400 font-bold">{queryResult.engineName}</span></span>
            </div>
          </div>

          {/* Table Output */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm font-mono">
              <thead>
                <tr className="border-b border-slate-800 bg-[#182238] text-slate-200">
                  {queryResult.columns.map((col, idx) => (
                    <th key={idx} className="p-3.5 font-bold capitalize">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-300">
                {queryResult.rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-800/50">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="p-3.5 tabular-nums">
                        {typeof cell === 'object' ? JSON.stringify(cell) : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
