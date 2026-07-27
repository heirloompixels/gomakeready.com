// The archive, pinned. What is tested here is not SQL syntax — the migration
// would fail loudly for that — but the four promises the schema makes:
//
//   every conversation is a numbered work, and no number comes twice;
//   the transcript is dense, in order, and per conversation;
//   the desk's trail (lead → note) survives being written from two places;
//   the record counts only what it was allowed to count.
//
// D1 is real here — the migration in migrations/ is the schema under test,
// applied per file by test/apply-migrations.ts and emptied per test below.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNote,
  appendEvent,
  countEvents,
  createConversation,
  createLead,
  createLetter,
  frictionsOf,
  getConversation,
  isLeadStatus,
  isLevel,
  LEAD_STATUSES,
  LEVELS,
  latestConversations,
  latestEvents,
  latestNotes,
  leadsByEmail,
  letterByKeyHash,
  listEvents,
  listLeads,
  listNotes,
  recordAggregates,
  setConversationFacts,
  setLeadStatus,
  setVisibility,
  sha256hex,
} from '../src/db';

const db = () => env.DB;

// An empty archive before each test — children first, then the works, then
// the counter that deals the numbers, so a test can say "the first Nº is 1"
// and mean it. The200 clears its tables the same way. This is the only
// DELETE anywhere in the repo, and it is a test fixture: the Worker itself
// has no delete verb and never will.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM letters'),
    env.DB.prepare('DELETE FROM notes'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM leads'),
    env.DB.prepare('DELETE FROM conversations'),
    env.DB.prepare('DELETE FROM sqlite_sequence'),
  ]);
});

describe('the vocabulary', () => {
  // The enumerations the migration writes in comments and TypeScript writes
  // in types. The guards are what a value arriving from outside — a model's
  // answer, a desk form — has to get past before it is either.
  it('knows the four levels and the five statuses, and nothing else', () => {
    for (const level of LEVELS) expect(isLevel(level)).toBe(true);
    for (const status of LEAD_STATUSES) expect(isLeadStatus(status)).toBe(true);
    expect(LEVELS).toEqual(['daily', 'burned', 'nodded', 'new']);
    expect(LEAD_STATUSES).toEqual(['new', 'contacted', 'booked', 'client', 'closed']);
    expect(isLevel('curious')).toBe(false);
    expect(isLevel('')).toBe(false);
    expect(isLeadStatus('archived')).toBe(false);
    // 'new' is a level and a lead status, and means a different thing in each.
    expect(isLevel('new')).toBe(true);
    expect(isLeadStatus('new')).toBe(true);
  });
});

describe('the numbering', () => {
  it('gives each conversation the next Nº, and starts the count at one', async () => {
    const first = await createConversation(db(), { town: 'Bozeman', timezone: 'America/Denver' });
    const second = await createConversation(db(), { town: 'Santa Fe' });
    const third = await createConversation(db());

    expect(first.id).toBe(1);
    expect(second.id).toBe(first.id + 1);
    expect(third.id).toBe(second.id + 1);
  });

  it('stamps the work with the edge and holds it back by default', async () => {
    const c = await createConversation(db(), { town: 'Aspen', timezone: 'America/Denver' });
    expect(c.town).toBe('Aspen');
    expect(c.timezone).toBe('America/Denver');
    // Held, not public: nothing is offered to the record until it is offered.
    expect(c.visibility).toBe('held');
    // Unset until calibration happens; an early exit is a real work.
    expect(c.level).toBeNull();
    expect(c.trade).toBeNull();
    expect(c.frictions).toBeNull();
    // Unix seconds, and near enough to now to be this second's row.
    expect(c.created_at).toBeGreaterThan(1_700_000_000);
    expect(c.created_at).toBeLessThan(4_000_000_000);
  });

  it('reads a work back by its Nº, and says nothing for a Nº never dealt', async () => {
    const c = await createConversation(db(), { town: 'Vail' });
    expect((await getConversation(db(), c.id))?.town).toBe('Vail');
    expect(await getConversation(db(), 9_999)).toBeNull();
  });

  it('reads the catalogue backwards', async () => {
    const made = [];
    for (let i = 0; i < 4; i++) made.push(await createConversation(db(), { town: 'Bozeman' }));
    const latest = await latestConversations(db(), 3);
    expect(latest.map((c) => c.id)).toEqual([made[3].id, made[2].id, made[1].id]);
  });
});

