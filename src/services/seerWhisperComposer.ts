import { DomainCategory } from '../types/telemetry';
import { GeolocationWeatherContext } from './telemetryEngine';
import { BarSectionName, NormalizedDomainReading } from './weatherBeatsComposer';

/**
 * 0-indexed musical section transition bars across the 32-bar form:
 * Bar 1 (Intro), Bar 5 (Groove), Bar 13 (Poly-Build), Bar 21 (Climax),
 * Bar 27 (Breakdown), Bar 31 (Outro).
 */
export const WHISPER_TRANSITION_BARS: readonly number[] = [0, 4, 12, 20, 26, 30];

export interface SeerWhisperEvent {
  id: number;
  text: string;
  domainId: DomainCategory | 'all';
  domainName: string;
  section: BarSectionName;
  barNumber: number; // 1..32
  triggeredAtMs: number;
  durationMs: number;
}

interface DomainOmenTemplate {
  low: string[];
  mid: string[];
  high: string[];
}

const DOMAIN_OMEN_TEMPLATES: Record<DomainCategory, DomainOmenTemplate> = {
  weather: {
    low: [
      'Still air lingers at {val}... a quiet hush before the turning sky.',
      'Frost gathers softly around {val}... listen beneath the glass.'
    ],
    mid: [
      'A gentle current breathes at {val}... clouds weave around the table.',
      'The evening wind turns through {val}... every drift speaks true.'
    ],
    high: [
      'Restless heat shimmers at {val}... the storm horizon wakes.',
      'Fevered skies pulse near {val}... watch the embers rise.'
    ]
  },
  environmental: {
    low: [
      'Clear air rests at {val}... the unseen canopy holds steady.',
      'Pure breath settles near {val}... stillness crowns the parlor.'
    ],
    mid: [
      'Drifting haze whispers at {val}... faint traces cross the candlelight.',
      'The ambient veil shifts to {val}... the earth keeps its count.'
    ],
    high: [
      'Heavy mist thickens at {val}... the air remembers every spark.',
      'Dense currents swirl around {val}... read the veiled horizon.'
    ]
  },
  geographic: {
    low: [
      'Silent meridians hold near {val}... the compass sleeps in gold.',
      'Steady ground answers at {val}... ancient bearings remain.'
    ],
    mid: [
      'Latitudes drift across {val}... distant borders hum in harmony.',
      'Mapped currents cross at {val}... the astrolabe aligns.'
    ],
    high: [
      'Magnetic bearings surge near {val}... unseen roads converge tonight.',
      'High terrain echoes at {val}... follow the brass horizon.'
    ]
  },
  atmospheric: {
    low: [
      'Falling pressure bows to {val}... open windows invite the rain.',
      'The barometer sinks to {val}... a deeper tide is approaching.'
    ],
    mid: [
      'Balanced pressure steadies at {val}... sky and glass mirror one another.',
      'Calm air holds at {val}... the veil rests undisturbed.'
    ],
    high: [
      'Crystalline pressure crests at {val}... clear stars watch the table.',
      'High skies lock around {val}... every omen rings sharp.'
    ]
  },
  geological: {
    low: [
      'Deep stone sleeps at {val}... beneath the floor all roots stay still.',
      'Quiet strata rest near {val}... only the bass remembers.'
    ],
    mid: [
      'Subtle tremors breathe at {val}... the bedrock hums in slow time.',
      'Earth plates murmur around {val}... feel the pulse below.'
    ],
    high: [
      'Tectonic tides stir at {val}... deep forces climb toward the light.',
      'The dark mantle wakes near {val}... thunder gathers underground.'
    ]
  },
  oceanographic: {
    low: [
      'Low tide retreats at {val}... calm water keeps its secrets.',
      'Glassy swells rest near {val}... the abyss stays hushed.'
    ],
    mid: [
      'Silver currents turn at {val}... salt winds carry distant echoes.',
      'Steady tides breathe through {val}... the moon guides the deep.'
    ],
    high: [
      'Deep swells crest at {val}... dark waters answer the stars.',
      'Oceanic surges climb past {val}... the horizon bends with tide.'
    ]
  },
  solar: {
    low: [
      'Dim solar embers rest at {val}... twilight rules the crystal core.',
      'Quiet sunbeams linger near {val}... silver shadows lengthen.'
    ],
    mid: [
      'Golden radiance flows at {val}... warm arcs trace the brass rings.',
      'Steady solar light holds {val}... the nebula turns amber.'
    ],
    high: [
      'Blazing solar flare crowns {val}... bright fire enters the orb.',
      'Solar currents surge at {val}... gold awakens in the glass.'
    ]
  },
  space: {
    low: [
      'Calm starlight drifts at {val}... the outer void keeps silent watch.',
      'Quiet orbit glides through {val}... distant constellations align.'
    ],
    mid: [
      'Cosmic winds brush past {val}... silver dust circles the dome.',
      'Orbital tides shimmer at {val}... listen to the high heavens.'
    ],
    high: [
      'Geomagnetic storms flare at {val}... the northern veil ignites.',
      'Deep space crackles near {val}... starlight bends around us.'
    ]
  },
  biological: {
    low: [
      'Slow living pulses rest at {val}... quiet roots drink in the dark.',
      'Soft biosignals settle near {val}... breath slows to the drum.'
    ],
    mid: [
      'Vital rhythms weave at {val}... living threads bind the canopy.',
      'Organic currents bloom near {val}... every heartbeat keeps time.'
    ],
    high: [
      'Vibrant life surges at {val}... wild blossoms open in the dark.',
      'Restless vitality peaks at {val}... the pulse runs luminous.'
    ]
  },
  agricultural: {
    low: [
      'Dry furrows wait at {val}... patience guards the sleeping seed.',
      'Quiet fields hold near {val}... waiting for the silver rain.'
    ],
    mid: [
      'Fertile soil breathes at {val}... green shoots answer the season.',
      'Harvest currents balance at {val}... earth and sky keep faith.'
    ],
    high: [
      'Abundant yield swells at {val}... golden fields ripen in chorus.',
      'Rich earth overflows near {val}... the season turns generous.'
    ]
  },
  energy: {
    low: [
      'Soft voltage rests at {val}... pale lanterns guard the hall.',
      'Gentle power hums at {val}... the grid sleeps in reserve.'
    ],
    mid: [
      'Steady current flows through {val}... copper lines sing beneath us.',
      'Balanced power holds at {val}... the pulse keeps warm.'
    ],
    high: [
      'High charge crackles at {val}... lightning threads the crystal core.',
      'Surging power crests near {val}... every coil glows bright.'
    ]
  },
  industrial: {
    low: [
      'Quiet turbines idle at {val}... iron wheels slow to a whisper.',
      'Distant looms rest near {val}... metal cools in the dusk.'
    ],
    mid: [
      'Measured engines turn at {val}... brass gears keep steady tempo.',
      'Forges breathe evenly at {val}... craft shapes the rhythm.'
    ],
    high: [
      'Heavy pistons drive past {val}... sparks rise through the smoke.',
      'Full industry roars near {val}... steel answers the beat.'
    ]
  },
  smart_building: {
    low: [
      'Empty corridors hush at {val}... stone walls keep the night.',
      'Quiet chambers settle near {val}... warm embers stay low.'
    ],
    mid: [
      'Living halls balance at {val}... sheltered air breathes softly.',
      'Inner sanctums steady at {val}... the hearth holds true.'
    ],
    high: [
      'Crowded towers hum at {val}... countless lanterns burn awake.',
      'Rising chambers pulse near {val}... the skyline glows warm.'
    ]
  },
  computing: {
    low: [
      'Quiet silicon sleeps at {val}... cold logic waits in stillness.',
      'Calm processors drift near {val}... idle threads unwind.'
    ],
    mid: [
      'Crystal circuits weave at {val}... silver calculations flow.',
      'Measured clocks tick through {val}... patterns surface cleanly.'
    ],
    high: [
      'Bright clusters race at {val}... lightning thinks inside the glass.',
      'Thermal cores surge near {val}... signals multiply fast.'
    ]
  },
  transport: {
    low: [
      'Silent avenues stretch at {val}... midnight travelers move alone.',
      'Open corridors hush near {val}... the crossroads wait.'
    ],
    mid: [
      'Steady caravans glide at {val}... lantern trails cross the night.',
      'Rhythmic transit flows through {val}... every vessel finds port.'
    ],
    high: [
      'Swift crossings converge at {val}... restless wheels stir the dust.',
      'Dense routes accelerate near {val}... momentum sweeps the city.'
    ]
  },
  network: {
    low: [
      'Clear pathways whisper at {val}... signals arrive without delay.',
      'Unbroken threads rest near {val}... distant voices draw close.'
    ],
    mid: [
      'Braided packets flow at {val}... invisible webs carry the news.',
      'Living relays shimmer at {val}... echoes span the ocean.'
    ],
    high: [
      'Crowded relays flicker at {val}... static dances along the wire.',
      'Heavy traffic strains near {val}... listen through the mist.'
    ]
  },
  artificial_intelligence: {
    low: [
      'Quiet weights ponder at {val}... latent visions form slowly.',
      'Still inference rests near {val}... awaiting the next spark.'
    ],
    mid: [
      'Neural currents weave at {val}... hidden patterns gleam inside.',
      'Synthetic intuition flows through {val}... mirroring our questions.'
    ],
    high: [
      'Swift tokens cascade at {val}... luminous minds race the stars.',
      'Inference blazes near {val}... new prophecies take shape.'
    ]
  },
  financial: {
    low: [
      'Cautious vaults hold at {val}... gold rests quietly in shadow.',
      'Still ledgers settle near {val}... fortune pauses to breathe.'
    ],
    mid: [
      'Balanced scales sway at {val}... silver tides change hands.',
      'Measured markets move through {val}... equilibrium holds.'
    ],
    high: [
      'Volatile tides crest at {val}... fortunes turn upon a spark.',
      'Swift currents climb past {val}... watch where the gold lands.'
    ]
  },
  economic: {
    low: [
      'Slow seasons turn at {val}... patient stores endure the winter.',
      'Hushed commerce rests near {val}... waiting for renewal.'
    ],
    mid: [
      'Steady trade breathes at {val}... caravans cross the harbor.',
      'Balanced cycles weave through {val}... the wheel turns smoothly.'
    ],
    high: [
      'Expansion rises past {val}... new sails catch the tailwind.',
      'Vibrant tides swell near {val}... abundance rings loud.'
    ]
  },
  business: {
    low: [
      'Quiet ledgers pause at {val}... craft prepares behind closed doors.',
      'Still ventures reflect near {val}... gathering quiet strength.'
    ],
    mid: [
      'Steady guilds labor at {val}... promises keep their measure.',
      'Orderly exchange flows through {val}... trust anchors the wheel.'
    ],
    high: [
      'Bold ventures crest at {val}... ambitious banners catch the wind.',
      'Rapid momentum climbs near {val}... new alliances awaken.'
    ]
  },
  social_information: {
    low: [
      'Soft murmurs drift at {val}... the public square falls tranquil.',
      'Quiet voices rest near {val}... reflection guides the crowd.'
    ],
    mid: [
      'Shared stories ripple at {val}... many tongues weave one chord.',
      'Collective whispers flow through {val}... curiosity awakens.'
    ],
    high: [
      'A chorus of voices surges at {val}... the air rings with news.',
      'Bright conversations ignite near {val}... every rumor takes wing.'
    ]
  },
  audio: {
    low: [
      'Velvet silence settles at {val}... hear the candle flame breathe.',
      'Hushed acoustics rest near {val}... every overtone gleams.'
    ],
    mid: [
      'Warm resonance blooms at {val}... sound fills the velvet parlor.',
      'Clear harmonics float through {val}... listen between the beats.'
    ],
    high: [
      'Rich acoustics swell at {val}... the chamber vibrates in gold.',
      'Resonant waves surge near {val}... overtones crown the sphere.'
    ]
  },
  musical: {
    low: [
      'Slow cadence breathes at {val}... patience shapes the melody.',
      'Tender tempo drifts near {val}... let the chord linger.'
    ],
    mid: [
      'Balanced groove turns at {val}... strings and drums entwine.',
      'Living harmony moves through {val}... the ritual finds its sway.'
    ],
    high: [
      'Ecstatic pulse climbs at {val}... the rhythm lifts the veil.',
      'Kinetic cadence drives past {val}... dance within the glow.'
    ]
  },
  security: {
    low: [
      'Unbroken wards hold at {val}... the sanctuary stays serene.',
      'Quiet sentinels watch near {val}... no shadow crosses the threshold.'
    ],
    mid: [
      'Vigilant shields hum at {val}... brass seals guard the perimeter.',
      'Steady ciphers turn through {val}... every gate remains true.'
    ],
    high: [
      'Alert wards flare at {val}... strange sparks test the boundary.',
      'Watchful barriers rise near {val}... hold fast to the light.'
    ]
  }
};

