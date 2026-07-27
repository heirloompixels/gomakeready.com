// The desk — where the practice keeps its books, behind a door that is not
// there for the wrong hand.
//
// Two ways in, and they are one authority wearing different clothes. A
// machine knocks with `Authorization: Bearer <ADMIN_SECRET>`. A browser
// presents the same secret once, at `GET /desk?key=…`, and is handed an
// HMAC-signed cookie in exchange; the address is then cleaned by a redirect,
// so the secret does not sit in the history, the title bar or a screenshot.
// No accounts, no passwords, no user table — the single secret *is* the
// admin identity (CLAUDE.md § CRM).
//
// Everything else answers the house miss, byte for byte: 404, text/plain,
// "Nothing is set at this address.\n", no www-authenticate, no realm, no
// hint that a door was ever here. A locked door advertises what it protects;
// a missing one doesn't. The wrong bearer, the wrong key, a forged cookie, a
// stale cookie and a POST from nowhere are all the same sentence, which is
// the same sentence /nothing-here gets.
//
// The gate organ is hand-copied from portals/the200/src/admin.ts (copy,
// don't extract — CLAUDE.md § Reusable organs); only the miss it hands back
// and the second way in are this house's.
//
// The page itself is thin on purpose: mockup 04's spirit — the stat row, the
// ledger, the hard rules — with the two-pane detail flattened into its own
// address, because a desk that needs client JavaScript to open a lead is a
// desk with a build step. There is no script here at all. Plain forms, plain
// redirects, and every answer no-store.

import type { MiddlewareHandler } from 'hono';
import { html } from 'hono/html';
import {
  type ConversationRow,
  type DeskCounts,
  deskCounts,
  type EventRow,
  frictionsOf,
  getConversation,
  getLead,
  isLeadStatus,
  LEAD_STATUSES,
  type LeadLine,
  type LeadRow,
  type LetterRow,
  leadLines,
  lettersFor,
  listEvents,
  listNotes,
  type NoteRow,
  setLeadStatus,
  sha256hex,
  addNote as writeNote,
} from './db';
import { readSpend } from './spend';
import { sameSig, sign } from './token';
import type { Env } from './types';

// ————— the house miss
//
// Written here rather than imported from the router so the gate can answer
// without the request ever reaching a route. It must stay identical to the
// sentence src/index.ts § notFound sets; the suite asserts the two bodies are
// the same string, so a change to one that forgets the other fails loudly.

const MISS = 'Nothing is set at this address.\n';

