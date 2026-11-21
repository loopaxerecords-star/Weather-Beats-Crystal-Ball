import http from 'http';
import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));

const apiKey = process.env.GEMINI_API_KEY || '';
let aiClient: GoogleGenAI | null = null;
if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
  aiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

function getActiveAiClient(): GoogleGenAI | null {
  const currentKey = process.env.GEMINI_API_KEY || '';
  if (!currentKey || currentKey === 'MY_GEMINI_API_KEY') return aiClient;
  if (!aiClient || currentKey !== apiKey) {
    return new GoogleGenAI({
      apiKey: currentKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiClient;
}

function extractGeminiError(
  error: any,
  fallbackMessage: string
): { status: number; message: string } {
  let status = typeof error?.status === 'number' ? error.status : 500;
  let message = typeof error?.message === 'string' ? error.message : fallbackMessage;

  if (message.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(message);
      const inner = parsed?.error ?? parsed;
      if (typeof inner?.code === 'number') status = inner.code;
      if (typeof inner?.message === 'string' && inner.message.trim()) {
        message = inner.message.trim();
      }
    } catch {
      // Keep original string
    }
  }

  const lower = message.toLowerCase();
  if (status === 402 || lower.includes('prepayment credits') || lower.includes('credits are depleted')) {
    return {
      status: 402,
      message:
        'Gemini API credits are depleted. Please manage billing or select an active API key in Settings > Secrets.'
    };
  }
  if (status === 429 || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return {
      status: 429,
      message:
        'Gemini API quota reached. Please check your plan or select a billing-enabled API key in Settings > Secrets.'
    };
  }
  if (status === 401 || status === 403 || lower.includes('api_key_invalid') || lower.includes('permission_denied')) {
    return {
      status: status === 401 ? 401 : 403,
      message: 'Gemini API key is missing or unauthorized. Please verify your key in Settings > Secrets.'
    };
  }

  return { status: status >= 400 && status <= 599 ? status : 500, message: message || fallbackMessage };
}

const VALID_DOMAINS = [
  'all',
  'weather',
  'atmospheric',
  'environmental',
  'geographic',
  'geological',
  'oceanographic',
  'solar',
  'space',
  'biological',
  'agricultural',
  'industrial',
  'energy',
  'smart_building',
  'transport',
  'network',
  'computing',
  'financial',
  'economic',
  'business',
  'social_information',
  'audio',
  'musical',
  'artificial_intelligence',
  'security'
] as const;

const VALID_DOMAIN_ONLY = VALID_DOMAINS.filter((d) => d !== 'all');
const VALID_VOICES = [
  'pad',
  'sub',
  'whisper',
  'kick',
  'djembe',
  'perc',
  'kora',
  'kalimba',
  'balafon',
  'fm'
] as const;
const VALID_FX_SLOTS = [
  'reverb',
  'delay',
  'filter',
  'distortion',
  'compressor',
  'modulation'
] as const;
const VALID_TTS_VOICES = ['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Aoede'] as const;

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeHexColor(hex: unknown, fallback = '#d4a96a'): string {
  if (typeof hex !== 'string') return fallback;
  const trimmed = hex.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback;
}

const FORBIDDEN_SQL_PATTERN =
  /\b(drop|delete|insert|update|alter|create|attach|detach|copy|pragma|export|import|call|load|truncate|replace|merge|grant|revoke|vacuum|checkpoint|install)\b/i;

function validateReadOnlySql(rawSql: string): { ok: boolean; sql: string; error?: string } {
  const cleaned = String(rawSql || '')
    .replace(/```sql/gi, '')
    .replace(/```/g, '')
    .trim();
  if (!cleaned) {
    return { ok: false, sql: '', error: 'Empty SQL statement.' };
  }
  const withoutTrailingSemicolon = cleaned.replace(/;+\s*$/, '').trim();
  if (withoutTrailingSemicolon.includes(';')) {
    return { ok: false, sql: '', error: 'Multiple SQL statements are not permitted.' };
  }
  if (!/^(select|with)\b/i.test(withoutTrailingSemicolon)) {
    return { ok: false, sql: '', error: 'Only read-only SELECT queries are permitted.' };
  }
  if (FORBIDDEN_SQL_PATTERN.test(withoutTrailingSemicolon)) {
    return { ok: false, sql: '', error: 'Query contains forbidden write or administrative SQL keywords.' };
  }
  return { ok: true, sql: `${withoutTrailingSemicolon};` };
}

// System health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    product: 'Weather Beats Universal Intelligence',
    version: '2.0.0-ai-suite',
    timestamp: new Date().toISOString(),
    aiAvailable: !!aiClient,
    activeDomainsCount: 24,
    phase1PriorityDomains: ['weather', 'environmental', 'geographic', 'energy', 'computing', 'audio_musical']
  });
});

// Gemini AI Intelligence Query Endpoint
app.post('/api/ai/query', async (req: Request, res: Response) => {
  try {
    const { prompt, telemetrySnapshot } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!aiClient) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in Settings > Secrets.'
      });
    }

    const systemInstruction = `You are the AI Systems Architect and Data Intelligence Core for Weather Beats Universal Intelligence.
Your task is to analyze telemetry across 24 intelligence domains (Weather, Atmospheric, Environmental, Geographic, Geological, Oceanographic, Solar, Space, Biological, Agricultural, Industrial, Energy, Smart Building, Transport, Network, Computing, Financial, Economic, Business, Social, Audio, Musical, AI, Security).
Formulate precise, data-driven, actionable intelligence summaries. Distinguish clearly between observed measurements, historical trends, and model predictions. Never fabricate false sensor values.`;

    const fullPrompt = `${systemInstruction}\n\nUser Intelligence Query: ${prompt}\n\nTelemetry Context Snapshot: ${JSON.stringify(telemetrySnapshot || {})}`;

    const response = await aiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: fullPrompt
    });

    res.json({
      insight: response.text || 'No response text generated.',
      source: 'gemini_4_hydrogen',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('AI Query Error:', error);
    res.status(error?.status || 500).json({
      error: error?.message || 'Failed to process AI intelligence query'
    });
  }
});

function ensureWavBase64(
  rawBase64: string,
  mimeType: string
): { base64: string; mimeType: string } {
  const buf = Buffer.from(rawBase64, 'base64');
  // Already a valid RIFF WAV header?
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    return { base64: rawBase64, mimeType: 'audio/wav' };
  }
  const rateMatch = /rate=(\d+)/i.exec(mimeType || '');
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = buf.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  const wavBuf = Buffer.concat([header, buf]);
  return { base64: wavBuf.toString('base64'), mimeType: 'audio/wav' };
}

