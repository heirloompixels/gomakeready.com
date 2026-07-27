// The presence token. It is the only thing standing between a stranger and a
// model call, so it is tested as the guard it is: what it lets through, and
// the four ways it says no.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { mintToken, readToken, TOKEN_LIFE } from '../src/token';

const SECRET = 'test-secret';
const now = 1_800_000_000;

describe('the presence token', () => {
  it('reads back what it was minted with', async () => {
    const t = await mintToken('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 52, SECRET, now);
    const p = await readToken(t, SECRET, now + 60);
    expect(p).toEqual({
      sid: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      cid: 52,
      exp: now + TOKEN_LIFE,
    });
  });

  it('is signed with the Worker’s own secret and no other', async () => {
    const t = await mintToken('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 1, SECRET, now);
    expect(await readToken(t, 'some-other-secret', now)).toBeNull();
    // The suite's binding is the secret the Worker actually signs with.
    expect(await readToken(t, env.SESSION_SECRET, now)).not.toBeNull();
  });

  it('is a ticket for one sitting', async () => {
    const t = await mintToken('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 1, SECRET, now);
    expect(await readToken(t, SECRET, now + TOKEN_LIFE - 1)).not.toBeNull();
    expect(await readToken(t, SECRET, now + TOKEN_LIFE)).toBeNull();
  });

  it('refuses a token that was edited on the way back', async () => {
    const t = await mintToken('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 7, SECRET, now);
    const [sid, cid, exp, sig] = t.split('.');
    // Another conversation's Nº, the same signature.
    expect(await readToken([sid, '8', exp, sig].join('.'), SECRET, now)).toBeNull();
    // A later expiry, the same signature.
    expect(await readToken([sid, cid, String(now + 99999), sig].join('.'), SECRET, now)).toBeNull();
    // One bit of the signature.
    const bent = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(await readToken([sid, cid, exp, bent].join('.'), SECRET, now)).toBeNull();
  });

  it('refuses junk without reading it twice', async () => {
    for (const junk of [
      '',
      'x',
      'not.a.token',
      'a.b.c.d',
      '../../etc/passwd',
      'x'.repeat(600),
      'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d.1.notanumber.sig',
    ]) {
      expect(await readToken(junk, SECRET, now)).toBeNull();
    }
  });
});