describe('the transcript', () => {
  it('counts from zero, densely, in the order it was said', async () => {
    const c = await createConversation(db());
    const a = await appendEvent(db(), {
      conversationId: c.id,
      role: 'site',
      body: 'Good evening.',
    });
    const b = await appendEvent(db(), {
      conversationId: c.id,
      role: 'visitor',
      body: 'I keep a gallery.',
      stage: 'onramp',
    });
    const d = await appendEvent(db(), { conversationId: c.id, role: 'site', body: 'Go on.' });

    expect([a.seq, b.seq, d.seq]).toEqual([0, 1, 2]);
    expect(b.role).toBe('visitor');
    expect(b.stage).toBe('onramp');
    expect(a.stage).toBeNull();
    expect((await listEvents(db(), c.id)).map((e) => e.body)).toEqual([
      'Good evening.',
      'I keep a gallery.',
      'Go on.',
    ]);
    expect(await countEvents(db(), c.id)).toBe(3);
  });

  it('counts per conversation, not across the archive', async () => {
    const one = await createConversation(db());
    const two = await createConversation(db());

    await appendEvent(db(), { conversationId: one.id, role: 'site', body: 'one · 0' });
    await appendEvent(db(), { conversationId: two.id, role: 'site', body: 'two · 0' });
    await appendEvent(db(), { conversationId: one.id, role: 'visitor', body: 'one · 1' });
    await appendEvent(db(), { conversationId: two.id, role: 'visitor', body: 'two · 1' });

    expect((await listEvents(db(), one.id)).map((e) => e.seq)).toEqual([0, 1]);
    expect((await listEvents(db(), two.id)).map((e) => e.seq)).toEqual([0, 1]);
    expect((await listEvents(db(), two.id)).map((e) => e.body)).toEqual(['two · 0', 'two · 1']);
  });

  it('deals every seq exactly once when the lines arrive at once', async () => {
    const c = await createConversation(db());
    const lines = Array.from({ length: 12 }, (_, i) => 'line ' + i);
    // Fired together: the next seq is computed inside the INSERT, so no two
    // writers can read the same MAX and both act on it.
    const written = await Promise.all(
      lines.map((body) => appendEvent(db(), { conversationId: c.id, role: 'site', body })),
    );

    const seqs = written.map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(seqs).size).toBe(12);
    expect(await countEvents(db(), c.id)).toBe(12);
  });

  it('hands back the last N in the order they were said', async () => {
    const c = await createConversation(db());
    for (let i = 0; i < 6; i++) {
      await appendEvent(db(), { conversationId: c.id, role: 'site', body: 'line ' + i });
    }
    const tail = await latestEvents(db(), c.id, 3);
    expect(tail.map((e) => e.body)).toEqual(['line 3', 'line 4', 'line 5']);
  });
});

describe('the facts calibration learns', () => {
  it('sets what it was given and leaves the rest where it was', async () => {
    const c = await createConversation(db(), { town: 'Bozeman' });

    const withLevel = await setConversationFacts(db(), c.id, { level: 'burned' });
    expect(withLevel?.level).toBe('burned');
    expect(withLevel?.trade).toBeNull();

    const withTrade = await setConversationFacts(db(), c.id, {
      trade: 'a gallery',
      frictions: ['the same letters, over and over', 'the inbox, generally'],
    });
    expect(withTrade?.level).toBe('burned'); // untouched
    expect(withTrade?.trade).toBe('a gallery');
    expect(frictionsOf(withTrade as NonNullable<typeof withTrade>)).toEqual([
      'the same letters, over and over',
      'the inbox, generally',
    ]);
  });

  it('is not a write when it is given nothing', async () => {
    const c = await createConversation(db(), { town: 'Vail' });
    const same = await setConversationFacts(db(), c.id, {});
    expect(same?.id).toBe(c.id);
    expect(same?.level).toBeNull();
  });

  it('reads an unset friction list as no frictions, not as a crash', async () => {
    const c = await createConversation(db());
    expect(frictionsOf(c)).toEqual([]);
  });
});

describe('the desk', () => {
  it('takes an address, with the conversation it came out of or without one', async () => {
    const c = await createConversation(db(), { town: 'Santa Fe' });
    const attached = await createLead(db(), { email: 'ann@shop.com', conversationId: c.id });
    const alone = await createLead(db(), { email: 'ben@shop.com' });

    expect(attached.conversation_id).toBe(c.id);
    expect(alone.conversation_id).toBeNull();
    // Every lead starts new; the desk moves it from there.
    expect(attached.status).toBe('new');
    expect(alone.status).toBe('new');
  });

  it('takes the same address twice — the desk sorts it, not the schema', async () => {
    await createLead(db(), { email: 'twice@shop.com' });
    await createLead(db(), { email: 'twice@shop.com' });
    const both = await leadsByEmail(db(), 'twice@shop.com');
    expect(both).toHaveLength(2);
    expect(both[0].id).not.toBe(both[1].id);
  });

  it('lists newest first, and one status at a time when asked', async () => {
    const a = await createLead(db(), { email: 'a@shop.com' });
    const b = await createLead(db(), { email: 'b@shop.com' });
    const c = await createLead(db(), { email: 'c@shop.com' });
    await setLeadStatus(db(), b.id, 'booked');

    const all = await listLeads(db());
    expect(all.map((l) => l.id)).toEqual([c.id, b.id, a.id]);

    const booked = await listLeads(db(), { status: 'booked' });
    expect(booked.map((l) => l.email)).toEqual(['b@shop.com']);

    const fresh = await listLeads(db(), { status: 'new' });
    expect(fresh.map((l) => l.id)).toEqual([c.id, a.id]);

    expect(await listLeads(db(), { limit: 2 })).toHaveLength(2);
    expect(await listLeads(db(), { status: 'closed' })).toEqual([]);
  });

  it('keeps its notes in the margin, in the order they were written', async () => {
    const lead = await createLead(db(), { email: 'noted@shop.com' });
    const first = await addNote(db(), lead.id, 'Called. Runs an outfitter out of Bozeman.');
    await addNote(db(), lead.id, 'Sent the letter by hand.');
    const third = await addNote(db(), lead.id, 'Booked for Thursday.');

    const all = await listNotes(db(), lead.id);
    expect(all.map((n) => n.body)).toEqual([
      'Called. Runs an outfitter out of Bozeman.',
      'Sent the letter by hand.',
      'Booked for Thursday.',
    ]);
    expect(all[0].id).toBe(first.id);
    expect(all[0].lead_id).toBe(lead.id);

    const tail = await latestNotes(db(), lead.id, 2);
    expect(tail.map((n) => n.id)).toEqual([all[1].id, third.id]);
  });
});

