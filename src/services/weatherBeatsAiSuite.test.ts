import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  TELEMETRY_BY_HOUR,
  TELEMETRY_INSTRUMENT_MAP,
  computeCircadianSpotlight,
  computeInfiniteFlowTide,
  formatTelemetryHour,
  getActiveTelemetryHour
} from './weatherBeatsComposer';
import {
  CRYSTAL_BALL_SCALE,
  SeerBlinkController,
  computeStagedAnimationWeights,
  evaluateBlinkEnvelope
} from './fortuneTellerRig';
import { VOICE_HPF_SPEC, audioDspEngine, computeEqualPowerMixGains } from './audioDspEngine';
import {
  SmartAlertRule,
  buildLyriaTelemetryPayload,
  classifyCrystalBallPrompt,
  evaluateSmartAlertRules,
  formatApiErrorMessage,
  validateReadOnlySqlClient
} from './aiIntelligenceSuite';
import { telemetryEngine } from './telemetryEngine';
import { build32BarComposition, computeDomainVector24 } from './weatherBeatsComposer';

after(() => {
  telemetryEngine.stopStreaming();
});

test('24-hour circadian telemetry mapping assigns unique hours 0..23 and wraps cleanly across midnight', () => {
  assert.equal(Object.keys(TELEMETRY_INSTRUMENT_MAP).length, 24);
  assert.equal(TELEMETRY_BY_HOUR.length, 24);

  const seenHours = new Set(TELEMETRY_BY_HOUR.map((entry) => entry.hourOfDay));
  const seenDomains = new Set(TELEMETRY_BY_HOUR.map((entry) => entry.domain));
  assert.equal(seenHours.size, 24);
  assert.equal(seenDomains.size, 24);

  for (let h = 0; h < 24; h++) {
    assert.equal(TELEMETRY_BY_HOUR[h].hourOfDay, h);
    assert.equal(TELEMETRY_BY_HOUR[h].hourLabel, formatTelemetryHour(h));
  }

  // Circular Gaussian spotlight wraps smoothly across 23:30 <-> 00:00
  const peakAtMidnight = computeCircadianSpotlight(0, 0);
  const nearMidnightBefore = computeCircadianSpotlight(0, 23.5);
  const nearMidnightAfter = computeCircadianSpotlight(0, 0.5);
  const oppositeNoon = computeCircadianSpotlight(0, 12);

  assert.equal(peakAtMidnight, 1);
  assert.ok(Math.abs(nearMidnightBefore - nearMidnightAfter) < 1e-6);
  assert.ok(nearMidnightBefore > 0.9);
  assert.ok(oppositeNoon >= 0 && oppositeNoon < nearMidnightBefore);

  const active = getActiveTelemetryHour(14.2);
  assert.equal(active.hourOfDay, 14);
});

test('Infinite flow tide evolves continuously with zero abrupt drops across 64 bars', () => {
  let prevEnergy = computeInfiniteFlowTide(0);
  for (let bar = 1; bar <= 64; bar++) {
    const energy = computeInfiniteFlowTide(bar);
    assert.ok(energy >= 0.35 && energy <= 1.0);
    const maxDelta = bar <= 4 ? 0.18 : 0.08;
    assert.ok(
      Math.abs(energy - prevEnergy) < maxDelta,
      `Abrupt energy jump between bar ${bar - 1} and ${bar}: ${prevEnergy} -> ${energy}`
    );
    prevEnergy = energy;
  }
});

test('Staged animations are strictly 0 before Play and awaken monotonically one by one', () => {
  const idle = computeStagedAnimationWeights(0);
  assert.deepEqual(idle, {
    core: 0,
    seerBreathGaze: 0,
    handsCandlesIncense: 0,
    astrolabeRings: 0,
    constellationBackdrop: 0
  });

  const t1 = computeStagedAnimationWeights(1.0);
  assert.ok(t1.core > 0 && t1.core < 1);
  assert.equal(t1.seerBreathGaze, 0);
  assert.equal(t1.handsCandlesIncense, 0);
  assert.equal(t1.astrolabeRings, 0);
  assert.equal(t1.constellationBackdrop, 0);

  const t3 = computeStagedAnimationWeights(3.0);
  assert.equal(t3.core, 1);
  assert.ok(t3.seerBreathGaze > 0 && t3.seerBreathGaze < 1);
  assert.equal(t3.handsCandlesIncense, 0);

  const t5 = computeStagedAnimationWeights(5.0);
  assert.equal(t5.seerBreathGaze, 1);
  assert.ok(t5.handsCandlesIncense > 0 && t5.handsCandlesIncense < 1);
  assert.equal(t5.astrolabeRings, 0);

  const t7 = computeStagedAnimationWeights(7.0);
  assert.equal(t7.handsCandlesIncense, 1);
  assert.ok(t7.astrolabeRings > 0 && t7.astrolabeRings < 1);
  assert.equal(t7.constellationBackdrop, 0);

  const t12 = computeStagedAnimationWeights(12.0);
  assert.deepEqual(t12, {
    core: 1,
    seerBreathGaze: 1,
    handsCandlesIncense: 1,
    astrolabeRings: 1,
    constellationBackdrop: 1
  });
});

