import assert from 'node:assert/strict';
import { UNIVERSAL_DOMAINS } from '../../../../src/services/domainRegistry';
import { telemetryEngine } from '../../../../src/services/telemetryEngine';
import {
  ALL_SYNTH_VOICES,
  TELEMETRY_BY_HOUR,
  TELEMETRY_CLUSTERS,
  build32BarComposition,
  buildEndlessCompositionSpan,
  computeDomainVector24,
  createDefaultVoiceMix,
  generateEndlessBar
} from '../../../../src/services/weatherBeatsComposer';
import {
  buildId3v23Tag,
  encodeMp3320,
  encodeWavPcm16,
  prependId3ToMp3
} from '../../../../src/services/audioExportEngine';
import { DomainCategory } from '../../../../src/types/telemetry';

console.log('Running Weather Beats 24-Telemetry 32-Bar DAW & Export Tests...');

// 1. Verify all 24 domains exist across TELEMETRY_CLUSTERS and TELEMETRY_BY_HOUR with zero omissions
const allDomainIds = Object.keys(UNIVERSAL_DOMAINS) as DomainCategory[];
assert.equal(allDomainIds.length, 24, 'Expected 24 registered intelligence domains');

const clusteredIds = TELEMETRY_CLUSTERS.flatMap((c) => c.domains);
assert.equal(clusteredIds.length, 24, 'Expected all 24 domains mapped across 7 telemetry clusters');
for (const d of allDomainIds) {
  assert.ok(clusteredIds.includes(d), `Domain ${d} missing from TELEMETRY_CLUSTERS`);
}
assert.equal(TELEMETRY_BY_HOUR.length, 24, 'Expected all 24 hours mapped to unique telemetry domains');

// 2. Verify 24-domain vector normalization & cluster lock override
const latest = telemetryEngine.getLatestByDomain();
const weatherCtx = telemetryEngine.getWeatherContext();
assert.equal(Object.keys(latest).length, 24, 'Expected telemetryEngine to seed all 24 domains');

const vec = computeDomainVector24(latest, weatherCtx);
for (const d of allDomainIds) {
  assert.ok(
    vec[d].normalized >= 0 && vec[d].normalized <= 1,
    `Normalized value for ${d} out of [0,1] bounds: ${vec[d].normalized}`
  );
}

const overriddenVec = computeDomainVector24(latest, weatherCtx, {
  space_solar: { locked: true, value: 0.92 }
});
assert.equal(overriddenVec.solar.normalized, 0.92, 'Cluster override should pin solar modulation');
assert.equal(overriddenVec.space.normalized, 0.92, 'Cluster override should pin space modulation');

// 3. Verify 32-bar continuous telemetry composition structure & circadian hours
const plan = build32BarComposition(vec, weatherCtx);
assert.equal(plan.bars.length, 32, 'Expected exactly 32 bars in dynamic arrangement');
assert.equal(plan.fxRack.length, 6, 'Expected 6-slot environmental FX rack');
assert.deepEqual(
  plan.fxRack.map((s) => s.id),
  ['reverb', 'delay', 'filter', 'distortion', 'compressor', 'modulation'],
  'Expected canonical 6 FX slots'
);
assert.ok(plan.chordProgressionSummary.length > 0, 'Expected non-empty chord progression summary');
assert.ok(plan.telemetrySignatureLabel.length > 0, 'Expected dynamic telemetry signature label');
assert.ok(plan.activeTelemetryHour.hourOfDay >= 0 && plan.activeTelemetryHour.hourOfDay <= 23);

const expectedTenVoices = ALL_SYNTH_VOICES.map((v) => v.id);
assert.equal(expectedTenVoices.length, 10, 'Expected 10 stereo studio voices including ambient whisper');
assert.ok(expectedTenVoices.includes('whisper'), 'Expected whisper voice in ALL_SYNTH_VOICES');

const defaultMix = createDefaultVoiceMix();
for (const voiceId of expectedTenVoices) {
  assert.ok(defaultMix[voiceId], `Missing default mix channel for ${voiceId}`);
  assert.ok(defaultMix[voiceId].gain > 0 && defaultMix[voiceId].gain <= 1.25);
  assert.ok(defaultMix[voiceId].pan >= -1 && defaultMix[voiceId].pan <= 1);
  assert.equal(defaultMix[voiceId].muted, false);
}

