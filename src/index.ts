// go, make, ready. — the Worker.
//
// The piece and two organs: the scroll, server-rendered from `hono/html`
// with its greeting settled at the edge; a health route that names its own
// commit; and a miss answered in the piece's voice rather than a stack trace.
// The stylesheets, the fonts and the client hand are static assets, served
// from this origin and no other.
import { Hono } from 'hono';
import { exportArchive } from './archive';
import { handleAsk } from './ask';
import { engineOn, handleSession, handleTurn } from './converse';
import { recordAggregates } from './db';
import { edgeGreeting, type Where } from './greeting';
import { guardHeaders } from './headers';
import { handleLetter } from './letter';
import { record } from './record';
import { scroll } from './scroll';
import type { Env } from './types';

export { SessionDO } from './session-do';

const READ = ['GET', 'HEAD'];

// Nothing loads from anywhere but here. The page carries no inline style and
// no inline script — the mockup's style="" attributes are classes in
// assets/scroll.css and its onsubmit is bound in assets/scroll.js — so the
// policy needs no 'unsafe-inline' to keep a single word of the design. The
// injected greeting rides in a data attribute, which is not script at all.
// connect-src is 'self' for the streamed conversation at step 4.
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; " +
  "img-src 'self' data:; connect-src 'self'; form-action 'self'; " +
  "base-uri 'none'; frame-ancestors 'none'";

const CACHE_STABLE = 'public, max-age=60';
const CACHE_NONE = 'no-store';

function respond(body: string, type: string, status: number, cache: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': type + '; charset=utf-8', 'cache-control': cache },
  });
}

const page = (body: string): Response => respond(body, 'text/html', 200, CACHE_STABLE);

const json = (data: unknown): Response =>
  respond(JSON.stringify(data, null, 1) + '\n', 'application/json', 200, CACHE_NONE);

// ————— routes

const app = new Hono<{ Bindings: Env }>();

app.use(guardHeaders(CSP));

// A miss is not a route. It is a plain sentence, and it is the whole answer.
app.notFound(() => respond('Nothing is set at this address.\n', 'text/plain', 404, CACHE_NONE));

// Hono types `raw.cf` for both directions of the wire; on the way in it is
// always Cloudflare's own, and it carries the town and the time zone.
const where = (req: Request): Where | undefined =>
  (req as Request<unknown, IncomingRequestCfProperties>).cf;

// The scroll. Cloudflare says where the reader is; the greeting is composed
// here, before the first byte, and the browser is told rather than asked.
// Whether there is an engine behind the conversation is settled here too, so
// the page never offers a correspondence the Worker cannot pay for: with no
// key, or past the day's cap, the client runs its scripted bank exactly as it
// did before step 4 and the visitor is told nothing about wallets.
app.on(READ, '/', async (c) =>
  page(
    await scroll(
      edgeGreeting(where(c.req.raw)),
      await engineOn(c.env),
      await recordAggregates(c.env.DB),
    ),
  ),
);

// The record, in full. Aggregates only — the page cannot print a name
// because the query cannot select one (src/db.ts § the record). Cached for
// a minute: it changes once per conversation, and a minute of staleness on
// a public tally is cheaper than a database read per reader.
app.on(READ, '/record', async (c) => page(await record(await recordAggregates(c.env.DB))));

// A letter, at its own address, with its own key. Everything that is not a
// live letter and the right key is a miss like any other (src/letter.ts).
app.on(READ, '/letter/:number', (c) => handleLetter(c.env, c.req.raw, c.req.param('number')));

// What the Worker knows about itself: that it is up, and which commit it was
// cut from. `wrangler deploy --var COMMIT:$(git rev-parse --short HEAD)`.
app.on(READ, '/_health', (c) => json({ ok: true, name: 'gmr', commit: c.env.COMMIT }));

// The ask band. The one public write so far, and the only address at which
// this Worker answers a POST — a GET here is a miss like any other, because
// there is no page to see. The guards live with the handler (src/ask.ts).
app.post('/ask', (c) => handleAsk(c.env, c.req.raw));

// The conversation. `/session` is reachable only once the sentence on-ramp is
// complete — the client posts what the visitor composed — and `/turn` only
// with the presence token `/session` minted. Neither is a page; a GET at
// either is a miss like any other (src/converse.ts).
app.post('/session', (c) => handleSession(c.env, c.req.raw));
app.post('/turn', (c) => handleTurn(c.env, c.req.raw));

// ————— the cron
//
// Once a day, at a quiet hour, the whole archive is copied to R2
// (src/archive.ts). No alarm, no polling, no queue: `triggers.crons` in
// wrangler.jsonc is the event, and this is the handler.
// Awaited rather than handed to waitUntil: the export is the whole of the
// job, so the invocation should live exactly as long as it does and its
// failure should be the invocation's failure.
const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env) => {
  await exportArchive(env, new Date(event.scheduledTime));
};

export default { fetch: app.fetch, scheduled };
