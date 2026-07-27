// The archive's other copy: one flat dump of every table, once a day, in R2.
//
// The cron is the event, so the handler is exercised the way the platform
// exercises it — the Worker's own `scheduled`, with a controller — as well as
// directly, which is what a hand at the console would run.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { exportArchive, TABLES } from '../src/archive';
import { addNote, appendEvent, createConversation, createLead, createLetter } from '../src/db';
import worker from '../src/index';

const DAY = new Date('2026-07-26T09:00:00Z');

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM letters'),
    env.DB.prepare('DELETE FROM notes'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM leads'),
    env.DB.prepare('DELETE FROM conversations'),
    env.DB.prepare('DELETE FROM sqlite_sequence'),
  ]);
  const listing = await env.ARCHIVE.list();
  for (const object of listing.objects) await env.ARCHIVE.delete(object.key);
});

/** A morning's worth of archive: one of everything the schema holds. */
async function aMorning(): Promise<void> {
  const c = await createConversation(env.DB, { town: 'Bozeman', timezone: 'America/Denver' });
  await appendEvent(env.DB, {
    conversationId: c.id,
    role: 'site',
    stage: 'calibrate',
    body: 'A line.',
  });
  await appendEvent(env.DB, {
    conversationId: c.id,
    role: 'visitor',
    stage: 'calibrate',
    body: 'go on',
  });
  const lead = await createLead(env.DB, { email: 'someone@example.com', conversationId: c.id });
  await addNote(env.DB, lead.id, 'Called back Thursday.');
  await createLetter(env.DB, {
    conversationId: c.id,
    html: '<article class="doc">a letter</article>',
    keyHash: 'a'.repeat(64),
    hoursLow: 6,
    hoursHigh: 9,
  });
}

describe('the daily export', () => {
  it('writes a file per table and a manifest, under the day', async () => {
    await aMorning();
    const done = await exportArchive(env, DAY);

    expect(done.day).toBe('2026-07-26');
    expect(done.keys).toEqual([
      ...TABLES.map((t) => 'archive/2026-07-26/' + t + '.jsonl'),
      'archive/2026-07-26/manifest.json',
    ]);
    expect(done.manifest.counts).toEqual({
      conversations: 1,
      events: 2,
      leads: 1,
      notes: 1,
      letters: 1,
    });

    // Every key it named is really there.
    const listing = await env.ARCHIVE.list({ prefix: 'archive/2026-07-26/' });
    expect(listing.objects.map((o) => o.key).sort()).toEqual([...done.keys].sort());
  });

  it('writes one row a line, whole, so the file can be read a line at a time', async () => {
    await aMorning();
    await exportArchive(env, DAY);

    const body = await (await env.ARCHIVE.get('archive/2026-07-26/events.jsonl'))?.text();
    const lines = (body ?? '').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]) as { seq: number; role: string; body: string };
    expect(first.seq).toBe(0);
    expect(first.role).toBe('site');
    expect(first.body).toBe('A line.');

    const manifest = await (await env.ARCHIVE.get('archive/2026-07-26/manifest.json'))?.json<{
      exported_at: string;
      counts: Record<string, number>;
    }>();
    expect(manifest?.exported_at).toBe(DAY.toISOString());
    expect(manifest?.counts.letters).toBe(1);
  });

  it('is empty and valid before anything has been said', async () => {
    const done = await exportArchive(env, DAY);
    expect(done.manifest.counts).toEqual({
      conversations: 0,
      events: 0,
      leads: 0,
      notes: 0,
      letters: 0,
    });
    expect(await (await env.ARCHIVE.get('archive/2026-07-26/leads.jsonl'))?.text()).toBe('');
  });

  it('overwrites the same day rather than accumulating a second copy', async () => {
    await aMorning();
    await exportArchive(env, DAY);
    await aMorning();
    await exportArchive(env, new Date('2026-07-26T09:04:00Z'));

    const listing = await env.ARCHIVE.list({ prefix: 'archive/' });
    expect(listing.objects).toHaveLength(TABLES.length + 1);
    const body = await (await env.ARCHIVE.get('archive/2026-07-26/conversations.jsonl'))?.text();
    expect((body ?? '').trimEnd().split('\n')).toHaveLength(2);
  });

  it('is what the cron actually runs', async () => {
    await aMorning();
    const ctx = createExecutionContext();
    await worker.scheduled(
      { cron: '0 9 * * *', scheduledTime: DAY.getTime(), noRetry: () => undefined },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const listing = await env.ARCHIVE.list({ prefix: 'archive/2026-07-26/' });
    expect(listing.objects).toHaveLength(TABLES.length + 1);
  });
});
