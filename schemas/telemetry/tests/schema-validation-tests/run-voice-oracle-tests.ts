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

telemetryEngine.stopStreaming();
console.log('ALL Voice Telemetry Oracle & Celestial Crystal Ball Visuals Tests PASSED!');
process.exit(0);
