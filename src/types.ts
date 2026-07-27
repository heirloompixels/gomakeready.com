// gmr — shared types. The contract between the data layer, the doors and the
// piece.

import type { SessionDO } from './session-do';

export interface Env {
  // Fonts, the stylesheets and the client hand.
  ASSETS: Fetcher;
  // The archive: conversations, their transcripts, leads, notes, letters.
  // One database, this project's own — never shared (CLAUDE.md § Data).
  DB: D1Database;
  // The daily global spend tally. Past the cap the funnel degrades to the
  // on-ramp and "leave an email, the letter comes by hand"
  // (CLAUDE.md § Guardrails 4). KV and not D1 because it is a counter with a
  // day's memory, not a record.
  SPEND: KVNamespace;
  // One live conversation each: stage cursor, exchange count, budget, and the
  // transcript tail the model is given. The only place the model is called.
  SESSION: DurableObjectNamespace<SessionDO>;
  // Where the archive is copied, once a day, by the cron (src/archive.ts).
  // D1 time travel is thirty days and belongs to Cloudflare; this outlives
  // the database (CLAUDE.md § Data).
  ARCHIVE: R2Bucket;
  // The sha this Worker was deployed from; "dev" everywhere else.
  COMMIT: string;
  // What the day's model spend may reach before the engine goes quiet, in
  // dollars. A var, so raising it is a deploy flag and not a build.
  DAILY_CAP_USD: string;
  // Signs the presence token, and the desk's cookie. `wrangler secret put
  // SESSION_SECRET`; locally it comes from .dev.vars (see .dev.vars.example).
  SESSION_SECRET: string;
  // The single secret behind the desk — the whole of the admin identity, with
  // no accounts and no passwords (CLAUDE.md § CRM). It is presented either as
  // `Authorization: Bearer …` or once at `/desk?key=…`, which mints the
  // cookie. Required, not optional: a desk whose gate could be undefined is a
  // desk that could open for the empty string.
  ADMIN_SECRET: string;
  // The same idea for the machine door at /mcp — a separate secret, so the
  // connector Kyle hands to Claude cannot also open the browser desk, and
  // either can be rotated without touching the other.
  MCP_SECRET: string;
  // `wrangler secret put ANTHROPIC_API_KEY`. Absent — as it is in dev and in
  // the test suite unless a test says otherwise — the page keeps its scripted
  // conversation and no model is ever called.
  ANTHROPIC_API_KEY?: string;
  // A gateway in front of the API, or a stand-in under test. Unset in
  // production, where the address is Anthropic's own.
  ANTHROPIC_BASE_URL?: string;
}
