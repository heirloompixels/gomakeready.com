// The session — one Durable Object per conversation.
//
// D1 is the archive; this is the working memory (CLAUDE.md § Data). It holds
// the stage cursor, the exchange count, the running spend and the tail of the
// transcript the model is given, and it is the only place the model is
// called — so the budget is enforced where the money is spent, not at a door
// that can be walked around.
//
// It never polls and it has no alarm. A session is woken by a visitor's turn
// and does nothing at all between them; when the tab closes it simply stops
// costing anything (CLAUDE.md § Data — wake on events; duration billing).
//
// SQLite-backed (wrangler.jsonc `new_sqlite_classes`), which is what the free
// plan will run and what the storage API assumes going forward.

import { DurableObject } from 'cloudflare:workers';
import {
  advance,
  CLOSE_JAMMED,
  CLOSE_LONG,
  CLOSE_SPENT,
  MAX_EXCHANGES,
  MAX_OUTPUT_TOKENS,
  MAX_SAID,
  onRamp,
  REFUSE_LONG_SAID,
  type Stage,
  systemFor,
} from './arc';
import { appendEvent, type Level, setConversationFacts } from './db';
import { type Line, speak } from './model';
import { addSpend, costOf, overCap } from './spend';
import type { Env } from './types';

/** How much of the transcript the model is given. Six stages, both voices. */
const TAIL = 12;

interface Memory {
  cid: number;
  trade: string;
  frictions: string[];
  town: string | null;
  level: Level | null;
  /** The stage last spoken; the next is computed from it and what they said. */
  stage: Stage;
  exchanges: number;
  spentUsd: number;
  tail: Line[];
  spoken: boolean;
  done: boolean;
}

const KEY = 'memory';

const sse = (event: string, data: unknown): string =>
  'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';

