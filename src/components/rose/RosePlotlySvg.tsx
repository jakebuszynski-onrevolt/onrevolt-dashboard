'use client';
import React from "react";

const DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const DEG = Math.PI / 180;

type Props = {
  x: number; y: number; w: number; h: number;
  values16: number[] | null;
  stroke?: string;        // kolor wykresu
  gridStroke?: string;    // kolor siatki
  labelColor?: string;    // kolor etykiet
  strokewidth: number | 3;
};

export default function RosePlotlySvg({
  x, y, w, h, values16,
  stroke = "#59b9fd",          // niebieski jak na screenie
  gridStroke = "#E6ECF6",      // jasna siatka
  labelColor = "#9FB2CC",       // blade etykiety
  strokewidth = 4
}: Props) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rMax = Math.max(0, Math.min(w, h) / 2 - 6); // mały padding
  const sw = 1*strokewidth;
  // brak danych → pusta siatka + etykiety (jak Plotly)
  const vals = (values16 && values16.length === 16) ? values16 : new Array(16).fill(0);
  const maxVal = Math.max(1, ...vals.map(v => Number(v) || 0));

  // --- siatka: 5 okręgów + promienie co 22.5° ---
  const rings = [0.5,0.75, 1].map((f, i) => (
    <circle key={`rg${i}`} cx={cx} cy={cy} r={f * rMax} fill="none" stroke={gridStroke} strokeWidth={sw}/>
  ));
  const spokes = Array.from({ length: 16 }, (_, i) => {
    const a = (i * 22.5 - 90) * DEG;
    const x2 = cx + rMax*1.05 * Math.cos(a);
    const y2 = cy + rMax*1.05 * Math.sin(a);
    return <line key={`sp${i}`} x1={cx} y1={cy} x2={x2} y2={y2} stroke={gridStroke} strokeWidth={sw}/>;
  });

  // --- etykiety DIRS na zewnątrz okręgu ---
  const labelR = rMax + 15;
  const labels = DIRS.map((d, i) => {
    const a = (i * 22.5 - 90) * DEG;
    const lx = cx + labelR * Math.cos(a);
    const ly = cy + labelR * Math.sin(a);
    // text-anchor:
    const ax = Math.cos(a);
    const anchor = Math.abs(ax) < 0.3 ? "middle" : (ax > 0 ? "start" : "end");
    return (
      <text
        key={`lb${i}`}
        x={lx}
        y={ly}
        fontSize={Math.max(10, rMax * 0.11)}
        fill={labelColor}
        textAnchor={anchor as any}
        dominantBaseline="middle"
      >
        {d}
      </text>
    );
  });

  // --- kliny jak barpolar (OBRYS, bez fill) ---
  const half = 11.25; // pół-szerokość sektora
  const paths = vals.map((v, i) => {
    const frac = Math.max(0, Math.min(1, (Number(v) || 0) / maxVal));
    const R = frac * rMax;
    if (R <= 0) return null;

    const cDeg = i * 22.5 - 90;
    const a1 = (cDeg - half) * DEG;
    const a2 = (cDeg + half) * DEG;

    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);

    // kontur klina (od środka, do łuku R, i z powrotem do środka)
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2} Z`;
    return <path key={`w${i}`} d={d} fill="none" stroke={stroke} strokeWidth={sw+3} />;
  });

  return (
    <g>
      {/* siatka */}
      {rings}{spokes}
      {/* kliny */}
      {paths}
      {/* center punkt subtelny */}
      <circle cx={cx} cy={cy} r={1.5} fill={gridStroke}/>
      {/* etykiety */}
      {labels}
    </g>
  );
}
