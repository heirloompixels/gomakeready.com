// The letter: set at the finale, kept at its own address.
//
// The Worker, D1 and the session Durable Object are the real things; the
// only stand-in is the model. Two doors are stubbed at once here, because
// the piece uses two: the streaming interview call (Haiku, src/model.ts) and
// the single non-streaming call that sets the letter (Sonnet-class,
// src/letter.ts). They are told apart the way the API tells them apart —
// `stream: true` — so a test can answer each of them differently.
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOSE_JAMMED } from '../src/arc';
import { getConversation, letterByNumber, sha256hex } from '../src/db';
import { LETTER_MAX_TOKENS } from '../src/letter';
import { dayKey } from '../src/spend';

// ————— the two stand-ins

interface LetterCall {
  model: string;
  maxTokens: number;
  stream: unknown;
  format: string | undefined;
  system: string;
  said: string;
}

let letterCalls: LetterCall[] = [];
let letterSays: (n: number) => string = () => JSON.stringify(GOOD);

/** Copy that validates. The <em> is the one tag the register allows. */
const GOOD = {
  headline: 'Where the hours are hiding at <em>your gallery.</em>',
  for_line: 'Set from a short correspondence · a gallery on Canyon Road · evenings',
  findings: [
    {
      title: 'The provenance letters',
      hours_low: 3,
      hours_high: 4,
      body: 'The same forty questions in different words. The reply drafts itself <em>in your voice</em>.',
    },
    {
      title: 'Words for the new work',
      hours_low: 2,
      hours_high: 3,
      body: 'The words wait for a quiet evening that does not come.',
    },
    {
      title: 'What never gets written',
      hours_low: 1,
      hours_high: 2,
      body: 'One working hour becomes the statements and the announcements.',
    },
  ],
  total_low: 6,
  total_high: 9,
  thesis: 'It is <em>1996 again</em>, and being early is a working advantage.',
  keep: 'This letter is yours whether we ever speak.',
};

// The interview's wire format, in pieces.
function wire(text: string): string {
  const parts: string[] = [
    'event: message_start',
    'data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 100 } } }),
    '',
    'event: content_block_delta',
    'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } }),
    '',
    'event: message_delta',
    'data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 40 } }),
    '',
    '',
  ];
  return parts.join('\n');
}

const realFetch = globalThis.fetch;