const SECTION_INVOCATION_PREFIX: Record<BarSectionName, string[]> = {
  Intro: ['Beyond the veil...', 'Draw near the glass...', 'Hear the first breath...'],
  Groove: ['The wheel turns...', 'Beneath the rhythm...', 'Feel the current...'],
  'Poly-Build': ['Currents gather...', 'Threads intertwine...', 'Rising through the mist...'],
  Climax: ['At the zenith...', 'The orb awakens...', 'Behold the crest...'],
  Breakdown: ['In quiet stillness...', 'Pause and listen...', 'Between the beats...'],
  Outro: ['As embers fade...', 'Carry this omen...', 'Until the next turning...']
};

function formatSpokenReading(reading: NormalizedDomainReading): string {
  const num = Number(reading.rawValue);
  const cleanNum = Number.isFinite(num)
    ? Math.abs(num) >= 100
      ? Math.round(num).toString()
      : Number(num.toFixed(1)).toString()
    : String(reading.rawValue);

  switch (reading.unit) {
    case '°C':
      return `${cleanNum} degrees`;
    case 'hPa':
      return `${cleanNum} hectopascals`;
    case '%':
      return `${cleanNum} percent`;
    case 'm/s':
      return `${cleanNum} meters per second`;
    case 'W/m²':
      return `${cleanNum} watts`;
    case 'µg/m³':
      return `${cleanNum} micrograms`;
    case 'tok/s':
      return `${cleanNum} tokens`;
    case 'BPM':
      return `${cleanNum} beats`;
    default:
      return reading.unit ? `${cleanNum} ${reading.unit}` : cleanNum;
  }
}

