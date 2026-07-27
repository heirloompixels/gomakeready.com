// The ask band's one door: an address left at the bottom of the scroll.
//
// This is the first public write the piece has, so it is the first place the
// house guardrails apply (CLAUDE.md § Guardrails). It is deliberately the
// cheap door — it touches no model, spends nothing, and can therefore be
// defended with a honeypot and a pair of length caps rather than a presence
// token. The expensive door, at step 4, gets the token and the budget.
//
// Everything here answers `no-store`. An address left is not a page.

import { createLead, getConversation } from './db';
import type { Env } from './types';

// The whole body, not just the address: a form with three fields has no
// business being larger than this, and the cap is checked before the body is
// read into memory as well as after.
const BODY_MAX = 4096;

// RFC 5321's limit on a path. Anything longer is not an address, it is an
// attempt at something.
const EMAIL_MAX = 254;

// What the band says back when it worked. The button wears this sentence;
// the server owns the words so the piece can change its mind in one place.
const SAID = 'Spoken for. Watch your inbox.';

function respond(body: string, type: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const spoken = (): Response =>
  respond(JSON.stringify({ ok: true, said: SAID }) + '\n', 'application/json', 200);

// A refusal is a plain sentence, in the register, and it is the whole answer —
// no field names, no codes, nothing for a script to sort itself by.
const refuse = (sentence: string): Response => respond(sentence + '\n', 'text/plain', 400);

// ————— the address, checked by hand
//
// Permissive on purpose: something@something.something, no whitespace, no
// second @. The only address that matters is one a letter can reach, and the
// mail server is the authority on that — a strict pattern here would refuse
// real people to catch fake ones the mailer would bounce anyway.
export function isEmail(s: string): boolean {
  if (s.length < 6 || s.length > EMAIL_MAX) return false;
  // No space, no control character: everything at or below U+0020, and DEL.
  for (const ch of s) if (ch <= ' ' || ch === '\u007f') return false;

  const at = s.indexOf('@');
  if (at < 1 || at !== s.lastIndexOf('@')) return false;

  const domain = s.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  if (dot < 1 || dot === domain.length - 1) return false;
  if (domain.includes('..')) return false;
  if (domain.length - dot - 1 < 2) return false; // a tld is two letters or more

  return true;
}

// The Nº the visitor was conversing under, if they were. Anything that is not
// a plain positive integer is simply not a conversation.
function asNumber(v: string): number | null {
  if (v.length < 1 || v.length > 12) return null;
  for (const ch of v) if (ch < '0' || ch > '9') return null;
  const n = parseInt(v, 10);
  return n > 0 ? n : null;
}

// ————— reading the body
//
// The band posts form-encoded, because a form is what it is. JSON is taken
// too, for the desk, for a smoke script, and for whatever asks next.

interface Said {
  email: string;
  website: string; // the honeypot
  conversation: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function fromJSON(raw: string): Said | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  // A number is tolerated for the Nº — JSON has integers and a caller will
  // send one; everything else must arrive as text.
  const conv = typeof o.conversation === 'number' ? String(o.conversation) : str(o.conversation);
  return { email: str(o.email), website: str(o.website), conversation: conv };
}

function fromForm(raw: string): Said {
  const p = new URLSearchParams(raw);
  return {
    email: p.get('email') ?? '',
    website: p.get('website') ?? '',
    conversation: p.get('conversation') ?? '',
  };
}

// ————— the door

export async function handleAsk(env: Env, req: Request): Promise<Response> {
  // The cheapest refusal first: what the sender says it is bringing.
  const declared = parseInt(req.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(declared) && declared > BODY_MAX) {
    return refuse('That is more than this desk will take.');
  }

  // Read as bytes, not as text: the cap is a cap on what arrived, and a
  // multi-byte character should not buy a sender three times the room.
  // (It also keeps workerd from warning that a form body is not text.)
  let bytes: ArrayBuffer;
  try {
    bytes = await req.arrayBuffer();
  } catch {
    return refuse('The desk could not make that out.');
  }
  // And what it actually brought — a chunked body declares nothing.
  if (bytes.byteLength > BODY_MAX) return refuse('That is more than this desk will take.');
  const raw = new TextDecoder().decode(bytes);

  const type = req.headers.get('content-type') ?? '';
  const said = type.includes('json') ? fromJSON(raw) : fromForm(raw);
  if (said === null) return refuse('The desk could not make that out.');

  // The honeypot. A field no honest hand can reach: off the page, out of the
  // tab order, hidden from a screen reader. Filled means a machine filled it,
  // and a machine is answered exactly as a person is — same status, same
  // sentence, same shape — while nothing at all is written down. Telling it
  // that it failed is how it learns to stop failing.
  if (said.website.trim().length > 0) return spoken();

  const email = said.email.trim();
  if (!isEmail(email)) return refuse('That address will not carry a letter. Try it again.');

  // The Nº, when the band was reached the long way. A stale or invented one
  // costs the visitor nothing: the lead stands alone and the desk sorts it.
  // Losing an address over a bad id would be the database refusing work.
  let conversationId: number | null = asNumber(said.conversation);
  if (conversationId !== null && !(await getConversation(env.DB, conversationId))) {
    conversationId = null;
  }

  await createLead(env.DB, { email, conversationId });
  return spoken();
}