// Standalone Weather-Adapted Neural TTS Endpoint (for Seer Ambient Whispers & Replies)
app.post('/api/ai/tts', async (req: Request, res: Response) => {
  try {
    const { text, weatherMood, voiceName } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text is required for neural TTS.' });
    }

    if (!aiClient) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in Settings > Secrets.'
      });
    }

    const safeVoice =
      typeof voiceName === 'string' && (VALID_TTS_VOICES as readonly string[]).includes(voiceName)
        ? voiceName
        : 'Kore';
    const style =
      typeof weatherMood === 'string' && weatherMood.trim().length > 0
        ? weatherMood.trim().slice(0, 160)
        : 'Hushed, calm atmospheric observatory narrator with subtle warmth';

    const ttsResponse = await aiClient.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Read the following softly in this vocal style (${style}), speaking only the quote verbatim:\n"${text.trim().slice(0, 480)}"`
            }
          ]
        }
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: safeVoice }
          }
        }
      }
    });

    const inlineData = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inlineData?.data) {
      return res.status(502).json({ error: 'Neural TTS returned empty audio payload.' });
    }

    const wrapped = ensureWavBase64(inlineData.data, inlineData.mimeType || 'audio/L16;rate=24000');
    res.json({
      audioBase64Wav: wrapped.base64,
      audioMimeType: wrapped.mimeType,
      voiceName: safeVoice,
      style
    });
  } catch (error: any) {
    console.error('Neural TTS Error:', error);
    res.status(error?.status || 500).json({
      error: error?.message || 'Failed to synthesize neural TTS audio'
    });
  }
});

// Voice Telemetry Oracle Intent Parsing + Weather-Adapted Spoken Audio Reply
app.post('/api/ai/voice-query', async (req: Request, res: Response) => {
  try {
    const { question, telemetrySummary, includeSpeech = true, weatherMood } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'A spoken or typed question is required.' });
    }

    if (!aiClient) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in Settings > Secrets.'
      });
    }

    const intentResponse = await aiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `User question: "${question.trim()}"\n\nLive 24-Domain Telemetry Snapshot:\n${telemetrySummary || 'No snapshot provided.'}`,
      config: {
        systemInstruction: `You are the Weather Beats Crystal Ball Telemetry Oracle.
Parse the user's verbal question about the live 24-domain telemetry snapshot.
1. Choose matchedDomain from this exact enum: ${VALID_DOMAINS.join(', ')}. Use a specific domain id whenever the question focuses on one domain, or 'all' when it asks for an overview across multiple domains.
2. Write a concise, natural, spoken-friendly answerText (2-3 crisp sentences max) grounded strictly in the exact numeric values and units in the telemetry snapshot. Never invent sensor numbers.
3. Provide intentSummary (short 3-6 word label) and citedMetrics (up to 3 short metric strings).`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matchedDomain: {
              type: Type.STRING,
              description: 'Exact domain id from the 24-domain registry or "all".'
            },
            intentSummary: {
              type: Type.STRING,
              description: 'Short 3-6 word summary of the user intent.'
            },
            answerText: {
              type: Type.STRING,
              description: 'Concise 2-3 sentence spoken answer grounded strictly in live telemetry.'
            },
            citedMetrics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Up to 3 short cited metric readings.'
            }
          },
          required: ['matchedDomain', 'intentSummary', 'answerText', 'citedMetrics']
        }
      }
    });

    const parsed = JSON.parse((intentResponse.text ?? '{}').trim() || '{}');
    const rawDomain = String(parsed.matchedDomain || 'all').trim().toLowerCase();
    const matchedDomain = (VALID_DOMAINS as readonly string[]).includes(rawDomain) ? rawDomain : 'all';
    const answerText = String(parsed.answerText || 'Telemetry reading complete.');
    const intentSummary = String(parsed.intentSummary || 'Live Telemetry Query');
    const citedMetrics = Array.isArray(parsed.citedMetrics)
      ? parsed.citedMetrics.map((m: unknown) => String(m)).slice(0, 3)
      : [];

    let audioBase64Wav: string | undefined;
    let audioMimeType: string | undefined;

    if (includeSpeech && answerText) {
      try {
        const ttsStyle =
          typeof weatherMood === 'string' && weatherMood.trim().length > 0
            ? weatherMood.trim().slice(0, 160)
            : 'Calm, clear atmospheric observatory narrator';
        const ttsResponse = await aiClient.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Read the following in this vocal style (${ttsStyle}), speaking only the answer verbatim:\n"${answerText}"`
                }
              ]
            }
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' }
              }
            }
          }
        });
        const inlineData = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (inlineData?.data) {
          const wrapped = ensureWavBase64(inlineData.data, inlineData.mimeType || 'audio/L16;rate=24000');
          audioBase64Wav = wrapped.base64;
          audioMimeType = wrapped.mimeType;
        }
      } catch (ttsErr) {
        console.warn('TTS voice synthesis skipped:', ttsErr);
      }
    }

    res.json({
      question: question.trim(),
      matchedDomain,
      intentSummary,
      answerText,
      citedMetrics,
      audioBase64Wav,
      audioMimeType,
      source: 'gemini_4_hydrogen',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Voice Oracle Error:', error);
    res.status(error?.status || 500).json({
      error: error?.message || 'Failed to parse voice telemetry query'
    });
  }
});

// 1. Natural-Language Musical Director (Live Mix, Synth & FX Control)
app.post('/api/ai/direct-music', async (req: Request, res: Response) => {
  try {
    const { instruction, currentState } = req.body;

    if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
      return res.status(400).json({ error: 'A musical direction prompt is required.' });
    }

    if (!aiClient) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in Settings > Secrets.'
      });
    }

    const response = await aiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Creative Direction: "${instruction.trim()}"\n\nCurrent DSP Studio State:\n${JSON.stringify(currentState || {})}`,
      config: {
        systemInstruction: `You are an expert Mastering Engineer & Live Sound Director for Weather Beats Endless Flow DSP Studio.
