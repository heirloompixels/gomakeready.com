// The ask band's door. The Worker runs for real here — SELF is the whole
// fetch handler — and D1 behind it is the real thing, so every case checks
// both what was said back and what was written down. A guard that answers
// correctly and writes anyway is not a guard.
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConversation, listLeads } from '../src/db';

const JSON_CT = 'application/json; charset=utf-8';
const TEXT_CT = 'text/plain; charset=utf-8';
const SAID = 'Spoken for. Watch your inbox.';

const at = (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch('http://example.com' + path, init);

const post = (body: string, type: string): Promise<Response> =>
  at('/ask', { method: 'POST', headers: { 'content-type': type }, body });

const form = (body: string) => post(body, 'application/x-www-form-urlencoded');
const asJSON = (body: unknown) => post(JSON.stringify(body), 'application/json');

const leads = () => listLeads(env.DB);

// Every case begins at an empty desk, so "nothing was written down" is a
// statement about this test and not about the order the file happened to run
// in. A test fixture only — the Worker has no delete verb.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM letters'),
    env.DB.prepare('DELETE FROM notes'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM leads'),
    env.DB.prepare('DELETE FROM conversations'),
    env.DB.prepare('DELETE FROM sqlite_sequence'),
  ]);
});

describe('leaving an address', () => {
  it('takes the form the band posts, and says the one sentence', async () => {
    const r = await form('email=ann%40yourshop.com&website=');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(JSON_CT);
    // An address left is not a page.
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ ok: true, said: SAID });

    const all = await leads();
    expect(all).toHaveLength(1);
    expect(all[0].email).toBe('ann@yourshop.com');
    expect(all[0].status).toBe('new');
    expect(all[0].conversation_id).toBeNull();
  });

  it('takes JSON just as well', async () => {
    const r = await asJSON({ email: 'ben@yourshop.com' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, said: SAID });
    expect((await leads())[0].email).toBe('ben@yourshop.com');
  });

  it('attaches the conversation it came out of, by Nº, either way', async () => {
    const c = await createConversation(env.DB, { town: 'Bozeman' });

    expect((await form('email=one%40shop.com&conversation=' + c.id)).status).toBe(200);
    expect((await asJSON({ email: 'two@shop.com', conversation: c.id })).status).toBe(200);

    const all = await leads();
    expect(all).toHaveLength(2);
    for (const lead of all) expect(lead.conversation_id).toBe(c.id);
  });

  it('keeps the address when the Nº is stale or invented', async () => {
    // Losing a lead over a number the visitor never chose would be the
    // database refusing work. The lead stands alone; the desk sorts it.
    const r = await form('email=three%40shop.com&conversation=9999');
    expect(r.status).toBe(200);
    const all = await leads();
    expect(all).toHaveLength(1);
    expect(all[0].conversation_id).toBeNull();
  });

  it('takes the same address twice', async () => {
    await form('email=twice%40shop.com');
    await form('email=twice%40shop.com');
    expect(await leads()).toHaveLength(2);
  });

  it('trims what a hand typed around it', async () => {
    await asJSON({ email: '  spaced@shop.com  ' });
    expect((await leads())[0].email).toBe('spaced@shop.com');
  });
});

describe('the honeypot', () => {
  it('answers a machine exactly as it answers a person, and writes nothing', async () => {
    const honest = await form('email=ann%40yourshop.com&website=');
    const bot = await form('email=bot%40spam.com&website=https%3A%2F%2Fbuy-things.example');

    // Same status, same shape, same sentence: nothing here teaches a bot
    // that it was caught.
    expect(bot.status).toBe(honest.status);
    expect(bot.headers.get('content-type')).toBe(honest.headers.get('content-type'));
    expect(await bot.json()).toEqual({ ok: true, said: SAID });

    // One lead, and it is the honest one.
    const all = await leads();
    expect(all).toHaveLength(1);
    expect(all[0].email).toBe('ann@yourshop.com');
  });

  it('is not tripped by the empty field the form always sends', async () => {
    await form('email=ann%40yourshop.com&website=');
    await asJSON({ email: 'ben@yourshop.com', website: '' });
    await form('email=cal%40yourshop.com&website=%20%20');
    expect(await leads()).toHaveLength(3);
  });

  it('catches a bot that also brought a good address', async () => {
    const r = await asJSON({ email: 'real-looking@shop.com', website: 'anything at all' });
    expect(r.status).toBe(200);
    expect(await leads()).toEqual([]);
  });
});