const miss = (): Response =>
  new Response(MISS, {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

// A desk is never a page anyone should keep. Nothing here is cached, ever.
const served = (body: string): Response =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

// A field the operator's own form could not have produced. It is not an
// address that failed, so it is not a miss — it is a sentence back.
const refuse = (sentence: string): Response =>
  new Response(sentence + '\n', {
    status: 400,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

// 303 and not 302: what follows a write is a different resource, seen with a
// GET, and the browser must not be able to repeat the POST by going back.
const backTo = (path: string): Response =>
  new Response(null, { status: 303, headers: { location: path, 'cache-control': 'no-store' } });

// ————— the two ways in

/**
 * Constant-time, and the whole comparison rather than a prefix: both sides
 * are hashed to the same width first, so the loop cannot leak the length of
 * the real secret — only the length of the guess, which the guesser already
 * knows. Copied from the200/src/admin.ts § authorized.
 */
export async function sameSecret(offered: string, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256hex(offered), sha256hex(secret)]);
  return sameSig(a, b);
}

/** The machine's knock. The scheme is part of the sentence. */
export async function authorized(req: Request, secret: string): Promise<boolean> {
  const raw = req.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  const offered = raw.startsWith(prefix) ? raw.slice(prefix.length) : '';
  return sameSecret(offered, secret);
}

// The cookie. It carries one fact — the hour it stops being good — signed,
// so the expiry is the Worker's and not the browser's: clearing Max-Age or
// editing the value cannot extend it by a second. Path is /desk and not /,
// which means the piece's visitors never receive it and never send it. The
// page says the site sets no cookies for visitors, and this keeps that true.
//
// `d` because the cookie's name is not information; the200 calls its own `a`
// for the same reason.
export const COOKIE = 'd';

/** Thirty days. Long enough not to be a chore, short enough to be a season. */
export const COOKIE_LIFE = 30 * 24 * 60 * 60;

// Signed with a prefix of its own, so no other signature made with
// SESSION_SECRET — the presence token's, above all — can be read as a
// standing at this desk (src/token.ts § sign).
const cookieBody = (exp: number): string => 'desk.' + exp;

export async function mintCookie(
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const exp = now + COOKIE_LIFE;
  const value = exp + '.' + (await sign(cookieBody(exp), secret));
  // Secure unconditionally: the desk is served over https everywhere it is
  // real, and localhost is a secure context, so wrangler dev keeps it too.
  return (
    COOKIE + '=' + value + '; Path=/desk; HttpOnly; Secure; SameSite=Strict; Max-Age=' + COOKIE_LIFE
  );
}

const COOKIE_RE = new RegExp('(?:^|;\\s*)' + COOKIE + '=([0-9]{1,12})\\.([A-Za-z0-9_-]+)');

/** A forged cookie, a stale one and no cookie at all are the same answer. */
export async function cookieHolds(
  req: Request,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const m = (req.headers.get('cookie') ?? '').match(COOKIE_RE);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp <= now) return false;
  return sameSig(m[2], await sign(cookieBody(exp), secret));
}

/**
 * The gate. Mounted on `/desk` and `/desk/*`, it answers every request to
 * every desk address that is not already through: the ledger, a lead, and
 * both writes. It never speaks — it steps aside, or it was never there.
 */
export const deskGate: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const url = new URL(c.req.url);
  const key = url.searchParams.get('key');

  // The mint. The one place the secret rides in an address, and it does not
  // stay there: the right key answers a redirect to /desk with the cookie
  // attached, and the wrong one answers the miss like anything else. A key
  // offered at any other address is a key in the wrong place.
  if (key !== null) {
    if (
      c.req.method === 'GET' &&
      url.pathname === '/desk' &&
      (await sameSecret(key, c.env.ADMIN_SECRET))
    ) {
      return new Response(null, {
        status: 302,
        headers: {
          location: '/desk',
          'set-cookie': await mintCookie(c.env.SESSION_SECRET),
          'cache-control': 'no-store',
        },
      });
    }
    return miss();
  }

  if (await authorized(c.req.raw, c.env.ADMIN_SECRET)) return next();
  if (await cookieHolds(c.req.raw, c.env.SESSION_SECRET)) return next();
  return miss();
};

// ————— small hands

const WEEK = 7 * 24 * 60 * 60;

/** The catalogue's own form: three digits, zero-filled. */
const no = (n: number | null): string => (n === null ? '—' : 'Nº ' + String(n).padStart(3, '0'));

// UTC, and labelled as such. The Worker has no notion of Bozeman's clock and
// a desk that guessed at one would be lying half the year.
const when = (sec: number): string =>
  new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ');

const dash = (s: string | null): string => (s === null || s === '' ? '—' : s);

const hours = (l: LetterRow): string => {
  if (l.hours_low === null || l.hours_high === null) return '—';
  return l.hours_low === l.hours_high ? String(l.hours_low) : l.hours_low + '–' + l.hours_high;
};

// An id in an address. Same discipline as the letter door: short, digits, and
// anything else is not an address this desk has.
function asId(v: string): number | null {
  if (v.length < 1 || v.length > 9) return null;
  for (const ch of v) if (ch < '0' || ch > '9') return null;
  const n = Number.parseInt(v, 10);
  return n > 0 ? n : null;
}

// ————— the ledger

export async function deskLedger(env: Env): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const [counts, rows, spend] = await Promise.all([
    deskCounts(env.DB, now - WEEK),
    // A hundred is the whole of it. When the ledger outgrows a hundred rows
    // it will want a filter and a second page, and that is a decision for
    // the day it happens rather than a feature built for a desk with four.
    leadLines(env.DB, { limit: 100 }),
    readSpend(env.SPEND),
  ]);
  return served(await ledgerPage(counts, rows, spend));
}

const head = (title: string) => html`<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="/brand.css">
<link rel="stylesheet" href="/scroll.css">
<link rel="stylesheet" href="/desk.css">
</head>`;