Weather Beats has NO fixed preset genres — it invents its own emergent soundscape continuously from 24 live telemetry streams.
Translate the user's natural-language creative direction into precise, tasteful, non-destructive DSP parameter updates.
Only include voices, continuous character deltas, FM parameters, or FX slots that should meaningfully change to honor the direction.
Continuous characterBias deltas (each -0.35..+0.35):
- kineticDelta: rhythmic drive & kick/groove forward momentum
- spaceDelta: atmospheric expansiveness, pad sustain & airiness
- polyrhythmDelta: West African interlocking syncopation (kora, djembe, kalimba, balafon)
- warmthDelta: tonal softness, low-mid warmth & gentle harmonic rounding
Valid voice ids: ${VALID_VOICES.join(', ')} (gain 0..1.2, pan -1..1, muted boolean). Note: 'perc' controls hi-hats/shaker/rims; 'kora' is 21-string harp; 'djembe' is talking drum; 'kalimba' is thumb piano; 'balafon' is marimba; 'fm' is Rhodes/lead; 'pad' is warm stereo pad; 'sub' is sub-bass; 'kick' is studio kick; 'whisper' is seer ambient whispers.
Valid FX slot ids: ${VALID_FX_SLOTS.join(', ')} (reverb primary=decaySec 0.5..4.2, delay primary=timeMs 80..650, filter primary=cutoffHz 420..12000 & secondary=resonanceQ 0.5..6, distortion primary=driveDb 0..16, compressor primary=thresholdDb -32..-6 & secondary=ratio 1.5..8, modulation primary=rateHz 0.1..4.5, all have mix 0..1 and bypass boolean).
For "darker" or "nocturnal" directions, lower filter cutoffHz (e.g., 1400-2600 Hz), soften perc/hats gain, raise warmthDelta, and add depth to sub/pad.
Keep bpmOffset between -18 and +18 BPM. Write a crisp 1-sentence summary of what you adjusted.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            bpmOffset: { type: Type.NUMBER },
            whispersEnabled: { type: Type.BOOLEAN },
            characterBias: {
              type: Type.OBJECT,
              properties: {
                kineticDelta: { type: Type.NUMBER },
                spaceDelta: { type: Type.NUMBER },
                polyrhythmDelta: { type: Type.NUMBER },
                warmthDelta: { type: Type.NUMBER }
              }
            },
            voiceChanges: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  voice: { type: Type.STRING },
                  gain: { type: Type.NUMBER },
                  pan: { type: Type.NUMBER },
                  muted: { type: Type.BOOLEAN }
                },
                required: ['voice']
              }
            },
            fmPatch: {
              type: Type.OBJECT,
              properties: {
                fmModIndex: { type: Type.NUMBER },
                modRatio: { type: Type.NUMBER },
                feedback: { type: Type.NUMBER },
                decaySec: { type: Type.NUMBER },
                density: { type: Type.NUMBER }
              }
            },
            fxChanges: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  slotId: { type: Type.STRING },
                  mix: { type: Type.NUMBER },
                  primaryValue: { type: Type.NUMBER },
                  secondaryValue: { type: Type.NUMBER },
                  bypass: { type: Type.BOOLEAN }
                },
                required: ['slotId']
              }
            }
          },
          required: ['summary']
        }
      }
    });

    const raw = JSON.parse((response.text ?? '{}').trim() || '{}');

    const bpmOffset =
      raw.bpmOffset !== undefined && Number.isFinite(Number(raw.bpmOffset))
        ? Math.round(clampNumber(raw.bpmOffset, -18, 18, 0))
        : undefined;

    const whispersEnabled =
      typeof raw.whispersEnabled === 'boolean' ? raw.whispersEnabled : undefined;

    const characterBias: Record<string, number> = {};
    if (raw.characterBias && typeof raw.characterBias === 'object') {
      for (const k of ['kineticDelta', 'spaceDelta', 'polyrhythmDelta', 'warmthDelta'] as const) {
        if (raw.characterBias[k] !== undefined && Number.isFinite(Number(raw.characterBias[k]))) {
          characterBias[k] = Number(clampNumber(raw.characterBias[k], -0.35, 0.35, 0).toFixed(2));
        }
      }
    }

    const voiceMixPatch: Record<string, { gain?: number; pan?: number; muted?: boolean }> = {};
    if (Array.isArray(raw.voiceChanges)) {
      for (const item of raw.voiceChanges) {
        const vId = String(item?.voice || '').trim();
        if (!(VALID_VOICES as readonly string[]).includes(vId)) continue;
        const entry: { gain?: number; pan?: number; muted?: boolean } = {};
        if (item.gain !== undefined && Number.isFinite(Number(item.gain))) {
          entry.gain = Number(clampNumber(item.gain, 0, 1.2, 0.65).toFixed(2));
        }
        if (item.pan !== undefined && Number.isFinite(Number(item.pan))) {
          entry.pan = Number(clampNumber(item.pan, -1, 1, 0).toFixed(2));
        }
        if (typeof item.muted === 'boolean') {
          entry.muted = item.muted;
        }
        if (Object.keys(entry).length > 0) {
          voiceMixPatch[vId] = entry;
        }
      }
    }

    const fmPatch: Record<string, number> = {};
    if (raw.fmPatch && typeof raw.fmPatch === 'object') {
      if (raw.fmPatch.fmModIndex !== undefined) {
        fmPatch.fmModIndex = Number(clampNumber(raw.fmPatch.fmModIndex, 0.05, 2.0, 0.6).toFixed(2));
      }
      if (raw.fmPatch.modRatio !== undefined) {
        fmPatch.modRatio = Number(clampNumber(raw.fmPatch.modRatio, 0.5, 4.0, 2.0).toFixed(2));
      }
      if (raw.fmPatch.feedback !== undefined) {
        fmPatch.feedback = Number(clampNumber(raw.fmPatch.feedback, 0, 0.95, 0.25).toFixed(2));
      }
      if (raw.fmPatch.decaySec !== undefined) {
        fmPatch.decaySec = Number(clampNumber(raw.fmPatch.decaySec, 0.08, 0.85, 0.35).toFixed(2));
      }
      if (raw.fmPatch.density !== undefined) {
        fmPatch.density = Number(clampNumber(raw.fmPatch.density, 0.1, 1.0, 0.55).toFixed(2));
      }
    }

    const fxRanges: Record<string, { pMin: number; pMax: number; sMin: number; sMax: number }> = {
      reverb: { pMin: 0.4, pMax: 4.5, sMin: 0.1, sMax: 0.9 },
      delay: { pMin: 80, pMax: 750, sMin: 0.05, sMax: 0.72 },
      filter: { pMin: 350, pMax: 16000, sMin: 0.4, sMax: 8.0 },
      distortion: { pMin: 0, pMax: 18, sMin: 0, sMax: 1 },
      compressor: { pMin: -36, pMax: -4, sMin: 1.2, sMax: 10 },
      modulation: { pMin: 0.1, pMax: 5.0, sMin: 0.001, sMax: 0.014 }
    };

    const fxPatch: Array<{
      slotId: string;
      mix?: number;
      primaryValue?: number;
      secondaryValue?: number;
      bypass?: boolean;
    }> = [];
    if (Array.isArray(raw.fxChanges)) {
      for (const item of raw.fxChanges) {
        const sId = String(item?.slotId || '').trim();
        if (!(VALID_FX_SLOTS as readonly string[]).includes(sId)) continue;
        const r = fxRanges[sId];
        const entry: {
          slotId: string;
          mix?: number;
          primaryValue?: number;
          secondaryValue?: number;
          bypass?: boolean;
        } = { slotId: sId };
        if (item.mix !== undefined && Number.isFinite(Number(item.mix))) {
          entry.mix = Number(clampNumber(item.mix, 0, 1, 0.35).toFixed(2));
        }
        if (item.primaryValue !== undefined && Number.isFinite(Number(item.primaryValue))) {
          entry.primaryValue = Number(clampNumber(item.primaryValue, r.pMin, r.pMax, r.pMin).toFixed(2));
        }
        if (item.secondaryValue !== undefined && Number.isFinite(Number(item.secondaryValue))) {
          entry.secondaryValue = Number(clampNumber(item.secondaryValue, r.sMin, r.sMax, r.sMin).toFixed(3));
        }
        if (typeof item.bypass === 'boolean') {
          entry.bypass = item.bypass;
        }
        fxPatch.push(entry);
      }
    }

    res.json({
      patch: {
        summary: String(raw.summary || 'Applied live sonic direction to Endless Flow.'),
        bpmOffset,
        whispersEnabled,
        characterBias: Object.keys(characterBias).length > 0 ? characterBias : undefined,
        voiceMixPatch: Object.keys(voiceMixPatch).length > 0 ? voiceMixPatch : undefined,
        fmPatch: Object.keys(fmPatch).length > 0 ? fmPatch : undefined,
        fxPatch: fxPatch.length > 0 ? fxPatch : undefined
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Musical Director Error:', error);
    res.status(error?.status || 500).json({
      error: error?.message || 'Failed to translate musical direction'
    });
  }
});

