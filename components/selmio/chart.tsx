"use client";
import { useState, useEffect, useRef } from "react";
import type { assessPurchase } from "@/lib/finance";
type Point = ReturnType<typeof assessPurchase>["timeline"][number];
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n / 100);
const day = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
export default function CashChart({
  points,
  bufferCents,
  scenario = false,
}: {
  points: Point[];
  bufferCents: number;
  scenario?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(800);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(280, Math.round(entries[0].contentRect.width))),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  if (!points.length)
    return (
      <div className="chart-empty">Add an account to see your cash ahead.</div>
    );
  const W = width,
    H = 235,
    L = 56,
    R = 20,
    T = 25,
    B = 32;
  const vals = points.flatMap((p) => [
    p.conservativeCents,
    p.favorableCents,
    p.baselineFavorableCents,
    p.dailyLowConservativeCents,
    p.dailyLowFavorableCents,
  ]);
  const lo = Math.min(0, ...vals, bufferCents) - 30000;
  const hi = Math.max(...vals, bufferCents, 100000) * 1.1;
  const x = (i: number) =>
    L + (i / Math.max(points.length - 1, 1)) * (W - L - R);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const line = (
    key: "conservativeCents" | "favorableCents" | "baselineConservativeCents",
  ) => points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p[key])}`).join(" ");
  const path = line("conservativeCents");
  const index = Math.min(
    active ?? Math.min(7, points.length - 1),
    points.length - 1,
  );
  const picked = points[index];
  const hasRange = points.some((p) => p.favorableCents !== p.conservativeCents);
  const hasIntradayLow = points.some(
    (p) => p.dailyLowConservativeCents < p.conservativeCents,
  );
  return (
    <div className="cash-chart" ref={container}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Projected end-of-day balance. Orange markers show lower intraday balances. The dotted horizontal line is the protected buffer. Use arrow keys to inspect dates."
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            setActive(
              Math.max(
                0,
                Math.min(
                  points.length - 1,
                  index + (e.key === "ArrowRight" ? 1 : -1),
                ),
              ),
            );
          }
        }}
        onMouseLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id="selmio-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c3d9aa" stopOpacity=".44" />
            <stop offset="100%" stopColor="#c3d9aa" stopOpacity=".02" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => {
          const value = lo + ((hi - lo) * i) / 3;
          return (
            <g key={i}>
              <line
                x1={L}
                x2={W - R}
                y1={y(value)}
                y2={y(value)}
                stroke="#e9ebe4"
                strokeWidth="1"
              />
              <text
                x={L - 12}
                y={y(value) + 4}
                textAnchor="end"
                fill="#8b9288"
                fontSize="12"
              >
                {money(value)}
              </text>
            </g>
          );
        })}
        <path
          d={`${path} L${x(points.length - 1)},${H - B} L${L},${H - B} Z`}
          fill="url(#selmio-chart-fill)"
        />
        {scenario && (
          <path
            d={line("baselineConservativeCents")}
            fill="none"
            stroke="#b3b9aa"
            strokeWidth="2"
            strokeDasharray="5 5"
          />
        )}
        <path
          d={line("favorableCents")}
          fill="none"
          stroke="#b7c59d"
          strokeWidth="2"
          strokeDasharray="4 5"
        />
        <line
          x1={L}
          x2={W - R}
          y1={y(bufferCents)}
          y2={y(bufferCents)}
          stroke="#bb997b"
          strokeWidth="1"
          strokeDasharray="3 5"
        />
        <path
          d={path}
          fill="none"
          stroke="#42674c"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
        {points.map((p, i) =>
          p.dailyLowConservativeCents < p.conservativeCents ? (
            <g key={`low-${p.date}`}>
              <line
                x1={x(i)}
                x2={x(i)}
                y1={y(p.conservativeCents)}
                y2={y(p.dailyLowConservativeCents)}
                stroke="#a67952"
                strokeWidth="1.4"
              />
              <circle
                cx={x(i)}
                cy={y(p.dailyLowConservativeCents)}
                r="3.5"
                fill="#fff"
                stroke="#a67952"
                strokeWidth="1.5"
              />
            </g>
          ) : null,
        )}
        {points.map((p, i) => (
          <rect
            key={p.date}
            x={x(i) - (W - L - R) / Math.max(points.length, 1) / 2}
            y={T}
            width={(W - L - R) / Math.max(points.length - 1, 1)}
            height={H - T - B}
            fill="transparent"
            onMouseEnter={() => setActive(i)}
            onClick={() => setActive(i)}
            aria-label={`${day(p.date)}: closing ${money(p.conservativeCents)}, intraday low ${money(p.dailyLowConservativeCents)}`}
          />
        ))}
        <line
          x1={x(index)}
          x2={x(index)}
          y1={T}
          y2={H - B}
          stroke="#779369"
          strokeDasharray="3 4"
          opacity=".5"
        />
        <circle
          cx={x(index)}
          cy={y(picked.conservativeCents)}
          r="5"
          fill="#42674c"
          stroke="#fff"
          strokeWidth="3"
        />
        {[
          0,
          Math.floor((points.length - 1) / 3),
          Math.floor(((points.length - 1) * 2) / 3),
          points.length - 1,
        ]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 7}
              textAnchor={
                i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"
              }
              fill="#92988e"
              fontSize="12"
            >
              {day(points[i].date)}
            </text>
          ))}
      </svg>
      <div className="chart-foot">
        <span>
          <i className="legend-dot" />
          Daily closing <i className="legend-line" />
          Protected buffer
          {hasRange && (
            <>
              <i className="legend-favorable" />
              More favorable
            </>
          )}
          {scenario && (
            <>
              <i className="legend-baseline" />
              Before purchase
            </>
          )}
          {hasIntradayLow && (
            <>
              <i className="legend-low" />
              Intraday low
            </>
          )}
        </span>
        <output>
          {day(picked.date)} <b>{money(picked.conservativeCents)}</b>
          {picked.dailyLowConservativeCents < picked.conservativeCents && (
            <small> · low {money(picked.dailyLowConservativeCents)}</small>
          )}
        </output>
      </div>
    </div>
  );
}
