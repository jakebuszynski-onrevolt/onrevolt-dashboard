import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  inspectReConsumptionWorkbook,
  preflightReConsumptionWorkbook,
  readReConsumptionProfile,
  ReConsumptionConflictError,
  saveReConsumptionProfile,
  uploadReConsumptionWorkbook,
  type ReConsumptionProfile,
} from './re-consumption-api';

const now = new Date('2026-09-09T10:00:00Z');
const baseUrl = 'https://re.example.test/re/setup_func.php';

function reportRows(kind = 'pobrana', year = 2026, month = 1, value = 1) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const rows: unknown[][] = [
    ['Raport zużycia'], ['590310600030743962'],
    [`Energia czynna ${kind} ${period}-01 - ${period}-${days}`],
    ['Jednostka: kWh'], [], ['Dzień', `Energia czynna ${kind} po bilansowaniu`, 'Status'],
  ];
  const lastSunday = days - new Date(Date.UTC(year, month - 1, days)).getUTCDay();
  let hours = 0;
  for (let index = 0; index < days * 24; index += 1) {
    const date = new Date(Date.UTC(year, month - 1, 1, 1) + index * 3_600_000);
    const transitionHour = date.getUTCDate() === lastSunday && date.getUTCHours() === 3;
    if (month === 3 && transitionHour) continue;
    const row = [date.toISOString().replace('T', ' ').slice(0, 19), value, 'Dane rzeczywiste'];
    rows.push(row);
    hours += 1;
    if (month === 10 && transitionHour) { rows.push([...row]); hours += 1; }
  }
  rows.push(['Suma', hours * value]);
  return rows;
}

function bytesFor(rows = reportRows(), coverSheet = false) {
  const workbook = XLSX.utils.book_new();
  if (coverSheet) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Okładka']]), 'Okładka');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Raport zużycia 1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const bytes = bytesFor();
const workbook = inspectReConsumptionWorkbook(bytes, now);
const input = { station: '41', bytes, fileName: 'pobór-2026-01.xlsx' };

function profile(overrides: Partial<ReConsumptionProfile> = {}): ReConsumptionProfile {
  return {
    station: '41', months: Array(12).fill(100), sources: Array(12).fill('standard'),
    exportSources: Array(12).fill('standard'), annualUsageKwh: 1200,
    hourlyProfile: { exists: true, rows: 8760, firstUpdate: null, lastUpdate: null },
    ...overrides,
  };
}

function receipt(file = bytes, overrides: Record<string, unknown> = {}) {
  const info = inspectReConsumptionWorkbook(file, now);
  const data: Record<string, unknown> = profile();
  const index = info.periodMonth - 1;
  if (info.kind === 'ACTIVE_IMPORT') {
    (data.months as number[])[index] = info.totalKwh;
    (data.sources as string[])[index] = 'xlsx';
  } else (data.exportSources as string[])[index] = 'xlsx';
  data[info.kind === 'ACTIVE_IMPORT' ? 'imported' : 'exported'] = {
    month: info.periodMonth, sourceYear: info.periodYear, totalKwh: info.totalKwh,
  };
  return { ...data, ...overrides };
}

function json(data: unknown) {
  return Response.json({ ok: true, data });
}

function mockHttp(responses: Array<Response | Error>) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchMock: typeof fetch = async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    const next = responses[calls.length - 1];
    assert.ok(next, 'unexpected HTTP call (no real network is allowed)');
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, options: { fetch: fetchMock, baseUrl, now } };
}

test('reads absent profile and uses no-store GET', async () => {
  const absent = profile({ months: null, sources: null, exportSources: null, annualUsageKwh: null, hourlyProfile: { exists: false, rows: 0 } });
  const mock = mockHttp([json(absent)]);
  assert.deepEqual(await readReConsumptionProfile('41', mock.options), absent);
  assert.equal(mock.calls[0].url.searchParams.get('action'), 'user_consumption_get');
  assert.equal(mock.calls[0].url.searchParams.get('station'), '41');
  assert.equal(mock.calls[0].init.cache, 'no-store');
  assert.equal(mock.calls[0].init.redirect, 'error');
  assert.ok(mock.calls[0].init.signal instanceof AbortSignal);
});

