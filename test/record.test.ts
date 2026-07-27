// The record, in full — and the same numbers carried into the scroll.
//
// The page is aggregates and nothing else, so what is pinned here is that it
// counts correctly, that it reads well at zero, and that no reader can find
// a person in it.
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createConversation,
  createLetter,
  setConversationFacts,
  setConversationVisibility,
} from '../src/db';

const at = (path: string): Promise<Response> => SELF.fetch('http://example.com' + path);

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

/** One conversation that reached its end, with a letter and its hours. */
async function work(
  town: string,
  trade: string,
  level: 'daily' | 'burned',
  hours: [number, number],
) {
  const c = await createConversation(env.DB, { town, timezone: 'America/Denver' });
  await setConversationFacts(env.DB, c.id, { trade, level });
  await setConversationVisibility(env.DB, c.id, 'public');
  await createLetter(env.DB, {
    conversationId: c.id,
    html: '<article class="doc">a letter</article>',
    keyHash: 'f'.repeat(64),
    hoursLow: hours[0],
    hoursHigh: hours[1],
  });
  return c;
}

describe('the record', () => {
  it('opens empty, and says so as a fact rather than an apology', async () => {
    const r = await at('/record');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(r.headers.get('cache-control')).toBe('public, max-age=60');

    const body = await r.text();
    expect(body).toContain('The record opens empty, which is a fact, not a flaw.');
    // Four tallies, all honest zeros.
    expect(body).toContain('<div class="n">0</div>');
    expect(body).toContain('conversations in the record');
    expect(body).toContain('letters set');
    expect(body).toContain('hours a week found, in sum');
    expect(body).toContain('Nobody has placed themselves yet.');
    expect(body).toContain('No trades have been named yet.');
  });

  it('carries the piece’s own sentence, and the broadside it is printed as', async () => {
    const body = await (await at('/record')).text();
    expect(body).toContain(
      'Nothing said here is kept whole. It is melted down, like old type, and',
    );
    expect(body).toContain('recast without a name.');
    expect(body).toContain('Printed each season as a letterpress broadside with');
    expect(body).toContain('Truth or Consequences Contemporary');
  });

  it('counts what it was allowed to count, and adds the hours up', async () => {
    await work('Bozeman', 'a gallery', 'burned', [3, 5]);
    await work('Santa Fe', 'an outfitter', 'burned', [4, 6]);
    await work('Bozeman', 'a gallery', 'daily', [1, 1]);
    // Held: said, never offered. It is in the scale and in nothing else.
    await createConversation(env.DB, { town: 'Aspen' });

    const body = await (await at('/record')).text();
    expect(body).toContain('<div class="n">3</div>'); // conversations, and letters
    expect(body).toContain('<div class="n">2</div>'); // towns
    expect(body).toContain('<div class="n">8–12</div>'); // the hours, in sum
    expect(body).not.toContain('The record opens empty');
    // The scale of the piece, which belongs to no one.
    expect(body).toContain('4 in all');
    // Melted: counts and trades, never a town beside a person, never a body.
    expect(body).toContain('<li><b>2</b> a gallery</li>');
    expect(body).toContain('tried it once, and it wrote them something wrong');
    expect(body).not.toContain('Bozeman');
  });

  it('is a page, not a door — the scroll is handed the same numbers', async () => {
    await work('Bozeman', 'a gallery', 'daily', [2, 4]);
    const body = await (await at('/')).text();
    // The tallies ride in the edge attribute, escaped, never in script.
    expect(body).toContain('&quot;letters&quot;:1');
    expect(body).toContain('&quot;hoursLow&quot;:2');
    expect(body).toContain('&quot;hoursHigh&quot;:4');
    expect(body).toContain('&quot;towns&quot;:1');
    // And the mock numbers the mockup carried are gone from the live hand.
    const js = await (await env.ASSETS.fetch('http://example.com/scroll.js')).text();
    expect(js).not.toContain('conversations this season');
    expect(js).not.toContain("'212'");
    expect(js).toContain('recordTally(RECORD)');
    expect(js).toContain('the record, in full');
  });
});