// 2. AI Motif & Chord Progression Evolver (for Endless Flow)
app.post('/api/ai/evolve-motif', async (req: Request, res: Response) => {
  try {
    const {
      telemetryClusters,
      weatherCtx,
      telemetrySignatureLabel,
      currentChordSummary,
      previousMotifTitle,
      reason
    } = req.body;

    if (!aiClient) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in Settings > Secrets.'
      });
    }

    const response = await aiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Telemetry Clusters: ${JSON.stringify(telemetryClusters || {})}
Weather: ${JSON.stringify(weatherCtx || {})}
Emergent Telemetry Signature: ${telemetrySignatureLabel || 'Atmospheric Drift'}
Current Chords: ${currentChordSummary || 'Dm9 · Bbmaj7 · Gm9 · A7sus4'}
Previous Motif: ${previousMotifTitle || 'Baseline Telemetry'}
Evolution Trigger: ${reason || 'Manual motif evolution'}`,
      config: {
        systemInstruction: `You are a Musical Arranger & African-Electronic Composer for Weather Beats Endless Flow.
Design a fresh, harmonically rich 4-chord progression and 16-step kora & kalimba melodic contours inspired by the telemetry cluster shifts.
- Provide a poetic 2-4 word motif title (e.g., "Amber Barometer Drift", "Solar Monsoon Arpeggio").
- scaleName: e.g. "D Dorian", "F Minor Pentatonic", "C Lydian", "G Aeolian", "A Phrygian Dominant".
- scaleIntervals: 5 to 7 ascending semitone offsets starting at 0, values 0..11.
- chords: EXACTLY 4 chords, each with rootOffset (semitone offset from tonic, -5..11), quality (e.g. "m9", "maj7", "sus2", "m11", "7sus4", "add9"), and intervals (4 ascending semitone offsets starting at 0, values 0..18).
- koraSteps: array of 16 integers representing chord-tone index (0..3) or -1 for rest. Keep 5-9 active plucks so it breathes musically!
- kalimbaSteps: array of 16 integers representing chord-tone index (0..3) or -1 for rest. Keep 4-8 syncopated plucks!
- fillIntensity: number 0.2..1.0 controlling rhythmic fill density.
- telemetryReason: concise 1-sentence note linking this musical motif to the telemetry shift.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            scaleName: { type: Type.STRING },
            scaleIntervals: { type: Type.ARRAY, items: { type: Type.INTEGER } },
            chords: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  rootOffset: { type: Type.INTEGER },
                  quality: { type: Type.STRING },
                  intervals: { type: Type.ARRAY, items: { type: Type.INTEGER } }
                },
                required: ['rootOffset', 'quality', 'intervals']
              }
            },
            koraSteps: { type: Type.ARRAY, items: { type: Type.INTEGER } },
            kalimbaSteps: { type: Type.ARRAY, items: { type: Type.INTEGER } },
            fillIntensity: { type: Type.NUMBER },
            telemetryReason: { type: Type.STRING }
          },
          required: [
            'title',
            'scaleName',
            'scaleIntervals',
            'chords',
            'koraSteps',
            'kalimbaSteps',
            'fillIntensity',
            'telemetryReason'
          ]
        }
      }
    });

    const raw = JSON.parse((response.text ?? '{}').trim() || '{}');

    const scaleIntervals = Array.isArray(raw.scaleIntervals)
      ? Array.from(
          new Set(
            [0, ...raw.scaleIntervals.map((n: unknown) => Math.round(clampNumber(n, 0, 11, 0)))].sort(
              (a, b) => a - b
            )
          )
        ).slice(0, 7)
      : [0, 2, 3, 5, 7, 9, 10];

    const fallbackChords = [
      { rootOffset: 0, quality: 'm9', intervals: [0, 3, 7, 14] },
      { rootOffset: 5, quality: 'm7', intervals: [0, 3, 7, 10] },
      { rootOffset: 8, quality: 'maj7', intervals: [0, 4, 7, 11] },
      { rootOffset: 7, quality: '7sus4', intervals: [0, 5, 7, 10] }
    ];

    const rawChords = Array.isArray(raw.chords) && raw.chords.length >= 2 ? raw.chords.slice(0, 4) : fallbackChords;
    const chords = rawChords.map((c: any, idx: number) => {
      const fb = fallbackChords[idx % fallbackChords.length];
      const intervals =
        Array.isArray(c?.intervals) && c.intervals.length >= 3
          ? c.intervals
              .slice(0, 4)
              .map((n: unknown) => Math.round(clampNumber(n, 0, 18, 0)))
          : fb.intervals;
      if (intervals[0] !== 0) intervals[0] = 0;
      return {
        rootOffset: Math.round(clampNumber(c?.rootOffset, -5, 11, fb.rootOffset)),
        quality: String(c?.quality || fb.quality).slice(0, 10),
        intervals
      };
    });
    while (chords.length < 4) {
      chords.push(fallbackChords[chords.length % fallbackChords.length]);
    }

    const normalizeStepArray = (arr: unknown, fallback: number[]): number[] => {
      if (!Array.isArray(arr) || arr.length === 0) return fallback;
      const out: number[] = [];
      for (let i = 0; i < 16; i++) {
        const val = arr[i];
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0) out.push(-1);
        else out.push(Math.round(clampNumber(n, 0, 3, 0)));
      }
      return out;
    };

    const koraSteps = normalizeStepArray(raw.koraSteps, [0, -1, 1, -1, 2, -1, 3, -1, 0, -1, 2, 1, -1, 3, 2, -1]);
    const kalimbaSteps = normalizeStepArray(raw.kalimbaSteps, [0, -1, -1, 2, -1, -1, 1, -1, -1, 3, -1, 2, -1, -1, 1, -1]);

    res.json({
      motif: {
        id: `motif-${Date.now()}`,
        title: String(raw.title || 'Barometric Drift').slice(0, 48),
        scaleName: String(raw.scaleName || 'Dorian').slice(0, 32),
        scaleIntervals,
        chords,
        koraSteps,
        kalimbaSteps,
        fillIntensity: Number(clampNumber(raw.fillIntensity, 0.2, 1.0, 0.6).toFixed(2)),
        telemetryReason: String(raw.telemetryReason || 'Adapted harmony to live telemetry clusters.').slice(0, 180),
        createdAt: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('Motif Evolver Error:', error);
    const parsedErr = extractGeminiError(error, 'Failed to evolve AI motif');
    res.status(parsedErr.status).json({ error: parsedErr.message });
  }
});