test('uses one env URL for GET and POST without forwarding a stale station/action', async () => {
  const previous = process.env.ONREVOLT_RE_PROFILE_URL;
  process.env.ONREVOLT_RE_PROFILE_URL = `${baseUrl}?action=old&station=999`;
  try {
    const mock = mockHttp([json(profile()), json(receipt())]);
    await uploadReConsumptionWorkbook(input, { fetch: mock.options.fetch, now });
    assert.equal(mock.calls[0].url.origin, 'https://re.example.test');
    assert.equal(mock.calls[0].url.searchParams.get('station'), '41');
    assert.equal(mock.calls[1].url.searchParams.has('station'), false);
    assert.equal(mock.calls[1].url.searchParams.get('action'), 'user_consumption_xlsx_upload');
  } finally {
    if (previous === undefined) delete process.env.ONREVOLT_RE_PROFILE_URL;
    else process.env.ONREVOLT_RE_PROFILE_URL = previous;
  }
});

test('uses existing RE importer default when env is absent', async () => {
  const previous = process.env.ONREVOLT_RE_PROFILE_URL;
  delete process.env.ONREVOLT_RE_PROFILE_URL;
  try {
    const mock = mockHttp([json(profile())]);
    await readReConsumptionProfile('41', { fetch: mock.options.fetch });
    assert.equal(`${mock.calls[0].url.origin}${mock.calls[0].url.pathname}`, 'https://my.onrevolt.com/re/setup_func.php');
  } finally {
    if (previous !== undefined) process.env.ONREVOLT_RE_PROFILE_URL = previous;
  }
});

test('sends exact original XLSX bytes, canonical station and filename as multipart', async () => {
  const mock = mockHttp([json(profile()), json(receipt())]);
  const result = await uploadReConsumptionWorkbook(input, mock.options);
  assert.equal(result.workbook.totalKwh, 744);
  assert.equal(mock.calls.length, 2);
  const post = mock.calls[1];
  assert.equal(post.init.method, 'POST');
  assert.equal(new Headers(post.init.headers).has('Content-Type'), false);
  assert.ok(post.init.body instanceof FormData);
  assert.equal(post.init.body.get('station'), '41');
  assert.deepEqual(Array.from(post.init.body.keys()), ['station', 'reject_existing', 'file']);
  assert.equal(post.init.body.get('reject_existing'), '1');
  const file = post.init.body.get('file') as File;
  assert.equal(file.name, input.fileName);
  assert.equal(Buffer.from(await file.arrayBuffer()).equals(bytes), true);
});

test('resolves a station hash through GET and sends the canonical number', async () => {
  const mock = mockHttp([json(profile()), json(receipt())]);
  await uploadReConsumptionWorkbook({ ...input, station: 'Abcd1234' }, mock.options);
  assert.equal((mock.calls[1].init.body as FormData).get('station'), '41');
});

test('propagates a locked importer conflict when another upload wins after preflight', async () => {
  const mock = mockHttp([json(profile()), Response.json({ ok: false, code: 'RE_MONTH_EXISTS', error: 'Inny import zapisał ten miesiąc' }, { status: 409 })]);
  await assert.rejects(uploadReConsumptionWorkbook(input, mock.options), ReConsumptionConflictError);
  assert.equal(mock.calls.length, 2);
});

test('only explicit replacement disables the locked same-month guard', async () => {
  const mock = mockHttp([json(profile()), json(receipt())]);
  await uploadReConsumptionWorkbook({ ...input, replaceExisting: true }, mock.options);
  assert.equal((mock.calls[1].init.body as FormData).has('reject_existing'), false);
});

for (const direction of ['import', 'export'] as const) {
  const file = direction === 'import' ? bytes : bytesFor(reportRows('oddana'));
  const info = inspectReConsumptionWorkbook(file, now);
  const field = direction === 'import' ? 'sources' : 'exportSources';
  test(`${direction}: existing XLSX blocks POST even when totals match`, async () => {
    const existing = profile({ [field]: Array(12).fill('xlsx') });
    const mock = mockHttp([json(existing)]);
    await assert.rejects(uploadReConsumptionWorkbook({ ...input, bytes: file }, mock.options), ReConsumptionConflictError);
    assert.equal(mock.calls.length, 1);
  });
  test(`${direction}: preflight exposes conflict for caller confirmation`, async () => {
    const mock = mockHttp([json(profile({ [field]: Array(12).fill('xlsx') }))]);
    const result = await preflightReConsumptionWorkbook({ station: '41', workbook: info }, mock.options);
    assert.equal(result.status, 'existing');
    assert.match(result.message, /Potwierdź zastąpienie profilu w RE/);
  });
  test(`${direction}: explicit replacement permits upload`, async () => {
    const mock = mockHttp([json(profile({ [field]: Array(12).fill('xlsx') })), json(receipt(file))]);
    await uploadReConsumptionWorkbook({ ...input, bytes: file, replaceExisting: true }, mock.options);
    assert.equal(mock.calls.length, 2);
  });
  test(`${direction}: opposite direction XLSX does not block this channel`, async () => {
    const other = direction === 'import' ? 'exportSources' : 'sources';
    const mock = mockHttp([json(profile({ [other]: Array(12).fill('xlsx') })), json(receipt(file))]);
    await uploadReConsumptionWorkbook({ ...input, bytes: file }, mock.options);
  });
}