for (const hour of [0, 6, 12, 18]) {
  const hPlan = build32BarComposition(vec, weatherCtx, { hourOfDayOverride: hour });
  assert.equal(hPlan.activeTelemetryHour.hourOfDay, hour, `Expected active hour ${hour}`);
  assert.equal(hPlan.bars.length, 32, `Expected 32 bars for hour ${hour}`);
  for (const bar of hPlan.bars) {
    assert.ok(bar.chordSymbol.length > 0, `Missing chordSymbol in bar ${bar.barIndex + 1}`);
    assert.ok(bar.chordNotes.length >= 3, `Expected triad/7th chordNotes in bar ${bar.barIndex + 1}`);
  }
  const voicesSeen = new Set(hPlan.bars.flatMap((b) => b.events.map((e) => e.voice)));
  for (const v of expectedTenVoices) {
    assert.ok(voicesSeen.has(v), `Expected voice ${v} to be scheduled in 32-bar arrangement`);
  }
}

// 4. Verify 16-bit Stereo RIFF PCM WAV Encoder
const sampleRate = 48000;
const testFrames = 4800; // 100ms @ 48kHz
const left = new Float32Array(testFrames);
const right = new Float32Array(testFrames);
for (let i = 0; i < testFrames; i++) {
  const s = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
  left[i] = s;
  right[i] = s * 0.8;
}
const wavBytes = encodeWavPcm16(left, right, sampleRate);
assert.equal(wavBytes.length, 44 + testFrames * 4, 'WAV byte length mismatch');
assert.equal(String.fromCharCode(...wavBytes.slice(0, 4)), 'RIFF');
assert.equal(String.fromCharCode(...wavBytes.slice(8, 12)), 'WAVE');
assert.equal(String.fromCharCode(...wavBytes.slice(36, 40)), 'data');

// 5. Verify 320kbps MP3 Encoder & ID3v2.3 Binary Header
const mp3Bytes = encodeMp3320(left, right, sampleRate);
assert.ok(mp3Bytes.length > 500, 'Expected non-empty 320kbps MP3 stream');

const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const id3Tag = buildId3v23Tag(
  {
    title: 'Weather Beats 001',
    artist: 'Weather Beats Studio',
    album: 'Environmental Sessions',
    genre: 'Electronic',
    year: '2026',
    comment: '24-domain telemetry test'
  },
  fakeJpeg
);
assert.equal(String.fromCharCode(...id3Tag.slice(0, 3)), 'ID3');
assert.equal(id3Tag[3], 3, 'Expected ID3v2.3 major version byte');

const tagAscii = Buffer.from(id3Tag).toString('latin1');
for (const frameId of ['TIT2', 'TPE1', 'TALB', 'TCON', 'TYER', 'COMM', 'APIC']) {
  assert.ok(tagAscii.includes(frameId), `Expected ID3 frame ${frameId}`);
}

const fullMp3 = prependId3ToMp3(
  mp3Bytes,
  {
    title: 'Weather Beats 001',
    artist: 'Weather Beats Studio',
    album: 'Environmental Sessions',
    genre: 'Electronic',
    year: '2026',
    comment: '24-domain telemetry test'
  },
  fakeJpeg
);
assert.equal(fullMp3.length, id3Tag.length + mp3Bytes.length);

// 6. Verify Endless Flow bar synthesis beyond bar 32 (zero abrupt transitions or wraparounds)
const endlessBars = [32, 33, 60, 64, 128].map((idx) =>
  generateEndlessBar(idx, vec, weatherCtx)
);
for (const eBar of endlessBars) {
  assert.ok(eBar.barIndex >= 32, 'Endless bar index should preserve continuous count >= 32');
  assert.ok(
    eBar.section !== 'Intro' && eBar.section !== 'Outro',
    `Endless bar ${eBar.barIndex} should flow smoothly without dropping back to ${eBar.section}`
  );
  assert.ok(eBar.events.length > 0, `Endless bar ${eBar.barIndex} must contain musical events`);
}
assert.ok(
  endlessBars[0].events.some((e) => e.voice === 'whisper'),
  'Wave transition bar 32 (index 32) should weave an ambient seer whisper'
);

const longSpan = buildEndlessCompositionSpan(64, vec, weatherCtx);
assert.equal(longSpan.bars.length, 64, 'Expected 64-bar continuous export span');
assert.equal(longSpan.bars[63].barIndex, 63, 'Expected continuous indexing through bar 64');

telemetryEngine.stopStreaming();
console.log('ALL Weather Beats 24-Telemetry 32-Bar DAW & Export Tests PASSED!');
process.exit(0);