test('Physiological blink envelope and controller produce natural asymmetric human blinks', () => {
  assert.equal(evaluateBlinkEnvelope(0), 0);
  assert.equal(evaluateBlinkEnvelope(1), 0);
  assert.equal(evaluateBlinkEnvelope(0.35), 1);
  // Closing (0..0.3) is faster than opening (0.4..1.0)
  assert.ok(evaluateBlinkEnvelope(0.15) > 0.3);
  assert.ok(evaluateBlinkEnvelope(0.65) > 0.25 && evaluateBlinkEnvelope(0.65) < 0.75);

  const ctrl = new SeerBlinkController();
  const sample = { left: 0, right: 0 };
  let blinkCount = 0;
  let wasClosed = false;
  let maxPeak = 0;

  for (let i = 0; i < 1200; i++) {
    ctrl.step(1 / 60, 0, false, sample);
    maxPeak = Math.max(maxPeak, sample.left, sample.right);
    const isClosed = sample.left > 0.85 && sample.right > 0.85;
    if (isClosed && !wasClosed) blinkCount++;
    wasClosed = isClosed;
  }

  assert.ok(maxPeak >= 0.93, 'Expected full natural eyelid closure');
  assert.ok(blinkCount >= 3 && blinkCount <= 9, `Expected 3-9 natural blinks over 20s, got ${blinkCount}`);
});

test('Voice high-pass spec is 250 Hz @ 16 dB/oct, crystal ball scale is 0.52, and Whispers default Off', () => {
  assert.equal(VOICE_HPF_SPEC.cutoffHz, 250);
  assert.equal(VOICE_HPF_SPEC.slopeDbPerOct, 16);
  assert.equal(CRYSTAL_BALL_SCALE, 0.52);
  assert.equal(audioDspEngine.getAmbientWhispersEnabled(), false);
});

test('Read-only DuckDB SQL validation blocks writes and permits safe SELECT / WITH queries', () => {
  assert.equal(validateReadOnlySqlClient('SELECT domain, raw_value FROM telemetry_events LIMIT 5').ok, true);
  assert.equal(validateReadOnlySqlClient('WITH latest AS (SELECT * FROM telemetry_events) SELECT * FROM latest').ok, true);
  assert.equal(validateReadOnlySqlClient('DROP TABLE telemetry_events').ok, false);
  assert.equal(validateReadOnlySqlClient('SELECT 1; DELETE FROM telemetry_events').ok, false);
  assert.equal(validateReadOnlySqlClient('PRAGMA version').ok, false);
});

test('Crystal Ball prompt classifier routes music direction, smart alerts, and telemetry questions accurately', () => {
  assert.equal(
    classifyCrystalBallPrompt('Make the kora warmer and bring the sub-bass forward'),
    'music_direction'
  );
  assert.equal(
    classifyCrystalBallPrompt('Alert me and tint the orb amber when wind exceeds 12 m/s'),
    'smart_alert'
  );
  assert.equal(
    classifyCrystalBallPrompt('What is the barometric pressure and air quality right now?'),
    'telemetry_question'
  );
});

