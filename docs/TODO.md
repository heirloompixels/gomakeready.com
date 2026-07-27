# TODO

The plan changed in July 2026 — the Zola brochure is being replaced by the
conversational Workers app (see CLAUDE.md, and `mockups/05-the-scroll.html`
for the piece itself). The brochure stays live until the app replaces it.

## Blocking launch

- [ ] **Pricing.** `The setup` and `On call` still carry `$——` placeholders.
      The first hour is settled at **$50**. Kyle has not set the other two.
      **Do not invent numbers.** Ask.
- [ ] **Trademark check.** A Dallas hospitality company ("Makeready", ~$78M
      revenue, boutique hotels + restaurants, founded 2016) holds the bare word
      in Class 43. Go Make Ready is a different phrase in different classes
      (35 business consulting / 41 training / 42 software consulting), and
      likelihood-of-confusion is probably low — but *probably* is not a
      clearance. One hour with a trademark attorney before anything is printed
      or letterpressed. Domain registration confers **no** trademark rights.
- [ ] **Domain → Cloudflare.** Confirm `gomakeready.com` is registered, then
      move its nameservers to the analogkyle Cloudflare account so the custom
      domain can bind (`portals/docs/cloudflare-access.md`). Until then the
      Worker serves at `gmr.analogkyle.workers.dev`.
- [ ] **Workers Paid** ($5/mo) before the first public deploy — the free plan
      stops serving rather than degrading when caps hit. (The session Durable
      Object is SQLite-backed, so it would run on the free plan; nothing else
      would.)
- [ ] **Four secrets, by hand.** Two before the first deploy that talks to a
      model: `wrangler secret put SESSION_SECRET` (signs the presence token
      *and* the desk cookie) and `wrangler secret put ANTHROPIC_API_KEY`.
      Without the key the Worker still serves the whole piece on its scripted
      conversation and spends nothing — which is the right way to deploy it
      first and watch it. Two more before the desk is any use:
      `ADMIN_SECRET` and `MCP_SECRET`, already set on the deployed Worker.
      Both are required strings in `Env`: a Worker deployed without them will
      typecheck and then answer every desk address with the miss, which is
      the safe failure but is indistinguishable from a working door.
      Keep the copies at `~/.config/cloudflare/gmr-admin.secret` and
      `~/.config/cloudflare/gmr-mcp.secret`, mode 0600, never printed
      (`portals/docs/cloudflare-access.md`).
- [ ] **Before the next deploy, by hand** (steps 5–6 added three things the
      remote account does not have yet):
      - `pnpm wrangler d1 migrations apply gmr --remote` — migration 0002
        adds `hours_low` / `hours_high` to `letters`. Additive; nothing is
        altered or dropped. Apply it *before* the deploy, not after: a
        Worker on 0002's code against 0001's schema cannot set a letter.
      - The R2 bucket `gmr-archive` must exist on the analogkyle account
        (`pnpm wrangler r2 bucket create gmr-archive`). The binding is
        `ARCHIVE`.
      - `triggers.crons: ["0 9 * * *"]` is registered by the deploy itself —
        no console step — but it only starts firing once the Worker is
        deployed with it, and 09:00 UTC is three in the morning in Bozeman.
        Watch the first run in Workers Logs.
- [ ] **A browser smoke of the desk**, against `wrangler dev`: open
      `/desk?key=…` once, confirm the address cleans itself and the cookie
      holds across a reload, and that the ledger and a lead are set on the
      house measure with the fonts and rules the piece uses. There is no
      client JS on either page, so this is a look and not a debugging
      session — but nobody has looked at it in a browser yet.
- [ ] **Attach the MCP server and work a week through it.** The command is
      at the head of `src/mcp.ts`. Then Gmail beside it, which is the whole
      point (CLAUDE.md § CRM).
- [ ] **A browser smoke of the letter**, against `wrangler dev` with a live
      key: walk the arc to the finale and confirm the real letter replaces
      the scripted act, that the plum keep-line links to the magic address,
      and that the address still opens in a fresh tab.
