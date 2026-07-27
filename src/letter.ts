// The letter — set once, at the end, and set properly or not at all.
//
// Six stages of interview happen in Haiku's hand, a turn at a time
// (src/arc.ts). This is the other call: one non-streaming Sonnet-class
// request that reads the whole correspondence and sets it as a printed
// document (CLAUDE.md § Architecture — "Haiku runs the interview; one
// Sonnet-class call sets the letter").
//
// Model id, params and the way the output is constrained are the claude-api
// skill's, July 2026:
//   claude-sonnet-5 — $3 / $15 per MTok, structured outputs supported.
// The shape is pinned with `output_config.format` (a json_schema), which is
// the reliable way to get JSON out of the API rather than out of a parser.
// Thinking is disabled: it is on by default on Sonnet 5, `max_tokens` caps
// thinking and text together, and a letter that truncates mid-finding is
// worse than no letter. The hard instruction is in the system prompt as
// well, so a gateway that has never heard of `output_config` still answers
// something this file can read.
//
// Nothing the model says is trusted. Every field is measured by hand below;
// a letter that fails twice is not printed at all — the session says the jam
// close instead (src/arc.ts § CLOSE_JAMMED). A broken letter would be worse
// than a missing one, because a letter is the only thing the visitor keeps.

import { html, raw } from 'hono/html';
import type { Facts } from './arc';
import { letterByNumber, sha256hex } from './db';
import { escapeButEm, type Line, type ModelEnv } from './model';
import type { Env } from './types';

const MODEL = 'claude-sonnet-5';
const VERSION = '2023-06-01';

/** Room for three findings, a thesis and the closing note. Nothing more. */
export const LETTER_MAX_TOKENS = 1500;

/** Longer than a turn: this call reads the whole correspondence. */
const TIMEOUT_MS = 60_000;

// ————— what a letter is

export interface Finding {
  title: string;
  hours_low: number;
  hours_high: number;
  body: string;
}

export interface Letter {
  headline: string;
  for_line: string;
  findings: Finding[];
  total_low: number;
  total_high: number;
  thesis: string;
  keep: string;
}

/** What is printed in the dochead: the conversation's Nº, and its town. */
export interface Head {
  number: number;
  town: string | null;
}

// The schema handed to the API. Deliberately types and nothing else: the
// structured-output compiler does not take lengths, ranges or item counts,
// and every one of those is checked by hand below anyway — a constraint the
// model is told about and a constraint the Worker enforces are two different
// things, and only the second one is a guarantee.
export const LETTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'for_line', 'findings', 'total_low', 'total_high', 'thesis', 'keep'],
  properties: {
    headline: { type: 'string' },
    for_line: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'hours_low', 'hours_high', 'body'],
        properties: {
          title: { type: 'string' },
          hours_low: { type: 'integer' },
          hours_high: { type: 'integer' },
          body: { type: 'string' },
        },
      },
    },
    total_low: { type: 'integer' },
    total_high: { type: 'integer' },
    thesis: { type: 'string' },
    keep: { type: 'string' },
  },
} as const;

// ————— the direction
//
// The interview's REGISTER is about taking turns — three sentences, a
// question at the end. A letter does none of that, so the voice is written
// again here rather than bent out of shape.

