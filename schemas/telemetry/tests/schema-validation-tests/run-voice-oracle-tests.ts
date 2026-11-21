import assert from 'node:assert/strict';
import { UNIVERSAL_DOMAINS } from '../../../../src/services/domainRegistry';
import { telemetryEngine } from '../../../../src/services/telemetryEngine';
import { computeDomainVector24 } from '../../../../src/services/weatherBeatsComposer';
import {
  buildCompactTelemetrySummary,
  normalizeMatchedDomain,
  parseTelemetryQuestionLocally
} from '../../../../src/services/voiceTelemetryOracle';
import { updateArcSegmentsBuffer } from '../../../../src/services/crystalBallVisuals';
import { computeSeerAnimationPose } from '../../../../src/services/fortuneTellerRig';
import {
  BACKDROP_NODE_COUNT,
  TELEMETRY_ANOMALY_DEVIATION_THRESHOLD,
  computeTelemetryArcNodes
} from '../../../../src/services/celestialBackdropUi';
import {
  WHISPER_TRANSITION_BARS,
  composeCrypticTelemetryWhisper,
  computeWhisperSyllableEnvelope
} from '../../../../src/services/seerWhisperComposer';
import { computeAudioVisualSync } from '../../../../src/hooks/useMicAudioVisualizer';
import { DomainCategory } from '../../../../src/types/telemetry';

console.log('Running Voice Telemetry Oracle & Celestial Crystal Ball Visuals Tests...');

// 1. Domain matching normalization
assert.equal(normalizeMatchedDomain('solar'), 'solar');
assert.equal(normalizeMatchedDomain(' Smart-Building '), 'smart_building');
assert.equal(normalizeMatchedDomain('SOCIAL INFORMATION'), 'social_information');
assert.equal(normalizeMatchedDomain('all'), 'all');
assert.equal(normalizeMatchedDomain('unknown_domain_xyz'), 'all');
assert.equal(normalizeMatchedDomain(undefined), 'all');

// 2. Compact 24-domain telemetry summary completeness
const latest = telemetryEngine.getLatestByDomain();
const weatherCtx = telemetryEngine.getWeatherContext();
const vec = computeDomainVector24(latest, weatherCtx);
const summary = buildCompactTelemetrySummary(vec, weatherCtx);

for (const domainId of Object.keys(UNIVERSAL_DOMAINS) as DomainCategory[]) {
  assert.ok(summary.includes(domainId), `Summary missing domain id: ${domainId}`);
}
assert.ok(summary.includes(weatherCtx.region), 'Summary should include weather region');

// 3. Deterministic local telemetry intent parser
const solarRes = parseTelemetryQuestionLocally('How strong is solar irradiance today?', vec, weatherCtx);
assert.equal(solarRes.matchedDomain, 'solar');
assert.equal(solarRes.source, 'local_telemetry_lookup');
assert.ok(solarRes.citedMetrics.length >= 1);

const secRes = parseTelemetryQuestionLocally('Any security firewall threat alerts?', vec, weatherCtx);
assert.equal(secRes.matchedDomain, 'security');

const musicRes = parseTelemetryQuestionLocally('What BPM tempo and kora scale are playing?', vec, weatherCtx);
assert.equal(musicRes.matchedDomain, 'musical');

const weatherRes = parseTelemetryQuestionLocally('What is the wind speed and temperature?', vec, weatherCtx);
assert.equal(weatherRes.matchedDomain, 'weather');

const overviewRes = parseTelemetryQuestionLocally('Give me a general summary', vec, weatherCtx, 'offline');
assert.equal(overviewRes.matchedDomain, 'all');
assert.equal(overviewRes.apiError, 'offline');

// 4. Verify telemetryEngine seeds all sampleMeasurementIds across all 24 domains
const buffered = telemetryEngine.getBufferedEvents();
const seenByDomain = new Map<DomainCategory, Set<string>>();
for (const evt of buffered) {
  if (!seenByDomain.has(evt.domain)) {
    seenByDomain.set(evt.domain, new Set());
  }
  seenByDomain.get(evt.domain)!.add(evt.measurement.measurement_id);
}

for (const domainId of Object.keys(UNIVERSAL_DOMAINS) as DomainCategory[]) {
  const expectedIds = UNIVERSAL_DOMAINS[domainId].sampleMeasurementIds;
  const actualSet = seenByDomain.get(domainId);
  assert.ok(actualSet, `Expected buffered events for domain ${domainId}`);
  for (const measId of expectedIds) {
    assert.ok(
      actualSet.has(measId),
      `Expected secondary metric ${measId} to be seeded for domain ${domainId}`
    );
  }
}