// 3a. Plain-English DuckDB SQL Generator (Strictly Read-Only SELECT)
app.post('/api/ai/duckdb-query', async (req: Request, res: Response) => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'A plain-English telemetry question is required.' });
    }

    if (!aiClient) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in Settings > Secrets.'
      });
    }

    const response = await aiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `User telemetry analytics question: "${question.trim()}"`,
      config: {
        systemInstruction: `You are a DuckDB SQL analyst for Weather Beats Universal Intelligence.
Convert the user's plain-English question into ONE single read-only DuckDB SELECT query against the table \`telemetry_events\`.
Exact schema of \`telemetry_events\`:
- event_id VARCHAR
- domain VARCHAR (valid values: ${VALID_DOMAIN_ONLY.join(', ')})
- measurement_id VARCHAR
- data_class VARCHAR
- origin_type VARCHAR
- event_time VARCHAR (ISO-8601 timestamp string)
- quality_score DOUBLE (0.0 to 1.0)
- value_json VARCHAR (JSON-serialized value or number)

Rules:
1. Output strictly ONE read-only SELECT (or WITH ... SELECT) statement. NEVER use INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, COPY, PRAGMA, ATTACH, or multiple statements.
2. Prefer simple, reliable DuckDB SQL (e.g. GROUP BY domain, COUNT(*), AVG(quality_score), MAX(event_time), WHERE domain = '...', ORDER BY ... DESC, LIMIT 50).
3. Include a brief 1-sentence explanation of what the query computes.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sql: { type: Type.STRING },
            explanation: { type: Type.STRING }
          },
          required: ['sql', 'explanation']
        }
      }
    });

    const parsed = JSON.parse((response.text ?? '{}').trim() || '{}');
    const validation = validateReadOnlySql(parsed.sql || '');
    if (!validation.ok) {
      return res.status(422).json({
        error: `Generated SQL rejected by read-only security policy: ${validation.error}`
      });
    }

    res.json({
      sql: validation.sql,
      explanation: String(parsed.explanation || 'Read-only DuckDB query generated.'),
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('DuckDB NL-to-SQL Error:', error);
    res.status(error?.status || 500).json({
      error: error?.message || 'Failed to translate question into DuckDB SQL'
    });
  }
});

// 3b. Plain-English DuckDB Results Summarizer
app.post('/api/ai/duckdb-summarize', async (req: Request, res: Response) => {
  try {
    const { question, sql, columns, rows } = req.body;

    if (!aiClient) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in Settings > Secrets.'
      });
    }

    const previewRows = Array.isArray(rows) ? rows.slice(0, 25) : [];
    const response = await aiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Question: ${question || 'Telemetry summary'}
SQL Executed: ${sql || ''}
Columns: ${JSON.stringify(columns || [])}
Result Rows (first ${previewRows.length}): ${JSON.stringify(previewRows)}`,
      config: {
        systemInstruction:
          'Summarize the exact DuckDB query results in 2-3 clear, grounded plain-English sentences. Cite only values actually present in the rows. Never fabricate numbers.'
      }
    });

    res.json({
      summary: (response.text || 'Query completed.').trim(),
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('DuckDB Summarize Error:', error);
    res.status(error?.status || 500).json({
      error: error?.message || 'Failed to summarize DuckDB query results'
    });
  }
});

// 4. Conversational Smart Alert Rules Compiler
app.post('/api/ai/smart-alert', async (req: Request, res: Response) => {
  try {
    const { description } = req.body;

    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'A plain-English alert rule description is required.' });
    }

    if (!aiClient) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in Settings > Secrets.'
      });
    }

    const response = await aiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Alert Rule Request: "${description.trim()}"`,
      config: {
        systemInstruction: `You compile conversational telemetry alert rules for Weather Beats Universal Intelligence into structured JSON.
