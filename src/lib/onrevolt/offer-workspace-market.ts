export type OfferMarketRow = { timestampUtc: string; pricePlnPerMwh: unknown };

export class OfferMarketDataError extends Error {}

export type OfferStoredMarketRow = { stamp: string; periodUtc: string | null; price: unknown };

/** PSE stores the end of the UTC interval; the simulation uses interval starts. */
export function offerMarketIntervalStarts(rows: OfferStoredMarketRow[]): OfferMarketRow[] {
  return rows.flatMap(row => {
    const period = /^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/.exec(row.periodUtc || '');
    const end = Date.parse(row.stamp);
    if (!period || !/Z$/.test(row.stamp) || !Number.isFinite(end) || end % 900000) {
      throw new OfferMarketDataError(`Brak jednoznacznego okresu UTC ceny rynkowej: ${row.stamp}.`);
    }
    const [startHour, startMinute, endHour, endMinute] = period.slice(1).map(Number);
    if (startHour > 24 || endHour > 24 || startMinute > 59 || endMinute > 59
      || (startHour === 24 && startMinute !== 0) || (endHour === 24 && endMinute !== 0)) {
      throw new OfferMarketDataError(`Nieprawidłowy okres UTC ceny rynkowej: ${row.periodUtc}.`);
    }
    const startMinutes = (startHour * 60 + startMinute) % 1440;
    const endMinutes = (endHour * 60 + endMinute) % 1440;
    const duration = (endMinutes - startMinutes + 1440) % 1440;
    const instant = new Date(end);
    if (![15, 60].includes(duration) || instant.getUTCHours() * 60 + instant.getUTCMinutes() !== endMinutes) {
      throw new OfferMarketDataError(`Niespójny koniec okresu UTC ceny rynkowej: ${row.stamp} (${row.periodUtc}).`);
    }
    return Array.from({ length: duration / 15 }, (_, index) => ({
      timestampUtc: new Date(end - duration * 60000 + index * 900000).toISOString(),
      pricePlnPerMwh: row.price,
    }));
  });
}

/** Aggregate explicit UTC quarter starts; never fill a missing price with zero. */
export function offerHourlyMarketPrices(rows: OfferMarketRow[], hours: string[], options: { clampNegativeBeforeAverage?: boolean } = {}): Map<string, number> {
  const quarters = new Map<number, number>();
  for (const row of rows) {
    const timestamp = Date.parse(row.timestampUtc);
    const raw = row.pricePlnPerMwh;
    const price = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!/Z$/.test(row.timestampUtc) || !Number.isFinite(timestamp) || timestamp % 900000 || !Number.isFinite(price) || quarters.has(timestamp)) {
      throw new OfferMarketDataError('Nieprawidłowy lub zduplikowany interwał ceny rynkowej.');
    }
    quarters.set(timestamp, (options.clampNegativeBeforeAverage ? Math.max(0, price) : price) / 1000);
  }
  return new Map(hours.map(hour => {
    const timestamp = Date.parse(hour);
    if (!Number.isFinite(timestamp) || timestamp % 3600000) throw new OfferMarketDataError('Nieprawidłowa godzina ceny rynkowej.');
    const values = [0, 1, 2, 3].map(quarter => quarters.get(timestamp + quarter * 900000));
    if (values.some(value => value === undefined)) throw new OfferMarketDataError(`Brak pełnych cen rynkowych dla ${hour}.`);
    return [hour, values.reduce<number>((total, value) => total + value!, 0) / 4];
  }));
}