test('Smart alert evaluator evaluates compound multi-domain conditions accurately', () => {
  const latest = telemetryEngine.getLatestByDomain();
  const weather = { ...telemetryEngine.getWeatherContext(), windSpeedMs: 14.5, pressureHpa: 998 };
  const vector24 = computeDomainVector24(latest, weather);

  const rules: SmartAlertRule[] = [
    {
      id: 'rule-storm',
      label: 'Gathering Gale',
      sourcePrompt: 'Alert when wind > 12 and pressure < 1005',
      logic: 'ALL',
      conditions: [
        { domain: 'weather', metric: 'wind_speed_ms', operator: 'gt', threshold: 12 },
        { domain: 'weather', metric: 'pressure_hpa', operator: 'lt', threshold: 1005 }
      ],
      orbTintHex: '#d4a96a',
      sonicIntensityBias: 0.22,
      summary: 'Wind > 12 m/s & Pressure < 1005 hPa',
      enabled: true,
      createdAt: new Date().toISOString()
    }
  ];

  const evalRes = evaluateSmartAlertRules(rules, { weather, vector24 });
  assert.equal(evalRes.triggeredRules.length, 1);
  assert.equal(evalRes.activeOrbTintHex, '#d4a96a');
  assert.equal(evalRes.activeIntensityBias, 0.22);
});

test('formatApiErrorMessage cleanly unwraps raw 402 prepayment depletion JSON and quota/auth errors', () => {
  const raw402 = JSON.stringify({
    error: {
      code: 402,
      message: 'Your prepayment credits are depleted. Please go to AI Studio to manage billing.',
      status: 'RESOURCE_EXHAUSTED'
    }
  });
  const msg402 = formatApiErrorMessage(raw402, 402);
  assert.ok(!msg402.includes('{'), 'Should not expose raw JSON envelope');
  assert.ok(/credits are depleted/i.test(msg402));
  assert.ok(/Settings > Secrets/i.test(msg402));

  const msg429 = formatApiErrorMessage('{"error":{"code":429,"message":"Quota exceeded"}}', 429);
  assert.ok(/quota reached/i.test(msg429));

  const msg403 = formatApiErrorMessage('API_KEY_INVALID', 403);
  assert.ok(/missing or unauthorized/i.test(msg403));
});

test('Equal-power Lyria crossfade math preserves unity power and defaults paid AI loops to Off', () => {
  // While Lyria is disabled or warming up, live 24-telemetry synth stays at full 1.0 gain
  assert.deepEqual(computeEqualPowerMixGains(0.65, false), { synthGain: 1.0, lyriaGain: 0.0 });

  // Equal-power law: synth^2 + lyria^2 ~= 1.0 across all blend points
  for (const blend of [0, 0.25, 0.5, 0.75, 1]) {
    const { synthGain, lyriaGain } = computeEqualPowerMixGains(blend, true);
    const powerSum = synthGain * synthGain + lyriaGain * lyriaGain;
    assert.ok(Math.abs(powerSum - 1.0) < 0.01, `Expected equal power at blend=${blend}, got ${powerSum}`);
  }

  // Paid background AI loops default to Off so startup & Play Flow never throw 402 errors
  assert.equal(audioDspEngine.getAutoEvolveEnabled(), false);
  assert.equal(audioDspEngine.getLyriaFlowState().enabled, false);
});

test('buildLyriaTelemetryPayload encodes active 24-hour instrument, BPM, weather, and optional Pro cover art', () => {
  const latest = telemetryEngine.getLatestByDomain();
  const weather = telemetryEngine.getWeatherContext();
  const vector24 = computeDomainVector24(latest, weather);
  const plan = build32BarComposition(vector24, weather, { hourOfDayOverride: 21 });

  const clipPayload = buildLyriaTelemetryPayload('clip', plan, weather, {
    directorNote: 'Warmer kora resonance',
    evolutionIndex: 2,
    coverArtDataUrl: 'data:image/jpeg;base64,IGNORED_IN_CLIP'
  });
  assert.equal(clipPayload.mode, 'clip');
  assert.equal(clipPayload.activeHourLabel, '21:00');
  assert.equal(clipPayload.bpm, plan.bpm);
  assert.ok(clipPayload.activeDomainName.length > 0 && !clipPayload.activeDomainName.includes('undefined'));
  assert.ok(clipPayload.activeInstrument.length > 0);
  assert.ok(clipPayload.circadianPhase.length > 0);
  assert.ok(clipPayload.weatherSummary.includes(weather.region));
  assert.equal(clipPayload.coverArtDataUrl, null);
  assert.equal(clipPayload.evolutionIndex, 2);

  const proPayload = buildLyriaTelemetryPayload('pro', plan, weather, {
    coverArtDataUrl: 'data:image/jpeg;base64,TESTART'
  });
  assert.equal(proPayload.mode, 'pro');
  assert.equal(proPayload.coverArtDataUrl, 'data:image/jpeg;base64,TESTART');
});

