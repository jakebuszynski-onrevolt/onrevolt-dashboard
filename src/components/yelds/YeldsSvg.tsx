// /src/components/yelds/YeldsSvg.tsx
'use client';
import React from "react";

type Props = {
    x: number; y: number; w: number; h: number;
    hist: number[];      // 12 liczb
    histpv: number[];    // 12 liczb
    max?: number;        // domyślnie 200
    colorA?: string;     // niebieski
    colorB?: string;     // pomarańcz
    grid?: boolean;      // subtelna siatka tła
};

function roundedTopPath(x: number, yTop: number, width: number, height: number, r: number) {
    const w = Math.max(0, width);
    const h = Math.max(0, height);
    const rr = 7;//Math.min(r, w / 2);  // promień nie większy niż połowa szerokości i wysokość
    const yBottom = yTop + h;
    // M do dołu-lewo → L pionowo do (góra+rr) → łuk Q do (lewy+rr, góra)
    // → L do (prawy-rr, góra) → łuk Q do (prawy, góra+rr) → L do dołu-prawo → Z
    return [
        `M ${x} ${yBottom}`,
        `L ${x} ${yTop + rr}`,
        `Q ${x} ${yTop} ${x + rr} ${yTop}`,
        `L ${x + w - rr} ${yTop}`,
        `Q ${x + w} ${yTop} ${x + w} ${yTop + rr}`,
        `L ${x + w} ${yBottom}`,
        `Z`,
    ].join(" ");
}

export default function YeldsSvg({
    x, y, w, h, hist, histpv,
    max = 200,
    colorA = "#00bcff",
    colorB = "#fdb633",
    grid = true
}: Props) {
    const pad = 8;
    const X = x + pad, Y = y + pad, W = Math.max(0, w - 2 * pad), H = Math.max(0, h - 2 * pad);
    const months = 12;

    // 3 „unity” na miesiąc: [blue][orange][gap]
    const unit = W / (months * 3);
    const barW = Math.max(2, unit);        // słupek = dokładnie 1 unit
    const gapUnit = unit;                  // przerwa = 1 unit
    const baseY = Y + H;
    const k = H / max;

    // const gridEls = grid
    //     ? Array.from({ length: 5 }, (_, i) => {
    //         const yy = Y + (H * i) / 5;
    //         return <line key={`g${i}`} x1={X} y1={yy} x2={X + W} y2={yy} stroke="#EEF3FA" strokeWidth={1} />;
    //     })
    //     : null;

    const bars = Array.from({ length: months }, (_, i) => {
        const vA = Math.max(0, Math.min(max, Number(hist[i] || 0)));
        const vB = Math.max(0, Math.min(max, Number(histpv[i] || 0)));
        const hA = vA * k, hB = vB * k;

        const groupX = X + i * (3 * unit);   // co miesiąc przesuwamy się o 3 unity
        const ax = groupX;                   // niebieski
        const bx = groupX + unit;            // pomarańczowy (zaraz obok)

        const ry = Math.min(6, barW);
        const aPath = roundedTopPath(ax, baseY - hA, barW, hA, ry);
        const bPath = roundedTopPath(bx, baseY - hB, barW, hB, ry);

        return (
            <g key={i}>
                <path d={aPath} fill={colorA} />
                <path d={bPath} fill={colorB} />
            </g>
        );
    });

    return (
        <g>
            {bars}
        </g>
    );
}