describe('the caps', () => {
  it('refuses a body larger than the desk will take', async () => {
    const huge = 'email=ann%40yourshop.com&note=' + 'x'.repeat(5000);
    const r = await form(huge);
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toBe(TEXT_CT);
    expect(await r.text()).toBe('That is more than this desk will take.\n');
    expect(await leads()).toEqual([]);
  });

  it('refuses an address longer than an address can be', async () => {
    // 254 is the limit on a path; this is over it and under the body cap.
    const long = 'a'.repeat(250) + '@yourshop.com';
    const r = await asJSON({ email: long });
    expect(r.status).toBe(400);
    expect(await leads()).toEqual([]);
  });
});

describe('junk', () => {
  const bad = [
    ['nothing at all', ''],
    ['no address', 'website='],
    ['an empty address', 'email='],
    ['no @', 'email=annyourshop.com'],
    ['two @', 'email=ann%40mid%40shop.com'],
    ['no domain', 'email=ann%40'],
    ['no dot in the domain', 'email=ann%40yourshop'],
    ['a trailing dot', 'email=ann%40yourshop.'],
    ['a one-letter tld', 'email=ann%40yourshop.c'],
    ['a doubled dot', 'email=ann%40your..shop.com'],
    ['a space inside', 'email=ann%20smith%40shop.com'],
    ['a newline inside', 'email=ann%0A%40shop.com'],
    ['nothing before the @', 'email=%40yourshop.com'],
  ];

  for (const [what, body] of bad) {
    it('refuses ' + what + ', in a plain sentence', async () => {
      const r = await form(body);
      expect(r.status).toBe(400);
      expect(r.headers.get('content-type')).toBe(TEXT_CT);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.text()).toBe('That address will not carry a letter. Try it again.\n');
      expect(await leads()).toEqual([]);
    });
  }

  it('refuses a body it cannot read, and names nothing', async () => {
    const r = await post('{not json at all', 'application/json');
    expect(r.status).toBe(400);
    expect(await r.text()).toBe('The desk could not make that out.\n');
    expect(await leads()).toEqual([]);
  });

  it('refuses JSON that is not an object', async () => {
    for (const body of ['"ann@shop.com"', '["ann@shop.com"]', 'null', '7']) {
      const r = await post(body, 'application/json');
      expect(r.status).toBe(400);
    }
    expect(await leads()).toEqual([]);
  });

  it('does not take an address out of a field that is not a string', async () => {
    const r = await asJSON({ email: { address: 'ann@shop.com' } });
    expect(r.status).toBe(400);
    expect(await leads()).toEqual([]);
  });
});

describe('the door itself', () => {
  it('is not a page — a GET is a miss like any other', async () => {
    const r = await at('/ask');
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toBe(TEXT_CT);
    expect(await r.text()).toBe('Nothing is set at this address.\n');
  });

  it('answers nothing to a HEAD, a PUT or a DELETE either', async () => {
    for (const method of ['HEAD', 'PUT', 'DELETE']) {
      expect((await at('/ask', { method })).status).toBe(404);
    }
    expect(await leads()).toEqual([]);
  });

  it('carries the guard headers, like every other answer', async () => {
    const r = await form('email=ann%40yourshop.com');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
});

describe('the band on the page', () => {
  it('carries the honeypot, unreachable by any honest hand', async () => {
    const body = await (await at('/')).text();
    expect(body).toContain('name="website"');
    expect(body).toContain('class="trap"');
    expect(body).toContain('tabindex="-1"');
    expect(body).toContain('aria-hidden="true"');
    expect(body).toContain('autocomplete="off"');
    // The address field is named, so the form serializes itself.
    expect(body).toContain('type="email" name="email"');
  });

  it('is wired to the door, same-origin, and owns no sentence the server owns', async () => {
    const js = await (await env.ASSETS.fetch('http://example.com/scroll.js')).text();
    expect(js).toContain("fetch('/ask'");
    expect(js).toContain("credentials: 'same-origin'");
    expect(js).toContain('The press jammed. Try once more.');
    // The success line comes back from the desk; it is not written here.
    expect(js).not.toContain(SAID);
  });

  it('hides the honeypot off the page rather than with display:none', async () => {
    const css = await (await env.ASSETS.fetch('http://example.com/scroll.css')).text();
    expect(css).toContain('.trap{');
    expect(css).toContain('left:-9999px');
  });
});
