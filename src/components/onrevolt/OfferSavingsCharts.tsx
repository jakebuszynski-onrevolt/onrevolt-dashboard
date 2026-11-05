'use client';

import { Box, Flex, Text } from '@chakra-ui/react';

const number = (value: number, digits = 0) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: digits }).format(value);
export type SavingsBarPart = { label: string; value: number; color: string };

export function OfferSavingsBar({ parts, maximum, unit }: { parts: SavingsBarPart[]; maximum: number; unit: string }) {
  const values = parts.filter(part => Number.isFinite(part.value));
  if (!values.length || !Number.isFinite(maximum) || maximum <= 0) return <Text color="#8392b4" textAlign="center">—</Text>;
  const minimum = Math.min(0, ...values.map(part => part.value));
  const top = Math.max(maximum, values.reduce((total, part) => total + Math.max(0, part.value), 0));
  const y = (value: number) => 16 + (top - value) / (top - minimum) * 244;
  let sum = 0;
  return <Box as="svg" viewBox="0 0 100 280" width="100%" height="100%" minH="260px" role="img" aria-label={parts.map(part => `${part.label}: ${number(part.value, 4)} ${unit}`).join('; ')} fontFamily="DM Sans, sans-serif">
    <text x="4" y="10" fontSize="9" fill="#8392b4">{unit}</text>
    {Array.from({ length: 6 }, (_, i) => {
      const value = top * i / 5;
      return <g key={i}><line x1="42" x2="96" y1={y(value)} y2={y(value)} stroke="#e0e5f2" /><text x="38" y={y(value) + 3} textAnchor="end" fontSize="9" fill="#8392b4">{number(value, maximum < 10 ? 2 : 0)}</text></g>;
    })}
    {values.map(part => {
      const base = part.value >= 0 ? sum : 0;
      if (part.value >= 0) sum += part.value;
      return <rect key={part.label} x="57" y={y(Math.max(base, base + part.value))} width="25" height={Math.abs(y(base) - y(base + part.value))} fill={part.color}><title>{`${part.label}: ${number(part.value, 4)} ${unit}`}</title></rect>;
    })}
    <line x1="42" x2="96" y1={y(0)} y2={y(0)} stroke="#a3aed0" />
  </Box>;
}

export function OfferSavingsProjectionChart({ before, after, paybackYears }: { before: number[]; after: number[]; paybackYears: number | null }) {
  const W = 1120, H = 330, L = 65, R = 170, T = 61, B = 43;
  const width = W - L - R, height = H - T - B;
  const maximum = Math.max(5000, Math.ceil(Math.max(...before, ...after) / 5000) * 5000);
  const minimum = Math.min(0, Math.floor(Math.min(...before, ...after) / 5000) * 5000);
  const x = (year: number) => L + (year - 1) / Math.max(1, before.length - 1) * width;
  const y = (value: number) => T + (maximum - value) / (maximum - minimum) * height;
  const path = (values: number[]) => values.map((value, i) => `${i ? 'L' : 'M'}${x(i + 1)} ${y(value)}`).join(' ');
  const markers = [1, 5, 10, 15, before.length].filter((year, index, all) => year <= before.length && all.indexOf(year) === index);
  return <>
    <Box overflowX="auto" aria-label="Prognoza rachunków wieloletnich">
      <Box as="svg" viewBox={`0 0 ${W} ${H}`} width="100%" minW="700px" role="img" aria-label="Roczne rachunki w taryfie docelowej bez inwestycji i z systemem" fontFamily="DM Sans, sans-serif">
        <text x={L} y="32" fontSize="13" fill="#8392b4">PLN / rok</text>
        {Array.from({ length: 6 }, (_, i) => {
          const value = minimum + (maximum - minimum) * i / 5;
          return <g key={i}><line x1={L} x2={W - R} y1={y(value)} y2={y(value)} stroke="#e9eef8" /><text x={L - 10} y={y(value) + 4} textAnchor="end" fontSize="12" fill="#8392b4">{number(value)}</text></g>;
        })}
        {before.slice(0, -1).map((_, i) => <path key={i} d={`M${x(i + 1)} ${y(before[i])}L${x(i + 2)} ${y(before[i + 1])}L${x(i + 2)} ${y(after[i + 1])}L${x(i + 1)} ${y(after[i])}Z`} fill={before[i] >= after[i] ? '#e7f7ed' : '#fff0ee'} />)}
        {([{ values: before, color: '#8999c2', label: 'Bez inwestycji' }, { values: after, color: '#00a450', label: 'Z systemem' }]).map(series => <g key={series.label}>
          <path d={path(series.values)} fill="none" stroke={series.color} strokeWidth="3.5" />
          {markers.map(year => <circle key={year} cx={x(year)} cy={y(series.values[year - 1])} r="4" fill={series.color}><title>{`Rok ${year} · ${series.label}: ${number(series.values[year - 1], 2)} zł`}</title></circle>)}
        </g>)}
        {markers.map(year => <text key={year} x={x(year)} y={H - 16} textAnchor="middle" fontSize="12" fill="#8392b4">Rok {year}</text>)}
        {paybackYears != null && paybackYears >= 1 && paybackYears <= before.length ? <g>
          <line x1={x(paybackYears)} x2={x(paybackYears)} y1={T} y2={H - B} stroke="#8a47ff" strokeDasharray="5 5" />
          <rect x={x(paybackYears) - 58} y="6" width="116" height="34" rx="6" fill="#f3edff" />
          <text x={x(paybackYears)} y="27" textAnchor="middle" fontSize="12" fill="#7840d3">Zwrot: {Math.floor(paybackYears)} lat</text>
        </g> : null}
        <text x={W - R + 16} y={T + 18} fill="#8999c2" fontSize="12">Bez inwestycji</text>
        <text x={W - R + 16} y={T + 38} fill="#8999c2" fontSize="15" fontWeight="700">{number(before.at(-1)!, 2)} zł</text>
        <text x={W - R + 16} y={T + 78} fill="#00a450" fontSize="12">Z systemem</text>
        <text x={W - R + 16} y={T + 98} fill="#00a450" fontSize="15" fontWeight="700">{number(after.at(-1)!, 2)} zł</text>
      </Box>
    </Box>
    <Flex gap="20px" wrap="wrap" fontSize="11px" color="#8392b4" mt="6px">
      <Text><Box as="span" display="inline-block" w="18px" h="3px" bg="#8999c2" mr="7px" verticalAlign="middle" />Taryfa docelowa bez inwestycji</Text>
      <Text><Box as="span" display="inline-block" w="18px" h="3px" bg="#00a450" mr="7px" verticalAlign="middle" />Taryfa docelowa z systemem</Text>
    </Flex>
  </>;
}
