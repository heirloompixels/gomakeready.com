// The machine door. The Worker runs for real here and D1 behind it is the
// real thing, so every tool is called the way a client would call it and
// checked against what was actually written.
//
// Two shapes are pinned above the rest: the door is invisible to a wrong
// bearer, exactly as the desk's is, and the JSON-RPC envelope is correct —
// a client that cannot parse the envelope never reaches the five tools.
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  createConversation,
  createLead,
  createLetter,
  getLead,
  listNotes,
  setConversationFacts,
  setConversationVisibility,
} from '../src/db';

const raw = (body: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.MCP_SECRET,
      'content-type': 'application/json',
      ...init.headers,
    },
    body,
    ...init,
  });

// One request, one answer, parsed.
const rpc = async (method: string, params?: unknown, id: unknown = 1) => {
  const r = await raw(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(r.headers.get('cache-control')).toBe('no-store');
  return (await r.json()) as {
    jsonrpc: string;
    id: unknown;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
};

interface ToolAnswer {
  content: { type: string; text: string }[];
  isError?: boolean;
}

const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolAnswer> => {
  const a = await rpc('tools/call', { name, arguments: args });
  expect(a.error).toBeUndefined();
  return a.result as unknown as ToolAnswer;
};

/** The document a happy tool call carries back. */
const data = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
  const answer = await call(name, args);
  expect(answer.isError).toBeUndefined();
  expect(answer.content[0].type).toBe('text');
  return JSON.parse(answer.content[0].text);
};

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

async function seed() {
  const c = await createConversation(env.DB, { town: 'Aspen', timezone: 'America/Denver' });
  await setConversationFacts(env.DB, c.id, {
    trade: 'a real estate broker',
    level: 'burned',
    frictions: ['listing copy', 'disclosure paperwork'],
  });
  await appendEvent(env.DB, {
    conversationId: c.id,
    role: 'site',
    stage: 'ideas',
    body: 'The listings, then. Who writes them now?',
  });
  await appendEvent(env.DB, {
    conversationId: c.id,
    role: 'visitor',
    stage: 'ideas',
    body: 'I do, on Sundays, badly.',
  });
  await setConversationVisibility(env.DB, c.id, 'public');
  const letter = await createLetter(env.DB, {
    conversationId: c.id,
    html: '<article class="doc">a letter</article>',
    keyHash: 'a'.repeat(64),
    hoursLow: 7,
    hoursHigh: 9,
  });
  const lead = await createLead(env.DB, { email: 'broker@aspen.example', conversationId: c.id });
  return { c, lead, letter };
}

// ————— the door

describe('the machine door', () => {
  it('does not exist without the bearer', async () => {
    const house = await SELF.fetch('http://example.com/nothing-here');
    const body = await house.text();

    const hands: Record<string, string>[] = [
      {},
      { authorization: 'Bearer not-the-secret' },
      // The desk's secret is not this door's secret.
      { authorization: 'Bearer ' + env.ADMIN_SECRET },
      { authorization: 'Basic a2V5OmtleQ==' },
    ];
    for (const headers of hands) {
      const r = await SELF.fetch('http://example.com/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(r.status).toBe(404);
      expect(await r.text()).toBe(body);
      expect(r.headers.get('content-type')).toBe(house.headers.get('content-type'));
      expect(r.headers.get('www-authenticate')).toBe(null);
    }
  });

  it('answers a GET with 405 and the method it does take', async () => {
    const hands: Record<string, string>[] = [{}, { authorization: 'Bearer ' + env.MCP_SECRET }];
    for (const headers of hands) {
      const r = await SELF.fetch('http://example.com/mcp', { headers });
      expect(r.status).toBe(405);
      expect(r.headers.get('allow')).toBe('POST');
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
  });
});

// ————— the envelope

describe('the envelope', () => {
  it('names itself, echoes a version it knows, and says what this desk is', async () => {
    const a = await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'a client', version: '1' },
    });
    expect(a.jsonrpc).toBe('2.0');
    expect(a.id).toBe(1);
    const r = a.result as Record<string, unknown>;
    expect(r.protocolVersion).toBe('2025-03-26');
    expect(r.capabilities).toEqual({ tools: {} });
    expect(r.serverInfo).toEqual({ name: 'gmr', version: env.COMMIT });

    const instructions = r.instructions as string;
    expect(instructions).toContain('go, make, ready.');
    expect(instructions).toContain('list_leads');
    expect(instructions).toContain('weekly_digest');
    // The register, and the one thing that is not here.
    expect(instructions).toContain('plainspoken');
    expect(instructions).toContain('no tool can hand it back');
    expect(instructions).not.toContain('!');
  });

  it('names its own version when asked for one it does not know', async () => {
    for (const asked of ['1999-01-01', undefined]) {
      const a = await rpc('initialize', { protocolVersion: asked });
      expect((a.result as Record<string, unknown>).protocolVersion).toBe('2025-06-18');
    }
  });

  it('takes a notification and says nothing back', async () => {
    const r = await raw(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    expect(r.status).toBe(202);
    expect(await r.text()).toBe('');
  });

  it('answers a ping with nothing in particular', async () => {
    const a = await rpc('ping');
    expect(a.result).toEqual({});
  });

  it('refuses a method it has never heard of', async () => {
    const a = await rpc('resources/list');
    expect(a.error?.code).toBe(-32601);
    expect(a.id).toBe(1);
  });

  it('says so when the body was not JSON', async () => {
    const r = await raw('{ this is not json');
    expect(r.status).toBe(200);
    const a = (await r.json()) as { id: null; error: { code: number } };
    expect(a.error.code).toBe(-32700);
    expect(a.id).toBe(null);
  });

  it('refuses a batch politely', async () => {
    const r = await raw(JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]));
    const a = (await r.json()) as { error: { code: number; message: string } };
    expect(a.error.code).toBe(-32600);
    expect(a.error.message).toContain('one message at a time');
  });

  it('keeps the id it was given, whatever shape it was', async () => {
    expect((await rpc('ping', undefined, 'abc')).id).toBe('abc');
    expect((await rpc('ping', undefined, 42)).id).toBe(42);
  });
});