test('manual and standard months are eligible without replacement', async () => {
  for (const source of ['manual', 'standard'] as const) {
    const mock = mockHttp([json(profile({ sources: Array(12).fill(source) })), json(receipt())]);
    await uploadReConsumptionWorkbook(input, mock.options);
  }
});

for (const [year, month, hours] of [[2026, 3, 743], [2025, 10, 745]]) {
  test(`preserves ${year}-${month} DST workbook bytes (${hours} rows)`, async () => {
    const file = bytesFor(reportRows('pobrana', year, month));
    const mock = mockHttp([json(profile()), json(receipt(file))]);
    const result = await uploadReConsumptionWorkbook({ ...input, bytes: file }, mock.options);
    assert.equal(result.workbook.rowsCount, hours);
    const posted = (mock.calls[1].init.body as FormData).get('file') as File;
    assert.equal(Buffer.from(await posted.arrayBuffer()).equals(file), true);
  });
}

for (const delta of [0, 0.001, -0.001]) {
  test(`accepts total difference ${delta} kWh within 1 Wh`, async () => {
    const data = receipt(bytes, { imported: { month: 1, sourceYear: 2026, totalKwh: 744 + delta } });
    const mock = mockHttp([json(profile()), json(data)]);
    await uploadReConsumptionWorkbook(input, mock.options);
  });
}

const invalidReceipts: Array<[string, Record<string, unknown>]> = [
  ['missing receipt', { imported: undefined }],
  ['wrong month', { imported: { month: 2, sourceYear: 2026, totalKwh: 744 } }],
  ['wrong year', { imported: { month: 1, sourceYear: 2025, totalKwh: 744 } }],
  ['total exceeds tolerance', { imported: { month: 1, sourceYear: 2026, totalKwh: 744.002 } }],
  ['non-numeric total', { imported: { month: 1, sourceYear: 2026, totalKwh: '744' } }],
  ['unexpected second channel', { exported: { month: 1, sourceYear: 2026, totalKwh: 1 } }],
  ['source not marked XLSX', { sources: Array(12).fill('standard') }],
  ['monthly total differs', { months: Array(12).fill(10) }],
  ['hourly profile missing', { hourlyProfile: { exists: false, rows: 0 } }],
];
for (const [label, overrides] of invalidReceipts) {
  test(`rejects success response with ${label}`, async () => {
    const mock = mockHttp([json(profile()), json(receipt(bytes, overrides))]);
    await assert.rejects(uploadReConsumptionWorkbook(input, mock.options), /RE nie potwierdziło/);
    assert.equal(mock.calls.length, 2);
  });
}

test('validates export receipt independently of import monthly totals', async () => {
  const file = bytesFor(reportRows('oddana', 2026, 2));
  const mock = mockHttp([json(profile()), json(receipt(file, { exported: { month: 2, sourceYear: 2026, totalKwh: 1 } }))]);
  await assert.rejects(uploadReConsumptionWorkbook({ ...input, bytes: file }, mock.options), /RE nie potwierdziło/);
});

test('zero export is a real XLSX month, not a missing measurement', async () => {
  const file = bytesFor(reportRows('oddana', 2026, 2, 0));
  const mock = mockHttp([json(profile()), json(receipt(file))]);
  const result = await uploadReConsumptionWorkbook({ ...input, bytes: file }, mock.options);
  assert.equal(result.workbook.totalKwh, 0);
  assert.equal(result.profile.exportSources[1], 'xlsx');
});

for (const malformed of [
  profile({ months: [1] }), profile({ sources: undefined }), profile({ exportSources: undefined }),
  profile({ sources: ['bad'] as never }), profile({ station: 'other' }),
  profile({ annualUsageKwh: undefined }), profile({ hourlyProfile: undefined }),
]) {
  test(`fails closed on malformed profile ${JSON.stringify(malformed).slice(0, 70)}`, async () => {
    const mock = mockHttp([json(malformed)]);
    await assert.rejects(uploadReConsumptionWorkbook(input, mock.options), /Nieprawidłowa odpowiedź/);
    assert.equal(mock.calls.length, 1);
  });
}