const bar = (right: unknown) => html`<header>
  <div class="wrap bar">
    <a href="/desk" class="brandmark">go<span class="p">,</span> make<span class="p">,</span> ready<span class="p">.</span></a>
    <nav><a href="/">The conversation</a><a href="/record">The record</a></nav>
    <div class="end"><span class="eyebrow">${right}</span></div>
  </div>
</header>`;

const foot = html`<footer>
  <div class="wrap">
    <div><b>go, make, ready.</b> — the desk.</div>
    <div>Every conversation is a numbered work. Nothing here is deleted.</div>
  </div>
</footer>`;

export const ledgerPage = (c: DeskCounts, rows: LeadLine[], spend: number) => html`<!doctype html>
<html lang="en">
${head('go, make, ready. — the desk')}
<body>

${bar('The desk')}

<main class="wrap deskwrap">
  <div class="deskhead">
    <h1>The week's <em>conversations.</em></h1>
    <div class="stats">
      <div class="stat"><div class="n p">${c.fresh}</div><div class="l">new this week</div></div>
      <div class="stat"><div class="n">${c.letters}</div><div class="l">letters set</div></div>
      <div class="stat"><div class="n">${c.booked}</div><div class="l">hours booked</div></div>
      <div class="stat"><div class="n">$${spend.toFixed(2)}</div><div class="l">model spend today</div></div>
    </div>
  </div>

  ${
    rows.length === 0
      ? html`<p class="quietnote">No address has been left at the band yet. The ledger opens
          empty, which is a fact about the hour and not a defect in the page.</p>`
      : html`<table class="rows">
    <thead>
      <tr>
        <th>Nº</th><th>Date <span class="d">·</span> UTC</th><th>Town</th>
        <th>Trade</th><th>Level</th><th>Email</th><th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(
        (l) => html`<tr>
        <td class="num"><a href="/desk/lead/${l.id}">${no(l.conversation_id)}</a></td>
        <td class="util">${when(l.created_at)}</td>
        <td>${dash(l.town)}</td>
        <td>${dash(l.trade)}</td>
        <td>${dash(l.level)}</td>
        <td class="util">${l.email}</td>
        <td><span class="status ${l.status}">${l.status}</span></td>
      </tr>`,
      )}
    </tbody>
  </table>`
  }
</main>

${foot}

</body>
</html>
`;

// ————— one lead

export async function deskLead(env: Env, rawId: string): Promise<Response> {
  const id = asId(rawId);
  if (id === null) return miss();

  const lead = await getLead(env.DB, id);
  if (lead === null) return miss();

  const cid = lead.conversation_id;
  const [conversation, events, notes, letters] = await Promise.all([
    cid === null ? Promise.resolve(null) : getConversation(env.DB, cid),
    cid === null ? Promise.resolve([] as EventRow[]) : listEvents(env.DB, cid),
    listNotes(env.DB, id),
    cid === null ? Promise.resolve([] as LetterRow[]) : lettersFor(env.DB, cid),
  ]);

  return served(
    await leadPage(lead, conversation, events, notes, letters.length > 0 ? letters[0] : null),
  );
}

const fact = (k: string, v: string) => html`<div class="fact"><span>${k}</span><b>${v}</b></div>`;

