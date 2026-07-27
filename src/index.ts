// go, make, ready. — the Worker.
//
// A holding page and two organs. The piece itself (mockups/05-the-scroll.html)
// is ported at step 3; what stands here is the shape it will be poured into:
// server-rendered HTML from `hono/html`, a health route that names its own
// commit, and a miss answered in the piece's voice rather than a stack trace.
import { Hono } from 'hono';
import { html } from 'hono/html';
import type { Env } from './types';

const READ = ['GET', 'HEAD'];

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

// ————— the holding page: one line, set on paper, until the press is loaded

const INK = '#0d1f29';
const PAPER = '#f7f4ef';
const PLUM = '#7d4060';

const holding = () => html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>go, make, ready.</title>
    <style>
      html { background: ${PAPER}; color: ${INK}; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        font: 400 clamp(1.25rem, 1rem + 1.2vw, 1.75rem)/1.6
              'EB Garamond', Garamond, 'Iowan Old Style', Georgia, serif;
      }
      p { margin: 0; padding: 0 2rem; max-width: 28em; text-align: center; }
      .c { color: ${PLUM}; }
    </style>
  </head>
  <body>
    <p>go<span class="c">,</span> make<span class="c">,</span> ready. — the press is being set.</p>
  </body>
</html>
`;

// ————— routes

const app = new Hono<{ Bindings: Env }>();

// A miss is not a route. It is a plain sentence, and it is the whole answer.
app.notFound(() => respond('Nothing is set at this address.\n', 'text/plain', 404, CACHE_NONE));

app.on(READ, '/', async () => page(await holding()));

// What the Worker knows about itself: that it is up, and which commit it was
// cut from. `wrangler deploy --var COMMIT:$(git rev-parse --short HEAD)`.
app.on(READ, '/_health', (c) => json({ ok: true, name: 'gmr', commit: c.env.COMMIT }));

export default { fetch: app.fetch };