export const LETTER_DIRECTION = `You are the compositor of "go, make, ready." — a page that
has just interviewed a small business owner about where their week goes. The
interview is over. Your work now is to set them a letter about their own hours,
as a printed document, from what they actually said.

Your register: plainspoken, unhurried, a little withheld. Shaker severity, warm.
No hype, no jargon, no exclamation points, no emoji, no salesmanship, no
headings, no lists, no markdown. Never say "as an AI" and never refer to
yourself. Never imply the tool replaces their taste, voice or judgment — it asks
for their sign-off, not their soul. Never invent a price.

Use their own words and their own trade throughout. Every finding must be a real
scene in their rooms, drawn from the friction they named and the things they
said — not a category, not a feature. The hours you attach are an honest weekly
estimate for that one finding, whole numbers, a small range.

You may wrap a few words in <em>…</em> for emphasis. You may use no other markup
of any kind, and no <b>, no <a>, no <script>, nothing.

Answer with a single JSON object and nothing else — no preface, no code fence.
Its shape, exactly:
{
  "headline": "one line, under twelve words, ending in a period, naming where their hours are hiding",
  "for_line": "one line of provenance: what this letter was set from, in the form 'Set from a short correspondence · <their trade, particularised> · <one true detail they gave>'",
  "findings": [
    { "title": "three or four words", "hours_low": 1, "hours_high": 3, "body": "three or four sentences: the scene, what would already be waiting for them, and whose judgment it stays" }
  ],
  "total_low": 0,
  "total_high": 0,
  "thesis": "four or five sentences: under the hours, the larger thing — that being met in their own words is the first genuinely new way to use a computer in decades, that it is like the internet but better, and that it is that early",
  "keep": "two sentences: the letter is theirs whether or not you ever speak, and what they said here joins the record melted down, like old type, recast without their name"
}
Exactly three findings. total_low and total_high are the sums of the findings'
hours. Nothing outside the object.`;

/** The correspondence, handed over as it was heard. */
function transcriptOf(tail: Line[]): string {
  return tail
    .map((l) => (l.role === 'user' ? 'THEM: ' : 'YOU: ') + l.text.replace(/<\/?em>/g, ''))
    .join('\n\n');
}

export function letterSystem(facts: Facts): string {
  const lines = [
    LETTER_DIRECTION,
    '',
    'What you know about this visitor, and all you know:',
    '- Their trade, in their words: ' + facts.trade,
    '- Where their week goes, in their words: ' + facts.frictions.join('; '),
  ];
  if (facts.town) lines.push('- The town the edge says they are reading from: ' + facts.town);
  if (facts.level) lines.push('- How they stand with it: ' + facts.level);
  return lines.join('\n');
}

export function letterPrompt(tail: Line[]): string {
  return (
    'The correspondence, whole, in the order it was said:\n\n' +
    transcriptOf(tail) +
    '\n\nSet their letter now. The JSON object, and nothing else.'
  );
}

// ————— measuring what came back
//
// Every field by hand. The escaping is the interview's own (src/model.ts):
// escape everything, then let the two tags the register allows back through.
// An unbalanced pair is not emphasis, it is a broken tag, so it is dropped
// rather than closed on the model's behalf.

const EM = /<\/?em>/g;

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = escapeButEm(v.replace(/\s+/g, ' ').trim());
  if (t.length === 0) return null;
  const plain = t.replace(EM, '');
  if (plain.length === 0 || plain.length > max) return null;
  const opens = (t.match(/<em>/g) ?? []).length;
  const closes = (t.match(/<\/em>/g) ?? []).length;
  return opens === closes ? t : plain;
}

function whole(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) return null;
  return v;
}

/** An hour a week is the floor; forty is a working week and a lie past it. */
const HOURS_MAX = 40;

export function readLetter(v: unknown): Letter | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;

  const headline = clean(o.headline, 90);
  const forLine = clean(o.for_line, 180);
  const thesis = clean(o.thesis, 900);
  const keep = clean(o.keep, 360);
  if (!headline || !forLine || !thesis || !keep) return null;

  if (!Array.isArray(o.findings) || o.findings.length !== 3) return null;
  const findings: Finding[] = [];
  let low = 0;
  let high = 0;
  for (const item of o.findings) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const f = item as Record<string, unknown>;
    const title = clean(f.title, 60);
    const body = clean(f.body, 700);
    const hl = whole(f.hours_low, 1, HOURS_MAX);
    const hh = whole(f.hours_high, 1, HOURS_MAX);
    if (!title || !body || hl === null || hh === null || hl > hh) return null;
    findings.push({ title, hours_low: hl, hours_high: hh, body });
    low += hl;
    high += hh;
  }

  // The totals are arithmetic, not judgment. They are read — a letter whose
  // sums are not integers is not a letter — and then set to what the three
  // findings actually add up to, because a printed total that does not add
  // up is the one mistake a letter cannot survive.
  const tl = whole(o.total_low, 1, HOURS_MAX * 3);
  const th = whole(o.total_high, 1, HOURS_MAX * 3);
  if (tl === null || th === null || tl > th) return null;

  return {
    headline,
    for_line: forLine,
    findings,
    total_low: low,
    total_high: high,
    thesis,
    keep,
  };
}

