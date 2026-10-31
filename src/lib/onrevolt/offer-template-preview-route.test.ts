import assert from 'node:assert/strict';
import test from 'node:test';
import { GET } from '../../app/offer-workspace-preview/templates/[page]/route';

test('wzory SVG są niedostępne poza lokalnym trybem development', async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  try {
    for (const mode of ['production', 'test']) {
      env.NODE_ENV = mode;
      const response = await GET(new Request('http://localhost/preview'), { params: Promise.resolve({ page: '1' }) });
      assert.equal(response.status, 404);
      assert.equal(await response.text(), '');
    }
  } finally { if (previous === undefined) delete env.NODE_ENV; else env.NODE_ENV = previous; }
});

test('podgląd akceptuje tylko dziesięć stron i osadza font bez zmiany pliku SVG', async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  try {
    env.NODE_ENV = 'development';
    for (const page of ['0', '11', '../page-01', '01']) {
      const response = await GET(new Request('http://localhost/preview'), { params: Promise.resolve({ page }) });
      assert.equal(response.status, 404);
    }
    const response = await GET(new Request('http://localhost/preview'), { params: Promise.resolve({ page: '1' }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.match(response.headers.get('content-security-policy')!, /sandbox/);
    assert.match(await response.text(), /@font-face.*font-family: 'DM Sans'.*data:font\/ttf;base64/);
  } finally { if (previous === undefined) delete env.NODE_ENV; else env.NODE_ENV = previous; }
});
