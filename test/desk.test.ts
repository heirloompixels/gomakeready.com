// The desk, and the door in front of it.
//
// Two things are pinned here and they are not the same thing. The first is
// that the door does not exist: every wrong hand gets the sentence
// /nothing-here gets, character for character, with no header anywhere in
// the answer that admits a door was there. The second is that the right hand
// gets a working desk — and that its writes land in D1, because a page that
// says "saved" and writes nothing is worse than one that refuses.
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  createConversation,
  createLead,
  createLetter,
  getLead,
  listNotes,
  setConversationFacts,
} from '../src/db';

const TEXT_CT = 'text/plain; charset=utf-8';
const HTML_CT = 'text/html; charset=utf-8';
const MISS = 'Nothing is set at this address.\n';

const at = (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch('http://example.com' + path, { redirect: 'manual', ...init });

const bearer = (path: string, init: RequestInit = {}): Promise<Response> =>
  at(path, { ...init, headers: { authorization: 'Bearer ' + env.ADMIN_SECRET, ...init.headers } });

// The miss the whole house answers with, fetched fresh each time so the
// comparison is against the router's own sentence and not a copy in this file.
const houseMiss = async (): Promise<{ body: string; type: string | null }> => {
  const r = await at('/nothing-here');
  return { body: await r.text(), type: r.headers.get('content-type') };
};

/** Every case begins at an empty desk. A fixture only — the Worker never deletes. */
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

/** One conversation walked to its end, with a letter and an address left. */
async function seed() {
  const c = await createConversation(env.DB, { town: 'Bozeman', timezone: 'America/Denver' });
  await setConversationFacts(env.DB, c.id, {
    trade: 'a fly-fishing outfitter',
    level: 'nodded',
    frictions: ['booking email', 'trip reports'],
  });
  await appendEvent(env.DB, {
    conversationId: c.id,
    role: 'site',
    stage: 'calibrate',
    body: 'And how do you stand with the thing everyone calls AI?',
  });
  await appendEvent(env.DB, {
    conversationId: c.id,
    role: 'visitor',
    stage: 'calibrate',
    body: 'I have heard the letters and nodded along.',
  });
  const letter = await createLetter(env.DB, {
    conversationId: c.id,
    html: '<article class="doc">a letter</article>',
    keyHash: 'f'.repeat(64),
    hoursLow: 4,
    hoursHigh: 6,
  });
  const lead = await createLead(env.DB, { email: 'ann@yourshop.com', conversationId: c.id });
  return { c, lead, letter };
}

// ————— the door

describe('the door', () => {
  const shut = [
    ['nothing at all', {}],
    ['a wrong bearer', { headers: { authorization: 'Bearer not-the-secret' } }],
    ['an empty bearer', { headers: { authorization: 'Bearer ' } }],
    ['basic auth', { headers: { authorization: 'Basic a2V5OmtleQ==' } }],
    ['a forged cookie', { headers: { cookie: 'd=99999999999.notasignature' } }],
    ['a garbage cookie', { headers: { cookie: 'd=hello; other=thing' } }],
    ['a stale cookie', { headers: { cookie: 'd=1.AAAA' } }],
  ] as const;

  for (const [hand, init] of shut) {
    it('does not exist for ' + hand, async () => {
      const house = await houseMiss();
      for (const path of ['/desk', '/desk/lead/1', '/desk/lead/1/status', '/desk/anything']) {
        const r = await at(path, init);
        expect(r.status, path).toBe(404);
        // Byte-identical to every other miss in the house.
        expect(await r.text(), path).toBe(house.body);
        expect(r.headers.get('content-type'), path).toBe(house.type);
        expect(r.headers.get('cache-control'), path).toBe('no-store');
        // Nothing anywhere says a door was here.
        expect(r.headers.get('www-authenticate'), path).toBe(null);
        expect(r.headers.get('set-cookie'), path).toBe(null);
      }
    });
  }

  it('does not exist for a wrong key, either', async () => {
    const house = await houseMiss();
    const r = await at('/desk?key=not-the-secret');
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(house.body);
    expect(r.headers.get('set-cookie')).toBe(null);
    expect(r.headers.get('location')).toBe(null);
  });

  it('will not take the right key at the wrong address', async () => {
    const r = await at('/desk/lead/1?key=' + env.ADMIN_SECRET);
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(MISS);
    expect(r.headers.get('set-cookie')).toBe(null);
  });

  it('refuses the writes to a hand that has not been let in', async () => {
    const { lead } = await seed();
    for (const path of ['/desk/lead/' + lead.id + '/status', '/desk/lead/' + lead.id + '/note']) {
      const r = await at(path, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'status=booked&body=hello',
      });
      expect(r.status, path).toBe(404);
      expect(await r.text(), path).toBe(MISS);
    }
    expect((await getLead(env.DB, lead.id))?.status).toBe('new');
    expect(await listNotes(env.DB, lead.id)).toHaveLength(0);
  });

  it('opens for the right bearer', async () => {
    const r = await bearer('/desk');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(HTML_CT);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.text()).toContain("The week's");
  });
});

