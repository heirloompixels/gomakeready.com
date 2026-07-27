# CLAUDE.md — gomakeready.com

Read this before writing anything. The law changed in July 2026. If you
remember the old rules — static Zola, no JS, GitHub Pages — forget them;
they served the brochure, and the brochure is over.

This repo follows the **house infrastructure style** defined in
`/Users/kpc/www/portals/CLAUDE.md` (which names gmr as a proving ground for
it). Where this file is silent on tooling or Cloudflare matters, portals'
conventions and its `docs/cloudflare-access.md` / `docs/cloudflare-costs.md`
are the law here too.

## What this is

**go, make, ready.** is three things at once, deliberately, and sees no
contradiction — the old job-printing shops never did. The wedding invitation
paid the rent and was still set true.

1. **An artwork.** A conversational website that addresses its visitor,
   interviews them in a human hand, and sets them a letter about their own
   hours. The piece is titled *go, make, ready.* and will be written up in
   Kyle Parker Cunningham's oeuvre. Presented with **Truth or Consequences
   Contemporary** (torc.art), the gallery Kyle runs in T or C, New Mexico.
2. **A practice.** AI-integration consulting for small owner-operated
   businesses — Bozeman, Santa Fe, Vail, Aspen. The site is the funnel and
   the demonstration at once: the conversation *is* the product.
3. **A thesis.** This is the first genuinely new way to use a computer in
   decades — like the internet, but better, and it is that early. The site's
   job is to shift the visitor's reality: guide them to understand the next
   decades of computer interaction, and to want to be early.

## The piece (settled — do not redesign)

The reference implementation is `mockups/05-the-scroll.html`. Its decisions
are law until Kyle says otherwise:

- **One continuous scroll.** No page navigation. Everything — greeting,
  interview, letter, record, ask — pours into a single rolling measure.
  Nav items are **forks**: questions the visitor may ask back (*What is
  this? Who is doing this? What does it cost? The record*), each typed into
  the scroll where the reader stands. Forks type faster (~0.55×).
- **The typist.** The machine writes in a human hand: uneven cadence,
  occasional adjacent-key slips noticed and backspaced, breath after commas,
  rarely a word struck and reset. Capped and subtle — at most 3 slips per
  long line, 1 per short line. This pacing is also the model's rate limiter:
  you must watch the presentation to use the tool.
- **The disclosure.** Early and subtle, in the greeting, unexplained:
  *"No one is typing this."* It detonates at the climax, which calls back to
  it. The site never pretends a human is typing; the hand is theater, the
  disclosure is law.
- **The arc.** Sentence on-ramp (*"I keep a gallery, and the week disappears
  into…"* — composed by the visitor from inline typeset choices, never form
  controls) → calibration (*how do you stand with the thing everyone calls
  AI?* — with the two-step: if they don't know, explain plainly and ask
  again, gentler) → a teaching turn pitched to their level (daily / burned /
  nodded / new) → ideas made theirs, drawn from their trade, each ending in a
  question back → the climax (*it is 1996 again* + disclosure callback) →
  the letter → the ask. Never lead with the word "AI" — the sentence comes
  first; calibration is earned.
- **The letter.** Numbered (*Nº n*), set as a printed document, findings
  with hours attached, closing on the thesis. Theirs to keep either way.
- **The record.** Public from day one, anonymized always. The consent line
  is the piece's own: *"Nothing said here is kept whole. It is melted down,
  like old type, and recast without a name."* Aggregates only — counts,
  words, hours — never names, never quotes traceable to a person. Printed
  seasonally as a letterpress broadside with torc.art.
- **The ask.** The first hour is **$50** — "the money is what makes it
  honest." It buys the hour, a working demonstration built on their own
  material, and their letter printed. Refunded on request if the hour wasn't
  worth it. The setup and on-call tiers still carry `$——` placeholders —
  **do not invent prices.**

## Architecture (target)

A TypeScript Cloudflare Workers app. One deploy serves everything. Best
tool for the job — no hand-rolling for purity's sake, no dependencies for
convenience's sake; dependencies stay countable on one hand.