// A miss inside the machine is the same sentence a miss outside it is. The
// door tells a stranger nothing about whether the address exists.
const miss = (): Response =>
  new Response('Nothing is set at this address.\n', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

export class SessionDO extends DurableObject<Env> {
  // In-flight guard. The object is single-threaded but not serial: a visitor
  // leaning on the reply button would otherwise open two model calls at once,
  // and two turns racing is two turns billed.
  private busy = false;

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method !== 'POST') return miss();
    if (path === '/open') return this.open(req);
    if (path === '/turn') return this.turn(req);
    return miss();
  }

  // ————— opening the work
  //
  // Called once, by /session, in the same breath as the conversation row.

  private async open(req: Request): Promise<Response> {
    const said = (await req.json()) as {
      cid: number;
      trade: string;
      frictions: string[];
      town: string | null;
    };
    const memory: Memory = {
      cid: said.cid,
      trade: said.trade,
      frictions: said.frictions,
      town: said.town,
      level: null,
      stage: 'calibrate',
      exchanges: 0,
      spentUsd: 0,
      tail: [{ role: 'user', text: onRamp(said.trade, said.frictions) }],
      spoken: false,
      done: false,
    };
    await this.ctx.storage.put(KEY, memory);
    return new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  // ————— a turn

  private async turn(req: Request): Promise<Response> {
    const memory = await this.ctx.storage.get<Memory>(KEY);
    if (!memory) return miss();

    const body = (await req.json()) as { said?: unknown };
    const said = typeof body.said === 'string' ? body.said.trim() : '';

    // A line too long is refused in register and costs the visitor nothing:
    // the stage does not move, the exchange is not counted, the desk reopens.
    if (said.length > MAX_SAID) {
      return this.say(REFUSE_LONG_SAID, memory, { chips: [], done: false });
    }
    if (memory.done) {
      return this.say('', memory, { chips: [], done: true });
    }
    if (this.busy) return miss();

    // The fence, then the wallet. Both close the conversation properly rather
    // than refusing it — a visitor who has said this much is owed an ending.
    if (memory.exchanges >= MAX_EXCHANGES) {
      return this.close(CLOSE_LONG, memory);
    }
    if (await overCap(this.env.SPEND, this.env.DAILY_CAP_USD)) {
      return this.close(CLOSE_SPENT, memory);
    }

    // The opening turn has no visitor line; the sentence they composed on the
    // on-ramp is already the first thing in the tail.
    const opening = !memory.spoken;
    let stage = memory.stage;
    let level = memory.level;

    if (!opening) {
      if (said.length === 0) return miss();
      const next = advance(memory.stage, said, memory.level);
      stage = next.stage;
      level = next.level;
      memory.exchanges += 1;
      memory.tail.push({ role: 'user', text: said });
      await appendEvent(this.env.DB, {
        conversationId: memory.cid,
        role: 'visitor',
        stage: memory.stage,
        body: said,
      });
      // What calibration learned belongs to the work, not to the transcript.
      if (level !== null && level !== memory.level) {
        await setConversationFacts(this.env.DB, memory.cid, { level });
      }
    }

    return this.speakTurn(memory, stage, level);
  }

  // ————— the streamed turn
  //
  // The response is opened before the model has said a word: the page shows
  // its setting-type indicator, and the first token lands in the same measure
  // the rest of the page was typed in.

  private speakTurn(memory: Memory, stage: Stage, level: Level | null): Response {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const put = (event: string, data: unknown): Promise<void> =>
      writer.write(enc.encode(sse(event, data)));

    this.busy = true;
    const work = async (): Promise<void> => {
      const system = systemFor(stage, {
        trade: memory.trade,
        frictions: memory.frictions,
        town: memory.town,
        level,
      });
      // Fire-and-forget writes inside the emit callback would reorder the
      // stream; each token is awaited, which is also the backpressure.
      const queue: Promise<void>[] = [];
      try {
        const spoken = await speak(this.env, system, memory.tail, MAX_OUTPUT_TOKENS, (text) => {
          queue.push(put('token', { text }));
        });
        await Promise.all(queue);

        const usd = costOf(spoken.inputTokens, spoken.outputTokens);
        memory.spentUsd += usd;
        memory.stage = stage;
        memory.level = level;
        memory.spoken = true;
        memory.done = stage === 'finale';
        memory.tail.push({ role: 'assistant', text: spoken.text });
        if (memory.tail.length > TAIL) memory.tail = memory.tail.slice(-TAIL);

        await this.ctx.storage.put(KEY, memory);
        await appendEvent(this.env.DB, {
          conversationId: memory.cid,
          role: 'site',
          stage,
          body: spoken.text,
        });
        if (usd > 0) await addSpend(this.env.SPEND, usd);

        await put('turn', {
          chips: spoken.chips,
          stage,
          level,
          done: memory.done,
          exchanges: memory.exchanges,
        });
      } catch {
        // The jam. Whatever broke — a timeout, a refusal, a bad gateway — the
        // visitor hears one sentence in the piece's own voice and is handed
        // the ask band. Nothing leaks, and the session is over.
        await Promise.all(queue).catch(() => undefined);
        memory.done = true;
        await this.ctx.storage.put(KEY, memory);
        await put('token', { text: CLOSE_JAMMED });
        await put('turn', { chips: [], stage, level, done: true, exchanges: memory.exchanges });
      } finally {
        this.busy = false;
        await writer.close().catch(() => undefined);
      }
    };
    void work();

    return this.stream(readable);
  }

  // ————— the endings that cost nothing
  //
  // A close and a refusal are streamed in exactly the shape a model turn is,
  // so the page has one way to read a turn and not three.

  private close(sentence: string, memory: Memory): Response {
    memory.done = true;
    return this.say(sentence, memory, { chips: [], done: true }, true);
  }

  private say(
    sentence: string,
    memory: Memory,
    end: { chips: string[]; done: boolean },
    save = false,
  ): Response {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    void (async () => {
      if (sentence) await writer.write(enc.encode(sse('token', { text: sentence })));
      await writer.write(
        enc.encode(
          sse('turn', {
            chips: end.chips,
            stage: memory.stage,
            level: memory.level,
            done: end.done,
            exchanges: memory.exchanges,
          }),
        ),
      );
      if (save) {
        await this.ctx.storage.put(KEY, memory);
        if (sentence) {
          await appendEvent(this.env.DB, {
            conversationId: memory.cid,
            role: 'site',
            stage: memory.stage,
            body: sentence,
          }).catch(() => undefined);
        }
      }
      await writer.close().catch(() => undefined);
    })();
    return this.stream(readable);
  }

  private stream(readable: ReadableStream): Response {
    return new Response(readable, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      },
    });
  }
}