// ————— the key, once

describe('the key', () => {
  it('mints a cookie and cleans the address behind it', async () => {
    const r = await at('/desk?key=' + env.ADMIN_SECRET);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/desk');
    expect(r.headers.get('cache-control')).toBe('no-store');

    const set = r.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/^d=\d+\.[A-Za-z0-9_-]+;/);
    expect(set).toContain('Path=/desk');
    expect(set).toContain('HttpOnly');
    expect(set).toContain('Secure');
    expect(set).toContain('SameSite=Strict');
    expect(set).toContain('Max-Age=' + 30 * 24 * 60 * 60);
    // The secret is not in the cookie. Only a signature over an expiry is.
    expect(set).not.toContain(env.ADMIN_SECRET);
  });

  it('is good for the follow-up, and for the writes under it', async () => {
    const { lead } = await seed();
    const minted = await at('/desk?key=' + env.ADMIN_SECRET);
    const cookie = (minted.headers.get('set-cookie') ?? '').split(';')[0];

    const ledger = await at('/desk', { headers: { cookie } });
    expect(ledger.status).toBe(200);
    expect(await ledger.text()).toContain('ann@yourshop.com');

    const one = await at('/desk/lead/' + lead.id, { headers: { cookie } });
    expect(one.status).toBe(200);

    const wrote = await at('/desk/lead/' + lead.id + '/status', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'status=contacted',
    });
    expect(wrote.status).toBe(303);
    expect((await getLead(env.DB, lead.id))?.status).toBe('contacted');
  });

  it('mints nothing a tampered expiry can extend', async () => {
    const minted = await at('/desk?key=' + env.ADMIN_SECRET);
    const cookie = (minted.headers.get('set-cookie') ?? '').split(';')[0];
    const [, value] = cookie.split('=');
    const [exp, sig] = value.split('.');
    const later = 'd=' + (Number(exp) + 86400) + '.' + sig;

    const r = await at('/desk', { headers: { cookie: later } });
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(MISS);
  });
});

// ————— the ledger

describe('the ledger', () => {
  it('reads correctly at zero', async () => {
    const r = await bearer('/desk');
    const body = await r.text();
    expect(body).toContain('No address has been left at the band yet.');
    expect(body).toContain('new this week');
    expect(body).toContain('letters set');
    expect(body).toContain('model spend today');
  });

  it('sets the week above the rows, and the rows newest first', async () => {
    const { lead } = await seed();
    await createLead(env.DB, { email: 'later@yourshop.com' });

    const body = await (await bearer('/desk')).text();
    // Two leads this week, one letter set, nothing booked.
    expect(body).toContain('<div class="n p">2</div>');
    expect(body).toContain('a fly-fishing outfitter');
    expect(body).toContain('Bozeman');
    expect(body).toContain('nodded');
    expect(body).toContain('/desk/lead/' + lead.id);
    // Newest first: the address with no conversation was left last.
    expect(body.indexOf('later@yourshop.com')).toBeLessThan(body.indexOf('ann@yourshop.com'));
    // The one with no conversation prints a dash rather than a number.
    expect(body).toContain('—');
  });

  it('carries no script of any kind', async () => {
    await seed();
    const body = await (await bearer('/desk')).text();
    expect(body).not.toContain('<script');
    expect(body).not.toContain('onclick');
  });
});

