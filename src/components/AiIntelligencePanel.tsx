import React, { useState } from 'react';
import { queryAiIntelligence, AiIntelligenceResponse } from '../services/geminiService';
import { telemetryEngine } from '../services/telemetryEngine';
import { DomainCategory } from '../types/telemetry';
import { Send, Bot, Brain } from 'lucide-react';

interface AiIntelligencePanelProps {
  currentDomain?: DomainCategory;
}

export const AiIntelligencePanel: React.FC<AiIntelligencePanelProps> = ({ currentDomain }) => {
  const [prompt, setPrompt] = useState<string>(
    'Synthesize cross-domain anomalies between Weather atmospheric pressure and Energy grid consumption over the past 30 minutes.'
  );
  const [response, setResponse] = useState<AiIntelligenceResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleRunAiQuery = async (customPrompt?: string) => {
    const activePrompt = customPrompt || prompt;
    if (!activePrompt.trim()) return;

    setIsLoading(true);
    try {
      const snapshot = telemetryEngine.getBufferedEvents({ limit: 20 });
      const res = await queryAiIntelligence(activePrompt, snapshot, currentDomain);
      setResponse(res);
    } catch (err) {
      console.error('AI Query failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 bg-[#0b0f17] flex flex-col min-w-0 overflow-y-auto p-8 space-y-8 custom-scrollbar">
      {/* Title & Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <Brain className="w-6 h-6 text-fuchsia-400" />
            <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight">Gemini 2.5 Flash AI Intelligence Core</h1>
            <span className="text-xs font-mono font-bold px-3 py-1 rounded-lg bg-fuchsia-950/80 text-fuchsia-300 border border-fuchsia-800/80">
              PROVIDER-INDEPENDENT AI ADAPTER
            </span>
          </div>
          <p className="text-sm text-slate-300 mt-2 max-w-4xl leading-relaxed">
            Provider-agnostic AI telemetry intelligence engine analyzing 24 domains for natural-language queries, cross-domain anomaly detection, and predictive forecasting.
          </p>
        </div>
      </div>

      {/* Query Prompt Box */}
      <div className="bg-[#121929] border border-slate-800 rounded-2xl p-6 space-y-5 shadow-lg">
        <label className="text-sm font-bold text-slate-200 block">
          Formulate Natural-Language Intelligence Query:
        </label>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRunAiQuery()}
            placeholder="Ask AI to analyze telemetry across domains..."
            className="flex-1 bg-[#0b0f17] border border-slate-700/80 rounded-xl px-4 py-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-fuchsia-500 font-medium shadow-inner"
          />
          <button
            onClick={() => handleRunAiQuery()}
            disabled={isLoading}
            className="px-6 py-3.5 bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 text-white font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2.5 shrink-0 shadow-lg shadow-fuchsia-950/40"
          >
            <Send className="w-4 h-4 fill-current" />
            <span>{isLoading ? 'Synthesizing...' : 'Execute AI Query'}</span>
          </button>
        </div>

        {/* Quick Sample Prompts */}
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            onClick={() => {
              const p = 'Analyze environmental AQI vs weather rainfall correlations.';
              setPrompt(p);
              handleRunAiQuery(p);
            }}
            className="text-xs font-mono text-slate-300 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 hover:text-white hover:border-slate-700 transition-colors"
          >
            [AQI vs Rainfall]
          </button>
          <button
            onClick={() => {
              const p = 'Detect computing CPU utilization anomalies during high audio FFT processing.';
              setPrompt(p);
              handleRunAiQuery(p);
            }}
            className="text-xs font-mono text-slate-300 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 hover:text-white hover:border-slate-700 transition-colors"
          >
            [CPU vs Audio FFT]
          </button>
          <button
            onClick={() => {
              const p = 'Provide a 12-hour predictive forecast trend for energy grid frequency stability.';
              setPrompt(p);
              handleRunAiQuery(p);
            }}
            className="text-xs font-mono text-slate-300 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 hover:text-white hover:border-slate-700 transition-colors"
          >
            [12-Hour Energy Forecast]
          </button>
        </div>
      </div>

      {/* AI Response Card Output */}
      {response && (
        <div className="bg-[#121929] border border-slate-800 rounded-2xl p-6 space-y-5 shadow-lg">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800 text-sm font-mono">
            <div className="flex items-center gap-2.5 text-fuchsia-400 font-bold">
              <Bot className="w-5 h-5" />
              <span>Gemini Intelligence Briefing</span>
            </div>
            <div className="flex items-center gap-6 text-slate-300">
              <span>Model: <span className="text-white font-bold">{response.source}</span></span>
              <span>Time: <span className="text-slate-200 font-semibold">{new Date(response.timestamp).toLocaleTimeString()}</span></span>
            </div>
          </div>

          <div className="text-sm text-slate-200 font-mono whitespace-pre-wrap leading-relaxed bg-[#0b0f17] p-5 rounded-xl border border-slate-800/80 shadow-inner">
            {response.insight}
          </div>
        </div>
      )}
    </div>
  );
};