// 5. Verify zero-GC lightning arc generator fills bounded finite coordinates
const arcCount = 6;
const segmentsPerArc = 12;
const arcBuf = new Float32Array(arcCount * segmentsPerArc * 6);
updateArcSegmentsBuffer(arcBuf, arcCount, segmentsPerArc, 1.25, 0.8, 1.15);
let nonZeroCount = 0;
for (let i = 0; i < arcBuf.length; i++) {
  assert.ok(Number.isFinite(arcBuf[i]), `Arc vertex at index ${i} must be finite`);
  assert.ok(Math.abs(arcBuf[i]) < 2.5, `Arc vertex at index ${i} out of orb bounds: ${arcBuf[i]}`);
  if (Math.abs(arcBuf[i]) > 0.001) nonZeroCount++;
}
assert.ok(nonZeroCount > 100, 'Expected populated crackling arc vertices');

// 6. Verify live microphone spectral-to-visual sync mapper for nebula core & floating runes
const hexRe = /^#[0-9a-f]{6}$/;
const silenceSync = computeAudioVisualSync(0, 0, 0, 0, 0);
assert.equal(silenceSync.intensity, 0);
assert.equal(silenceSync.runeOpacityBoost, 0);
assert.equal(silenceSync.runeScaleBoost, 0);

const bassSync = computeAudioVisualSync(0.92, 0.08, 0.05, 0.72, 0.85);
const midSync = computeAudioVisualSync(0.08, 0.9, 0.1, 0.65, 0.78);
const trebleSync = computeAudioVisualSync(0.05, 0.1, 0.95, 0.75, 0.9);

for (const profile of [silenceSync, bassSync, midSync, trebleSync]) {
  assert.ok(profile.intensity >= 0 && profile.intensity <= 1);
  assert.ok(profile.swirlBoost >= 0 && profile.swirlBoost <= 1.4);
  assert.ok(profile.runeOpacityBoost >= 0 && profile.runeOpacityBoost <= 0.45);
  assert.ok(profile.runeScaleBoost >= 0 && profile.runeScaleBoost <= 0.15);
  assert.match(profile.nebulaPrimaryHex, hexRe);
  assert.match(profile.nebulaSecondaryHex, hexRe);
  assert.match(profile.nebulaAccentHex, hexRe);
  assert.match(profile.runeOuterHex, hexRe);
  assert.match(profile.runeInnerHex, hexRe);
}

assert.ok(bassSync.intensity > 0.6, 'Bass peak should produce strong nebula intensity');
assert.notEqual(
  bassSync.nebulaPrimaryHex,
  trebleSync.nebulaPrimaryHex,
  'Bass and treble spectra must produce distinct nebula core colors'
);
assert.notEqual(
  bassSync.runeOuterHex,
  trebleSync.runeOuterHex,
  'Bass and treble spectra must produce distinct outer floating rune colors'
);
assert.notEqual(
  midSync.runeInnerHex,
  trebleSync.runeInnerHex,
  'Mid and treble spectra must produce distinct inner floating rune colors'
);

// 7. Verify Hooded Celestial Seer animation pose kinematics, gaze clamps, speaking glow & candle flicker
const idlePose = computeSeerAnimationPose(1.5, 0.2, 0.0, 0.0, 0.0, 0.0);
const speakingPose = computeSeerAnimationPose(1.5, 0.75, 0.9, 0.65, 2.5, -2.5);

for (const pose of [idlePose, speakingPose]) {
  assert.ok(Number.isFinite(pose.breathOffset));
  assert.ok(pose.headYaw >= -0.32 && pose.headYaw <= 0.32, `headYaw out of clamp: ${pose.headYaw}`);
  assert.ok(pose.headPitch >= -0.22 && pose.headPitch <= 0.28, `headPitch out of clamp: ${pose.headPitch}`);
  assert.ok(Number.isFinite(pose.leftHandX) && Number.isFinite(pose.leftHandY) && Number.isFinite(pose.leftHandZ));
  assert.ok(Number.isFinite(pose.rightHandX) && Number.isFinite(pose.rightHandY) && Number.isFinite(pose.rightHandZ));
  assert.ok(pose.leftHandX < 0 && pose.rightHandX > 0, 'Hovering hands should frame the crystal ball symmetrically');
  assert.ok(pose.candleFlickerA > 0.5 && pose.candleFlickerB > 0.5, 'Candle flicker must remain positive');
}

