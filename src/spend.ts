// The wallet.
//
// One number a day, kept in KV: what the model has cost since midnight UTC.
// Past the cap the funnel degrades — no new sessions get an engine, and the
// sessions already talking close gracefully on their next turn
// (CLAUDE.md § Guardrails 4).
//
// KV and not D1 because this is a counter with a day's memory, not a record.
// The read-modify-write below is not atomic and is not meant to be: two turns
// landing in the same millisecond can lose one of the two additions, which
// costs the ledger a fraction of a cent and costs the visitor nothing. A cap
// is a fence, not an audit.

/** Prices per token, Anthropic list rates for Haiku 4.5 ($1 / $5 per MTok). */
export const PRICE_IN = 1.0 / 1_000_000;
export const PRICE_OUT = 5.0 / 1_000_000;

/** What one exchange cost, in dollars. */
export function costOf(inputTokens: number, outputTokens: number): number {
  return inputTokens * PRICE_IN + outputTokens * PRICE_OUT;
}

/** The key a day is kept under. UTC, so the day turns at the same instant everywhere. */
export function dayKey(now: Date = new Date()): string {
  return 'spend:' + now.toISOString().slice(0, 10);
}

// Two days, so yesterday is still readable while today is being written, and
// nothing accumulates in the namespace forever.
const KEEP = 172800;

export async function readSpend(kv: KVNamespace, now?: Date): Promise<number> {
  const raw = await kv.get(dayKey(now));
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Add a turn's cost to the day, and answer what the day now stands at. */
export async function addSpend(kv: KVNamespace, usd: number, now?: Date): Promise<number> {
  const key = dayKey(now);
  const total = (await readSpend(kv, now)) + usd;
  await kv.put(key, total.toFixed(6), { expirationTtl: KEEP });
  return total;
}

/** The cap, as configured. A var, so it can be raised at deploy without a build. */
export function capOf(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export async function overCap(kv: KVNamespace, raw: string | undefined): Promise<boolean> {
  return (await readSpend(kv)) >= capOf(raw);
}
