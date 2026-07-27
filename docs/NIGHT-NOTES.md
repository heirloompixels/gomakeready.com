# Night notes — 2026-07-26 → 27

Kyle: you went to bed after step 3 and asked for the rest. Steps 4–7 are
built, tested (173 tests), committed, and deployed. The piece is live at
https://gmr.analogkyle.workers.dev — running on its scripted conversation,
spending nothing, until you wake the engine. Everything below is either a
decision I made for you (veto anything) or a thing only you can do.

## The morning list (only you can do these)

1. **Wake the engine.** One command, then the conversation is real:
   `pnpm wrangler secret put ANTHROPIC_API_KEY` (paste a key from
   console.anthropic.com — I deliberately did not provision one).
   The daily wallet is capped at $10 (`vars.DAILY_CAP_USD`); at the cap the
   piece degrades gracefully to the scripted path + "the letter comes by
   hand." Then walk the arc once with the browser open — the streamed path
   has never been seen by human eyes (test-covered only; owed smoke is in
   TODO).
2. **Attach the desk to Claude Code** (works today):
   `claude mcp add --transport http gmr https://gmr.analogkyle.workers.dev/mcp
   --header "Authorization: Bearer $(cat ~/.config/cloudflare/gmr-mcp.secret)"`
   Claude Desktop wants OAuth for remote connectors — that shim is not built;
   decide whether you want it or whether Claude Code + the desk page suffice.
3. **The desk in a browser:** visit `/desk?key=<contents of
   ~/.config/cloudflare/gmr-admin.secret>` once; it mints a 30-day cookie and
   cleans the address. Caveat I want your eyes on: the key transits the URL,
   and Workers Logs (observability is on) records request URLs — fine for a
   single operator over TLS, but if it bothers you, use curl with the Bearer
   header instead and we'll add a login form later.
4. Still yours from before: nameservers → analogkyle account, Workers Paid,
   Stripe link for the $50, letter delivery (Resend vs by hand), pricing
   placeholders, trademark hour.
5. **Nothing was pushed to GitHub** — commits are local (fe1252c → d976ece,
   seven of them). The repo's old Pages workflow still deploys the Zola
   brochure on push; push when you're ready for that to happen (harmless,
   but it's a publish).

## Decisions I made overnight (veto freely)

- **No API key provisioned.** Using any key of yours without you awake felt
  wrong; the engine ships complete but dormant, and the site is whole
  without it.
- **Conversations become record-eligible ('public', aggregates only) when
  they reach the finale** — the visitor has been told twice by then. Early
  abandonment stays 'held'. Withdrawal is a by-hand flag, never deletion.
- **Letter totals are recomputed from the findings**, not trusted from the
  model — a printed sum that doesn't add up is the one mistake a letter
  can't survive.
- **The letter-setting Sonnet call is metered into the same daily wallet**
  as the interview.
- **Magic-link keys are unrecoverable by design** (hashed at rest). A reader
  who loses their letter needs it set again; no tool, including the MCP
  desk, can hand a key back. The MCP door text says so plainly.
- **MCP is hand-rolled** (stateless Streamable HTTP, ~no dependencies), not
  Cloudflare's agents SDK — house dependency rule. GET /mcp answers 405
  (the one door that admits it exists); everything else wrong-handed gets
  the invisible miss.
- **Desk cookie:** Path=/desk, expiry inside the HMAC signature, SameSite
  Strict — "no cookies for visitors" stays literally true.
- **Smoke leads were deleted from remote D1** before launch (5 rows of my
  own test email, pre-launch fixtures; the append-only law starts with real
  data at Nº 1).
- **Secrets:** three fresh ones generated to ~/.config/cloudflare/gmr-*.secret
  (0600) and put to the Worker — newline-stripped after the first put
  produced a one-byte mismatch (the200's "bare token" phrasing, understood
  the hard way).

## One finding you should feel with your own hands

**Cold load to clickable on-ramp is ~90 seconds** at the current typing
cadence (I walked the whole live piece in a real browser; it's beautiful,
and it's slow). The speed-bump is the design — but 90s is a long toll
before the first interaction. Options if you want them: greeting ~30%
faster; or reveal the on-ramp once the disclosure sentence lands rather
than after the full line. One number either way. Your call — it's pacing
law, so I didn't touch it.

## Upstream note for portals

pnpm 10.20 silently ignores the `allowBuilds:` key in portals'
pnpm-workspace.yaml (the working key is `onlyBuiltDependencies`), so
portals' postinstall builds (workerd, esbuild) may not be running there.

## What went out, commit by commit

- `44a4f71` step 4 — engine: six-stage arc as stage directions, SessionDO
  (SQLite-backed), presence token, 12-exchange fence, $10/day wallet,
  SSE into the same typist, dormant without the key. 100 tests.
- `<letters>` step 5b+6 — Sonnet letter as validated JSON, magic links,
  /record honest from zero, daily R2 archive export (cron 09:00 UTC).
  122 tests.
- `d976ece` step 7 — /desk (invisible gate, thin ledger, plain forms) and
  /mcp (five tools, door text in register). 173 tests.
- Everything reviewed file-by-file, `make check` re-run here after each
  agent, deployed by hand with the sha, smoked live with curl; the full
  scripted piece walked end-to-end in Chrome against production — zero
  console errors, zero CSP violations.
