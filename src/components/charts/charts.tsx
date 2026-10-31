"use client";

/**
 * Inline-SVG charts. Single series each (the title names the series, so no
 * legend); 2px line with a 10% area wash; columns capped at 24px with a 4px
 * rounded data-end; hairline solid gridlines; text in ink tokens; hover layer
 * on every plotted mark. Each chart pairs with a table view at the call site.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

/** Container width in CSS pixels, so the SVG renders 1:1 and text keeps its true size. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}
const PAD = { t: 14, r: 16, b: 26, l: 36 };

function niceMax(v: number) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const monthLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
const monthYear = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

function useHover() {
  const [i, setI] = useState<number | null>(null);
  return { i, setI };
}

function Tooltip({ x, y, title, value, containerWidth }: { x: number; y: number; title: string; value: string; containerWidth: number }) {
  const left = Math.min(Math.max(x, 70), containerWidth - 70);
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-[var(--shadow-pop)]"
      style={{ left, top: y - 8 }}
      role="status"
    >
      <div className="text-muted">{title}</div>
      <div className="tabular font-semibold text-ink">{value}</div>
    </div>
  );
}

export function LineChart({ data, height = 200, valueLabel, ariaLabel }: { data: { x: string; y: number }[]; height?: number; valueLabel: string; ariaLabel: string }) {
  const { ref, w: W } = useWidth();
  const { i, setI } = useHover();
  const H = height;
  const max = niceMax(Math.max(1, ...data.map((d) => d.y)));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const xAt = (k: number) => PAD.l + (data.length <= 1 ? innerW / 2 : (k / (data.length - 1)) * innerW);
  const yAt = (v: number) => PAD.t + innerH - (v / max) * innerH;
  const path = data.map((d, k) => `${k ? "L" : "M"}${xAt(k).toFixed(1)},${yAt(d.y).toFixed(1)}`).join(" ");
  const area = `${path} L${xAt(data.length - 1)},${PAD.t + innerH} L${xAt(0)},${PAD.t + innerH} Z`;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const last = data[data.length - 1];

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    const k = Math.round(((sx - PAD.l) / innerW) * (data.length - 1));
    setI(Math.max(0, Math.min(data.length - 1, k)));
  };
  const scale = 1;

  return (
    <div ref={ref} className="relative min-w-0 overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yAt(t)} y2={yAt(t)} stroke="var(--color-viz-grid)" strokeWidth={1} />
            <text x={PAD.l - 8} y={yAt(t) + 3.5} textAnchor="end" className="tabular fill-muted text-[10.5px]">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {data.map((d, k) =>
          k % 3 === (data.length - 1) % 3 ? (
            <text key={d.x} x={xAt(k)} y={H - 8} textAnchor="middle" className="fill-muted text-[10.5px]">
              {monthLabel(d.x)}
            </text>
          ) : null,
        )}
        <path d={area} fill="var(--color-viz)" opacity={0.1} />
        <path d={path} fill="none" stroke="var(--color-viz)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last && (
          <>
            <circle cx={xAt(data.length - 1)} cy={yAt(last.y)} r={4.5} fill="var(--color-viz)" stroke="var(--color-surface)" strokeWidth={2} />
            <text x={xAt(data.length - 1) - 8} y={yAt(last.y) - 9} textAnchor="end" className="tabular fill-ink text-[11px] font-semibold">
              {last.y}
            </text>
          </>
        )}
        {i !== null && (
          <>
            <line x1={xAt(i)} x2={xAt(i)} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--color-line-strong)" strokeWidth={1} />
            <circle cx={xAt(i)} cy={yAt(data[i].y)} r={4.5} fill="var(--color-viz)" stroke="var(--color-surface)" strokeWidth={2} />
          </>
        )}
        <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setI(null)} />
      </svg>
      {i !== null && <Tooltip x={xAt(i) * scale} y={yAt(data[i].y) * scale} title={monthYear(data[i].x)} value={`${data[i].y} ${valueLabel}`} containerWidth={W} />}
    </div>
  );
}

/** `x` is an ISO month-end date, or a year when `xKind` is "year". */
export function ColumnChart({
  data,
  height = 150,
  valueLabel,
  ariaLabel,
  xKind = "month",
}: {
  data: { x: string; y: number }[];
  height?: number;
  valueLabel: string;
  ariaLabel: string;
  xKind?: "month" | "year";
}) {
  const { ref, w: W } = useWidth();
  const { i, setI } = useHover();
  const H = height;
  const max = niceMax(Math.max(1, ...data.map((d) => d.y)));
  const pad = { ...PAD, l: xKind === "year" ? 44 : PAD.l };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const band = innerW / Math.max(1, data.length);
  const bw = Math.min(24, band * 0.6);
  // Years: keep labels at least ~44px apart, anchored on the latest year.
  const every = xKind === "year" ? Math.max(1, Math.ceil(44 / band)) : 3;
  const xLabel = (x: string) => (xKind === "year" ? x : monthLabel(x));
  const xTitle = (x: string) => (xKind === "year" ? `Issued in ${x}` : monthYear(x));
  const yAt = (v: number) => pad.t + innerH - (v / max) * innerH;
  const scale = 1;
  const ticks = useMemo(() => [0, max / 2, max], [max]);
  return (
    <div ref={ref} className="relative min-w-0 overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={yAt(t)} y2={yAt(t)} stroke="var(--color-viz-grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={yAt(t) + 3.5} textAnchor="end" className="tabular fill-muted text-[10.5px]">
              {Number.isInteger(t) ? t.toLocaleString("en-US") : t.toFixed(1)}
            </text>
          </g>
        ))}
        {data.map((d, k) => {
          const cx = pad.l + band * k + band / 2;
          const top = yAt(d.y);
          const base = pad.t + innerH;
          const h = base - top;
          const r = Math.min(4, h);
          const x0 = cx - bw / 2;
          const p = h > 0 ? `M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${base} Z` : "";
          return (
            <g key={d.x} onMouseEnter={() => setI(k)} onMouseLeave={() => setI(null)}>
              <rect x={cx - band / 2} y={pad.t} width={band} height={innerH} fill="transparent" />
              {p && <path d={p} fill="var(--color-viz)" opacity={i === null || i === k ? 1 : 0.55} />}
              {k % every === (data.length - 1) % every && (
                <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted text-[10.5px]">
                  {xLabel(d.x)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {i !== null && (
        <Tooltip x={(pad.l + band * i + band / 2) * scale} y={yAt(data[i].y) * scale} title={xTitle(data[i].x)} value={`${data[i].y.toLocaleString("en-US")} ${valueLabel}`} containerWidth={W} />
      )}
    </div>
  );
}

/**
 * Horizontal bars as an accessible list. Rows with an `href` drill into the
 * underlying cases; `display` overrides the formatted value (e.g. a percentage).
 */
export function BarList({ rows, max }: { rows: { label: string; value: number; href?: string; hint?: string; display?: string }[]; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  // Narrow screens put the label above its bar so the bar keeps a readable length.
  const row = "group grid grid-cols-[minmax(0,1fr)_52px] items-center gap-x-3 gap-y-1 rounded-md px-1.5 py-1 sm:grid-cols-[minmax(150px,220px)_1fr_52px]";
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const value = r.display ?? r.value.toLocaleString("en-US");
        const inner = (
          <>
            <span className="col-span-2 truncate text-[12.5px] text-ink-2 group-hover:text-ink sm:col-span-1">{r.label}</span>
            <span className="relative h-3.5">
              <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-viz transition-opacity group-hover:opacity-85" style={{ width: `${r.value === 0 ? 0 : Math.max(1.5, (r.value / m) * 100)}%` }} />
            </span>
            <span className="tabular text-right text-[12.5px] font-medium text-ink">{value}</span>
          </>
        );
        return (
          <li key={r.label}>
            {r.href ? (
              <Link href={r.href} title={r.hint ?? `${value} — view cases`} className={`${row} hover:bg-subtle`}>
                {inner}
              </Link>
            ) : (
              <div title={r.hint ?? `${r.label}: ${value}`} className={row}>
                {inner}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