export const leadPage = (
  lead: LeadRow,
  c: ConversationRow | null,
  events: EventRow[],
  notes: NoteRow[],
  letter: LetterRow | null,
) => html`<!doctype html>
<html lang="en">
${head('go, make, ready. — the desk · lead ' + lead.id)}
<body>

${bar(html`The desk <span class="d">·</span> ${no(lead.conversation_id)}`)}

<main class="wrap deskwrap">
  <div class="deskhead">
    <h1>${lead.email}</h1>
    <div class="stats"><a class="back util" href="/desk">← the ledger</a></div>
  </div>

  <div class="pane">
    <div class="k eyebrow">The facts</div>
    ${fact('Left', when(lead.created_at))}
    ${fact('Standing', lead.status)}
    ${fact('Conversation', no(lead.conversation_id))}
    ${fact('Town', dash(c === null ? null : c.town))}
    ${fact('Time zone', dash(c === null ? null : c.timezone))}
    ${fact('Trade', dash(c === null ? null : c.trade))}
    ${fact('Level', dash(c === null ? null : c.level))}
    ${fact('Frictions', c === null || frictionsOf(c).length === 0 ? '—' : frictionsOf(c).join(' · '))}
    ${fact('In the record', dash(c === null ? null : c.visibility))}
  </div>

  <div class="pane">
    <div class="k eyebrow">The letter</div>
    ${
      letter === null
        ? html`<p class="quietnote">No letter was set for this conversation.</p>`
        : html`${fact('Letter', no(letter.number))}
          ${fact('Hours a week', hours(letter))}
          ${fact('Set', when(letter.created_at))}
          <p class="quietnote">The address the visitor keeps carries a key this desk does not
            have. Only its hash was ever written down, so the link cannot be reproduced from
            here — a letter that has been lost is set again, not looked up.</p>`
    }
  </div>

  <div class="pane">
    <div class="k eyebrow">Move it</div>
    <div class="acts">
      <form method="post" action="/desk/lead/${lead.id}/status">
        <select name="status" aria-label="Standing">
          ${LEAD_STATUSES.map(
            (s) => html`<option value="${s}"${s === lead.status ? ' selected' : ''}>${s}</option>`,
          )}
        </select>
        <button class="cta ghost" type="submit">Set the standing</button>
      </form>
    </div>
  </div>

  <div class="pane">
    <div class="k eyebrow">The margin <span class="d">·</span> ${notes.length}</div>
    ${
      notes.length === 0
        ? html`<p class="quietnote">Nothing written in the margin yet.</p>`
        : html`<ul class="notes">${notes.map(
            (n) => html`<li><span class="util when">${when(n.at)}</span>${n.body}</li>`,
          )}</ul>`
    }
    <form class="notely" method="post" action="/desk/lead/${lead.id}/note">
      <textarea name="body" rows="3" maxlength="2000" required
        placeholder="What was true when you wrote it. The correction is the next note."></textarea>
      <button class="cta" type="submit">Write it down</button>
    </form>
  </div>

  <div class="pane">
    <div class="k eyebrow">The transcript <span class="d">·</span> ${events.length} lines</div>
    ${
      events.length === 0
        ? html`<p class="quietnote">This address was left off the band alone — there is no
            conversation behind it.</p>`
        : events.map(
            (e) => html`<div class="turn ${e.role === 'site' ? 'site' : 'you'}">
        <div class="who">${e.seq} <span class="d">·</span> ${e.role}${
          e.stage === null ? '' : html` <span class="d">·</span> ${e.stage}`
        }</div>
        <div class="txt">${e.body}</div>
      </div>`,
          )
    }
  </div>
</main>

${foot}

</body>
</html>
`;

// ————— the two writes
//
// CSRF, in one sentence: the cookie is SameSite=Strict, so no other origin
// can cause a browser to send it, and the bearer path is not a browser at
// all. With a single operator and no third-party embedding, that is the
// whole defence — a hidden token per form would be ceremony over a door
// nobody else can knock on. It is written here so the next hand knows the
// stance was chosen and not forgotten. If the desk ever grows a second
// operator or an iframe, this comment is the thing to come back to.

export async function deskStatus(env: Env, req: Request, rawId: string): Promise<Response> {
  const id = asId(rawId);
  if (id === null) return miss();

  const form = await req.formData();
  const status = String(form.get('status') ?? '');
  if (!isLeadStatus(status)) return refuse('That is not a standing a lead can take.');

  const row = await setLeadStatus(env.DB, id, status);
  if (row === null) return miss();
  return backTo('/desk/lead/' + id);
}

/** Long enough for a paragraph of margin, short enough not to be a document. */
export const NOTE_MAX = 2000;

export async function deskNote(env: Env, req: Request, rawId: string): Promise<Response> {
  const id = asId(rawId);
  if (id === null) return miss();

  const form = await req.formData();
  const body = String(form.get('body') ?? '').trim();
  if (body.length < 1) return refuse('An empty note is not a note.');
  if (body.length > NOTE_MAX) return refuse('That is more margin than this desk will take.');

  // Checked before the write rather than caught after it: notes carries a
  // foreign key to leads, and a database error is not a sentence.
  if ((await getLead(env.DB, id)) === null) return miss();
  await writeNote(env.DB, id, body);
  return backTo('/desk/lead/' + id);
}
