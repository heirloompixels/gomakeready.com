// The archive, put somewhere else once a day.
//
// "The archive is the schema default: append-only conversation events,
// nothing hard-deleted, visibility flags not destruction; D1 time travel
// plus a scheduled export to R2." (CLAUDE.md § Data.) D1 time travel is the
// last thirty days and belongs to Cloudflare; this is the other half — a
// flat copy of every table, in a bucket, that outlives the database and can
// be read by anything that can read a line of JSON.
//
// The cron IS the event (CLAUDE.md § Data — wake on events, never poll).
// There is no alarm, no queue and no ticker: `triggers.crons` in
// wrangler.jsonc names one quiet hour and the platform knocks.
//
// Idempotent per day. The keys carry the date and nothing else, so a second
// run — a retry, a hand at the console, two crons in one day — overwrites
// the same objects rather than accumulating a second copy of the same
// morning. A day is the smallest unit the record is measured in.

import type { Env } from './types';

/** Every table 0001 and 0002 declare, in the order they were written. */
export const TABLES = ['conversations', 'events', 'leads', 'notes', 'letters'] as const;

export type Table = (typeof TABLES)[number];

export interface Manifest {
  exported_at: string;
  counts: Record<string, number>;
}

export interface Exported {
  /** The day the export is filed under: the R2 prefix, and the manifest's own. */
  day: string;
  keys: string[];
  manifest: Manifest;
}

const day = (now: Date): string => now.toISOString().slice(0, 10);

/** One row a line. Not an array: a jsonl file streams and an array does not. */
function lines(rows: Record<string, unknown>[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
}

/**
 * The whole archive, written to `archive/YYYY-MM-DD/`. Tables in the order
 * above, then the manifest last — so a manifest present is a manifest whose
 * tables are all already there.
 */
export async function exportArchive(env: Env, now: Date = new Date()): Promise<Exported> {
  const at = day(now);
  const prefix = 'archive/' + at + '/';
  const counts: Record<string, number> = {};
  const keys: string[] = [];

  for (const table of TABLES) {
    // The table names are this file's own constants, never a caller's — the
    // one place in the repo where SQL is not fully parameterised, and it is
    // not parameterisable: an identifier cannot be bound.
    const { results } = await env.DB.prepare('SELECT * FROM ' + table).all<
      Record<string, unknown>
    >();
    const key = prefix + table + '.jsonl';
    await env.ARCHIVE.put(key, lines(results), {
      httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8' },
    });
    counts[table] = results.length;
    keys.push(key);
  }

  const manifest: Manifest = { exported_at: now.toISOString(), counts };
  const key = prefix + 'manifest.json';
  await env.ARCHIVE.put(key, JSON.stringify(manifest, null, 1) + '\n', {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  keys.push(key);

  return { day: at, keys, manifest };
}
