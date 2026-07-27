// The model door.
//
// One call, made only from the Worker, and only from inside the session
// Durable Object (CLAUDE.md § Architecture). Haiku runs the interview; the
// Sonnet-class call that sets the letter is step 5 and is not here.
//
// Raw fetch rather than @anthropic-ai/sdk: the call is one POST with three
// headers, the response is read as a stream we already have to re-shape for
// the page, and the house rule is that dependencies stay countable on one
// hand. Nothing below is hand-rolled that the SDK would have done better —
// the wire format is the interface.
//
// Prices, model id and stream shape are the claude-api skill's, June 2026:
//   claude-haiku-4-5 — 200K context, $1 / $5 per MTok in / out.
// Haiku 4.5 takes no `effort` and no adaptive thinking; both would error, and
// an interviewer that pauses to think is a page that stops typing.

const MODEL = 'claude-haiku-4-5';
const VERSION = '2023-06-01';

/** 30 seconds. The typist is slower than the model; a longer wait is a jam. */
const TIMEOUT_MS = 30_000;

export interface Line {
  role: 'assistant' | 'user';
  text: string;
}

export interface Spoken {
  /** What the visitor may read, escaped, with the chips line removed. */
  text: string;
  /** The choices the model offered, if it offered any. */
  chips: string[];
  inputTokens: number;
  outputTokens: number;
}

// ————— the press
//
// The model's text is not handed to the page as it arrives. Two things are
// held back: the CHIPS line, which is machinery and not speech, and any
// partial <em> tag, so a tag never straddles two events and arrives at the
// browser broken. Everything else is escaped, because a model's output is a
// stranger's words and the page renders what it is given.

const MARKERS = ['\nCHIPS:', '<em>', '</em>'];

// The longest tail of `s` that could still become one of the markers.
function holdback(s: string): number {
  for (let k = Math.min(7, s.length); k > 0; k--) {
    const tail = s.slice(-k);
    for (const m of MARKERS) if (m.length > k && m.startsWith(tail)) return k;
  }
  return 0;
}

// Everything is escaped; the two tags the register allows are then let back
// through. Safe because the holdback guarantees a tag is never split.
export function escapeButEm(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;em&gt;/g, '<em>')
    .replace(/&lt;\/em&gt;/g, '</em>');
}

export function press(emit: (text: string) => void): {
  feed: (delta: string) => void;
  end: () => string;
} {
  let raw = '';
  let buf = '';
  let stopped = false;

  return {
    feed(delta: string): void {
      raw += delta;
      if (stopped) return;
      buf += delta;
      const at = buf.indexOf('\nCHIPS:');
      if (at >= 0) {
        if (at > 0) emit(escapeButEm(buf.slice(0, at)));
        stopped = true;
        buf = '';
        return;
      }
      // The one case the marker misses: a turn that opens with the line.
      if (raw.length === buf.length && 'CHIPS:'.startsWith(buf.slice(0, 6))) {
        if (buf.startsWith('CHIPS:')) {
          stopped = true;
          buf = '';
        }
        return;
      }
      const keep = holdback(buf);
      const out = buf.slice(0, buf.length - keep);
      buf = buf.slice(buf.length - keep);
      if (out) emit(escapeButEm(out));
    },
    end(): string {
      if (!stopped && buf) emit(escapeButEm(buf));
      buf = '';
      return raw;
    },
  };
}

const CHIPS_LINE = /(?:^|\n)[ \t]*CHIPS[ \t]*:[ \t]*([^\n]*)/;

/** The chips the model offered, and the speech with that line taken out. */
export function partChips(raw: string): { text: string; chips: string[] } {
  const m = raw.match(CHIPS_LINE);
  if (!m) return { text: raw.trim(), chips: [] };
  const chips = m[1]
    .split('|')
    .map((c) => c.trim().replace(/<[^>]*>/g, ''))
    .filter((c) => c.length > 0 && c.length <= 90)
    .slice(0, 4);
  return { text: raw.slice(0, m.index).trim(), chips };
}

// ————— the call

export interface ModelEnv {
  ANTHROPIC_API_KEY?: string;
  /** A gateway, or a stand-in under test. The real address when unset. */
  ANTHROPIC_BASE_URL?: string;
}

const endpoint = (env: ModelEnv): string =>
  (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '') + '/v1/messages';

async function open(env: ModelEnv, system: string, messages: Line[], maxTokens: number) {
  const r = await fetch(endpoint(env), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      stream: true,
      system,
      messages: messages.map((l) => ({ role: l.role, content: l.text })),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok || !r.body) {
    // The status is worth a log line and nothing else; the visitor is never
    // told which door failed.
    throw new Error('the model answered ' + r.status);
  }
  return r.body;
}

/**
 * One turn. Text is handed to `emit` as it arrives, already escaped and
 * already free of the chips line. The whole turn comes back at the end with
 * its usage, which is what the wallet is kept in.
 *
 * One retry, and only before a word has been spoken — a stream that fails
 * halfway cannot be started again without the visitor seeing it stutter.
 */
export async function speak(
  env: ModelEnv,
  system: string,
  messages: Line[],
  maxTokens: number,
  emit: (text: string) => void,
): Promise<Spoken> {
  let spokenYet = false;
  const guarded = (t: string): void => {
    spokenYet = true;
    emit(t);
  };

  for (let attempt = 0; ; attempt++) {
    const pen = press(guarded);
    let input = 0;
    let output = 0;
    try {
      const body = await open(env, system, messages, maxTokens);
      const reader = body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += value;
        let cut = pending.indexOf('\n\n');
        while (cut >= 0) {
          const block = pending.slice(0, cut);
          pending = pending.slice(cut + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '' || payload === '[DONE]') continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(payload) as Record<string, unknown>;
            } catch {
              continue;
            }
            const type = ev.type;
            if (type === 'content_block_delta') {
              const delta = ev.delta as { type?: string; text?: string } | undefined;
              if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
                pen.feed(delta.text);
              }
            } else if (type === 'message_start') {
              const u = (ev.message as { usage?: Record<string, number> } | undefined)?.usage;
              if (u) {
                input =
                  (u.input_tokens ?? 0) +
                  (u.cache_creation_input_tokens ?? 0) +
                  (u.cache_read_input_tokens ?? 0);
                output = u.output_tokens ?? 0;
              }
            } else if (type === 'message_delta') {
              const u = ev.usage as Record<string, number> | undefined;
              if (u?.output_tokens !== undefined) output = u.output_tokens;
            } else if (type === 'error') {
              throw new Error('the model sent an error event');
            }
          }
          cut = pending.indexOf('\n\n');
        }
      }
      const raw = pen.end();
      const { text, chips } = partChips(raw);
      return { text, chips, inputTokens: input, outputTokens: output };
    } catch (err) {
      if (attempt === 0 && !spokenYet) continue;
      throw err;
    }
  }
}