Valid domains: ${VALID_DOMAIN_ONLY.join(', ')}.
Valid metric keys:
- For weather: "wind_speed_ms", "pressure_hpa", "temperature_c", "humidity_pct", "aqi", or "raw"
- For any other domain: "raw" (the domain's primary numeric reading) or "normalized" (0..100 percentage modulation).
Valid operators: "gt" (greater than), "lt" (less than), "rising" (increasing over recent samples), "dropping" (decreasing over recent samples).
For rising/dropping operators, threshold can be 0 (any downward/upward delta).
Choose orbTintHex as a tasteful low-glare hex color matching the requested color (e.g. amber -> "#d4a96a", crimson/red -> "#c77d76", emerald/green -> "#7fa898", indigo/violet -> "#958ec2", cyan/blue -> "#7ca7ba").
Optional sonicIntensityBias: a number between -0.35 (calmer/spacious) and +0.35 (more kinetic/driving) if the user requests a sonic intensity shift, otherwise 0.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            logic: { type: Type.STRING, description: 'ALL or ANY' },
            conditions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  domain: { type: Type.STRING },
                  metric: { type: Type.STRING },
                  operator: { type: Type.STRING, description: 'gt, lt, rising, or dropping' },
                  threshold: { type: Type.NUMBER },
                  unit: { type: Type.STRING }
                },
                required: ['domain', 'metric', 'operator']
              }
            },
            orbTintHex: { type: Type.STRING },
            sonicIntensityBias: { type: Type.NUMBER },
            summary: { type: Type.STRING }
          },
          required: ['label', 'logic', 'conditions', 'orbTintHex', 'summary']
        }
      }
    });

    const raw = JSON.parse((response.text ?? '{}').trim() || '{}');
    const validOps = ['gt', 'lt', 'rising', 'dropping'];
    const validMetrics = ['wind_speed_ms', 'pressure_hpa', 'temperature_c', 'humidity_pct', 'aqi', 'raw', 'normalized'];

    const conditions = Array.isArray(raw.conditions)
      ? raw.conditions
          .slice(0, 4)
          .map((c: any) => {
            const dom = String(c?.domain || 'weather').toLowerCase();
            const domain = (VALID_DOMAIN_ONLY as readonly string[]).includes(dom) ? dom : 'weather';
            const met = String(c?.metric || 'raw').toLowerCase();
            const metric = validMetrics.includes(met) ? met : 'raw';
            const op = String(c?.operator || 'gt').toLowerCase();
            const operator = validOps.includes(op) ? op : 'gt';
            return {
              domain,
              metric,
              operator,
              threshold: Number.isFinite(Number(c?.threshold)) ? Number(c.threshold) : 0,
              unit: typeof c?.unit === 'string' ? c.unit.slice(0, 16) : ''
            };
          })
      : [];

    if (conditions.length === 0) {
      return res.status(422).json({ error: 'Could not extract any valid telemetry conditions from that alert description.' });
    }

    const sonicIntensityBias =
      raw.sonicIntensityBias !== undefined && Number.isFinite(Number(raw.sonicIntensityBias))
        ? Number(clampNumber(raw.sonicIntensityBias, -0.35, 0.35, 0).toFixed(2))
        : 0;

    res.json({
      rule: {
        id: `smart-alert-${Date.now()}`,
        label: String(raw.label || 'Custom Telemetry Alert').slice(0, 64),
        sourcePrompt: description.trim(),
        logic: String(raw.logic || 'ALL').toUpperCase() === 'ANY' ? 'ANY' : 'ALL',
        conditions,
        orbTintHex: sanitizeHexColor(raw.orbTintHex, '#d4a96a'),
        sonicIntensityBias: sonicIntensityBias !== 0 ? sonicIntensityBias : undefined,
        summary: String(raw.summary || 'Compound telemetry alert compiled.').slice(0, 200),
        enabled: true,
        createdAt: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('Smart Alert Compiler Error:', error);
    res.status(error?.status || 500).json({
      error: error?.message || 'Failed to compile conversational alert rule'
    });
  }
});

// 5. Session-Specific Cover Art & Liner Notes for Master Exports
app.post('/api/ai/release-kit', async (req: Request, res: Response) => {
  try {
    const {
      weatherCtx,
      bpm,
      telemetrySignatureLabel,
      scaleName,
      chordSummary,
      motifTitle,
      standoutReadings
    } = req.body;

    if (!aiClient) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in Settings > Secrets.'
      });
    }

    // Step 1: Curated ID3 metadata, editorial liner notes, and visual art prompt
    const metaResponse = await aiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Location & Weather: ${JSON.stringify(weatherCtx || {})}
Emergent Telemetry Sonic Signature: ${telemetrySignatureLabel || 'Atmospheric Drift'}, ${bpm || 108} BPM, Scale: ${scaleName || 'Dorian'}, Chords: ${chordSummary || 'Dm9'}, Active Motif: ${motifTitle || 'Live Telemetry'}
Standout Telemetry Readings: ${JSON.stringify(standoutReadings || [])}`,
      config: {
        systemInstruction: `You are an Art Director and Album Liner-Notes Editor for Weather Beats Universal Intelligence.
