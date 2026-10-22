"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { MetricSeries } from "@/lib/goals/progress";

const HEIGHT = 200;
const PAD = { top: 16, right: 56, bottom: 28, left: 44 };

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function format(value: number): string {
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}K`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Clean axis ticks: 0, 25, 50... chosen so there are about four. */
function niceTicks(min: number, max: number): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? raw;
  const first = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max + step / 2; value += step) ticks.push(Math.round(value * 1000) / 1000);
  return ticks;
}

/** The value the target line has on a day number, between its two ends. */
function targetAt(line: NonNullable<MetricSeries["targetLine"]>, day: number): number {
  const a = dayNumber(line.from.date);
  const b = dayNumber(line.to.date);
  return line.from.value + ((line.to.value - line.from.value) * (day - a)) / (b - a);
}

/**
 * A metric's logged values against the target pace: a 2px line with an end
 * label, a dashed reference line from baseline to target, a crosshair
 * tooltip on hover or focus, and the same numbers in a table below.
 * Colours were checked with the dataviz palette validator in both themes:
 * indigo 600 / slate 500 on white, indigo 500 / slate 600 (light navy) on the
 * dark card. The grey target line is a reference, told apart by its dashes too.
 */
export function MetricChart({ name, unit, series }: { name: string; unit: string | null; series: MetricSeries }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { logged, targetLine } = series;
  const x0 = dayNumber(series.start);
  const x1 = Math.max(dayNumber(series.end), x0 + 1);
  const values = [...logged.map((point) => point.value), ...(targetLine ? [targetLine.from.value, targetLine.to.value] : [])];
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const y0 = ticks[0];
  const y1 = ticks.at(-1)! === y0 ? y0 + 1 : ticks.at(-1)!;
  const plotWidth = Math.max(10, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (date: string) => PAD.left + ((dayNumber(date) - x0) / (x1 - x0)) * plotWidth;
  const y = (value: number) => PAD.top + (1 - (value - y0) / (y1 - y0)) * plotHeight;
  const path = logged.map((point, index) => `${index ? "L" : "M"}${x(point.date).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const last = logged.at(-1)!;
  const point = active === null ? null : logged[active];
  const suffix = unit ? ` ${unit}` : "";

  function pick(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left + PAD.left;
    let best = 0;
    logged.forEach((item, index) => { if (Math.abs(x(item.date) - pointerX) < Math.abs(x(logged[best].date) - pointerX)) best = index; });
    setActive(best);
  }

  return (
    <figure className="mt-3">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5"><svg width="16" height="4" aria-hidden="true"><line x1="0" y1="2" x2="16" y2="2" className="stroke-indigo-600 dark:stroke-indigo-500" strokeWidth="2" strokeLinecap="round" /></svg>Logged</span>
        {targetLine && <span className="inline-flex items-center gap-1.5"><svg width="16" height="4" aria-hidden="true"><line x1="0" y1="2" x2="16" y2="2" className="stroke-slate-500 dark:stroke-slate-600" strokeWidth="2" strokeDasharray="4 3" /></svg>Target pace</span>}
      </figcaption>
      <div ref={box} className="relative mt-1 w-full" style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={`${name}: ${format(last.value)}${suffix} on ${shortDate(last.date)}. The table below lists every value.`}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={PAD.left + plotWidth} y1={y(tick)} y2={y(tick)} className="stroke-slate-200" strokeWidth="1" />
                <text x={PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[11px]">{format(tick)}</text>
              </g>
            ))}
            <text x={PAD.left} y={HEIGHT - 8} className="fill-slate-500 text-[11px]">{shortDate(series.start)}</text>
            <text x={PAD.left + plotWidth} y={HEIGHT - 8} textAnchor="end" className="fill-slate-500 text-[11px]">{shortDate(series.end)}</text>
            {targetLine && (
              <line x1={x(targetLine.from.date)} y1={y(targetLine.from.value)} x2={x(targetLine.to.date)} y2={y(targetLine.to.value)}
                className="stroke-slate-500 dark:stroke-slate-600" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
            )}
            <path d={path} fill="none" className="stroke-indigo-600 dark:stroke-indigo-500" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(last.date)} cy={y(last.value)} r="4" className="fill-indigo-600 stroke-white dark:fill-indigo-500" strokeWidth="2" />
            <text x={x(last.date) + 8} y={y(last.value)} dy="0.32em" className="fill-slate-900 text-xs font-semibold">{format(last.value)}</text>
            {point && (
              <g aria-hidden="true">
                <line x1={x(point.date)} x2={x(point.date)} y1={PAD.top} y2={PAD.top + plotHeight} className="stroke-slate-400" strokeWidth="1" />
                <circle cx={x(point.date)} cy={y(point.value)} r="5" className="fill-indigo-600 stroke-white dark:fill-indigo-500" strokeWidth="2" />
              </g>
            )}
            <rect x={PAD.left} y={PAD.top} width={plotWidth} height={plotHeight} fill="transparent" tabIndex={0}
              aria-label={`Explore ${name} values with the arrow keys`}
              onPointerMove={pick} onPointerLeave={() => setActive(null)} onBlur={() => setActive(null)}
              onFocus={() => setActive(logged.length - 1)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") setActive((index) => Math.max(0, (index ?? logged.length) - 1));
                if (event.key === "ArrowRight") setActive((index) => Math.min(logged.length - 1, (index ?? -1) + 1));
              }}
              className="cursor-crosshair outline-none focus-visible:stroke-indigo-400" />
          </svg>
        )}
        {point && width > 0 && (
          <div role="status" className="pointer-events-none absolute top-0 z-10 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm"
            style={{ left: Math.min(Math.max(0, x(point.date) - 70), width - 150), width: 150 }}>
            <p className="text-slate-500">{shortDate(point.date)}</p>
            <p><span className="font-semibold text-slate-900">{format(point.value)}{suffix}</span> <span className="text-slate-500">logged</span></p>
            {targetLine && point.date >= targetLine.from.date && point.date <= targetLine.to.date && (
              <p><span className="font-semibold text-slate-900">{format(targetAt(targetLine, dayNumber(point.date)))}{suffix}</span> <span className="text-slate-500">target pace</span></p>
            )}
          </div>
        )}
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">Show as table</summary>
        <table className="mt-2 w-full max-w-sm text-left text-xs">
          <thead><tr className="text-slate-500"><th scope="col" className="py-1 font-medium">Date</th><th scope="col" className="py-1 text-right font-medium">Logged</th>{targetLine && <th scope="col" className="py-1 text-right font-medium">Target pace</th>}</tr></thead>
          <tbody>
            {logged.map((item) => (
              <tr key={item.date} className="border-t border-slate-100 text-slate-800">
                <td className="py-1">{shortDate(item.date)}</td>
                <td className="py-1 text-right tabular-nums">{format(item.value)}{suffix}</td>
                {targetLine && <td className="py-1 text-right tabular-nums">{item.date >= targetLine.from.date && item.date <= targetLine.to.date ? `${format(targetAt(targetLine, dayNumber(item.date)))}${suffix}` : "–"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
