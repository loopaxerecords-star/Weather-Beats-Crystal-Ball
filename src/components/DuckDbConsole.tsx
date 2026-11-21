import React, { useState, useEffect, useMemo } from 'react';
import { duckDbService, QueryResult } from '../services/duckdbService';
import { telemetryEngine } from '../services/telemetryEngine';
import { computeDomainVector24 } from '../services/weatherBeatsComposer';
import {
  SmartAlertRule,
  addSmartAlertRule,
  compileSmartAlertRule,
  deleteSmartAlertRule,
  evaluateSmartAlertRules,
  loadSmartAlertRules,
  requestDuckDbResultSummary,
  requestDuckDbSqlFromEnglish,
  subscribeSmartAlertRules,
  toggleSmartAlertRule
} from '../services/aiIntelligenceSuite';
import {
  Database,
  Play,
  CheckCircle,
  Code,
  Search,
  Bell,
  Trash2,
  AlertTriangle
} from 'lucide-react';

export const DuckDbConsole: React.FC = () => {
  const [sqlQuery, setSqlQuery] = useState<string>(
    'SELECT domain, COUNT(*) as event_count, AVG(quality_score) as avg_quality FROM telemetry_events GROUP BY domain;'
  );
  const [englishQuestion, setEnglishQuestion] = useState<string>('');
  const [queryExplanation, setQueryExplanation] = useState<string | null>(null);
  const [querySummary, setQuerySummary] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [isAskingNl, setIsAskingNl] = useState<boolean>(false);
  const [engineInfo, setEngineInfo] = useState(duckDbService.getEngineInfo());

  // Conversational Smart Alert Rules
  const [alertPrompt, setAlertPrompt] = useState<string>('');
  const [isCompilingAlert, setIsCompilingAlert] = useState<boolean>(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [alertRules, setAlertRules] = useState<SmartAlertRule[]>(() => loadSmartAlertRules());
  const [weatherCtx, setWeatherCtx] = useState(() => telemetryEngine.getWeatherContext());
  const [latestByDomain, setLatestByDomain] = useState(() => telemetryEngine.getLatestByDomain());

  useEffect(() => {
    duckDbService.init().then(() => {
      setEngineInfo(duckDbService.getEngineInfo());
      const events = telemetryEngine.getBufferedEvents({ limit: 200 });
      duckDbService.insertEvents(events);
    });

    const unsubscribe = telemetryEngine.subscribe((event) => {
      duckDbService.insertEvents([event]);
      setEngineInfo(duckDbService.getEngineInfo());
      setWeatherCtx(telemetryEngine.getWeatherContext());
      setLatestByDomain(telemetryEngine.getLatestByDomain());
    });

    const unsubAlerts = subscribeSmartAlertRules(() => {
      setAlertRules(loadSmartAlertRules());
    });

    return () => {
      unsubscribe();
      unsubAlerts();
    };
  }, []);

  const vector24 = useMemo(
    () => computeDomainVector24(latestByDomain, weatherCtx),
    [latestByDomain, weatherCtx]
  );

  const alertEval = useMemo(
    () => evaluateSmartAlertRules(alertRules, { weather: weatherCtx, vector24 }),
    [alertRules, weatherCtx, vector24]
  );

  const handleExecute = async (overrideSql?: string, sourceQuestion?: string) => {
    const targetSql = (overrideSql ?? sqlQuery).trim();
    if (!targetSql) return;
    setIsExecuting(true);
    setQueryError(null);
    if (!sourceQuestion) {
      setQuerySummary(null);
    }
    try {
      const result = await duckDbService.executeSql(targetSql);
      setQueryResult(result);

      if (sourceQuestion) {
        try {
          const summary = await requestDuckDbResultSummary(
            sourceQuestion,
            targetSql,
            result.columns,
            result.rows.slice(0, 20)
          );
          setQuerySummary(summary);
        } catch (sumErr) {
          setQuerySummary(
            sumErr instanceof Error
              ? `Result returned (${result.rowCount} rows); summary unavailable: ${sumErr.message}`
              : null
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'SQL execution failed.';
      setQueryError(msg);
      setQueryResult(null);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleAskPlainEnglish = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = englishQuestion.trim();
    if (!q || isAskingNl) return;
    setIsAskingNl(true);
    setQueryError(null);
    setQueryExplanation(null);
    setQuerySummary(null);
    try {
      const nlRes = await requestDuckDbSqlFromEnglish(q);
      setSqlQuery(nlRes.sql);
      setQueryExplanation(nlRes.explanation);
      await handleExecute(nlRes.sql, q);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : 'Could not compile natural-language query.');
    } finally {
      setIsAskingNl(false);
    }
  };

  const handleCreateSmartAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    const desc = alertPrompt.trim();
    if (!desc || isCompilingAlert) return;
    setIsCompilingAlert(true);
    setAlertError(null);
    try {
      const compiled = await compileSmartAlertRule(desc);
      addSmartAlertRule(compiled);
      setAlertPrompt('');
    } catch (err) {
      setAlertError(err instanceof Error ? err.message : 'Could not compile smart alert rule.');
    } finally {
      setIsCompilingAlert(false);
    }
  };

  return (
    <div className="flex-1 bg-[#10141c] flex flex-col min-w-0 overflow-y-auto p-6 lg:p-8 space-y-6 custom-scrollbar text-[#e6e1d8]">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-white/[0.08]">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Database className="w-5 h-5 text-[#c9b18a] shrink-0" />
            <h1 className="text-2xl font-semibold text-[#ece7df] tracking-tight">
              DuckDB Analytical Store &amp; Smart Alerts
            </h1>
            <span className="text-xs font-mono text-[#9c9991]">
              {engineInfo.engineName} · Read-Only SQL Verified
            </span>
          </div>
          <p className="text-sm text-[#b5b0a6] mt-1.5 max-w-4xl leading-relaxed">
            Query all 24 live telemetry streams in plain English or standard SQL, and define compound conversational alert rules that subtly tint the crystal ball when conditions breach.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0 font-mono text-xs tabular-nums text-[#c7c2b8] bg-[#161b25] px-4 py-2.5 rounded-xl border border-white/[0.08]">
          <span>
            Records: <span className="text-[#ece7df] font-semibold">{engineInfo.recordCount}</span>
          </span>
          <span aria-hidden="true" className="text-stone-600">·</span>
          <span>
            Active Alerts: <span className="text-[#c9b18a] font-semibold">{alertRules.filter((r) => r.enabled).length}</span>
          </span>
        </div>
      </div>

      {/* 01. Plain-English Telemetry Query */}
      <section className="bg-[#161b25] border border-white/[0.08] rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[#ece7df] flex items-center gap-2">
            <Search className="w-4 h-4 text-[#7fa898]" />
            <span>01. Ask Telemetry in Plain English</span>
          </h2>
          <span className="text-xs font-mono text-[#9c9991]">
            Compiles to strict read-only SELECT / WITH SQL
          </span>
        </div>

        <form onSubmit={handleAskPlainEnglish} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={englishQuestion}
            onChange={(e) => setEnglishQuestion(e.target.value)}
            placeholder="e.g., Which 5 telemetry domains had the highest average value or lowest quality score?"
            className="flex-1 bg-[#11151d] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-sm text-[#ece7df] placeholder:text-[#7c7972] focus:outline-none focus:border-[#c9b18a]/60"
          />
          <button
            type="submit"
            disabled={isAskingNl || !englishQuestion.trim()}
            className="px-5 py-2.5 rounded-xl bg-[#c9b18a] hover:bg-[#d5bf9b] text-[#11151d] font-semibold text-sm transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {isAskingNl ? 'Compiling SQL...' : 'Ask & Run'}
          </button>
        </form>

        <div className="flex flex-wrap gap-2 text-xs font-mono">
          {[
            'Top 6 domains by event count and average value',
            'Which domains have the lowest average quality score?',
            'Show the 15 most recent weather and solar readings'
          ].map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => setEnglishQuestion(sample)}
              className="px-2.5 py-1 rounded-lg bg-[#11151d] hover:bg-[#1e2432] border border-white/[0.08] text-[#b5b0a6] hover:text-[#ece7df] transition-colors"
            >
              {sample}
            </button>
          ))}
        </div>

        {queryExplanation && (
          <div className="text-xs font-mono text-[#a3c2bc]">
            Query intent: {queryExplanation}
          </div>
        )}
      </section>

      {/* 02. SQL Editor */}
      <section className="bg-[#161b25] border border-white/[0.08] rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="duckdb-sql-editor" className="text-base font-semibold text-[#ece7df] flex items-center gap-2">
            <Code className="w-4 h-4 text-[#c9b18a]" />
            <span>02. Read-Only SQL Statement</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setSqlQuery('SELECT domain, COUNT(*) as count, AVG(value) as avg_value FROM telemetry_events GROUP BY domain;')
              }
              className="text-xs font-mono text-[#c7c2b8] hover:text-[#ece7df] bg-[#11151d] px-3 py-1.5 rounded-lg border border-white/[0.08]"
            >
              Group Summary
            </button>
            <button
              type="button"
              onClick={() =>
                setSqlQuery(
                  'SELECT event_id, domain, measurement_id, value, unit, event_time FROM telemetry_events LIMIT 25;'
                )
              }
              className="text-xs font-mono text-[#c7c2b8] hover:text-[#ece7df] bg-[#11151d] px-3 py-1.5 rounded-lg border border-white/[0.08]"
            >
              Recent Events
            </button>
          </div>
        </div>

        <textarea
          id="duckdb-sql-editor"
          value={sqlQuery}
          onChange={(e) => setSqlQuery(e.target.value)}
          rows={4}
          className="w-full bg-[#11151d] border border-white/[0.1] rounded-xl p-4 text-sm font-mono text-[#a3c2bc] placeholder:text-[#7c7972] focus:outline-none focus:border-[#c9b18a]/60"
        />

        {queryError && (
          <div className="rounded-xl bg-[#27181b] border border-[#c27d77]/40 px-4 py-3 text-xs text-[#e5a8a3] flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#c27d77]" />
            <span>{queryError}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="text-xs font-mono text-[#9c9991]">
            Engine: <span className="text-[#c9b18a] font-medium">{engineInfo.engineName}</span>
          </div>

          <button
            type="button"
            onClick={() => handleExecute()}
            disabled={isExecuting}
            className="px-5 py-2.5 bg-[#7fa898] hover:bg-[#8eb5a5] text-[#11151d] font-semibold text-sm rounded-xl transition-colors flex items-center gap-2 disabled:opacity-60"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>{isExecuting ? 'Executing SQL...' : 'Run Analytical Query'}</span>
          </button>
        </div>
      </section>

      {/* Query Results & AI Summary */}
      {queryResult && (
        <section className="bg-[#161b25] border border-white/[0.08] rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.08] text-xs font-mono">
            <div className="flex items-center gap-2 text-[#8bb5a6] font-semibold">
              <CheckCircle className="w-4 h-4" />
              <span>Query Executed</span>
            </div>
            <div className="flex items-center gap-5 text-[#c7c2b8] tabular-nums">
              <span>Time: {queryResult.executionTimeMs} ms</span>
              <span>Rows: {queryResult.rowCount}</span>
              <span className="text-[#c9b18a]">{queryResult.engineName}</span>
            </div>
          </div>

          {querySummary && (
            <div className="rounded-xl bg-[#11151d] border border-[#7fa898]/25 px-4 py-3 text-sm text-[#e6e1d8] leading-relaxed">
              <span className="text-xs font-mono text-[#7fa898] block mb-1">Telemetry Insight</span>
              {querySummary}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-white/[0.08] bg-[#11151d] text-[#d8d3c9]">
                  {queryResult.columns.map((col, idx) => (
                    <th key={idx} className="p-3 font-semibold">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-[#c7c2b8]">
                {queryResult.rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-white/[0.02]">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="p-3 tabular-nums">
                        {typeof cell === 'object' ? JSON.stringify(cell) : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 03. Conversational Smart Alert Rules */}
      <section className="bg-[#161b25] border border-white/[0.08] rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[#ece7df] flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#c9b18a]" />
            <span>03. Conversational Smart Alert Rules</span>
          </h2>
          <span className="text-xs font-mono text-[#9c9991]">
            Evaluates live across all 24 domains · subtly tints the Crystal Ball
          </span>
        </div>

        <form onSubmit={handleCreateSmartAlert} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={alertPrompt}
            onChange={(e) => setAlertPrompt(e.target.value)}
            placeholder="e.g., Alert me when wind exceeds 12 m/s and barometric pressure drops below 1005 hPa"
            className="flex-1 bg-[#11151d] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-sm text-[#ece7df] placeholder:text-[#7c7972] focus:outline-none focus:border-[#c9b18a]/60"
          />
          <button
            type="submit"
            disabled={isCompilingAlert || !alertPrompt.trim()}
            className="px-5 py-2.5 rounded-xl bg-[#202736] hover:bg-[#283144] border border-white/[0.1] text-[#e6d5b8] font-medium text-sm transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {isCompilingAlert ? 'Compiling Rule...' : 'Add Smart Alert'}
          </button>
        </form>

        {alertError && (
          <div className="rounded-xl bg-[#27181b] border border-[#c27d77]/40 px-4 py-2.5 text-xs text-[#e5a8a3]">
            {alertError}
          </div>
        )}

        {alertRules.length === 0 ? (
          <p className="text-xs text-[#9c9991]">
            No smart alert rules configured yet. Describe any multi-domain threshold above or in the Observatory prompt bar.
          </p>
        ) : (
          <div className="divide-y divide-white/[0.06] border-t border-white/[0.07]">
            {alertRules.map((rule) => {
              const isTriggered = alertEval.triggeredRules.some((r) => r.id === rule.id);
              const reason = alertEval.reasonsByRuleId[rule.id];
              return (
                <div key={rule.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span
                        className="w-3 h-3 rounded-full shrink-0 border border-white/20"
                        style={{ backgroundColor: rule.orbTintHex }}
                        title={`Orb tint: ${rule.orbTintHex}`}
                      />
                      <span className="text-sm font-medium text-[#ece7df]">{rule.label}</span>
                      <span
                        className={`text-[11px] font-mono ${
                          !rule.enabled
                            ? 'text-[#7c7972]'
                            : isTriggered
                              ? 'text-[#d4a96a]'
                              : 'text-[#7fa898]'
                        }`}
                      >
                        · {!rule.enabled ? 'Paused' : isTriggered ? 'Breached' : 'Monitoring'}
                      </span>
                    </div>
                    <div className="text-xs text-[#9c9991]">{rule.summary}</div>
                    {isTriggered && reason && (
                      <div className="text-[11px] font-mono text-[#d4a96a]">{reason}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleSmartAlertRule(rule.id)}
                      className="px-3 py-1.5 rounded-lg bg-[#11151d] hover:bg-[#1e2432] border border-white/[0.09] text-xs font-medium text-[#d7d2c8]"
                    >
                      {rule.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSmartAlertRule(rule.id)}
                      aria-label={`Delete alert ${rule.label}`}
                      className="p-2 rounded-lg bg-[#11151d] hover:bg-[#27181b] border border-white/[0.08] text-[#9c9991] hover:text-[#e5a8a3] transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
