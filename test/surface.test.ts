// The HTTP surface, pinned. Three answers exist at step 2 — the holding
// page, the health organ, and the miss — and this suite is their contract.
// The Worker runs for real here: SELF is the whole fetch handler.
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const HTML = 'text/html; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';
const JSON_CT = 'application/json; charset=utf-8';

const at = (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch('http://example.com' + path, init);

describe('the holding page', () => {
  it('is set on paper, in ink, in the register', async () => {
    const r = await at('/');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(HTML);
    const body = await r.text();
    expect(body).toContain('<title>go, make, ready.</title>');
    expect(body).toContain('the press is being set.');
    expect(body).toContain('#f7f4ef'); // paper
    expect(body).toContain('#0d1f29'); // ink
    expect(body).toContain('#7d4060'); // the commas, in plum
    // Fonts are ours or the reader's. Nothing is fetched from anyone else.
    expect(body).not.toContain('fonts.googleapis.com');
  });

  it('answers a HEAD the same way', async () => {
    const r = await at('/', { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(HTML);
  });
});

describe('health', () => {
  it('reports the commit it was deployed with, and its own name', async () => {
    const r = await at('/_health');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(JSON_CT);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ ok: true, name: 'gmr', commit: env.COMMIT });
    expect(env.COMMIT.length).toBeGreaterThan(0);
  });
});

describe('a miss', () => {
  it('says so plainly, and says nothing else', async () => {
    const r = await at('/nothing-here');
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toBe(TEXT);
    expect(await r.text()).toBe('Nothing is set at this address.\n');
  });

  it('does not soften for a browser, and does not leak a stack', async () => {
    const r = await at('/admin', { headers: { accept: 'text/html' } });
    expect(r.status).toBe(404);
    const body = await r.text();
    expect(body).toBe('Nothing is set at this address.\n');
    expect(body).not.toContain('Error');
  });

  it('refuses a method the piece does not answer', async () => {
    const r = await at('/', { method: 'POST' });
    expect(r.status).toBe(404);
  });
});
