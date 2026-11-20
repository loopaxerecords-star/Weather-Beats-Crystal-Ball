/**
 * Weather Beats Universal Intelligence — Time-Series Local Extrema Detector
 * Identifies local minima and local maxima (including plateau handling) for
 * sparkline and telemetry trend visualization.
 */

export type ExtremumType = 'local_min' | 'local_max';

export interface DetectedExtremum {
  index: number;
  value: number;
  type: ExtremumType;
  isGlobal: boolean;
}

export interface ExtremaOptions {
  /** Minimum prominence relative to total series range (0..1). Defaults to 0.03. */
  minProminenceRatio?: number;
  /** When a series is strictly monotonic (no interior turning points), mark global endpoints. */
  includeGlobalEndpointsIfMonotonic?: boolean;
}

export function detectLocalExtrema(
  values: number[],
  options: ExtremaOptions = {}
): DetectedExtremum[] {
  const n = values.length;
  if (n < 2) return [];

  const {
    minProminenceRatio = 0.03,
    includeGlobalEndpointsIfMonotonic = true
  } = options;

  const globalMin = Math.min(...values);
  const globalMax = Math.max(...values);
  const totalRange = globalMax - globalMin;

  if (totalRange === 0) {
    return [];
  }

  const rawExtrema: DetectedExtremum[] = [];

  for (let i = 1; i < n - 1; i++) {
    const prev = values[i - 1];
    const curr = values[i];

    // Plateau runs are evaluated once at their start index
    if (curr === prev) continue;

    let j = i;
    while (j + 1 < n - 1 && values[j + 1] === curr) {
      j++;
    }

    if (j + 1 >= n) break;
    const next = values[j + 1];
    const repIndex = Math.floor((i + j) / 2);

    if (curr > prev && curr > next) {
      const prominence = Math.min(curr - prev, curr - next);
      if (curr === globalMax || prominence >= totalRange * minProminenceRatio) {
        rawExtrema.push({
          index: repIndex,
          value: curr,
          type: 'local_max',
          isGlobal: curr === globalMax
        });
      }
    } else if (curr < prev && curr < next) {
      const prominence = Math.min(prev - curr, next - curr);
      if (curr === globalMin || prominence >= totalRange * minProminenceRatio) {
        rawExtrema.push({
          index: repIndex,
          value: curr,
          type: 'local_min',
          isGlobal: curr === globalMin
        });
      }
    }

    i = j;
  }

  // Ensure global maximum and minimum are represented if series is monotonic or lacks one side
  if (includeGlobalEndpointsIfMonotonic) {
    const hasGlobalMax = rawExtrema.some((e) => e.type === 'local_max' && e.isGlobal);
    const hasGlobalMin = rawExtrema.some((e) => e.type === 'local_min' && e.isGlobal);

    if (!hasGlobalMax) {
      const maxIdx = values.indexOf(globalMax);
      if (maxIdx !== -1 && !rawExtrema.some((e) => e.index === maxIdx)) {
        rawExtrema.push({
          index: maxIdx,
          value: globalMax,
          type: 'local_max',
          isGlobal: true
        });
      }
    }

    if (!hasGlobalMin) {
      const minIdx = values.indexOf(globalMin);
      if (minIdx !== -1 && !rawExtrema.some((e) => e.index === minIdx)) {
        rawExtrema.push({
          index: minIdx,
          value: globalMin,
          type: 'local_min',
          isGlobal: true
        });
      }
    }
  }

  return rawExtrema.sort((a, b) => a.index - b.index);
}