- **Worker foundation: Hono** — for routing and middleware only. SQL stays
  hand-written (no ORM), validation stays hand-rolled (no zod-by-reflex).
  Misses answer in the language they were asked (custom `notFound`);
  cache/CSP headers are deliberate, not defaults.
- **Pages:** server-rendered HTML from the Worker, streamed, written with
  `hono/html` tagged templates (interpolations auto-escape) — never
  hand-concatenated strings. The Worker knows the visitor's town
  (`request.cf.city`) and hour and sets the greeting at the edge. No
  cookies for visitors, no tracking, and the page says so.
- **Client layer: bundled vanilla TypeScript, no framework** — native
  `fetch`, SSE/WebSocket, direct DOM. The typist engine is the most complex
  thing on the page. htmx is retired house-wide; don't reach for it.
- **Model:** Anthropic API, called only from the Worker. Haiku runs the
  interview; one Sonnet-class call sets the letter. Stream tokens to the
  page; the typist paces them.
- **Data:** D1 (one database, this project's own — never shared), migrations
  checked into the repo. Durable Objects for live session state and
  per-session budget; **never poll — wake on events** (DO alarms for when a
  thing is due, never interval tickers; duration billing —
  `portals/docs/cloudflare-costs.md`). KV for the daily spend tally.
  **The archive is the schema default:** append-only conversation events,
  nothing hard-deleted, visibility flags not destruction; D1 time travel
  plus a scheduled export to R2. Raw transcripts stay private; the public
  record is melted aggregates only.
- **CRM:** the "desk" — thin admin UI served by the same Worker behind the
  house **single-secret admin gate** (HMAC cookie, no accounts, the door an
  invisible 404 to everyone else — copy the organ from portals, don't
  reinvent). And an **MCP server at `gomakeready.com/mcp`** (tools:
  `list_leads`, `get_lead`, `update_status`, `add_note`, `weekly_digest`),
  bearer-token secret stored like the portals admin secrets
  (`~/.config/cloudflare/…`, mode 0600, never printed). Kyle's daily
  interface is Claude Desktop with this connector plus Gmail. The CRM is
  also the piece's catalogue: every conversation is a numbered work.
- **Reusable organs** (session, guard, admin gate, header stack as Hono
  middleware): **copy from portals, don't extract** — hand-copied until a
  third use proves the pattern.

### Toolchain (house)

- **pnpm** with versions pinned; strict `tsconfig` extending the house base
  (`portals/tsconfig.base.json` is the reference). **Biome** lints/formats
  (house config: `useTemplate` off; mockups, HTML, fixtures, migrations
  excluded — handcrafted surfaces stay handcrafted).
- **Vitest + `@cloudflare/vitest-pool-workers`** for unit/integration tests
  inside workerd against real D1/DO bindings (`portals/the200/test/` is the
  reference setup). Playwright/smoke scripts for the browser layer —
  anything touching the live layer or client JS gets a **real browser
  smoke** against `wrangler dev`, not just curl.
- Plain `wrangler dev` until a real client bundle grows; then
  **Vite + `@cloudflare/vite-plugin`**.
- `"observability": { "enabled": true }` in `wrangler.jsonc`.
- **CI is checks only** (biome, typecheck, tests). **Deploys are a hand
  running wrangler** — a launch is a release moment, not a push effect.
  Config checked in; commit embedded and reported at `/_health`.

### Cloudflare account (get this right)

- Deploy to **analogkyle's account** (`e31907b848be2fd0a182757d8c938594`) —
  gomakeready.com is assigned there. **Pin `account_id` in
  `wrangler.jsonc`**; the default OAuth login points at the *other* (old
  snow) account and gets it wrong silently.
- Token: `source ~/.config/cloudflare/kpc.env` (via `set -a`). **Never
  print that file** — verify with `grep -c`, not `cat`. Full rules:
  `portals/docs/cloudflare-access.md`.
- `gomakeready.com`'s **nameservers are not on the account yet** — they
  must move before the custom domain binds. Until then the Worker serves at
  `<name>.analogkyle.workers.dev`. This is a launch blocker.
- Be on **Workers Paid** before the first public deploy; the free plan
  stops serving rather than degrading.

### Guardrails (law, not suggestions)

The chat endpoint is an open wallet unless all of these hold:

1. No model call before the visitor completes the sentence on-ramp — the
   on-ramp is the investment gate.
2. Public writes are defended the house way: **presence token** minted by
   the session DO when the on-ramp completes, rate limits (DO-side + edge
   rules), honeypot, length caps. Cloudflare's invisible bot mitigation is
   welcome; **Turnstile widgets are chrome and are not.**
3. Per-session cap (~10–12 exchanges, short `max_tokens`); budget enforced
   in the Durable Object; the session token is signed and required on every
   model-touching request.
4. Daily global spend cap in KV; past it, the funnel degrades gracefully to
   the on-ramp + "leave an email, the letter comes by hand."
5. The interviewer interviews. It asks; it does not answer arbitrary
   requests; it stays in register and in scope.

## Design constraints (unchanged)

The visual identity survives the rewrite untouched.

- **Ink:** `#0d1f29` — Prussian-derived near-black. Reads as *ink*, not blue.
- **Accent:** `#7d4060` plum. Commas, rules, links, the caret.
- **Paper:** `#f7f4ef`; `#fbf9f6` for inset panels. **Rules:** `#d8d1c7`.
- **Kyle does not like blue.** If unavoidable, Prussian, oil-paint dark.
  Never tech blue, never ultramarine.
- **Type:** EB Garamond (display, body) + DM Sans (utility). Mockups load
  Google Fonts via `<link>`; the Workers app **self-hosts the fonts** —
  house rule: pages are self-contained at runtime, zero external requests
  from the visitor's browser beyond our own origins.
- Wordmark: **`go, make, ready.`** lowercase, commas in plum. Spoken name:
  Go Make Ready.
- Swiss grid discipline carrying letterpress warmth. The body sits on one
  centered measure with a 190px rail; hard rules, generous negative space.
- **No CSS frameworks. Hand-written CSS.**

## Voice

Plainspoken, unhurried, and now a little withheld — curiosity is built by
declining to explain, never by confusing. Shaker severity, warm. No hype,
no jargon, no exclamation points. Lead with their hours and the thesis,
never with "AI." Never imply the tool replaces the client's taste, voice,
or judgment — it asks for their sign-off, not their soul. The credential is
the nineties: Unix (Sun, SGI, BSD, Linux) and building the web when there
was no template — *being early was a superpower, and it is that morning
again.*

## Working agreement

- Brainstorm in text first — Kyle wants conversation and minimal mockups
  before real builds. Don't jump to implementation.
- Small, reviewable commits; typecheck and tests green before a step is
  done.

## State of the work

- `mockups/01–04` — the iteration record (superseded by 05, kept on purpose).
- `mockups/05-the-scroll.html` — **the reference.** Read it before touching
  the piece.
- The Zola brochure (`templates/`, `content/`, `config.toml`) still builds
  and still deploys; it remains live until the Workers app replaces it.
  Migration is the current task.
- `print/` — letterpress leave-behind (WeasyPrint). Will also set the
  letters and the seasonal record broadsides.
- `docs/TODO.md` — open tasks. Launch blockers: setup/on-call pricing
  placeholders, trademark check, **gomakeready.com nameservers → the
  analogkyle Cloudflare account**.

## Running

```
make dev             # wrangler dev, localhost:8787 — the Worker
make typecheck       # tsc --noEmit
make test            # vitest inside workerd
make check           # biome + typecheck + test — green before a step is done

make run             # zola serve, localhost:1111 — the old brochure
make build           # zola build into public/
make print           # re-render the leave-behind PDF
```

pnpm only. The Worker's static assets live in `assets/` (fonts, the client
bundle); `public/` stays the Zola build output until the brochure retires.

Deploys are a hand, and they carry the sha:

```
pnpm wrangler deploy --var COMMIT:$(git rev-parse --short HEAD)
```
