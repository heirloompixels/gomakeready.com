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
      stops serving rather than degrading when caps hit.
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
- [ ] 4. The conversation engine: session Durable Object (presence token,
      exchange + spend budget), Anthropic API streaming, the six-stage arc as
      stage directions, all five guardrails (CLAUDE.md § Guardrails).
- [ ] 5. The letter and the ledger: D1 schema (append-only events, leads,
      letters, numbering), Sonnet letter call, magic link, R2 export.
- [ ] 6. The record: aggregation + public page, live from conversation Nº 1.
- [ ] 7. The desk + MCP: admin-gate organ copied from portals, thin ledger
      view, MCP server at `/mcp` (resolve the OAuth-shim question for Claude
      Desktop here), connect alongside Gmail.
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
