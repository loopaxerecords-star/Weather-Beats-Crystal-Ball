import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const app = express();
app.use(express.json({ limit: '4mb' }));

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
];

// System health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    product: 'Weather Beats Universal Intelligence',
    version: '1.0.0-phase1',
    timestamp: new Date().toISOString(),
    aiAvailable: !!aiClient,
    activeDomainsCount: 24,
    phase1PriorityDomains: ['weather', 'environmental', 'geographic', 'energy', 'computing', 'audio_musical']
  });
});

// Gemini AI Intelligence Query Endpoint
app.post('/api/ai/query', async (req: Request, res: Response) => {
  try {
    const { prompt, telemetrySnapshot, domainContext } = req.body;

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

// Voice Telemetry Oracle Intent Parsing + Spoken Audio Reply
app.post('/api/ai/voice-query', async (req: Request, res: Response) => {
  try {
    const { question, telemetrySummary, includeSpeech = true } = req.body;

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
    const matchedDomain = VALID_DOMAINS.includes(rawDomain) ? rawDomain : 'all';
    const answerText = String(parsed.answerText || 'Telemetry reading complete.');
    const intentSummary = String(parsed.intentSummary || 'Live Telemetry Query');
    const citedMetrics = Array.isArray(parsed.citedMetrics)
      ? parsed.citedMetrics.map((m: unknown) => String(m)).slice(0, 3)
      : [];

    let audioBase64Wav: string | undefined;
    let audioMimeType: string | undefined;

    if (includeSpeech && answerText) {
      try {
        const ttsResponse = await aiClient.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: answerText,
                  speechMetadata: {
                    style: 'Calm, clear atmospheric observatory narrator'
                  }
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
          audioBase64Wav = inlineData.data;
          audioMimeType = inlineData.mimeType || 'audio/wav';
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

// Live Weather Telemetry Proxy (Open-Meteo Integration)
app.get('/api/connectors/weather', async (req: Request, res: Response) => {
  try {
    const lat = req.query.lat || '51.5074';
    const lon = req.query.lon || '-0.1278';

    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation`);
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

// Mounting Vite in development mode
async function startServer() {
  const PORT = process.env.PORT || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, () => {
    console.log(`Weather Beats Universal Intelligence Server running on http://localhost:${PORT}`);
  });
}

startServer();