describe('the letter', () => {
  it('numbers itself, distinctly from the conversation', async () => {
    const one = await createConversation(db());
    const two = await createConversation(db());
    await createConversation(db()); // a conversation that never reached a letter

    const a = await createLetter(db(), { conversationId: two.id, html: '<p>Nº one</p>' });
    const b = await createLetter(db(), { conversationId: one.id, html: '<p>Nº two</p>' });

    // Letters start at 1 and count for themselves.
    expect(a.number).toBe(1);
    expect(b.number).toBe(2);
    expect(a.conversation_id).toBe(two.id);
  });

  it('keeps the hash of the key and never the key', async () => {
    const c = await createConversation(db());
    const key = 'a-key-that-goes-in-the-mail';
    const hash = await sha256hex(key);
    const letter = await createLetter(db(), {
      conversationId: c.id,
      html: '<p>Findings.</p>',
      keyHash: hash,
    });

    expect(hash).toHaveLength(64);
    expect(letter.key_hash).toBe(hash);
    expect(letter.html).not.toContain(key);
    expect(JSON.stringify(letter)).not.toContain(key);

    expect((await letterByKeyHash(db(), hash))?.id).toBe(letter.id);
    expect(await letterByKeyHash(db(), await sha256hex('some other key'))).toBeNull();
  });
});

describe('the record', () => {
  it('is empty before anything is said, and says so in honest zeros', async () => {
    const r = await recordAggregates(db());
    expect(r).toEqual({
      conversations: 0,
      total: 0,
      byLevel: {},
      byTrade: {},
      towns: 0,
      letters: 0,
      hoursLow: 0,
      hoursHigh: 0,
    });
  });

  it('counts only what it was allowed to count, and totals everything', async () => {
    const shown = await createConversation(db());
    await setConversationFacts(db(), shown.id, { level: 'burned', trade: 'a gallery' });
    await setVisibility(db(), shown.id, 'public');

    const alsoShown = await createConversation(db());
    await setConversationFacts(db(), alsoShown.id, { level: 'burned', trade: 'an outfitter' });
    await setVisibility(db(), alsoShown.id, 'public');

    // Held: said, but never offered.
    const held = await createConversation(db());
    await setConversationFacts(db(), held.id, { level: 'new', trade: 'a design studio' });

    // Withdrawn: offered, then taken back. The row stays; the count does not.
    const withdrawn = await createConversation(db());
    await setConversationFacts(db(), withdrawn.id, { level: 'nodded', trade: 'a gallery' });
    await setVisibility(db(), withdrawn.id, 'public');
    await setVisibility(db(), withdrawn.id, 'withdrawn');

    const r = await recordAggregates(db());
    expect(r.conversations).toBe(2);
    expect(r.total).toBe(4); // the scale of the piece belongs to no one
    expect(r.byLevel).toEqual({ burned: 2 });
    expect(r.byTrade).toEqual({ 'a gallery': 1, 'an outfitter': 1 });
    expect(r.letters).toBe(0);
    expect(r.hoursLow).toBe(0);
    expect(r.hoursHigh).toBe(0);

    // Withdrawal removes nothing: the work is still in the archive, still
    // numbered, still carrying what it said.
    const still = await getConversation(db(), withdrawn.id);
    expect(still?.visibility).toBe('withdrawn');
    expect(still?.trade).toBe('a gallery');
  });

  it('leaves a public conversation out of the tallies until it has facts', async () => {
    const c = await createConversation(db());
    await setVisibility(db(), c.id, 'public');
    const r = await recordAggregates(db());
    expect(r.conversations).toBe(1);
    expect(r.byLevel).toEqual({});
    expect(r.byTrade).toEqual({});
  });
});