Weather Beats creates its own emergent genre-free music directly from 24 live telemetry streams.
Create bespoke release metadata and an album artwork visual prompt reflecting the exact city/location, live weather mood, emergent sonic signature, and standout telemetry readings.
- title: evocative 2-5 word track title (no quotes)
- album: cohesive session album title (e.g. "London Atmospheric Sessions")
- genre: concise emergent telemetry signature label (e.g. "Atmospheric Drift · Telemetry Flow")
- comment: concise 1-line technical ID3 comment citing location, temp, BPM, and standout metric
- linerNotes: 3-4 refined sentences of editorial sleeve notes weaving together the weather atmosphere, telemetry readings, and acoustic instrumentation
- artPrompt: rich visual art direction for a square 1:1 fine-art album cover (minimalist atmospheric observatory aesthetic, matte deep slate/obsidian tones with warm brass and weather-matched light, NO text or typography inside the image).`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            album: { type: Type.STRING },
            genre: { type: Type.STRING },
            comment: { type: Type.STRING },
            linerNotes: { type: Type.STRING },
            artPrompt: { type: Type.STRING }
          },
          required: ['title', 'album', 'genre', 'comment', 'linerNotes', 'artPrompt']
        }
      }
    });

    const curated = JSON.parse((metaResponse.text ?? '{}').trim() || '{}');
    const artPrompt = String(
      curated.artPrompt ||
        `Atmospheric fine-art square album cover inspired by ${weatherCtx?.region || 'coastal observatory'} weather at ${weatherCtx?.temperatureC ?? 18}C, subtle obsidian glass sphere, warm muted brass astrolabe arcs, soft mist, gallery lighting, no text, no letters, no watermark`
    );

    // Step 2: Generate bespoke 1:1 album cover art via gemini-3.1-flash-lite-image
    let coverArtDataUrl: string | null = null;
    let imageError: string | null = null;
    try {
      const imgResponse = await aiClient.models.generateContent({
        model: 'gemini-3.1-flash-lite-image',
        contents: `${artPrompt}. Strictly no text, no words, no watermarks, clean fine-art vinyl sleeve composition.`,
        config: {
          imageConfig: {
            aspectRatio: '1:1'
          }
        }
      });

      const parts = imgResponse.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType || 'image/png';
          coverArtDataUrl = `data:${mime};base64,${part.inlineData.data}`;
          break;
        }
      }
    } catch (imgErr: any) {
      console.warn('AI Cover Art generation error:', imgErr);
      imageError = imgErr?.message || 'Image generation unavailable.';
    }

    res.json({
      title: String(curated.title || 'Observatory Session').slice(0, 64),
      album: String(curated.album || 'Weather Beats Sessions').slice(0, 64),
      genre: String(curated.genre || telemetrySignatureLabel || 'Telemetry Flow').slice(0, 48),
      comment: String(curated.comment || 'Synthesized from 24 live telemetry streams').slice(0, 140),
      linerNotes: String(curated.linerNotes || '').slice(0, 900),
      artPrompt,
      coverArtDataUrl,
      imageError,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Release Kit Error:', error);
    const parsedErr = extractGeminiError(error, 'Failed to generate AI release artwork and liner notes');
    res.status(parsedErr.status).json({ error: parsedErr.message });
  }
});

// 6. Google Lyria 3 Flow Music Endpoint (lyria-3-clip-preview live 30s flow + lyria-3-pro-preview full studio renders)
app.post('/api/ai/lyria-flow', async (req: Request, res: Response) => {
  try {
    const client = getActiveAiClient();
    if (!client) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in Settings > Secrets.'
      });
    }

    const rawMode = String(req.body?.mode || 'clip').trim().toLowerCase();
    const mode: 'clip' | 'pro' = rawMode === 'pro' ? 'pro' : 'clip';
    const model = mode === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview';

    const bpm = Math.round(clampNumber(req.body?.bpm, 64, 150, 98));
    const scaleName = String(req.body?.scaleName || 'Dorian').trim().slice(0, 48);
    const chordSummary = String(req.body?.chordSummary || 'Cm9 · F9 · Bbmaj9 · Gm7').trim().slice(0, 140);
    const telemetrySignatureLabel = String(
      req.body?.telemetrySignatureLabel || 'Atmospheric Drift'
    )
      .trim()
      .slice(0, 80);
    const activeHourLabel = String(req.body?.activeHourLabel || '12:00').trim().slice(0, 16);
    const activeDomainName = String(req.body?.activeDomainName || 'Weather').trim().slice(0, 48);
    const activeInstrument = String(req.body?.activeInstrument || 'Warm Analog Stereo Pad')
      .trim()
      .slice(0, 80);
    const circadianPhase = String(req.body?.circadianPhase || 'Midday').trim().slice(0, 32);
    const weatherSummary = String(req.body?.weatherSummary || 'Mild atmospheric breeze').trim().slice(0, 220);
    const directorNote = String(req.body?.directorNote || '').trim().slice(0, 180);
    const evolutionIndex = Math.max(0, Math.round(clampNumber(req.body?.evolutionIndex, 0, 9999, 0)));

    const durationDirective =
      mode === 'pro'
        ? 'Compose a full-length, deeply evolving, studio-mastered instrumental soundscape with organic ebb-and-flow phrasing.'
        : 'Compose a seamless 30-second instrumental flow chapter with a soft, breathable entrance and smooth tail designed to crossfade invisibly into an ongoing endless composition.';

    const variationCue =
      evolutionIndex > 0
        ? `Evolution chapter #${evolutionIndex + 1}: gently shift rhythmic texture, harmonic voicings, and subtle stereo counter-melodies while staying anchored in the exact same key and tempo.`
        : 'Opening chapter: establish a grounded, hypnotic, warm acoustic-electronic groove right from the first bar.';

    const promptText = [
      durationDirective,
      `STRICTLY PURELY INSTRUMENTAL MUSIC ONLY: absolutely no vocals, no singing, no choir, no humming, no spoken words, and no lyrics. Keep clean open midrange headroom (250 Hz to 2.5 kHz) so a soft narrator voice can float effortlessly above the mix.`,
      `Tempo: ${bpm} BPM steady pocket. Harmonic palette: ${scaleName} scale, chord progression ${chordSummary}.`,
      `Telemetry sonic signature: ${telemetrySignatureLabel}.`,
      `Active circadian telemetry hour: ${activeHourLabel} (${circadianPhase}) spotlighting ${activeDomainName} via ${activeInstrument}, woven gently with organic West African plucked kora, warm kalimba, subtle wooden percussion, deep round sub-bass, and lush warm analog pads.`,
      `Live environmental atmosphere: ${weatherSummary}.`,
      directorNote ? `Musical director nuance: ${directorNote}.` : '',
      variationCue,
      'Production aesthetic: refined nocturnal studio warmth, acoustic intimacy, velvety dynamics, zero harsh EDM drops or abrupt transitions.'
    ]
      .filter(Boolean)
      .join('\n');

    const promptSummary = `${activeHourLabel} ${activeDomainName} (${activeInstrument}) · ${telemetrySignatureLabel} · ${bpm} BPM · ${scaleName}`;

    // Optional cover art image conditioning for Lyria Pro (bounded safely to <= 6MB base64)
    const parts: Array<Record<string, unknown>> = [{ text: promptText }];
    const rawCover = typeof req.body?.coverArtDataUrl === 'string' ? req.body.coverArtDataUrl.trim() : '';
    if (mode === 'pro' && rawCover.startsWith('data:image/') && rawCover.length <= 6_000_000) {
      const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(rawCover);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1] === 'image/jpg' ? 'image/jpeg' : match[1],
            data: match[2]
          }
        });
      }
    }

    const responseStream = await client.models.generateContentStream({
      model,
      contents: parts.length > 1 ? { parts } : promptText
    });

    const audioChunks: Buffer[] = [];
    let notesText = '';
    let mimeType = 'audio/mpeg';

    for await (const chunk of responseStream) {
      const chunkParts = chunk.candidates?.[0]?.content?.parts;
      if (!chunkParts) continue;
      for (const part of chunkParts) {
        if (part.inlineData?.data) {
          if (audioChunks.length === 0 && part.inlineData.mimeType) {
            mimeType = part.inlineData.mimeType;
          }
          audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
        }
        if (part.text) {
          notesText += part.text;
        }
      }
    }

    if (audioChunks.length === 0) {
      return res.status(502).json({
        error: 'Google Lyria returned an empty audio stream. Please try again.'
      });
    }

    const audioBase64 = Buffer.concat(audioChunks).toString('base64');
    res.json({
      audioDataUrl: `data:${mimeType};base64,${audioBase64}`,
      mimeType,
      model,
      mode,
      promptSummary,
      notes: notesText.trim().slice(0, 600),
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Lyria Flow Music Error:', error);
    const parsedErr = extractGeminiError(error, 'Failed to generate Google Lyria Flow music');
    res.status(parsedErr.status).json({ error: parsedErr.message });
  }
});