// ————— the five

describe('tools/list', () => {
  it('offers five, each with a schema and a paragraph', async () => {
    const a = await rpc('tools/list');
    const tools = (
      a.result as {
        tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
      }
    ).tools;
    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name)).toEqual([
      'list_leads',
      'get_lead',
      'update_status',
      'add_note',
      'weekly_digest',
    ]);
    for (const t of tools) {
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(t.inputSchema.additionalProperties, t.name).toBe(false);
      expect(t.description.length, t.name).toBeGreaterThan(120);
      expect(t.description, t.name).not.toContain('!');
    }
  });
});

describe('list_leads', () => {
  it('hands back the ledger, newest first, with the facts of the conversation', async () => {
    const { c, lead } = await seed();
    await createLead(env.DB, { email: 'lone@example.com' });

    const rows = (await data('list_leads')) as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0].email).toBe('lone@example.com');
    expect(rows[1]).toMatchObject({
      id: lead.id,
      conversation: c.id,
      email: 'broker@aspen.example',
      status: 'new',
      town: 'Aspen',
      trade: 'a real estate broker',
      level: 'burned',
    });
    expect(typeof rows[1].created).toBe('string');
  });

  it('narrows by standing, and takes a limit', async () => {
    await seed();
    await createLead(env.DB, { email: 'lone@example.com' });
    expect((await data('list_leads', { status: 'contacted' })) as unknown[]).toHaveLength(0);
    expect((await data('list_leads', { limit: 1 })) as unknown[]).toHaveLength(1);
  });

  it('refuses a standing and a limit it cannot take', async () => {
    expect((await call('list_leads', { status: 'delighted' })).isError).toBe(true);
    expect((await call('list_leads', { limit: 5000 })).isError).toBe(true);
  });
});