beforeEach(async () => {
  letterCalls = [];
  letterSays = () => JSON.stringify(GOOD);
  env.ANTHROPIC_API_KEY = 'test-key';
  env.ANTHROPIC_BASE_URL = 'https://model.test';

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    if (!req.url.startsWith('https://model.test')) {
      return realFetch(input as RequestInfo, init);
    }
    const body = (await req.json()) as {
      model: string;
      system: string;
      max_tokens: number;
      stream?: boolean;
      messages: { role: string; content: string }[];
      output_config?: { format?: { type?: string } };
    };

    if (body.stream === true) {
      return new Response(wire('A line in register.\nCHIPS: go on | tell me more'), {
        headers: { 'content-type': 'text/event-stream' },
      });
    }

    letterCalls.push({
      model: body.model,
      maxTokens: body.max_tokens,
      stream: body.stream,
      format: body.output_config?.format?.type,
      system: body.system,
      said: body.messages[0]?.content ?? '',
    });
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: letterSays(letterCalls.length) }],
        usage: { input_tokens: 1200, output_tokens: 400 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
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

// ————— walking the arc

const at = (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch('http://example.com' + path, init);

const post = (path: string, body: unknown): Promise<Response> =>
  at(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

interface Ended {
  done: boolean;
  stage: string;
  letter?: boolean;
}

interface Heard {
  said: string;
  end: Ended;
  set: { number: number; url: string } | null;
}

async function turn(token: string, said: string): Promise<Heard> {
  const r = await post('/turn', { token, said });
  expect(r.status).toBe(200);

  let text = '';
  let end: Ended | null = null;
  let set: { number: number; url: string } | null = null;
  for (const block of (await r.text()).split('\n\n')) {
    if (!block.trim()) continue;
    const name = /^event: (.+)$/m.exec(block)?.[1] ?? '';
    const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? 'null');
    if (name === 'token') text += (data as { text: string }).text;
    else if (name === 'turn') end = data as Ended;
    else if (name === 'letter') set = data as { number: number; url: string };
  }
  if (end === null) throw new Error('the turn never closed');
  return { said: text, end, set };
}

/** The whole six-stage arc, in the order the page walks it. */
async function toTheEnd(): Promise<Heard> {
  const started = await (
    await post('/session', { trade: 'a gallery', frictions: ['the same letters, over and over'] })
  ).json<{ token?: string }>();
  const token = started.token ?? '';
  await turn(token, '');
  await turn(token, 'I use it most days');
  await turn(token, 'go on');
  await turn(token, 'that would matter');
  await turn(token, 'I would see the kids');
  return turn(token, 'I intend to be early this time');
}

// ————— the letter is set

describe('setting the letter', () => {
  it('asks once, in the shape it can read, and prints what comes back', async () => {
    const last = await toTheEnd();

    expect(last.end.done).toBe(true);
    expect(last.end.letter).toBe(true);
    expect(last.set).not.toBeNull();
    expect(last.set?.number).toBe(1);

    // One call, not a stream, constrained to the schema and to a length a
    // letter fits in (src/letter.ts § the call).
    expect(letterCalls).toHaveLength(1);
    expect(letterCalls[0].model).toBe('claude-sonnet-5');
    expect(letterCalls[0].maxTokens).toBe(LETTER_MAX_TOKENS);
    expect(letterCalls[0].stream).toBeUndefined();
    expect(letterCalls[0].format).toBe('json_schema');
    // And it was handed the register and the whole correspondence.
    expect(letterCalls[0].system).toContain('a gallery');
    expect(letterCalls[0].said).toContain('I keep a gallery, and the week disappears into');
    expect(letterCalls[0].said).toContain('I intend to be early this time');
  });

  it('writes the row with its hours and the hash of its key, never the key', async () => {
    const last = await toTheEnd();
    const key = new URL('http://x' + (last.set?.url ?? '')).searchParams.get('k') ?? '';

    const row = await letterByNumber(env.DB, 1);
    if (row === null) throw new Error('the letter was not set');
    expect(row.conversation_id).toBe(1);
    expect(row.hours_low).toBe(6);
    expect(row.hours_high).toBe(9);
    expect(row.key_hash).toBe(await sha256hex(key));
    expect(row.key_hash).toHaveLength(64);
    // 32 bytes of randomness, base64url.
    expect(key.length).toBeGreaterThanOrEqual(43);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(row)).not.toContain(key);
  });

  it('sets it into the same markup the scripted act uses', async () => {
    await toTheEnd();
    const row = await letterByNumber(env.DB, 1);
    const html = row?.html ?? '';
    expect(html).toContain('<article class="doc">');
    expect(html).toContain('<div class="dochead setin">');
    // The conversation's Nº, and the town the edge did not name.
    expect(html).toContain('<div class="d">Nº 001</div>');
    expect(html).toContain('Where the hours are hiding at <em>your gallery.</em>');
    expect(html).toContain('<div class="hrs">3–4 <small>hrs / week</small></div>');
    expect(html).toContain('<div class="n">6–9</div>');
  });

  it('lets <em> through and nothing else, whatever the model sends', async () => {
    letterSays = () =>
      JSON.stringify({
        ...GOOD,
        headline: 'Hours <em>hiding</em> & <script>alert(1)</script> here.',
        keep: 'Kept. <img src=x onerror=alert(1)>',
      });
    await toTheEnd();

    const html = (await letterByNumber(env.DB, 1))?.html ?? '';
    expect(html).toContain('<em>hiding</em>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&amp;');
  });

  it('joins the record: the finale makes the conversation public', async () => {
    expect(await getConversation(env.DB, 1)).toBeNull();
    await toTheEnd();
    expect((await getConversation(env.DB, 1))?.visibility).toBe('public');
  });
});

// ————— the letter that will not set

describe('a letter that cannot be read', () => {
  it('tries once more, then says the press jammed and prints nothing', async () => {
    letterSays = () => 'I am afraid I cannot set that today.';
    const last = await toTheEnd();

    // One retry, and the second attempt is told what was wrong.
    expect(letterCalls).toHaveLength(2);
    expect(letterCalls[0].system).not.toContain('could not be set');
    expect(letterCalls[1].system).toContain('could not be set');

    expect(last.said).toContain(CLOSE_JAMMED);
    expect(last.end.done).toBe(true);
    expect(last.end.letter).toBe(false);
    expect(last.set).toBeNull();
    expect(await letterByNumber(env.DB, 1)).toBeNull();

    // The conversation still reached its end, so it still joins the record.
    expect((await getConversation(env.DB, 1))?.visibility).toBe('public');
  });

  it('refuses copy that is the right shape and the wrong arithmetic', async () => {
    letterSays = () =>
      JSON.stringify({
        ...GOOD,
        findings: [
          { ...GOOD.findings[0], hours_low: 4, hours_high: 2 },
          GOOD.findings[1],
          GOOD.findings[2],
        ],
      });
    const last = await toTheEnd();
    expect(last.end.letter).toBe(false);
    expect(await letterByNumber(env.DB, 1)).toBeNull();
  });

  it('refuses a letter that is not three findings', async () => {
    letterSays = (n) =>
      JSON.stringify(n === 1 ? { ...GOOD, findings: [GOOD.findings[0]] } : { nonsense: true });
    const last = await toTheEnd();
    expect(last.end.letter).toBe(false);
    expect(letterCalls).toHaveLength(2);
  });

  it('takes the second answer when the first one was unreadable', async () => {
    letterSays = (n) => (n === 1 ? 'not json' : JSON.stringify(GOOD));
    const last = await toTheEnd();
    expect(last.end.letter).toBe(true);
    expect(last.set?.number).toBe(1);
    expect(letterCalls).toHaveLength(2);
  });
});

// ————— the magic address

describe('the door onto a letter', () => {
  const TEXT = 'text/plain; charset=utf-8';

  it('opens for the key it was given, and says so no-store', async () => {
    const last = await toTheEnd();
    const r = await at(last.set?.url ?? '');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(r.headers.get('cache-control')).toBe('no-store');

    const body = await r.text();
    expect(body).toContain('<title>go, make, ready. — a letter on the hours</title>');
    expect(body).toContain('Where the hours are hiding at <em>your gallery.</em>');
    // Its Nº, the quiet line, and the band that carries the conversation Nº.
    expect(body).toContain('The letter <span class="d">·</span> Nº 001');
    expect(body).toContain('This letter is yours to keep');
    expect(body).toContain('<input type="hidden" name="conversation" value="1">');
    expect(body).toContain('The money is what makes it honest.');
  });

  it('hands back the article alone when the page asks for a fragment', async () => {
    const last = await toTheEnd();
    const r = await at((last.set?.url ?? '') + '&fragment=1');
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body.startsWith('<article class="doc">')).toBe(true);
    expect(body.trimEnd().endsWith('</article>')).toBe(true);
    expect(body).not.toContain('<!doctype html>');
  });

  it('is a miss for the wrong key, and reads like every other miss', async () => {
    const last = await toTheEnd();
    const wrong = '/letter/1?k=' + 'x'.repeat(43);
    const r = await at(wrong);
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toBe(TEXT);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.text()).toBe('Nothing is set at this address.\n');

    // And so is no key at all, and a key of the wrong size.
    expect((await at('/letter/1')).status).toBe(404);
    expect((await at('/letter/1?k=short')).status).toBe(404);
    // The right key still opens it, so the letter itself is fine.
    expect((await at(last.set?.url ?? '')).status).toBe(200);
  });

  it('is a miss for a number nobody has been given', async () => {
    const last = await toTheEnd();
    const key = new URL('http://x' + (last.set?.url ?? '')).searchParams.get('k') ?? '';
    for (const address of ['/letter/2?k=' + key, '/letter/0?k=' + key, '/letter/x?k=' + key]) {
      const r = await at(address);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe('Nothing is set at this address.\n');
    }
  });
});
