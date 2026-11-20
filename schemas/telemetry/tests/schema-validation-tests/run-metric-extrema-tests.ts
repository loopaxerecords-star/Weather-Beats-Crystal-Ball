/**
 * Weather Beats Universal Intelligence — Metric Extrema Detection Tests
 * Verifies local minima & maxima detection across waves, plateaus, monotonic trends,
 * and noise prominence filtering.
 */

import assert from 'node:assert/strict';
import { detectLocalExtrema } from '../../../../src/services/metricExtrema';

// 1. Empty / single-point / flat series produce zero extrema
assert.deepEqual(detectLocalExtrema([]), []);
assert.deepEqual(detectLocalExtrema([42]), []);
assert.deepEqual(detectLocalExtrema([10, 10, 10, 10]), []);

// 2. Multi-peak sinusoidal-like wave detects interior local maxima and local minima
const wave = [10, 15, 22, 17, 12, 18, 25, 19, 14];
const waveExtrema = detectLocalExtrema(wave);
assert.deepEqual(
  waveExtrema.map((e) => ({ index: e.index, type: e.type, value: e.value, isGlobal: e.isGlobal })),
  [
    { index: 0, type: 'local_min', value: 10, isGlobal: true },
    { index: 2, type: 'local_max', value: 22, isGlobal: false },
    { index: 4, type: 'local_min', value: 12, isGlobal: false },
    { index: 6, type: 'local_max', value: 25, isGlobal: true }
  ]
);

// 3. Plateau peak & trough select a single midpoint marker (no duplicate adjacent markers)
const plateau = [5, 12, 12, 12, 6, 3, 3, 9];
const plateauExtrema = detectLocalExtrema(plateau);
assert.ok(
  plateauExtrema.some((e) => e.index === 2 && e.type === 'local_max' && e.value === 12 && e.isGlobal)
);
assert.ok(
  plateauExtrema.some((e) => e.index === 5 && e.type === 'local_min' && e.value === 3 && e.isGlobal)
);

// 4. Strictly monotonic series marks global endpoints when enabled
const rising = [1, 2, 3, 4, 5];
const risingExtrema = detectLocalExtrema(rising, { includeGlobalEndpointsIfMonotonic: true });
assert.deepEqual(
  risingExtrema.map((e) => ({ index: e.index, type: e.type, value: e.value, isGlobal: e.isGlobal })),
  [
    { index: 0, type: 'local_min', value: 1, isGlobal: true },
    { index: 4, type: 'local_max', value: 5, isGlobal: true }
  ]
);

// 5. Micro-jitter below prominence threshold is filtered while global peak/trough remain
const noisy = [0, 10, 9.9, 10.1, 20, 19.95, 20.05, 5];
const filtered = detectLocalExtrema(noisy, { minProminenceRatio: 0.05 });
assert.equal(filtered.filter((e) => e.type === 'local_max').length, 1);
assert.equal(filtered.find((e) => e.type === 'local_max')?.value, 20.05);

console.log('Metric Extrema Detection Tests: waves, plateaus, monotonic trends & prominence filtering PASSED.');
