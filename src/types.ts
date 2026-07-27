// gmr — shared types. The contract between the data layer, the doors and the
// piece. The session DO joins it at step 4 (docs/TODO.md).

export interface Env {
  // Fonts, the stylesheets and the client hand.
  ASSETS: Fetcher;
  // The archive: conversations, their transcripts, leads, notes, letters.
  // One database, this project's own — never shared (CLAUDE.md § Data).
  DB: D1Database;
  // The daily global spend tally. Bound now, spent at step 4: past the cap
  // the funnel degrades to the on-ramp and "leave an email, the letter comes
  // by hand" (CLAUDE.md § Guardrails 4). KV and not D1 because it is a
  // counter with a day's memory, not a record.
  SPEND: KVNamespace;
  // The sha this Worker was deployed from; "dev" everywhere else.
  COMMIT: string;
}