// Live Weather Telemetry Proxy (Open-Meteo Integration)
app.get('/api/connectors/weather', async (req: Request, res: Response) => {
  try {
    const lat = req.query.lat || '51.5074';
    const lon = req.query.lon || '-0.1278';

    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation`
    );
    if (response.ok) {
      const data = await response.json();
      return res.json({
        domain: 'weather',
        status: 'LIVE',
        provider: 'Open-Meteo Real-Time',
        location: { latitude: Number(lat), longitude: Number(lon) },
        metrics: {
          temperature_c: data.current?.temperature_2m ?? 18.5,
          humidity_pct: data.current?.relative_humidity_2m ?? 65,
          pressure_hpa: data.current?.surface_pressure ?? 1013.2,
          wind_speed_ms: data.current?.wind_speed_10m ?? 4.2,
          wind_dir_deg: data.current?.wind_direction_10m ?? 210,
          rainfall_mm: data.current?.precipitation ?? 0.0
        },
        timestamp: new Date().toISOString()
      });
    }
  } catch {
    // Fall back gracefully
  }

  res.json({
    domain: 'weather',
    status: 'SIMULATED',
    provider: 'Open-Meteo (Simulated Direct Fallback)',
    location: { latitude: 51.5074, longitude: -0.1278 },
    metrics: {
      temperature_c: 19.2 + Math.sin(Date.now() / 10000) * 3,
      humidity_pct: 62 + Math.cos(Date.now() / 15000) * 10,
      pressure_hpa: 1014.5 + Math.sin(Date.now() / 20000) * 5,
      wind_speed_ms: 4.8 + Math.random() * 2,
      wind_dir_deg: (210 + Math.random() * 20) % 360,
      rainfall_mm: 0.0
    },
    timestamp: new Date().toISOString()
  });
});

// Bidirectional Live Seer Voice WebSocket Bridge (/api/ai/live -> gemini-3.8-live)
function attachLiveVoiceBridge(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = (request.url || '').split('?')[0];
    if (pathname === '/api/ai/live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (clientWs: WebSocket) => {
    let liveSession: any = null;
    let isClosing = false;

    const safeSend = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const closeSession = () => {
      if (isClosing) return;
      isClosing = true;
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // Ignore close errors
        }
        liveSession = null;
      }
    };

    clientWs.on('message', async (rawData) => {
      let msg: any;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        return;
      }

      if (msg.type === 'init') {
        if (!aiClient) {
          safeSend({
            type: 'error',
            message: 'GEMINI_API_KEY is not configured in Settings > Secrets.'
          });
          clientWs.close();
          return;
        }

        if (liveSession) return;

        const telemetrySummary = String(msg.telemetrySummary || 'Live 24-domain telemetry stream active.').slice(
          0,
          3500
        );
        const weatherMood = String(msg.weatherMood || 'calm atmospheric observatory narrator').slice(0, 160);

        try {
          liveSession = await aiClient.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Zephyr' }
                }
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction: {
                parts: [
                  {
                    text: `You are the Weather Beats Crystal Ball Seer in a live, interruptible voice conversation.
Tone & pacing: ${weatherMood}. Speak warmly, concisely (2-3 crisp sentences per turn), and directly answer follow-up questions about cross-domain telemetry anomalies (such as correlating pressure drops, solar Kp spikes, AQI shifts, wind speed, and musical BPM).
Always stay strictly grounded in the live 24-domain telemetry readings provided below; never fabricate sensor numbers.

Live 24-Domain Telemetry Briefing:
${telemetrySummary}`
                  }
                ]
              }
            },
            callbacks: {
              onopen: () => {
                safeSend({ type: 'ready' });
              },
              onmessage: (serverMessage: any) => {
                if (serverMessage.serverContent?.interrupted) {
                  safeSend({ type: 'interrupted' });
                  return;
                }

                const inputText = serverMessage.serverContent?.inputTranscription?.text;
                if (inputText) {
                  safeSend({ type: 'inputTranscript', text: inputText });
                }

                const outputText = serverMessage.serverContent?.outputTranscription?.text;
                if (outputText) {
                  safeSend({ type: 'outputTranscript', text: outputText });
                }

                const parts = serverMessage.serverContent?.modelTurn?.parts || [];
                for (const part of parts) {
                  if (part.inlineData?.data) {
                    safeSend({
                      type: 'audio',
                      data: part.inlineData.data,
                      mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000'
                    });
                  }
                }

                if (serverMessage.serverContent?.turnComplete) {
                  safeSend({ type: 'turnComplete' });
                }
              },
              onerror: (err: any) => {
                safeSend({
                  type: 'error',
                  message: err?.message || 'Live voice session encountered an upstream error.'
                });
              },
              onclose: () => {
                if (!isClosing) {
                  safeSend({ type: 'closed' });
                }
              }
            }
          });
        } catch (err: any) {
          console.error('Live Voice Connect Error:', err);
          safeSend({
            type: 'error',
            message: err?.message || 'Failed to establish Live Seer Voice connection.'
          });
        }
      } else if (msg.type === 'audio' && typeof msg.data === 'string' && liveSession) {
        try {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000'
            }
          });
        } catch {
          // Ignore transient send errors while closing
        }
      } else if (msg.type === 'telemetry_update' && typeof msg.telemetrySummary === 'string' && liveSession) {
        try {
          liveSession.sendClientContent({
            turns: [
              {
                role: 'user',
                parts: [
                  {
                    text: `[Silent telemetry context refresh — do not reply until spoken to]\n${msg.telemetrySummary.slice(0, 2200)}`
                  }
                ]
              }
            ],
            turnComplete: false
          });
        } catch {
          // Non-fatal context refresh skip
        }
      }
    });

    clientWs.on('close', closeSession);
    clientWs.on('error', closeSession);
  });
}

// Mounting Vite in development mode
async function startServer() {
  const PORT = process.env.PORT || 3000;
  const server = http.createServer(app);
  attachLiveVoiceBridge(server);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  server.listen(PORT, () => {
    console.log(`Weather Beats Universal Intelligence Server running on http://localhost:${PORT}`);
  });
}

startServer();