// ————— the call
//
// One POST, no stream. The retry is the whole of the recovery: a second
// attempt, told plainly what was wrong with the first, and then the jam.

const endpoint = (env: ModelEnv): string =>
  (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '') + '/v1/messages';

interface Answered {
  copy: unknown;
  inputTokens: number;
  outputTokens: number;
}

// The model may answer with the object alone (the structured-output path) or
// with the object wrapped in a sentence (a gateway that dropped the format).
// Both are read; nothing else is.
function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const open = text.indexOf('{');
    const close = text.lastIndexOf('}');
    if (open < 0 || close <= open) return null;
    try {
      return JSON.parse(text.slice(open, close + 1));
    } catch {
      return null;
    }
  }
}

async function ask(env: ModelEnv, system: string, prompt: string): Promise<Answered> {
  const r = await fetch(endpoint(env), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: LETTER_MAX_TOKENS,
      system,
      // Sonnet 5 thinks by default and `max_tokens` caps thinking and text
      // together; a letter needs the whole budget for the letter.
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: LETTER_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error('the model answered ' + r.status);

  const body = (await r.json()) as {
    content?: { type?: string; text?: string }[];
    usage?: Record<string, number>;
  };
  const text = (body.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  const u = body.usage ?? {};
  return {
    copy: readJson(text),
    inputTokens:
      (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
  };
}

/** What the second attempt is told, in the register the first one was given. */
const AGAIN =
  '\n\nYour last answer could not be set. It was not a single JSON object of exactly ' +
  'the shape above, with exactly three findings, whole-number hours, and no markup ' +
  'but <em>. Set it again, correctly, and answer with the object alone.';

export interface Set {
  copy: Letter;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The letter, composed. Null means it could not be set twice running, which
 * the caller turns into the jam close — never into a half-printed page.
 */
export async function compose(env: ModelEnv, facts: Facts, tail: Line[]): Promise<Set | null> {
  const system = letterSystem(facts);
  const prompt = letterPrompt(tail);
  let input = 0;
  let output = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const answered = await ask(env, attempt === 0 ? system : system + AGAIN, prompt);
      input += answered.inputTokens;
      output += answered.outputTokens;
      const copy = readLetter(answered.copy);
      if (copy) return { copy, inputTokens: input, outputTokens: output };
    } catch {
      // A timeout, a bad gateway, a refusal: the same as unreadable copy.
      // One more attempt, then the press has jammed.
    }
  }
  return null;
}

// ————— the markup
//
// One template, used by the scripted letter act in the scroll and by the
// letter a real correspondence sets. They cannot drift, because there is
// only one of them.

const no = (n: number): string => String(n).padStart(3, '0');

const span = (low: number, high: number): string => (low === high ? String(low) : low + '–' + high);

export function letterArticle(l: Letter, head: Head) {
  const where = head.town ? ' · ' + head.town : '';
  const findings = l.findings.map(
    (f) => html`<div class="finding setin">
          <div class="fh"><h2>${raw(f.title)}</h2><div class="hrs">${span(f.hours_low, f.hours_high)} <small>hrs / week</small></div></div>
          <p>${raw(f.body)}</p>
        </div>
        `,
  );
  return html`<article class="doc">
        <div class="dochead setin">
          <div class="t">go<span class="p">,</span> make<span class="p">,</span> ready<span class="p">.</span> — a letter on the hours</div>
          <div class="d">Nº ${no(head.number)}${where}</div>
        </div>
        <h1 class="setin">${raw(l.headline)}</h1>
        <div class="for setin">${raw(l.for_line)}</div>
        ${findings}<div class="total setin">
          <div class="n">${span(l.total_low, l.total_high)}</div>
          <div class="l">hours a week, sitting in these three alone</div>
        </div>
        <div class="finding thesis setin">
          <p>
            ${raw(l.thesis)}</p>
        </div>
        <div class="keep setin">
          ${raw(l.keep)}
        </div>
      </article>`;
}

// ————— the scripted letter
//
// The letter the page shows when there is no engine behind it: the mockup's
// own, word for word, set through the template above so the demonstration
// and the real thing are the same document. Its <b> tags are ours, not a
// model's — the register allows the page its own emphasis; it allows the
// model only <em>.

export const SCRIPTED_HEAD: Head = { number: 52, town: 'Santa Fe' };

export const SCRIPTED_LETTER: Letter = {
  headline: 'Where the hours are hiding at <em>your gallery.</em>',
  for_line:
    'Set from a short correspondence · a gallery on Canyon Road · the owner answers, evenings',
  findings: [
    {
      title: 'The provenance letters',
      hours_low: 3,
      hours_high: 4,
      body: `Collectors ask the same forty questions in different words. Given your artist files
            and your past answers, the reply drafts itself <b>in your voice</b> — you read it,
            mend a sentence, send it. The judgment stays yours. The typing doesn't.`,
    },
    {
      title: 'Words for the new work',
      hours_low: 2,
      hours_high: 3,
      body: `The work arrives, the photographs are made, and the words wait for a quiet
            evening that doesn't come. From your photographs and a few spoken notes,
            a draft is waiting <b>before you've locked the door</b>.`,
    },
    {
      title: 'What never gets written',
      hours_low: 1,
      hours_high: 2,
      body: `You said it plainly. One working hour a week becomes the statements and
            the announcements, drafted from what actually happened in the room —
            <b>nothing leaves without your hand on it.</b>`,
    },
  ],
  total_low: 6,
  total_high: 9,
  thesis: `And under the hours, the larger thing: what you did on this page — asking in
            your own words, and being met — is the first <b>genuinely new way to use a
            computer</b> in decades. It is like the internet, but better, and it is that
            early. The advantage, as before, goes to whoever moves first.`,
  keep: `This letter is yours whether we ever speak. What you said here joins the record
          melted down, like old type — recast without your name.`,
};

/** The scripted act, set. What the scroll has always shown, from one template. */
export const scriptedLetter = () => letterArticle(SCRIPTED_LETTER, SCRIPTED_HEAD);

// ————— the magic address
//
// The key exists in exactly one place: the URL the reader keeps. It is
// generated here, hashed on the way into the database (src/db.ts §
// sha256hex) and never written down anywhere in between. A database in the
// wrong hands opens no one's letter.

const B64 = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** 32 bytes of the platform's own randomness — 43 characters of base64url. */
export function magicKey(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return B64(b);
}

// ————— the door
//
// GET /letter/:number?k=… — the only way in, and the only thing that
// distinguishes a reader from a stranger. Everything that is not a live
// letter with the right key answers the house miss: the wrong key, a number
// nobody has been given, a letter set before keys existed, and an address
// invented out of nothing all read exactly alike. The door is not an oracle
// (the same discipline as the200's admin gate — copy, don't extract).

const MISS = 'Nothing is set at this address.\n';

const miss = (): Response =>
  new Response(MISS, {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

const served = (body: string): Response =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

// Length-independent, like the presence token's (src/token.ts): both sides
// are sha-256 hex, so both are 64 characters and the comparison tells an
// attacker how long their own guess was and nothing else.
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function asNumber(v: string): number | null {
  if (v.length < 1 || v.length > 9) return null;
  for (const ch of v) if (ch < '0' || ch > '9') return null;
  const n = Number.parseInt(v, 10);
  return n > 0 ? n : null;
}

export async function handleLetter(env: Env, req: Request, rawNumber: string): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get('k') ?? '';
  const number = asNumber(rawNumber);
  if (number === null || key.length < 16 || key.length > 200) return miss();

  const row = await letterByNumber(env.DB, number);
  if (row === null || row.key_hash === null) return miss();
  if (!sameHash(await sha256hex(key), row.key_hash)) return miss();

  // The article alone, for the page that is already open: the scroll fetches
  // this back into its own letter act rather than being handed a second copy
  // of the whole document (assets/scroll.js § revealSetLetter).
  if (url.searchParams.get('fragment') === '1') return served(row.html);

  // The town and the hours are already set into the article; the page only
  // has to name the two numbers and hand the reader the band.
  return served(
    await letterPage(row.html, { number: row.number, conversation: row.conversation_id }),
  );
}

// ————— the standalone page
//
// The same measure the scroll is set on — a 190px rail and a body, the same
// two stylesheets, the same closing band. It carries no conversation, so it
// carries none of the typist: one small script binds the ask band and that
// is the whole of its behaviour.

export interface Kept {
  /** The letter's own Nº — the address it is kept at. */
  number: number;
  /** The conversation it was set from, which the ask band carries back. */
  conversation: number;
}

export const letterPage = (article: string, k: Kept) => html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>go, make, ready. — a letter on the hours</title>
<meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="/brand.css">
<link rel="stylesheet" href="/scroll.css">
</head>
<body>

<header>
  <div class="wrap bar">
    <a href="/" class="brandmark">go<span class="p">,</span> make<span class="p">,</span> ready<span class="p">.</span></a>
    <nav><a href="/record">The record</a></nav>
    <div class="end"><span class="eyebrow">Conversation <span class="d">·</span> Nº ${no(k.conversation)}</span></div>
  </div>
</header>

<main class="flow">
  <div class="entry first">
    <div class="rail eyebrow">The letter <span class="d">·</span> Nº ${no(k.number)}</div>
    <div class="body">
      ${raw(article)}
      <p class="kept">This letter is yours to keep, whether or not we ever speak. It lives at
        a private address — this one. Nobody else has it, and nothing here is indexed.</p>
    </div>
  </div>
</main>

<section class="ask on" id="ask">
  <div class="inner">
    <div class="rail eyebrow">The ask <span class="d">·</span> IV</div>
    <div>
      <h2>An hour of my attention, on your material. Fifty dollars. <em>The money is what makes it honest.</em></h2>
      <p>Free hours are worth what they cost. Mine begins before we meet — I'll arrive with
        something already built from your own shop, and you keep whatever we make, along
        with this letter, printed and set properly. If the hour isn't worth it, say so,
        and the fifty comes back.</p>
      <form>
        <input type="email" name="email" placeholder="you@yourshop.com" required>
        <input class="trap" type="text" name="website" tabindex="-1" aria-hidden="true" autocomplete="off">
        <input type="hidden" name="conversation" value="${k.conversation}">
        <button class="cta" type="submit">Claim the hour — $50</button>
      </form>
      <div class="meta">In Bozeman through the summer · elsewhere by Zoom<br>
        presented with <a href="https://torc.art">Truth or Consequences Contemporary</a> — torc.art</div>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <div><b>go, make, ready.</b> — an artwork that is also an offer.</div>
    <div>Kyle Parker Cunningham · with <a href="https://torc.art">Truth or Consequences Contemporary</a>, T or C, New Mexico</div>
  </div>
</footer>

<script src="/band.js" defer></script>
</body>
</html>
`;
