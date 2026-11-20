import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, TrendingDown, TrendingUp } from 'lucide-react';
import { detectLocalExtrema } from '../services/metricExtrema';

export interface SparklinePoint {
  time: string;
  value: number;
  timestamp: number;
}

interface DomainSparklineProps {
  metricName: string;
  unit: string;
  colorHex: string;
  data: SparklinePoint[];
}

export const DomainSparkline: React.FC<DomainSparklineProps> = ({
  metricName,
  unit,
  colorHex,
  data
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const numericValues = useMemo(() => data.map((d) => d.value), [data]);

  const extrema = useMemo(
    () =>
      detectLocalExtrema(numericValues, {
        minProminenceRatio: 0.03,
        includeGlobalEndpointsIfMonotonic: true
      }),
    [numericValues]
  );

  const extremaByIndex = useMemo(() => {
    const map = new Map<number, (typeof extrema)[number]>();
    for (const ex of extrema) {
      map.set(ex.index, ex);
    }
    return map;
  }, [extrema]);

  const width = 228;
  const height = 52;
  const padX = 8;
  const padY = 10;

  const minVal = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const maxVal = numericValues.length > 0 ? Math.max(...numericValues) : 0;
  const range = maxVal - minVal || 1;

  const coords = useMemo(() => {
    return data.map((pt, idx) => {
      const x =
        padX + (idx / Math.max(1, data.length - 1)) * (width - padX * 2);
      const y =
        height - padY - ((pt.value - minVal) / range) * (height - padY * 2);
      return { x, y, ...pt, extremum: extremaByIndex.get(idx) };
    });
  }, [data, minVal, range, extremaByIndex]);

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const latest = data.length > 0 ? data[data.length - 1] : null;
  const previous = data.length > 1 ? data[data.length - 2] : null;
  const delta = latest && previous ? Number((latest.value - previous.value).toFixed(2)) : 0;

  const activePoint =
    hoveredIndex !== null && coords[hoveredIndex] ? coords[hoveredIndex] : null;

  const localMaxCount = extrema.filter((e) => e.type === 'local_max').length;
  const localMinCount = extrema.filter((e) => e.type === 'local_min').length;

  return (
    <div
      className="bg-[#121929] border border-slate-800 rounded-xl px-4 py-3 min-w-[270px] sm:w-[300px] shrink-0 space-y-2"
      aria-label={`Real-time trend sparkline for ${metricName}`}
    >
      {/* Top Row: Metric Name, Live/Hovered Value, Delta */}
      <div className="flex items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-slate-400 truncate" title={metricName}>
            {metricName}
          </span>
          {activePoint?.extremum && (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                activePoint.extremum.type === 'local_max'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/70'
                  : 'bg-amber-950/80 text-amber-300 border border-amber-700/70'
              }`}
            >
              {activePoint.extremum.type === 'local_max' ? 'LOCAL MAX' : 'LOCAL MIN'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 tabular-nums">
          <span className="text-white font-bold">
            {activePoint
              ? activePoint.value
              : latest
              ? latest.value
              : '--'}{' '}
            <span className="text-slate-400 font-normal">{unit}</span>
          </span>
          {data.length > 1 && !activePoint && (
            <span
              className={`flex items-center gap-0.5 font-semibold ${
                delta > 0
                  ? 'text-emerald-400'
                  : delta < 0
                  ? 'text-rose-400'
                  : 'text-slate-400'
              }`}
            >
              {delta > 0 ? (
                <TrendingUp className="w-3 h-3" />
              ) : delta < 0 ? (
                <TrendingDown className="w-3 h-3" />
              ) : null}
              {delta > 0 ? `+${delta}` : delta}
            </span>
          )}
        </div>
      </div>

      {/* Sparkline SVG with Local Minima & Maxima Visual Markers */}
      {data.length >= 2 ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[52px] overflow-visible cursor-crosshair"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          {/* Area Fill */}
          <polygon
            fill={`${colorHex}20`}
            points={`${padX},${height - padY} ${polylinePoints} ${width - padX},${height - padY}`}
          />

          {/* Trend Polyline */}
          <polyline
            fill="none"
            stroke={colorHex}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={polylinePoints}
          />

          {/* Local Minima & Maxima Markers */}
          {coords.map((pt, idx) => {
            if (!pt.extremum) return null;
            const isMax = pt.extremum.type === 'local_max';
            const fill = isMax ? '#10b981' : '#f59e0b';
            const markerRadius = pt.extremum.isGlobal ? 4 : 3;

            return (
              <g key={`ext-${idx}`} data-extremum={pt.extremum.type}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={markerRadius}
                  fill={fill}
                  stroke="#0b0f17"
                  strokeWidth="1.5"
                />
                {pt.extremum.isGlobal && (
                  <polygon
                    points={
                      isMax
                        ? `${pt.x},${pt.y - 9} ${pt.x - 3.5},${pt.y - 4.5} ${pt.x + 3.5},${pt.y - 4.5}`
                        : `${pt.x},${pt.y + 9} ${pt.x - 3.5},${pt.y + 4.5} ${pt.x + 3.5},${pt.y + 4.5}`
                    }
                    fill={fill}
                  />
                )}
              </g>
            );
          })}

          {/* Hovered Cursor Marker */}
          {activePoint && (
            <g>
              <line
                x1={activePoint.x}
                y1={2}
                x2={activePoint.x}
                y2={height - 2}
                stroke="#475569"
                strokeDasharray="2 2"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r={4}
                fill="#ffffff"
                stroke={colorHex}
                strokeWidth="2"
              />
            </g>
          )}

          {/* Transparent Hover Hit Targets */}
          {coords.map((pt, idx) => {
            const sliceWidth = (width - padX * 2) / Math.max(1, coords.length - 1);
            return (
              <rect
                key={`hit-${idx}`}
                x={Math.max(0, pt.x - sliceWidth / 2)}
                y={0}
                width={sliceWidth}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHoveredIndex(idx)}
              />
            );
          })}
        </svg>
      ) : (
        <div className="h-[52px] flex items-center justify-center text-xs font-mono text-slate-400 bg-[#0b0f17] rounded-lg border border-slate-800/80">
          Awaiting live telemetry samples...
        </div>
      )}

      {/* Bottom Extrema Summary Strip */}
      <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-400 pt-1 border-t border-slate-800/70">
        <span className="flex items-center gap-1 text-amber-300">
          <ArrowDown className="w-3 h-3" />
          <span>Min: {data.length > 0 ? minVal : '--'}</span>
          {localMinCount > 0 && (
            <span className="text-slate-500">({localMinCount})</span>
          )}
        </span>

        {activePoint ? (
          <span className="text-slate-300">{activePoint.time}</span>
        ) : (
          <span className="text-slate-500">{data.length} pts</span>
        )}

        <span className="flex items-center gap-1 text-emerald-300">
          <ArrowUp className="w-3 h-3" />
          <span>Max: {data.length > 0 ? maxVal : '--'}</span>
          {localMaxCount > 0 && (
            <span className="text-slate-500">({localMaxCount})</span>
          )}
        </span>
      </div>
    </div>
  );
};
