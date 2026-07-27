// The conversation engine, end to end: the Worker runs for real, D1 and the
// session Durable Object behind it are the real things, and the only stand-in
// is the model itself.
//
// The model is never called. `ANTHROPIC_BASE_URL` points the door at
// https://model.test — an address that resolves nowhere — and a stub on the
// global `fetch` answers it with the Anthropic wire format, byte for byte:
// message_start with its usage, content_block_delta text, message_delta with
// the output count. The pool's own outbound mocking (`fetchMock`) is not
// exported by @cloudflare/vitest-pool-workers 0.18, but the Durable Object
// runs in the same isolate as this file, so a stub set here is the fetch the
// session sees. The stub also splits every turn into seven-character deltas,
// which is the only way to prove the press holds back a half-written <em> or
// a half-written CHIPS line instead of shipping it to the page.
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOSE_JAMMED, CLOSE_LONG, CLOSE_SPENT, REFUSE_LONG_SAID } from '../src/arc';
import { frictionsOf, getConversation, listEvents } from '../src/db';
import { dayKey } from '../src/spend';
import { readToken } from '../src/token';

// ————— the stand-in

interface Call {
  system: string;
  messages: { role: string; content: string }[];
  key: string | null;
  version: string | null;
  maxTokens: number;
}

let calls: Call[] = [];
let answer: (call: Call) => { text: string; input?: number; output?: number } | 'jam' = () => ({
  text: 'A line from the machine.',
});

// The wire format, in pieces small enough to split every marker the press
// has to reassemble.
function wire(text: string, input: number, output: number): string {
  const parts: string[] = [
    'event: message_start',
    'data: ' +
      JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: input } } }),
    '',
  ];
  for (let i = 0; i < text.length; i += 7) {
    parts.push(
      'event: content_block_delta',
      'data: ' +
        JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: text.slice(i, i + 7) },
        }),
      '',
    );
  }
  parts.push(
    'event: message_delta',
    'data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: output } }),
    '',
    '',
  );
  return parts.join('\n');
}

// The other call. The finale sets a letter (src/letter.ts) with one
// non-streaming request, so the stub answers anything that is not a stream
// with copy that validates — the letter itself is examined in
// test/letter.test.ts; here it only has to not stop the arc.
const LETTER = {
  headline: 'Where the hours are hiding at <em>your gallery.</em>',
  for_line: 'Set from a short correspondence · a gallery · the owner answers, evenings',
  findings: [
    { title: 'The letters', hours_low: 3, hours_high: 4, body: 'The same forty questions.' },
    { title: 'The words', hours_low: 2, hours_high: 3, body: 'Waiting for a quiet evening.' },
    { title: 'The tellings', hours_low: 1, hours_high: 2, body: 'What never gets written.' },
  ],
  total_low: 6,
  total_high: 9,
  thesis: 'It is 1996 again, and being early is a working advantage.',
  keep: 'This letter is yours whether we ever speak.',
};

const realFetch = globalThis.fetch;