describe('get_lead', () => {
  it('hands back the lead whole, transcript and all', async () => {
    const { c, lead, letter } = await seed();
    const d = (await data('get_lead', { id: lead.id })) as Record<string, Record<string, unknown>>;

    expect(d.lead).toMatchObject({ id: lead.id, email: 'broker@aspen.example', status: 'new' });
    expect(d.conversation).toMatchObject({
      number: c.id,
      town: 'Aspen',
      trade: 'a real estate broker',
      level: 'burned',
      visibility: 'public',
      frictions: ['listing copy', 'disclosure paperwork'],
    });

    const transcript = d.transcript as unknown as Record<string, unknown>[];
    expect(transcript).toHaveLength(2);
    expect(transcript[0]).toEqual({
      seq: 0,
      role: 'site',
      stage: 'ideas',
      body: 'The listings, then. Who writes them now?',
    });
    expect(transcript[1].body).toBe('I do, on Sundays, badly.');

    expect(d.letter).toEqual({ number: letter.number, hours_low: 7, hours_high: 9 });
    // The key was never written down and cannot come back out.
    expect(JSON.stringify(d)).not.toContain(letter.key_hash);
    expect(JSON.stringify(d)).not.toContain('key');
  });

  it('takes an id the model wrote as a string', async () => {
    const { lead } = await seed();
    const d = (await data('get_lead', { id: String(lead.id) })) as Record<
      string,
      Record<string, unknown>
    >;
    expect(d.lead.id).toBe(lead.id);
  });

  it('says so plainly when there is no lead at that id', async () => {
    const a = await call('get_lead', { id: 9999 });
    expect(a.isError).toBe(true);
    expect(a.content[0].text).toContain('There is no lead at that id');
  });

  it('is honest about a lead with no conversation behind it', async () => {
    const lone = await createLead(env.DB, { email: 'lone@example.com' });
    const d = (await data('get_lead', { id: lone.id })) as Record<string, unknown>;
    expect(d.conversation).toBe(null);
    expect(d.letter).toBe(null);
    expect(d.transcript).toEqual([]);
  });
});

describe('update_status', () => {
  it('writes, and answers the lead as it now stands', async () => {
    const { lead } = await seed();
    const d = (await data('update_status', { id: lead.id, status: 'booked' })) as Record<
      string,
      unknown
    >;
    expect(d.status).toBe('booked');
    expect((await getLead(env.DB, lead.id))?.status).toBe('booked');
  });

  it('refuses a standing that is not one, and moves nothing', async () => {
    const { lead } = await seed();
    const a = await call('update_status', { id: lead.id, status: 'delighted' });
    expect(a.isError).toBe(true);
    expect((await getLead(env.DB, lead.id))?.status).toBe('new');
  });

  it('moves nothing at an id nobody has', async () => {
    expect((await call('update_status', { id: 9999, status: 'booked' })).isError).toBe(true);
  });
});

describe('add_note', () => {
  it('appends, and hands the note back', async () => {
    const { lead } = await seed();
    const d = (await data('add_note', {
      id: lead.id,
      body: '  Sunday listings. Start there.  ',
    })) as Record<string, unknown>;
    expect(d.body).toBe('Sunday listings. Start there.');
    const notes = await listNotes(env.DB, lead.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe('Sunday listings. Start there.');
  });

  it('will not take an empty note, a document, or a lead that is not there', async () => {
    const { lead } = await seed();
    expect((await call('add_note', { id: lead.id, body: '   ' })).isError).toBe(true);
    expect((await call('add_note', { id: lead.id, body: 'x'.repeat(2001) })).isError).toBe(true);
    expect((await call('add_note', { id: 9999, body: 'hello' })).isError).toBe(true);
    expect(await listNotes(env.DB, lead.id)).toHaveLength(0);
  });
});

describe('weekly_digest', () => {
  it('reads correctly at zero', async () => {
    const d = (await data('weekly_digest')) as Record<string, Record<string, unknown>>;
    expect((d.new_leads as Record<string, unknown>).count).toBe(0);
    expect((d.letters_set as Record<string, unknown>).count).toBe(0);
    expect(d.engine).toBe(false as unknown as Record<string, unknown>);
    expect(d.spend_today_usd).toBe(0 as unknown as Record<string, unknown>);
    expect(String(d.status_changes)).toContain('Not tracked');
  });

  it('counts the week, the letters, and the record beside them', async () => {
    const { c, letter } = await seed();
    const d = (await data('weekly_digest')) as Record<string, Record<string, unknown>>;

    expect(d.new_leads.count).toBe(1);
    expect((d.new_leads.rows as Record<string, unknown>[])[0]).toMatchObject({
      email: 'broker@aspen.example',
      town: 'Aspen',
    });
    expect(d.letters_set.count).toBe(1);
    expect((d.letters_set.rows as Record<string, unknown>[])[0]).toMatchObject({
      number: letter.number,
      conversation: c.id,
      hours_low: 7,
      hours_high: 9,
    });
    expect(d.record).toMatchObject({ conversations: 1, letters: 1, hoursLow: 7, hoursHigh: 9 });
  });
});

describe('an unknown tool', () => {
  it('is a result that says so, not a broken call', async () => {
    const a = await call('delete_everything');
    expect(a.isError).toBe(true);
    expect(a.content[0].text).toContain('tools/list has the five there are');
  });
});