test('rejects mismatched station at both GET and POST', async () => {
  for (const responses of [[json(profile({ station: '42' }))], [json(profile()), json(receipt(bytes, { station: '42' }))]]) {
    const mock = mockHttp(responses);
    await assert.rejects(uploadReConsumptionWorkbook(input, mock.options), /innej stacji/);
  }
});

test('propagates HTTP, application, malformed JSON and network errors without retries', async () => {
  const cases: Array<[Response | Error, RegExp]> = [
    [Response.json({ ok: false, error: 'Brak danych godzinowych' }, { status: 400 }), /Brak danych godzinowych/],
    [Response.json({ ok: false, error: 'Importer niedostępny' }), /Importer niedostępny/],
    [new Response('<html>bad gateway</html>', { status: 502 }), /poprawnym JSON/],
    [new Error('request timed out'), /timed out/],
    [Response.json({ ok: true, data: profile() }, { status: 500 }), /HTTP 500/],
  ];
  for (const [response, pattern] of cases) {
    const mock = mockHttp([json(profile()), response]);
    await assert.rejects(uploadReConsumptionWorkbook(input, mock.options), pattern);
    assert.equal(mock.calls.length, 2);
  }
});

test('rejects current and older months before any HTTP call', async () => {
  for (const [year, month] of [[2026, 9], [2025, 8]]) {
    const mock = mockHttp([]);
    await assert.rejects(uploadReConsumptionWorkbook({ ...input, bytes: bytesFor(reportRows('pobrana', year, month)) }, mock.options), /12 zamkniętych/);
    assert.equal(mock.calls.length, 0);
  }
});

test('rejects invalid station, non-XLSX, truncated workbook and wrong first sheet before HTTP', async () => {
  const cases = [
    { ...input, station: '../41' }, { ...input, fileName: 'report.csv' },
    { ...input, bytes: bytesFor(reportRows().filter((_, index) => index !== 100)) },
    { ...input, bytes: bytesFor(reportRows(), true) },
    { ...input, bytes: Buffer.alloc(0) },
  ];
  for (const invalid of cases) {
    const mock = mockHttp([]);
    await assert.rejects(uploadReConsumptionWorkbook(invalid, mock.options));
    assert.equal(mock.calls.length, 0);
  }
});

test('rejects unequal mixed channel columns that existing CRM inspector can accept', async () => {
  const rows = reportRows();
  rows[5].push('Energia czynna pobrana po bilansowaniu', 'Energia czynna oddana po bilansowaniu');
  for (const row of rows.slice(6, -1)) row.push(0, 0);
  const mock = mockHttp([]);
  await assert.rejects(uploadReConsumptionWorkbook({ ...input, bytes: bytesFor(rows) }, mock.options), /tylko jeden kierunek/);
  assert.equal(mock.calls.length, 0);
});

test('saves monthly declaration through existing JSON action without sending export sources', async () => {
  const data = profile({ sources: ['manual', 'xlsx', ...Array(10).fill('standard')], exportSources: Array(12).fill('xlsx') });
  const mock = mockHttp([json(data)]);
  assert.deepEqual(await saveReConsumptionProfile('41', data.months, data.sources, mock.options), data);
  assert.equal(mock.calls.length, 1);
  const call = mock.calls[0];
  assert.equal(call.url.searchParams.get('action'), 'user_consumption_save');
  assert.equal(call.init.method, 'POST');
  assert.equal(new Headers(call.init.headers).get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(call.init.body as string), { station: '41', months: data.months, sources: data.sources, protect_detailed: true });
});

test('monthly save rejects invalid input without network or silent normalization', async () => {
  for (const data of [profile({ months: [1] }), profile({ months: Array(12).fill(-1) }), profile({ sources: undefined }), profile({ sources: Array(12).fill('unknown') })]) {
    const mock = mockHttp([]);
    await assert.rejects(saveReConsumptionProfile('41', data.months, data.sources, mock.options), /12 poprawnych/);
    assert.equal(mock.calls.length, 0);
  }
});

test('monthly save rejects unconfirmed values, sources and server errors', async () => {
  const data = profile();
  for (const response of [json(profile({ months: Array(12).fill(200) })), json(profile({ sources: Array(12).fill('manual') })), Response.json({ ok: false, error: 'Zapis odrzucony' }, { status: 400 })]) {
    const mock = mockHttp([response]);
    await assert.rejects(saveReConsumptionProfile('41', data.months, data.sources, mock.options), /RE nie potwierdziło|Zapis odrzucony/);
    assert.equal(mock.calls.length, 1);
  }
});