beforeEach(async () => {
  calls = [];
  answer = () => ({ text: 'A line from the machine.' });
  env.ANTHROPIC_API_KEY = 'test-key';
  env.ANTHROPIC_BASE_URL = 'https://model.test';

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    if (!req.url.startsWith('https://model.test')) {
      return realFetch(input as RequestInfo, init);
    }
    const body = (await req.json()) as {
      system: string;
      messages: { role: string; content: string }[];
      max_tokens: number;
      stream?: boolean;
    };
    if (body.stream !== true) {
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify(LETTER) }],
          usage: { input_tokens: 900, output_tokens: 300 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    const call: Call = {
      system: body.system,
      messages: body.messages,
      key: req.headers.get('x-api-key'),
      version: req.headers.get('anthropic-version'),
      maxTokens: body.max_tokens,
    };
    calls.push(call);
    const said = answer(call);
    if (said === 'jam') return new Response('upstream is unwell', { status: 500 });
    return new Response(wire(said.text, said.input ?? 100, said.output ?? 40), {
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;

  await env.SPEND.delete(dayKey());
  await env.DB.batch([
    env.DB.prepare('DELETE FROM letters'),
    env.DB.prepare('DELETE FROM notes'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM leads'),
    env.DB.prepare('DELETE FROM conversations'),
    env.DB.prepare('DELETE FROM sqlite_sequence'),
  ]);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  env.ANTHROPIC_API_KEY = undefined;
});

// ————— reading the doors

const at = (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch('http://example.com' + path, init);

const post = (path: string, body: unknown, init: RequestInit = {}): Promise<Response> =>
  at(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });

interface Opened {
  engine: boolean;
  token?: string;
  conversation?: number;
}

const open = async (
  trade = 'a gallery',
  frictions = ['the same letters, over and over'],
): Promise<Opened> => (await post('/session', { trade, frictions })).json<Opened>();

interface Ended {
  chips: string[];
  stage: string;
  level: string | null;
  done: boolean;
  exchanges: number;
}

interface Heard {
  said: string;
  end: Ended;
}

// One turn, read off the wire the way the page reads it.
async function turn(token: string, said: string): Promise<Heard> {
  const r = await post('/turn', { token, said });
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
  expect(r.headers.get('cache-control')).toBe('no-store');

  let text = '';
  let end: Ended | null = null;
  for (const block of (await r.text()).split('\n\n')) {
    if (!block.trim()) continue;
    const name = /^event: (.+)$/m.exec(block)?.[1] ?? '';
    const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? 'null');
    if (name === 'token') text += (data as { text: string }).text;
    else if (name === 'turn') end = data as Ended;
  }
  if (end === null) throw new Error('the turn never closed');
  return { said: text, end };
}

// ————— /session

describe('opening a conversation', () => {
  it('writes the work down, and hands back a token that verifies', async () => {
    const started = await open('an outfitter', ['asking to be paid', 'the inbox, generally']);
    expect(started.engine).toBe(true);
    expect(started.conversation).toBe(1);

    const presence = await readToken(started.token ?? '', env.SESSION_SECRET);
    expect(presence).not.toBeNull();
    expect(presence?.cid).toBe(1);

    const row = await getConversation(env.DB, 1);
    if (row === null) throw new Error('the conversation was not opened');
    expect(row.trade).toBe('an outfitter');
    expect(frictionsOf(row)).toEqual(['asking to be paid', 'the inbox, generally']);
    // Nothing has been said yet — the archive holds the work, not a transcript.
    expect(await listEvents(env.DB, 1)).toEqual([]);
  });

  it('takes the town from the edge, like the page does', async () => {
    await post('/session', { trade: 'a gallery', frictions: ['the feeds I feed'] }, {
      cf: { city: 'Santa Fe', timezone: 'America/Denver' },
    } as RequestInit);
    const row = await getConversation(env.DB, 1);
    expect(row?.town).toBe('Santa Fe');
    expect(row?.timezone).toBe('America/Denver');
  });

  it('says there is no engine when there is no key, and writes nothing', async () => {
    env.ANTHROPIC_API_KEY = undefined;
    const started = await open();
    expect(started).toEqual({ engine: false });
    expect(await getConversation(env.DB, 1)).toBeNull();
  });

  it('says there is no engine once the day is spent', async () => {
    await env.SPEND.put(dayKey(), '10.5');
    expect(await open()).toEqual({ engine: false });
    // And the page itself stops offering one.
    const body = await (await at('/')).text();
    expect(body).toContain('&quot;engine&quot;:false');
  });

  it('tells the page there is an engine when there is one', async () => {
    const body = await (await at('/')).text();
    expect(body).toContain('&quot;engine&quot;:true');
  });

  it('refuses a sentence it cannot read, in a plain sentence', async () => {
    for (const bad of [
      {},
      { trade: '', frictions: ['x'] },
      { trade: 'a gallery' },
      { trade: 'a gallery', frictions: [] },
      { trade: 'a gallery', frictions: 'the inbox' },
      { trade: 'a gallery', frictions: [1, 2] },
      { trade: 'x'.repeat(200), frictions: ['x'] },
      { trade: 'a gallery', frictions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
    ]) {
      const r = await post('/session', bad);
      expect(r.status).toBe(400);
      expect(await r.text()).toBe('That is not a sentence this page can read.\n');
    }
    expect(await getConversation(env.DB, 1)).toBeNull();
  });

  it('refuses a body larger than a sentence could be', async () => {
    const r = await post('/session', { trade: 'a gallery', frictions: ['x'.repeat(4000)] });
    expect(r.status).toBe(400);
    expect(await r.text()).toBe('That is more than this desk will take.\n');
  });

  it('is not a page — a GET is a miss like any other', async () => {
    expect((await at('/session')).status).toBe(404);
    expect((await at('/turn')).status).toBe(404);
  });
});

// ————— /turn: the door

describe('the token on the turn door', () => {
  it('answers a stranger the same sentence every other miss gets', async () => {
    for (const junk of ['', 'nonsense', 'a.b.c.d', 'x'.repeat(400)]) {
      const r = await post('/turn', { token: junk, said: '' });
      expect(r.status).toBe(404);
      expect(await r.text()).toBe('Nothing is set at this address.\n');
    }
    expect(calls).toEqual([]);
  });

  it('answers an expired token the same way', async () => {
    const started = await open();
    const [sid, cid] = (started.token ?? '').split('.');
    // Correctly shaped, honestly signed once, an hour past its hour.
    const stale = [sid, cid, '1000000000', 'whatever'].join('.');
    expect((await post('/turn', { token: stale, said: '' })).status).toBe(404);
    expect(calls).toEqual([]);
  });
});

// ————— /turn: the conversation

describe('the conversation', () => {
  it('opens on the calibration turn, and writes what it said to the archive', async () => {
    const started = await open('a gallery', ['the same letters, over and over']);
    answer = () => ({
      text: 'Before we go further — the thing everyone calls <em>AI.</em> How do you stand?\nCHIPS: I use it most days | I tried it once | truthfully, I don’t know',
    });

    const heard = await turn(started.token ?? '', '');

    // The chips line is machinery: parsed, and never shown.
    expect(heard.said).not.toContain('CHIPS');
    expect(heard.said).toContain('How do you stand?');
    expect(heard.said).toContain('<em>AI.</em>');
    expect(heard.end.chips).toEqual([
      'I use it most days',
      'I tried it once',
      'truthfully, I don’t know',
    ]);
    expect(heard.end.stage).toBe('calibrate');
    expect(heard.end.done).toBe(false);
    expect(heard.end.exchanges).toBe(0);

    // What the model was handed: the register, the visitor's own sentence,
    // and the day's key on the door.
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('test-key');
    expect(calls[0].version).toBe('2023-06-01');
    expect(calls[0].maxTokens).toBe(350);
    expect(calls[0].system).toContain('You interview.');
    expect(calls[0].system).toContain('a gallery');
    expect(calls[0].messages).toEqual([
      {
        role: 'user',
        content: 'I keep a gallery, and the week disappears into the same letters, over and over.',
      },
    ]);

    // The archive has the site's line, stripped, under its stage.
    const events = await listEvents(env.DB, 1);
    expect(events).toHaveLength(1);
    expect(events[0].role).toBe('site');
    expect(events[0].stage).toBe('calibrate');
    expect(events[0].body).not.toContain('CHIPS');
  });

  it('takes the visitor’s line, writes it down, and moves one stage', async () => {
    const started = await open();
    answer = () => ({ text: 'Something in register.\nCHIPS: go on | show me' });
    await turn(started.token ?? '', '');

    const heard = await turn(started.token ?? '', 'I use it most days');
    expect(heard.end.stage).toBe('teach');
    expect(heard.end.level).toBe('daily');
    expect(heard.end.exchanges).toBe(1);

    const events = await listEvents(env.DB, 1);
    expect(events.map((e) => [e.role, e.stage])).toEqual([
      ['site', 'calibrate'],
      ['visitor', 'calibrate'],
      ['site', 'teach'],
    ]);
    expect(events[1].body).toBe('I use it most days');

    // What calibration learned belongs to the work, not the transcript.
    expect((await getConversation(env.DB, 1))?.level).toBe('daily');

    // And the model was given the exchange so far, in order.
    expect(calls[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(calls[1].messages[2].content).toBe('I use it most days');
  });

  it('takes the two-step when they do not know, and only then teaches', async () => {
    const started = await open();
    answer = () => ({ text: 'A line.\nCHIPS: go on' });
    await turn(started.token ?? '', '');

    const puzzled = await turn(started.token ?? '', "truthfully, I don't know what any of it is");
    expect(puzzled.end.stage).toBe('explain');
    expect(puzzled.end.level).toBeNull();
    expect(calls[1].system).toContain('nobody has told');

    const placed = await turn(started.token ?? '', 'this is the first anyone has explained it');
    expect(placed.end.stage).toBe('teach');
    expect(placed.end.level).toBe('new');
    expect((await getConversation(env.DB, 1))?.level).toBe('new');
  });

  it('walks the whole arc and ends on the letter', async () => {
    const started = await open();
    answer = () => ({ text: 'A line in register.\nCHIPS: go on | tell me more' });
    const token = started.token ?? '';

    await turn(token, '');
    expect((await turn(token, 'I tried it once; it wrote me something wrong')).end.stage).toBe(
      'teach',
    );
    expect((await turn(token, 'go on, then')).end.stage).toBe('idea1');
    expect((await turn(token, 'that would matter')).end.stage).toBe('idea2');
    // The evenings question is answered in their own words, so the stage
    // that asks it offers no chips.
    expect(calls[3].system).toContain('Do NOT offer chips');
    expect((await turn(token, 'I would see the kids')).end.stage).toBe('climax');

    const last = await turn(token, 'I intend to be early this time');
    expect(last.end.stage).toBe('finale');
    expect(last.end.done).toBe(true);
    expect(last.end.exchanges).toBe(5);
    expect(calls[5].system).toContain('going to set them a letter');

    // Six turns spoken, five answered, nothing lost.
    const events = await listEvents(env.DB, 1);
    expect(events.filter((e) => e.role === 'site')).toHaveLength(6);
    expect(events.filter((e) => e.role === 'visitor')).toHaveLength(5);

    // And the work is over: a further turn spends nothing and says so.
    const after = await turn(token, 'one more thing');
    expect(after.end.done).toBe(true);
    expect(calls).toHaveLength(6);
  });
});

// ————— the guards that cost money

describe('the guards', () => {
  it('refuses a line longer than one breath, in register, and keeps the stage', async () => {
    const started = await open();
    answer = () => ({ text: 'A line.\nCHIPS: go on' });
    await turn(started.token ?? '', '');

    const refused = await turn(started.token ?? '', 'x'.repeat(501));
    expect(refused.said).toBe(REFUSE_LONG_SAID);
    expect(refused.end.stage).toBe('calibrate');
    expect(refused.end.done).toBe(false);
    expect(refused.end.exchanges).toBe(0);
    // It cost nothing: no model call, no line in the archive.
    expect(calls).toHaveLength(1);
    expect(await listEvents(env.DB, 1)).toHaveLength(1);
  });

  it('closes gracefully at the twelfth exchange', async () => {
    const started = await open();
    answer = () => ({ text: 'A line.\nCHIPS: go on' });
    await turn(started.token ?? '', '');

    // The arc reaches its letter at six, so the fence is a backstop; it is
    // reached here by winding the session's own counter forward.
    const sid = (started.token ?? '').split('.')[0];
    const stub = env.SESSION.get(env.SESSION.idFromName(sid));
    await runInDurableObject(stub, async (_instance, state) => {
      const memory = await state.storage.get<{ exchanges: number }>('memory');
      await state.storage.put('memory', { ...memory, exchanges: 12 });
    });

    const closed = await turn(started.token ?? '', 'and another thing');
    expect(closed.said).toBe(CLOSE_LONG);
    expect(closed.end.done).toBe(true);
    expect(calls).toHaveLength(1);
    // The close is said out loud, so the archive has it too.
    expect((await listEvents(env.DB, 1)).at(-1)?.body).toBe(CLOSE_LONG);
  });

  it('closes a conversation already in flight when the day’s cap is reached', async () => {
    const started = await open();
    answer = () => ({ text: 'A line.\nCHIPS: go on' });
    await turn(started.token ?? '', '');

    await env.SPEND.put(dayKey(), '11');
    const closed = await turn(started.token ?? '', 'go on');
    expect(closed.said).toBe(CLOSE_SPENT);
    expect(closed.end.done).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('keeps the day’s tally, in dollars, as the turns go by', async () => {
    const started = await open();
    // 1000 in at $1/MTok + 200 out at $5/MTok = $0.002 the turn.
    answer = () => ({ text: 'A line.\nCHIPS: go on', input: 1000, output: 200 });
    await turn(started.token ?? '', '');
    expect(Number(await env.SPEND.get(dayKey()))).toBeCloseTo(0.002, 6);

    await turn(started.token ?? '', 'I use it most days');
    expect(Number(await env.SPEND.get(dayKey()))).toBeCloseTo(0.004, 6);
  });

  it('closes in register when the press jams, and retries once first', async () => {
    const started = await open();
    answer = () => 'jam';

    const jammed = await turn(started.token ?? '', '');
    expect(jammed.said).toBe(CLOSE_JAMMED);
    expect(jammed.end.done).toBe(true);
    // One retry before giving up, and not a word about status codes.
    expect(calls).toHaveLength(2);
    expect(jammed.said).not.toContain('500');
  });

  it('lets nothing through that is not <em>', async () => {
    const started = await open();
    answer = () => ({
      text: 'Consider <script>alert(1)</script> and <em>this</em> & that.\nCHIPS: go on',
    });
    const heard = await turn(started.token ?? '', '');
    expect(heard.said).toContain('&lt;script&gt;');
    expect(heard.said).not.toContain('<script>');
    expect(heard.said).toContain('<em>this</em>');
    expect(heard.said).toContain('&amp; that');
  });
});

// ————— the page, in both modes

describe('the page', () => {
  it('carries the engine flag to the client, and the client reads it', async () => {
    const js = await (await env.ASSETS.fetch('http://example.com/scroll.js')).text();
    expect(js).toContain('EDGE.engine === true');
    expect(js).toContain("fetch('/session'");
    expect(js).toContain("fetch('/turn'");
    // The scripted bank is still there, whole, for when there is no engine.
    expect(js).toContain('Then you are exactly who this page was set for.');
    expect(js).toContain('it is <em>1996 again.</em>');
  });
});