- [ ] **How the $50 gets paid.** Probably a Stripe payment link — one quiet
      link, no cart. Undecided.
- [ ] **How the letter reaches the inbox.** Transactional sender (Resend?) vs
      Kyle mailing them by hand from Gmail in the first weeks — which fits the
      piece. Undecided.

## The build (steps, in order)

- [x] 1. Bank the design: mockups 01–05, CLAUDE.md rewritten to the new law,
      this TODO.
- [ ] 2. Scaffold the Workers app: pnpm, Hono, strict tsconfig, Biome,
      `wrangler.jsonc` (account pinned, observability), vitest-pool-workers,
      `/_health`, Makefile targets, first deploy to workers.dev.
- [ ] 3. Port the piece: scroll served from `hono/html`, edge greeting from
      `request.cf` (city + timezone), fonts self-hosted (subset the variable
      TTFs already in `print/fonts/`), typist as client script.
- [x] 4. The conversation engine: session Durable Object (presence token,
      exchange + spend budget), Anthropic API streaming, the six-stage arc as
      stage directions, all five guardrails (CLAUDE.md § Guardrails).
      Letter generation stays scripted until step 5; the finale reveals the
      static letter act as it always has. Still owed: a real browser smoke of
      the streamed path against `wrangler dev` with a live key.
- [x] 5. The letter and the ledger: D1 schema (append-only events, leads,
      letters, numbering), Sonnet letter call, magic link, R2 export.
      The finale makes one non-streaming `claude-sonnet-5` call constrained
      by `output_config.format`, validates every field by hand (one retry,
      then the jam close), renders through the same template the scripted
      act uses, stores the html and the hours, and emits the magic address
      over the stream. The conversation joins the record at the same moment.
- [x] 6. The record: aggregation + public page, live from conversation Nº 1.
      `/record` in the house measure, honest zeros, and the scroll's record
      fork now carries real tallies from the edge instead of mock numbers.
- [x] 7. The desk + MCP: admin-gate organ copied from portals, thin ledger
      view, MCP server at `/mcp`, connect alongside Gmail.
      `/desk` opens for `Authorization: Bearer <ADMIN_SECRET>` or for the
      HMAC cookie `GET /desk?key=…` mints (thirty days, `Path=/desk`, so no
      visitor ever receives one); everything else — wrong bearer, wrong key,
      forged or stale cookie, any POST — gets the house miss byte for byte.
      `/mcp` is a hand-rolled stateless Streamable-HTTP server: five tools,
      no SDK, no new dependencies, bearer `MCP_SECRET`, the same invisible
      404. The OAuth-shim question resolved itself — Claude Code attaches an
      HTTP server with a plain `Authorization` header, so no shim is needed;
      if a client that requires OAuth is ever wanted, that is its own step.
      Still owed: attaching it for real and watching a week go through it.
- [ ] 8. Launch: domain bound, Zola retired, brochure URL becomes the piece.

## Before first client

- [ ] Favicon + `og:` tags. Use the registration mark.
- [ ] `robots.txt` (and decide what the record means for crawlers).

## Print

- [ ] Proof the leave-behind on the Vandercook 325G. It is designed for two
      plates (Prussian + plum) at 5.5×8.5 — the trim already in use.
- [ ] Business card + letterhead in the same two inks.
- [ ] Confirm the leave-behind still reads with the plum plate dropped
      (one-color fallback). It should.
- [ ] The letters (Nº n) and the seasonal record broadside join the print
      pipeline once steps 5–6 exist.

## Deliberately not doing

- Analytics. No. (The record is not analytics; it is the piece.)
- A blog. Not yet, and not without a reason.
- Client accounts, passwords, a real CMS. The desk + magic links suffice.
- Frontend frameworks and CSS frameworks. Hono serves HTML; the client is
  hand-written. See CLAUDE.md — the *toolchain* rules loosened; the page
  stays handmade.
