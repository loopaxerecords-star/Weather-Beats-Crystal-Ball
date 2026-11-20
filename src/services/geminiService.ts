import { TelemetryEvent, DomainCategory } from '../types/telemetry';
import { GeolocationWeatherContext } from './telemetryEngine';
import { NormalizedDomainReading } from './weatherBeatsComposer';
import {
  VoiceQueryResult,
  buildCompactTelemetrySummary,
  normalizeMatchedDomain,
  parseTelemetryQuestionLocally
} from './voiceTelemetryOracle';

export interface AiIntelligenceResponse {
  insight: string;
  source: string;
  timestamp: string;
}

export async function queryAiIntelligence(
  prompt: string,
  telemetrySnapshot?: TelemetryEvent[],
  domainContext?: DomainCategory
): Promise<AiIntelligenceResponse> {
  try {
    const response = await fetch('/api/ai/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        telemetrySnapshot: telemetrySnapshot ? telemetrySnapshot.slice(-15) : [],
        domainContext
      }),
    });

    const data = await response.json();
    if (response.ok) {
      return {
        insight: data.insight,
        source: data.source || 'gemini_4_hydrogen',
        timestamp: data.timestamp || new Date().toISOString()
      };
    }

    return {
      insight: `AI service unavailable: ${data.error || `HTTP ${response.status}`}.`,
      source: 'api_error',
      timestamp: new Date().toISOString()
    };
  } catch (err: any) {
    return {
      insight: `AI service unreachable (${err?.message || 'network error'}).`,
      source: 'network_error',
      timestamp: new Date().toISOString()
    };
  }
}

export async function queryVoiceTelemetryOracle(
  question: string,
  vector24: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext,
  includeSpeech = true
): Promise<VoiceQueryResult> {
  const telemetrySummary = buildCompactTelemetrySummary(vector24, weatherCtx);

  try {
    const response = await fetch('/api/ai/voice-query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        question,
        telemetrySummary,
        includeSpeech
      })
    });

    const data = await response.json();
    if (response.ok) {
      return {
        question: data.question || question,
        matchedDomain: normalizeMatchedDomain(data.matchedDomain),
        intentSummary: data.intentSummary || 'Live Telemetry Query',
        answerText: data.answerText || 'Telemetry reading complete.',
        citedMetrics: Array.isArray(data.citedMetrics) ? data.citedMetrics : [],
        audioBase64Wav: data.audioBase64Wav,
        audioMimeType: data.audioMimeType,
        source: 'gemini_4_hydrogen'
      };
    }

    return parseTelemetryQuestionLocally(
      question,
      vector24,
      weatherCtx,
      data?.error || `AI endpoint returned HTTP ${response.status}`
    );
  } catch (err: any) {
    return parseTelemetryQuestionLocally(
      question,
      vector24,
      weatherCtx,
      err?.message || 'Unable to reach AI voice endpoint'
    );
  }
}