assert.ok(
  speakingPose.speakingGlowIntensity > idlePose.speakingGlowIntensity + 1.5,
  'Speaking & mic input must strongly amplify seer speaking glow'
);
assert.ok(
  speakingPose.eyeEmissiveIntensity > idlePose.eyeEmissiveIntensity + 1.2,
  'Speaking & mic input must strongly amplify seer eye luminescence'
);
assert.ok(
  speakingPose.leftHandX > idlePose.leftHandX && speakingPose.rightHandX < idlePose.rightHandX,
  'Active speaking/channeling should draw the seer hands slightly closer around the crystal ball'
);

// 8. Verify cryptic telemetry whisper composer & zero-GC syllabic envelope
assert.deepEqual([...WHISPER_TRANSITION_BARS], [0, 4, 12, 20, 26, 30]);
const sectionsToTest = ['Intro', 'Groove', 'Poly-Build', 'Climax', 'Breakdown', 'Outro'] as const;
let prevWhisper = '';
for (let i = 0; i < sectionsToTest.length; i++) {
  const barNum = WHISPER_TRANSITION_BARS[i] + 1;
  const evt = composeCrypticTelemetryWhisper(
    vec,
    weatherCtx,
    sectionsToTest[i],
    barNum,
    'all',
    prevWhisper
  );
  assert.ok(evt.text.length >= 16, `Whisper text too short for ${sectionsToTest[i]}: ${evt.text}`);
  assert.notEqual(evt.text, prevWhisper, 'Consecutive ambient whispers must not repeat');
  assert.ok(evt.durationMs >= 3600 && evt.durationMs <= 6200);
  prevWhisper = evt.text;
}

const focusedSolarWhisper = composeCrypticTelemetryWhisper(
  vec,
  weatherCtx,
  'Intro',
  1,
  'solar'
);
assert.equal(focusedSolarWhisper.domainId, 'solar', 'Focused domain lens should guide whisper omen');

const nonRepeatCheck = composeCrypticTelemetryWhisper(
  vec,
  weatherCtx,
  'Intro',
  1,
  'solar',
  focusedSolarWhisper.text
);
assert.notEqual(
  nonRepeatCheck.text,
  focusedSolarWhisper.text,
  'Passing previousText must rotate to a distinct cryptic whisper'
);

assert.equal(computeWhisperSyllableEnvelope(900, 1000, 4000), 0, 'Envelope before start must be 0');
assert.equal(computeWhisperSyllableEnvelope(5500, 1000, 4000), 0, 'Envelope after end must be 0');
const midEnv = computeWhisperSyllableEnvelope(2800, 1000, 4000);
assert.ok(midEnv > 0.15 && midEnv <= 1, `Expected active mid-whisper envelope in (0.15, 1], got ${midEnv}`);

// 9. Verify behind-the-orb 24-domain celestial telemetry arch layout & anomaly detection
const testNorms = new Array(BACKDROP_NODE_COUNT).fill(0.5);
testNorms[2] = 0.5 + TELEMETRY_ANOMALY_DEVIATION_THRESHOLD + 0.12; // high anomaly
testNorms[19] = 0.5 - TELEMETRY_ANOMALY_DEVIATION_THRESHOLD - 0.1; // low anomaly
const arcNodes = computeTelemetryArcNodes(testNorms, 5, 12);
assert.equal(arcNodes.length, 24, 'Expected 24 celestial telemetry arch nodes');
assert.equal(arcNodes[2].isAnomaly, true, 'High deviation node must be flagged as anomaly');
assert.equal(arcNodes[19].isAnomaly, true, 'Low deviation node must be flagged as anomaly');
assert.equal(arcNodes[0].isAnomaly, false, 'Baseline 0.5 node must not be flagged as anomaly');
assert.ok(arcNodes[12].isHighlighted, 'Hovered node should be highlighted');
assert.ok(arcNodes[12].nodeScale > arcNodes[0].nodeScale, 'Hovered node should scale larger');
for (const node of arcNodes) {
  assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z));
  assert.ok(node.barLength > 0, 'Gauge bar length must be positive');
}

telemetryEngine.stopStreaming();
console.log('ALL Voice Telemetry Oracle & Celestial Crystal Ball Visuals Tests PASSED!');
process.exit(0);
