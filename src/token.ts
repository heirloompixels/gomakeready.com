// The presence token.
//
// Hand-copied from portals/the200/src/session.ts (copy, don't extract —
// CLAUDE.md § Reusable organs) and adapted: the200 signs a cookie that says
// *who is here*; this signs a ticket that says *this visitor completed the
// sentence on-ramp, at this hour, for this conversation*. No cookie, no
// identity, nothing stored in the browser but the string itself, which the
// page throws away when the tab closes.
//
// It is the investment gate in one line: the model door will not open for a
// request that cannot present one, and only /session mints them
// (CLAUDE.md § Guardrails 1–3).

const enc = new TextEncoder();

// The key is imported once per secret and kept, because a Worker isolate may
// answer a thousand turns and importKey is not free.
let keyCache: { secret: string; key: CryptoKey } | null = null;
async function hmacKey(secret: string): Promise<CryptoKey> {
  if (keyCache && keyCache.secret === secret) return keyCache.key;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  keyCache = { secret, key };
  return key;
}

const b64url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

/** What the token carries. Nothing else is in it, and nothing else is needed. */
export interface Presence {
  /** The session Durable Object's name — a uuid, meaningless on its own. */
  sid: string;
  /** The conversation Nº, so the archive and the working memory agree. */
  cid: number;
  /** Unix seconds. A ticket for one sitting, not a season pass. */
  exp: number;
}

/** Two hours. Longer than any conversation; shorter than a working day. */
export const TOKEN_LIFE = 2 * 60 * 60;

const body = (p: Presence): string => p.sid + '.' + p.cid + '.' + p.exp;

export async function mintToken(
  sid: string,
  cid: number,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const p: Presence = { sid, cid, exp: now + TOKEN_LIFE };
  return body(p) + '.' + (await sign(body(p), secret));
}

// Length-independent comparison. The signature is the whole of the guard, so
// it is compared in constant time for its length: an attacker learns how long
// their own guess was and nothing else.
function sameSig(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The token, read back. Anything that is not a live, correctly signed ticket
 * answers null — a bad signature, a stale hour and a hand-typed guess are all
 * the same answer, and the caller turns all three into the same miss.
 */
export async function readToken(
  token: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<Presence | null> {
  if (typeof token !== 'string' || token.length < 8 || token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [sid, rawCid, rawExp, sig] = parts;
  if (!/^[0-9a-f-]{16,64}$/.test(sid)) return null;
  if (!/^[0-9]{1,12}$/.test(rawCid) || !/^[0-9]{1,12}$/.test(rawExp)) return null;

  const p: Presence = { sid, cid: Number(rawCid), exp: Number(rawExp) };
  if (p.exp <= now) return null;
  if (!sameSig(sig, await sign(body(p), secret))) return null;
  return p;
}
