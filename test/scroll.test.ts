// The scroll's contract: what the reader is served before a line is typed.
//
// The page is one server-rendered answer plus three static files, and the
// only thing about it that changes from reader to reader is the town. This
// suite pins the town, the greeting handed to the typist, the absence of any
// origin but ours, and the policy that enforces it.
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { edgeGreeting } from '../src/greeting';

const HTML = 'text/html; charset=utf-8';

const at = (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch('http://example.com' + path, init);

describe('the scroll', () => {
  it('is served whole, and signs itself', async () => {
    const r = await at('/');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(HTML);
    const body = await r.text();
    expect(body).toContain('<title>go, make, ready.</title>');
    // The wordmark, lowercase, its commas in plum.
    expect(body).toContain(
      'go<span class="p">,</span> make<span class="p">,</span> ready<span class="p">.</span>',
    );
    // All five acts and the closing band.
    expect(body).toContain('A correspondence');
    expect(body).toContain('The letter');
    expect(body).toContain('The ask');
    expect(body).toContain('The money is what makes it honest.');
    // The forks are in the header, all four of them.
    for (const fork of ['what', 'who', 'cost', 'record']) {
      expect(body).toContain('data-fork="' + fork + '"');
    }
    // The footer credits the gallery.
    expect(body).toContain('Truth or Consequences Contemporary');
  });

  it('speaks from home when the edge says nothing', async () => {
    const body = await (await at('/')).text();
    expect(body).toContain('Set at the edge for <b>Bozeman</b>');
    expect(body).toContain('no cookies, no tracking');
    // The greeting is handed to the typist as JSON on an attribute, escaped
    // by the template — never concatenated into script.
    expect(body).toMatch(/id="edge" hidden data-edge="/);
    expect(body).toContain('Bozeman. Late to be working');
    expect(body).toContain('No one is typing this.');
  });

  // The pool does pass `cf` through SELF.fetch, so the edge can be played.
  it('addresses the town the edge names', async () => {
    const r = await at('/', {
      cf: { city: 'Santa Fe', timezone: 'America/Denver' },
    } as RequestInit);
    const body = await r.text();
    expect(body).toContain('Set at the edge for <b>Santa Fe</b>');
    expect(body).toContain('Santa Fe. Late to be working');
    expect(body).not.toContain('Bozeman. Late to be working');
  });

  it('fetches nothing from anyone else', async () => {
    const body = await (await at('/')).text();
    expect(body).not.toContain('fonts.googleapis.com');
    expect(body).not.toContain('fonts.gstatic.com');
    // Styles and script are ours, by path, not by inline.
    expect(body).toContain('href="/brand.css"');
    expect(body).toContain('href="/scroll.css"');
    expect(body).toContain('src="/scroll.js"');
    expect(body).not.toContain('<style');
    expect(body).not.toContain('onsubmit');
    expect(body).not.toMatch(/ style="/);
  });

  it("leaves the mockup's chrome behind", async () => {
    const body = await (await at('/')).text();
    expect(body).not.toContain('mockbar');
    expect(body).not.toContain('Mockup');
    expect(body).not.toContain('.html"');
  });
});

describe('the greeting, composed at the edge', () => {
  const noon = new Date('2026-07-26T18:00:00Z'); // noon in Denver

  it('falls home to Bozeman, mountain time', () => {
    const e = edgeGreeting(undefined, noon);
    expect(e.town).toBe('Bozeman');
    expect(e.timezone).toBe('America/Denver');
    expect(e.daypart).toBe('afternoon');
    expect(e.greeting).toContain('Good afternoon, Bozeman.');
  });

  it("tells the hour by the reader's own zone, not the Worker's", () => {
    const at8am = new Date('2026-07-26T12:00:00Z');
    expect(edgeGreeting({ city: 'Aspen', timezone: 'America/Denver' }, at8am).daypart).toBe(
      'morning',
    );
    expect(edgeGreeting({ city: 'Vail', timezone: 'Pacific/Auckland' }, at8am).daypart).toBe(
      'morning',
    );
    expect(edgeGreeting({ city: 'Bozeman', timezone: 'Europe/Berlin' }, at8am).daypart).toBe(
      'afternoon',
    );
  });

  it('goes home rather than break on a zone it does not know', () => {
    const e = edgeGreeting({ city: 'Bozeman', timezone: 'Mars/Olympus' }, noon);
    expect(e.timezone).toBe('America/Denver');
    expect(e.daypart).toBe('afternoon');
  });

  it("is the mockup's line, word for word", () => {
    expect(edgeGreeting({ city: 'Santa Fe', timezone: 'America/Denver' }, noon).greeting).toBe(
      'Good afternoon, Santa Fe. Late to be working — but then, that is the subject. ' +
        'No one is typing this. Stay a while anyway; there is something at the bottom of the page for you.',
    );
  });
});

// In production the asset server stands in front of the Worker; inside the
// vitest pool it does not, so the files are asked for through the binding.
// The live smoke against `wrangler dev` covers the path in front.
describe('the static files', () => {
  const asset = (path: string) => env.ASSETS.fetch('http://example.com' + path);

  it('serves the fonts as fonts, from our own origin', async () => {
    for (const f of ['eb-garamond', 'eb-garamond-italic', 'dm-sans']) {
      const r = await asset('/fonts/' + f + '.woff2');
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('font/woff2');
      const bytes = await r.arrayBuffer();
      expect(bytes.byteLength).toBeGreaterThan(10_000);
      // Well under the variable TTFs they were subset from (240k–851k).
      expect(bytes.byteLength).toBeLessThan(120_000);
    }
  });

  it('serves the hand and the styles', async () => {
    const js = await asset('/scroll.js');
    expect(js.status).toBe(200);
    const source = await js.text();
    expect(source).toContain('humanType');
    expect(source).toContain("document.getElementById('edge').dataset.edge");

    for (const sheet of ['/brand.css', '/scroll.css']) {
      const r = await asset(sheet);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/css');
    }
    const brand = await (await asset('/brand.css')).text();
    expect(brand).toContain('@font-face');
    expect(brand).toContain("url('/fonts/eb-garamond.woff2')");
    expect(brand).not.toContain('fonts.gstatic.com');
  });
});
