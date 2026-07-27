// The two expensive doors: where a conversation is opened, and where it is
// carried on. Everything either of them does is a guardrail until the last
// line, which hands the work to the session Durable Object.
//
//   /session  the on-ramp completed — the investment gate. Opens the work in
//             the archive, wakes a session, and mints the presence token.
//   /turn     one exchange. Verifies the token, routes to the session, and
//             streams back whatever the session says.
//
// The doors hold the cheap checks (shape, size, signature); the session holds
// the ones that cost money (exchanges, spend, length in register). Nothing
// here can be reached without having composed the sentence first, and nothing
// here spends a cent on its own (CLAUDE.md § Guardrails).

import { createConversation, setConversationFacts } from './db';
import { overCap } from './spend';
import { mintToken, readToken } from './token';
import type { Env } from './types';

/** A body from this page is a sentence and a token. Nothing needs 2KB. */
const BODY_MAX = 2048;

/** The sentence's parts, capped where a hand would stop and a script wouldn't. */
const TRADE_MAX = 80;
const FRICTION_MAX = 90;
const FRICTIONS_MAX = 6;

function respond(body: string, type: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const json = (data: unknown, status = 200): Response =>
  respond(JSON.stringify(data) + '\n', 'application/json', status);

const refuse = (sentence: string): Response => respond(sentence + '\n', 'text/plain', 400);

// A door that will not open is not a door. Bad tokens, missing sessions and
// invented addresses all get the same sentence the rest of the Worker gives a
// miss — nothing here is an oracle for what a valid token looks like.
const miss = (): Response => respond('Nothing is set at this address.\n', 'text/plain', 404);

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const declared = Number.parseInt(req.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(declared) && declared > BODY_MAX) return null;
  let bytes: ArrayBuffer;
  try {
    bytes = await req.arrayBuffer();
  } catch {
    return null;
  }
  if (bytes.byteLength > BODY_MAX) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ————— is there an engine at all
//
// Two conditions, checked in the same place for the page and for the door, so
// a visitor is never offered a conversation the Worker cannot pay for.

export async function engineOn(env: Env): Promise<boolean> {
  if (!env.ANTHROPIC_API_KEY) return false;
  return !(await overCap(env.SPEND, env.DAILY_CAP_USD));
}

// ————— /session

interface Sentence {
  trade: string;
  frictions: string[];
}

// Hand-rolled, like every other check in this repo: the shape is four lines
// of specification and a schema library would be a dependency spent on it.
function readSentence(body: Record<string, unknown>): Sentence | null {
  const trade = typeof body.trade === 'string' ? body.trade.trim() : '';
  if (trade.length < 1 || trade.length > TRADE_MAX) return null;

  const raw = body.frictions;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > FRICTIONS_MAX) return null;
  const frictions: string[] = [];
  for (const f of raw) {
    if (typeof f !== 'string') return null;
    const t = f.trim();
    if (t.length < 1 || t.length > FRICTION_MAX) return null;
    frictions.push(t);
  }
  return { trade, frictions };
}

type Where = Pick<IncomingRequestCfProperties, 'city' | 'timezone'>;

export async function handleSession(env: Env, req: Request): Promise<Response> {
  const body = await readBody(req);
  if (body === null) return refuse('That is more than this desk will take.');

  const sentence = readSentence(body);
  if (sentence === null) return refuse('That is not a sentence this page can read.');

  // No key, or the day is spent: the page keeps its scripted bank and the ask
  // band still takes an address. The visitor is told nothing about wallets.
  if (!(await engineOn(env))) return json({ engine: false });

  const cf = (req as Request<unknown, IncomingRequestCfProperties>).cf as Where | undefined;
  const conversation = await createConversation(env.DB, {
    town: cf?.city?.trim() || null,
    timezone: cf?.timezone?.trim() || null,
  });
  await setConversationFacts(env.DB, conversation.id, {
    trade: sentence.trade,
    frictions: sentence.frictions,
  });

  // The session's name is a fresh uuid and nothing else — not the Nº, not the
  // address, not anything a stranger could guess their way to.
  const sid = crypto.randomUUID();
  const stub = env.SESSION.get(env.SESSION.idFromName(sid));
  await stub.fetch('https://session/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      cid: conversation.id,
      trade: sentence.trade,
      frictions: sentence.frictions,
      town: conversation.town,
    }),
  });

  return json({
    engine: true,
    token: await mintToken(sid, conversation.id, env.SESSION_SECRET),
    conversation: conversation.id,
  });
}

// ————— /turn

export async function handleTurn(env: Env, req: Request): Promise<Response> {
  const body = await readBody(req);
  if (body === null) return refuse('That is more than this desk will take.');

  const token = typeof body.token === 'string' ? body.token : '';
  const presence = await readToken(token, env.SESSION_SECRET);
  if (presence === null) return miss();

  const stub = env.SESSION.get(env.SESSION.idFromName(presence.sid));
  const answer = await stub.fetch('https://session/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ said: typeof body.said === 'string' ? body.said : '' }),
  });

  // Re-wrapped rather than returned: a subrequest's headers are sealed, and
  // the guard middleware has three of its own to add. The body is passed
  // through untouched, still streaming.
  return new Response(answer.body, {
    status: answer.status,
    headers: new Headers(answer.headers),
  });
}
