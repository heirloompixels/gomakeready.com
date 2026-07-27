// gmr — shared types. Thin for now; D1, the session DO, and the spend tally
// join it at steps 4–5 (docs/TODO.md).

export interface Env {
  // Fonts and the client bundle. Bound but unused until the piece is ported.
  ASSETS: Fetcher;
  // The sha this Worker was deployed from; "dev" everywhere else.
  COMMIT: string;
}
