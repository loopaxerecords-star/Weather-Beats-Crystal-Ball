import { DomainCategory } from '../types/telemetry';
import { ALL_DOMAINS_LIST, UNIVERSAL_DOMAINS } from './domainRegistry';
import { GeolocationWeatherContext } from './telemetryEngine';
import { NormalizedDomainReading } from './weatherBeatsComposer';

export interface VoiceQueryResult {
  question: string;
  matchedDomain: DomainCategory | 'all';
  intentSummary: string;
  answerText: string;
  citedMetrics: string[];
  audioBase64Wav?: string;
  audioMimeType?: string;
  source: 'gemini_4_hydrogen' | 'local_telemetry_lookup';
  apiError?: string;
}

const VALID_DOMAIN_SET = new Set<string>(Object.keys(UNIVERSAL_DOMAINS));

const DOMAIN_KEYWORDS: Record<DomainCategory, string[]> = {
  weather: ['weather', 'temperature', 'temp', 'rain', 'wind', 'humidity', 'forecast', 'climate', 'hot', 'cold'],
  environmental: ['environment', 'environmental', 'aqi', 'air quality', 'pm2.5', 'pm25', 'pollution', 'co2', 'carbon'],
  geographic: ['location', 'geographic', 'latitude', 'longitude', 'elevation', 'gps', 'coordinates', 'region', 'where'],
  energy: ['energy', 'power', 'grid', 'electricity', 'voltage', 'watt', 'kilowatt', 'solar generation'],
  computing: ['cpu', 'computing', 'processor', 'memory', 'ram', 'disk', 'server', 'compute'],
  audio: ['audio', 'dsp', 'loudness', 'lufs', 'db', 'decibel', 'amplitude', 'fft', 'spectrum', 'sound'],
  musical: ['music', 'musical', 'bpm', 'tempo', 'beat', 'beats', 'scale', 'kora', 'djembe', 'synth', 'fm'],
  atmospheric: ['atmospheric', 'atmosphere', 'pressure', 'barometer', 'hpa', 'ozone', 'boundary layer'],
  geological: ['geological', 'geology', 'seismic', 'earthquake', 'quake', 'tectonic', 'tremor'],
  oceanographic: ['ocean', 'oceanographic', 'sea', 'wave', 'salinity', 'tide', 'marine'],
  solar: ['solar', 'sun', 'sunspot', 'irradiance', 'flare', 'uv'],
  space: ['space', 'cosmic', 'radiation', 'geomagnetic', 'kp', 'satellite', 'orbit'],
  biological: ['biological', 'biology', 'biodiversity', 'vegetation', 'species', 'biomass', 'eco'],
  agricultural: ['agricultural', 'agriculture', 'soil', 'crop', 'moisture', 'farm', 'evapotranspiration'],
  industrial: ['industrial', 'industry', 'machine', 'turbine', 'vibration', 'factory'],
  smart_building: ['building', 'smart building', 'occupancy', 'hvac', 'indoor', 'room'],
  transport: ['transport', 'traffic', 'vehicle', 'speed', 'fleet', 'congestion', 'road'],
  network: ['network', 'latency', 'ping', 'jitter', 'packet', 'bandwidth', 'internet'],
  financial: ['financial', 'finance', 'market', 'volatility', 'stock', 'price', 'trade'],
  economic: ['economic', 'economy', 'inflation', 'cpi', 'gdp', 'yield'],
  business: ['business', 'orders', 'revenue', 'sales', 'customer', 'churn'],
  social_information: ['social', 'sentiment', 'news', 'trend', 'social media', 'public'],
  artificial_intelligence: ['ai', 'artificial intelligence', 'model', 'token', 'tokens', 'throughput', 'inference'],
  security: ['security', 'threat', 'firewall', 'attack', 'vulnerability', 'intrusion', 'login']
};

export function normalizeMatchedDomain(candidate: string | undefined | null): DomainCategory | 'all' {
  if (!candidate) return 'all';
  const cleaned = candidate.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (cleaned === 'all') return 'all';
  if (VALID_DOMAIN_SET.has(cleaned)) return cleaned as DomainCategory;
  return 'all';
}

export function buildCompactTelemetrySummary(
  vector24: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext
): string {
  const lines = ALL_DOMAINS_LIST.map((meta) => {
    const r = vector24[meta.id];
    return `${meta.id} (${meta.name}): ${r.rawValue} ${r.unit} [norm=${Math.round(r.normalized * 100)}%]`;
  });
  return [
    `Location: ${weatherCtx.region} (${weatherCtx.latitude.toFixed(2)}, ${weatherCtx.longitude.toFixed(2)})`,
    `Local Weather: ${weatherCtx.temperatureC.toFixed(1)}°C, Humidity ${weatherCtx.humidityPct}%, Wind ${weatherCtx.windSpeedMs} m/s, Pressure ${weatherCtx.pressureHpa} hPa, PM2.5 ${weatherCtx.pm25UgM3} µg/m³ (AQI ${weatherCtx.aqi})`,
    '24 Live Domains:',
    ...lines
  ].join('\n');
}

/**
 * Deterministic local telemetry intent parser & grounded summary builder.
 * Never claims to be an LLM; used for explicit fallback when offline or API key is unconfigured.
 */
export function parseTelemetryQuestionLocally(
  question: string,
  vector24: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext,
  apiError?: string
): VoiceQueryResult {
  const q = question.toLowerCase();
  let bestDomain: DomainCategory | 'all' = 'all';
  let bestScore = 0;

  for (const domain of Object.keys(DOMAIN_KEYWORDS) as DomainCategory[]) {
    let score = 0;
    for (const kw of DOMAIN_KEYWORDS[domain]) {
      if (q.includes(kw)) {
        score += kw.includes(' ') ? 3 : 2;
      }
    }
    if (q.includes(domain.replace(/_/g, ' '))) {
      score += 4;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  if (bestDomain !== 'all') {
    const reading = vector24[bestDomain];
    const meta = UNIVERSAL_DOMAINS[bestDomain];
    const pct = Math.round(reading.normalized * 100);
    return {
      question,
      matchedDomain: bestDomain,
      intentSummary: `Focused ${meta.name}`,
      answerText: `${meta.name} is currently at ${reading.rawValue} ${reading.unit} (${pct}% of its active telemetry range), while ${weatherCtx.region} reports ${weatherCtx.temperatureC.toFixed(1)}°C and AQI ${weatherCtx.aqi}.`,
      citedMetrics: [`${meta.name}: ${reading.rawValue} ${reading.unit}`, `Normalized: ${pct}%`],
      source: 'local_telemetry_lookup',
      apiError
    };
  }

  return {
    question,
    matchedDomain: 'all',
    intentSummary: 'Cross-Domain 24-Channel Overview',
    answerText: `Across all 24 live domains at ${weatherCtx.region}, local weather is ${weatherCtx.temperatureC.toFixed(1)}°C with AQI ${weatherCtx.aqi}, energy load is ${vector24.energy.rawValue} ${vector24.energy.unit}, solar irradiance is ${vector24.solar.rawValue} ${vector24.solar.unit}, and tempo sits at ${vector24.musical.rawValue} ${vector24.musical.unit}.`,
    citedMetrics: [
      `Weather: ${weatherCtx.temperatureC.toFixed(1)}°C`,
      `Energy: ${vector24.energy.rawValue} ${vector24.energy.unit}`,
      `Solar: ${vector24.solar.rawValue} ${vector24.solar.unit}`,
      `Tempo: ${vector24.musical.rawValue} ${vector24.musical.unit}`
    ],
    source: 'local_telemetry_lookup',
    apiError
  };
}