let whisperSeqCounter = 1;

/**
 * Pure, deterministic cryptic telemetry whisper composer.
 * Inspects live 24-domain deviations, active weather, section mood, and focused lens
 * to produce concise, evocative 6-12 word whispers without repeating back-to-back lines.
 */
export function composeCrypticTelemetryWhisper(
  vector24: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext,
  section: BarSectionName,
  barNumber: number,
  focusedDomain: 'all' | DomainCategory = 'all',
  previousText?: string
): SeerWhisperEvent {
  const entries = Object.values(vector24);
  const ranked = [...entries].sort((a, b) => {
    const devA = Math.abs(a.normalized - 0.5);
    const devB = Math.abs(b.normalized - 0.5);
    if (Math.abs(devB - devA) > 0.0001) return devB - devA;
    return a.domain.localeCompare(b.domain);
  });

  // Choose target domain: honor focusedDomain prominently, otherwise rotate through top live anomalies
  const barSlot = Math.max(0, WHISPER_TRANSITION_BARS.indexOf(barNumber - 1));
  let chosen: NormalizedDomainReading;
  if (focusedDomain !== 'all' && vector24[focusedDomain] && barSlot % 2 === 0) {
    chosen = vector24[focusedDomain];
  } else if (section === 'Intro' && focusedDomain === 'all') {
    chosen = vector24.weather ?? ranked[0];
  } else {
    chosen = ranked[barSlot % Math.min(6, Math.max(1, ranked.length))] ?? vector24.weather;
  }

  const tier: 'low' | 'mid' | 'high' =
    chosen.normalized < 0.34 ? 'low' : chosen.normalized > 0.66 ? 'high' : 'mid';

  const templateGroup = DOMAIN_OMEN_TEMPLATES[chosen.domain];
  const variants = templateGroup ? templateGroup[tier] : DOMAIN_OMEN_TEMPLATES.weather.mid;
  const prefixes = SECTION_INVOCATION_PREFIX[section] ?? SECTION_INVOCATION_PREFIX.Intro;

  const formattedVal = formatSpokenReading(chosen);
  let variantIdx = (barNumber + Math.round(weatherCtx.temperatureC + weatherCtx.aqi)) % variants.length;
  if (variantIdx < 0) variantIdx = 0;

  let text = variants[variantIdx].replace('{val}', formattedVal);

  // Add subtle weather-grounded poetic opener on Intro / Outro / Breakdown
  if (section === 'Intro' || section === 'Outro') {
    const prefix = prefixes[barNumber % prefixes.length];
    text = `${prefix} ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  }

  // Guarantee zero back-to-back repetition
  if (previousText && text === previousText) {
    const altVariant = variants[(variantIdx + 1) % variants.length];
    const altText = altVariant.replace('{val}', formattedVal);
    if (altText !== previousText) {
      text = altText;
    } else {
      const nextDomain = ranked[(barSlot + 1) % ranked.length] ?? chosen;
      const nextTier: 'low' | 'mid' | 'high' =
        nextDomain.normalized < 0.34 ? 'low' : nextDomain.normalized > 0.66 ? 'high' : 'mid';
      const nextTpl = (DOMAIN_OMEN_TEMPLATES[nextDomain.domain]?.[nextTier] ?? variants)[0];
      chosen = nextDomain;
      text = `${prefixes[(barNumber + 1) % prefixes.length]} ${nextTpl
        .replace('{val}', formatSpokenReading(nextDomain))
        .toLowerCase()}`;
    }
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const durationMs = Math.max(3600, Math.min(6200, Math.round(wordCount * 410 + 1100)));

  return {
    id: whisperSeqCounter++,
    text,
    domainId: chosen.domain,
    domainName: chosen.name,
    section,
    barNumber,
    triggeredAtMs: Date.now(),
    durationMs
  };
}

/**
 * Pure, zero-allocation syllabic vocal envelope (0..1) used alongside the real-time
 * Web Audio whisper bus AnalyserNode to synchronize the Hooded Celestial Seer's
 * speaking glow smoothly across each whispered phrase.
 */
export function computeWhisperSyllableEnvelope(
  nowMs: number,
  triggeredAtMs: number,
  durationMs: number
): number {
  if (durationMs <= 0) return 0;
  const elapsed = nowMs - triggeredAtMs;
  if (elapsed < 0 || elapsed > durationMs) return 0;

  const progress = elapsed / durationMs;
  // Smooth fade-in (first 14%) and breathy fade-out (last 24%)
  const attack = Math.min(1, progress / 0.14);
  const release = Math.min(1, (1 - progress) / 0.24);
  const windowEnv = Math.min(attack, release);

  // Organic whispered syllable cadence (~3.4 Hz primary + 5.7 Hz consonant shimmer)
  const sec = elapsed * 0.001;
  const cadence =
    0.56 +
    0.26 * Math.sin(sec * Math.PI * 3.4) +
    0.18 * Math.sin(sec * Math.PI * 5.7 + 0.9);

  return Math.max(0, Math.min(1, windowEnv * cadence));
}