// ————— one lead

describe('a lead', () => {
  it('sets the facts, the transcript, the letter and the two forms', async () => {
    const { lead, letter } = await seed();
    const r = await bearer('/desk/lead/' + lead.id);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');

    const body = await r.text();
    expect(body).toContain('ann@yourshop.com');
    expect(body).toContain('a fly-fishing outfitter');
    expect(body).toContain('booking email · trip reports');
    // The transcript, both hands, in the scroll's own turn styles.
    expect(body).toContain('class="turn site"');
    expect(body).toContain('class="turn you"');
    expect(body).toContain('And how do you stand with the thing everyone calls AI?');
    expect(body).toContain('I have heard the letters and nodded along.');
    // The letter is named with its hours, and its key is nowhere.
    expect(body).toContain('Nº ' + String(letter.number).padStart(3, '0'));
    expect(body).toContain('4–6');
    expect(body).toContain('cannot be reproduced from');
    expect(body).not.toContain(letter.key_hash);
    // Both forms, posting to their own addresses.
    expect(body).toContain('action="/desk/lead/' + lead.id + '/status"');
    expect(body).toContain('action="/desk/lead/' + lead.id + '/note"');
  });

  it('is a miss at an id nobody has been given', async () => {
    for (const path of ['/desk/lead/9999', '/desk/lead/0', '/desk/lead/abc', '/desk/lead/-1']) {
      const r = await bearer(path);
      expect(r.status, path).toBe(404);
      expect(await r.text(), path).toBe(MISS);
    }
  });

  it('says plainly when an address came off the band alone', async () => {
    const lone = await createLead(env.DB, { email: 'quiet@yourshop.com' });
    const body = await (await bearer('/desk/lead/' + lone.id)).text();
    expect(body).toContain('there is no');
    expect(body).toContain('No letter was set');
  });
});

// ————— the writes

describe('the writes', () => {
  const post = (path: string, body: string) =>
    bearer(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

  it('moves a standing and lands it in D1', async () => {
    const { lead } = await seed();
    const r = await post('/desk/lead/' + lead.id + '/status', 'status=booked');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/desk/lead/' + lead.id);
    expect((await getLead(env.DB, lead.id))?.status).toBe('booked');

    // And the ledger's own count moves with it.
    expect(await (await bearer('/desk')).text()).toContain('hours booked');
  });

  it('refuses a standing no lead can take, and writes nothing', async () => {
    const { lead } = await seed();
    const r = await post('/desk/lead/' + lead.id + '/status', 'status=delighted');
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toBe(TEXT_CT);
    expect((await getLead(env.DB, lead.id))?.status).toBe('new');
  });

  it('appends a note, and shows it back', async () => {
    const { lead } = await seed();
    const r = await post('/desk/lead/' + lead.id + '/note', 'body=Called+Tuesday.+Wants+the+hour.');
    expect(r.status).toBe(303);

    const notes = await listNotes(env.DB, lead.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe('Called Tuesday. Wants the hour.');
    expect(await (await bearer('/desk/lead/' + lead.id)).text()).toContain('Wants the hour.');
  });

  it('will not take an empty note or a document', async () => {
    const { lead } = await seed();
    expect((await post('/desk/lead/' + lead.id + '/note', 'body=%20%20')).status).toBe(400);
    expect((await post('/desk/lead/' + lead.id + '/note', 'body=' + 'x'.repeat(2001))).status).toBe(
      400,
    );
    expect(await listNotes(env.DB, lead.id)).toHaveLength(0);
  });

  it('is a miss when the lead is not there', async () => {
    const r = await post('/desk/lead/9999/note', 'body=hello');
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(MISS);
  });
});
