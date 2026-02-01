'use client';
import React from "react";

type Props = {
  x: number; y: number; w: number; h: number;
  values16: number[] | null;
  /** Kolor jak w Plotly: wypełnienie + obrys */
  fill?: string;   // domyślnie 'rgba(33,120,255,0.7)'
  stroke?: string; // domyślnie 'rgba(33,120,255,1)'
};

const HALF_WIDTH_DEG = 11.25; // barpolar: szerokość ~ 360/16 / 2 (półszerokość)
const DEG2RAD = Math.PI / 180;

export default function RoseSvg({
  x, y, w, h, values16,
  fill = "rgba(00,188,255,0.7)",
  stroke = "rgba(00,188,255,1)"
}: Props) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rMax = Math.max(0, Math.min(w, h) / 2 - 2);

  if (!values16 || values16.length !== 16) {
    // identycznie jak „pusty” widok – bez siatki, neutralny napis
    const fs = Math.max(10, rMax * 0.18);
    return (
      <g>
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fill="#9CA3AF">
          Brak danych
        </text>
      </g>
    );
  }

  // Skaluje do dostępnego promienia – Plotly skaluje w osi radialnej, my normalizujemy do max-a
  const maxVal = Math.max(1, ...values16.map(v => Number(v) || 0));

  // Klin (barpolar) – środkowy kąt = i*22.5°; start = środek - 11.25°, koniec = środek + 11.25°
  const wedges = values16.map((v, i) => {
    const frac = Math.max(0, Math.min(1, (Number(v) || 0) / maxVal));
    const R = frac * rMax;

    // Środek kierunku: 0° = N na górze → -90° w układzie SVG
    const centerDeg = i * 22.5 - 90;
    const startDeg = centerDeg - HALF_WIDTH_DEG;
    const endDeg   = centerDeg + HALF_WIDTH_DEG;

    const x1 = cx + R * Math.cos(startDeg * DEG2RAD);
    const y1 = cy + R * Math.sin(startDeg * DEG2RAD);
    const x2 = cx + R * Math.cos(endDeg   * DEG2RAD);
    const y2 = cy + R * Math.sin(endDeg   * DEG2RAD);

    // Klin od środka -> łuk z R -> z powrotem do środka (A = arc; large-arc-flag=0, sweep=1)
    const d = [
      `M ${cx} ${cy}`,
      `L ${x1} ${y1}`,
      `A ${R} ${R} 0 0 1 ${x2} ${y2}`,
      `Z`
    ].join(' ');

    // szerokość obrysu ~2 jak w Plotly
    const sw = 2;

    return <path key={i} d={d} fill={fill} stroke={stroke} strokeWidth={sw} />;
  });

  return <g>{wedges}</g>;
}
