// The HTTP surface, pinned. The scroll has its own suite (scroll.test.ts);
// what is pinned here is everything around it — the health organ, the miss,
// and the guard headers every answer carries.
// The Worker runs for real here: SELF is the whole fetch handler.
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const HTML = 'text/html; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';
const JSON_CT = 'application/json; charset=utf-8';

const at = (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch('http://example.com' + path, init);

describe('the page', () => {
  it('is set on paper, in the register', async () => {
    const r = await at('/');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(HTML);
    expect(await r.text()).toContain('go, make, ready.');
  });

  it('answers a HEAD the same way', async () => {
    const r = await at('/', { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(HTML);
  });
});

describe('the guard headers', () => {
  // Every surface carries them, whatever it answers with.
  for (const path of ['/', '/_health', '/nothing-here']) {
    it('are on ' + path, async () => {
      const r = await at(path);
      const csp = r.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).toContain("font-src 'self'");
      // Nothing inline is served, so nothing inline is allowed.
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('unsafe-eval');
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    });
  }
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
