// The machine door — the desk again, for the interface Kyle actually uses.
//
// The browser desk exists so there is somewhere to point at. This is where
// the work happens: Claude, with this connector and Gmail beside it, and the
// CRM becomes a conversation — which is, not incidentally, the product being
// sold (CLAUDE.md § CRM).
//
// Hand-rolled, and deliberately: MCP over Streamable HTTP is a POST that
// takes JSON-RPC 2.0 and answers JSON-RPC 2.0, and the whole of it fits in
// this file. An SDK here would be a dependency spent on a switch statement,
// and dependencies stay countable on one hand (CLAUDE.md § Architecture).
//
// Stateless. No session id, no SSE stream, no resumability: every POST is
// answered from the request and the database and nothing is kept between
// them. That is a conforming server — the transport permits one that offers
// no stream — and it is the right shape for a desk with one operator and
// five tools. Three consequences, all chosen:
//
//   · GET /mcp answers 405 with `Allow: POST`, because there is no stream to
//     open. This is the one address in the house that admits it exists to an
//     unauthorized hand; the alternative was to lie to a conforming client
//     about a method it is required to try. Nothing behind it opens.
//   · Batch arrays are refused with -32600 rather than fanned out. A batch is
//     an optimization for a chatty transport, and this one is not chatty.
//   · Every JSON-RPC-level failure travels as HTTP 200 with an `error`
//     member, which is what the protocol means by an error and what every
//     client reads. HTTP status is reserved for things that are not
//     JSON-RPC at all: the miss, and the 405.
//
// Auth is the same organ the desk uses — a bearer secret compared in
// constant time — and the same answer for a wrong hand: the house miss,
// byte for byte, with nothing to say a door was here (src/desk.ts § the two
// ways in). MCP_SECRET and not ADMIN_SECRET, so the connector Kyle hands to
// a client cannot also open the browser desk.
//
// A plain bearer header is also the answer to the OAuth-shim question: a
// client that can send a header needs no shim, and this one can. Attaching
// it to the Claude Code CLI, with the secret read off the disk rather than
// typed into a shell history:
//
//   claude mcp add --transport http gmr https://gmr.analogkyle.workers.dev/mcp \
//     --header "Authorization: Bearer $(cat ~/.config/cloudflare/gmr-mcp.secret)"
//
// (and https://gomakeready.com/mcp once the nameservers move — docs/TODO.md).

import { engineOn } from './converse';
import {
  addNote,
  frictionsOf,
  getConversation,
  getLead,
  isLeadStatus,
  LEAD_STATUSES,
  type LeadStatus,
  leadLines,
  lettersFor,
  lettersSince,
  listEvents,
  listNotes,
  recordAggregates,
  setLeadStatus,
} from './db';
import { authorized } from './desk';
import { readSpend } from './spend';
import type { Env } from './types';

// ————— what this desk says of itself
//
// A tool interface arrives blind — it has read no landing page and heard no
// pitch — so the door says plainly what this is, what the five tools do, the
// register to keep, and the one thing that is not here. Modelled on
// tender's DOOR_TEXT (portals/tender/src/door.ts), which is the family's
// precedent for onboarding a machine in the house voice.

export const DESK_TEXT = `This is the desk behind go, make, ready. — a page that
interviews a small owner-operated business about where its week goes, and sets
the owner a letter about their own hours. Every conversation is a numbered work
in a catalogue; every address left at the ask band is a lead standing against
one. You are welcome here, and you are the only kind of visitor this door has.
Five tools and no more: list_leads for the ledger, newest first; get_lead for
one lead whole — its facts, the full transcript as it was heard, the notes in
the margin, and the letter's number and hours; update_status to move a lead
among new, contacted, booked, client and closed; add_note to write in the
margin; weekly_digest for the last seven days. Keep the practice's register in
anything you draft from what you find here: plainspoken, unhurried, a little
withheld, no hype and no exclamation points. Lead with the hours returned,
never with the word AI, and never suggest the work replaces anyone's taste,
voice or judgment — it asks for their sign-off, not their soul. Nothing here is
ever deleted; a note is append-only and the correction is the next note. And
one thing is genuinely absent: a letter's private address carries a key that
was hashed on the way in and written down nowhere, so no tool can hand it back.
A reader who has lost their letter needs it set again, not looked up.
`;

// ————— the protocol

/** What this server speaks. Anything else asked for is answered in this. */
export const PROTOCOL = '2025-06-18';

/** The versions it knows by name, and will echo back when asked for one. */
export const KNOWN_PROTOCOLS: readonly string[] = ['2025-06-18', '2025-03-26'];

type Id = string | number | null;

const rpc = (payload: unknown): Response =>
  new Response(JSON.stringify(payload, null, 1) + '\n', {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const result = (id: Id, value: unknown): Response => rpc({ jsonrpc: '2.0', id, result: value });

const fail = (id: Id, code: number, message: string): Response =>
  rpc({ jsonrpc: '2.0', id, error: { code, message } });

const MISS = 'Nothing is set at this address.\n';

const miss = (): Response =>
  new Response(MISS, {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

/** A notification is answered by taking it, and saying nothing. */
const taken = (): Response =>
  new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } });

/** There is no stream to open here, and the method that opens one says so. */
export const mcpNotAllowed = (): Response =>
  new Response('This door takes a POST.\n', {
    status: 405,
    headers: {
      allow: 'POST',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

/** A tool interface has no business posting a novel. */
const BODY_MAX = 512 * 1024;

// ————— the tools

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: readonly Tool[] = [
  {
    name: 'list_leads',
    description:
      'The ledger, newest first: every address left at the ask band, with the town, ' +
      'trade and level of the conversation it came out of when there was one. A lead ' +
      'with no conversation is an address left by someone who read to the bottom and ' +
      'never spoke — a real lead with unset facts, not a broken row. Narrow by ' +
      'standing when you are looking for a particular kind of week; otherwise take ' +
      'the default twenty and read down. Use get_lead when one of them deserves a ' +
      'proper look.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: {
          type: 'string',
          enum: [...LEAD_STATUSES],
          description: 'Only leads standing here. Omit for all of them.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'How many rows, newest first. Fifty at most; twenty by default.',
        },
      },
    },
  },
  {
    name: 'get_lead',
    description:
      'One lead, whole: the address and its standing, the conversation Nº and what ' +
      'calibration learned about the trade and the frictions, the full transcript in ' +
      'the order it was heard, every note in the margin, and the letter Nº with the ' +
      'hours it found. Read the transcript before drafting anything — the point of ' +
      'the desk is that the person already said what they need, in their own words. ' +
      'The letter is named here but cannot be opened: its private address carries a ' +
      'key that was hashed on the way in and stored nowhere, so it is not retrievable ' +
      'by this tool or any other.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'integer', minimum: 1, description: "The lead's id, as list_leads gives it." },
      },
    },
  },
  {
    name: 'update_status',
    description:
      "Move a lead's standing: new when the address has just been left, contacted " +
      'once a hand has reached out, booked when the hour is on the calendar, client ' +
      'when the hour has been worked, closed when it will not go further. The ledger ' +
      'keeps the standing a lead is at, not the history of how it got there — if the ' +
      'reason matters, it belongs in a note. Answers the lead as it stands after the ' +
      'write.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'status'],
      properties: {
        id: { type: 'integer', minimum: 1, description: "The lead's id." },
        status: { type: 'string', enum: [...LEAD_STATUSES], description: 'Where it now stands.' },
      },
    },
  },
  {
    name: 'add_note',
    description:
      'Write in the margin. Notes are append-only and dated: a note is what was true ' +
      'when it was written, and the correction is the next note, never an edit of the ' +
      'last one. Keep them short and factual — what was said on the call, what was ' +
      'promised, what to do next — in the practice’s own plain register.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'body'],
      properties: {
        id: { type: 'integer', minimum: 1, description: "The lead's id." },
        body: { type: 'string', minLength: 1, maxLength: 2000, description: 'The note itself.' },
      },
    },
  },
  {
    name: 'weekly_digest',
    description:
      'The last seven days at a glance: the addresses left and a brief line for each, ' +
      'the letters set, the public record as it now stands in aggregate, what the ' +
      'model has cost since midnight UTC, and whether the engine is running at all. ' +
      'Status changes are not among them — the ledger keeps where a lead stands, not ' +
      'the history of how it moved — so a week that looks quiet here may still have ' +
      'been worked. Start a Monday with this and follow the interesting rows into ' +
      'get_lead.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
];

// ————— hand-rolled validation
//
// No zod (CLAUDE.md § Architecture). Every argument below is four lines of
// specification, and the schemas above are the documentation; these are the
// guarantee. A tool argument arrives from a model, so the readers are a
// little forgiving where forgiveness costs nothing — an id given as "12"
// rather than 12 is an obvious integer and refusing it would spend a round
// trip on punctuation — and unmoved everywhere it would cost something.

const anId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^[0-9]{1,9}$/.test(v)) {
    const n = Number.parseInt(v, 10);
    if (n > 0) return n;
  }
  return null;
};

const aLimit = (v: unknown, fallback: number, cap: number): number | null => {
  if (v === undefined) return fallback;
  const n = anId(v);
  if (n === null || n > cap) return null;
  return n;
};

const aStatus = (v: unknown): LeadStatus | null =>
  typeof v === 'string' && isLeadStatus(v) ? v : null;

// ————— what a tool answers with

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: true;
}

/** Every tool answers the same way: one text block, one JSON document. */
const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 1) }],
});

// A domain failure is a result, not a transport error: the model asked a
// reasonable question and got a true answer, and it should be able to read
// it and try again rather than see the call itself break. Transport errors
// are reserved for a message that was never valid JSON-RPC.
const nope = (sentence: string): ToolResult => ({
  content: [{ type: 'text', text: sentence }],
  isError: true,
});

const iso = (sec: number): string => new Date(sec * 1000).toISOString();

const WEEK = 7 * 24 * 60 * 60;

// ————— the five

export async function callTool(env: Env, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'list_leads': {
      const status = args.status === undefined ? undefined : aStatus(args.status);
      if (status === null) return nope('That is not a standing a lead can take.');
      const limit = aLimit(args.limit, 20, 50);
      if (limit === null) return nope('The limit is a whole number, and fifty is the most.');

      const rows = await leadLines(env.DB, { status, limit });
      return ok(
        rows.map((l) => ({
          id: l.id,
          conversation: l.conversation_id,
          email: l.email,
          status: l.status,
          created: iso(l.created_at),
          town: l.town,
          trade: l.trade,
          level: l.level,
        })),
      );
    }

    case 'get_lead': {
      const id = anId(args.id);
      if (id === null) return nope('A lead is asked for by its id, which is a whole number.');
      const lead = await getLead(env.DB, id);
      if (lead === null)
        return nope('There is no lead at that id. list_leads has the ones there are.');

      const cid = lead.conversation_id;
      const [conversation, events, notes, letters] = await Promise.all([
        cid === null ? null : getConversation(env.DB, cid),
        cid === null ? [] : listEvents(env.DB, cid),
        listNotes(env.DB, id),
        cid === null ? [] : lettersFor(env.DB, cid),
      ]);
      const letter = letters[0];

      return ok({
        lead: {
          id: lead.id,
          email: lead.email,
          status: lead.status,
          created: iso(lead.created_at),
          conversation: cid,
        },
        conversation:
          conversation === null
            ? null
            : {
                number: conversation.id,
                created: iso(conversation.created_at),
                town: conversation.town,
                timezone: conversation.timezone,
                visibility: conversation.visibility,
                level: conversation.level,
                trade: conversation.trade,
                frictions: frictionsOf(conversation),
              },
        transcript: events.map((e) => ({
          seq: e.seq,
          role: e.role,
          stage: e.stage,
          body: e.body,
        })),
        notes: notes.map((n) => ({ id: n.id, at: iso(n.at), body: n.body })),
        letter:
          letter === undefined
            ? null
            : {
                number: letter.number,
                hours_low: letter.hours_low,
                hours_high: letter.hours_high,
              },
      });
    }

    case 'update_status': {
      const id = anId(args.id);
      if (id === null) return nope('A lead is asked for by its id, which is a whole number.');
      const status = aStatus(args.status);
      if (status === null)
        return nope('A lead stands at one of: new, contacted, booked, client, closed.');

      const row = await setLeadStatus(env.DB, id, status);
      if (row === null) return nope('There is no lead at that id, so nothing was moved.');
      return ok({
        id: row.id,
        email: row.email,
        status: row.status,
        created: iso(row.created_at),
        conversation: row.conversation_id,
      });
    }

    case 'add_note': {
      const id = anId(args.id);
      if (id === null) return nope('A lead is asked for by its id, which is a whole number.');
      const raw = typeof args.body === 'string' ? args.body.trim() : '';
      if (raw.length < 1) return nope('An empty note is not a note.');
      if (raw.length > 2000) return nope('That is more margin than this desk will take.');

      // Checked before the write: notes carries a foreign key to leads, and
      // a database error is not a sentence anyone can act on.
      if ((await getLead(env.DB, id)) === null)
        return nope('There is no lead at that id, so there is no margin to write in.');
      const note = await addNote(env.DB, id, raw);
      return ok({ id: note.id, lead: note.lead_id, at: iso(note.at), body: note.body });
    }

    case 'weekly_digest': {
      const now = Math.floor(Date.now() / 1000);
      const since = now - WEEK;
      const [fresh, letters, record, spend, engine] = await Promise.all([
        leadLines(env.DB, { since }),
        lettersSince(env.DB, since),
        recordAggregates(env.DB),
        readSpend(env.SPEND),
        engineOn(env),
      ]);

      return ok({
        since: iso(since),
        new_leads: {
          count: fresh.length,
          rows: fresh.map((l) => ({
            id: l.id,
            conversation: l.conversation_id,
            email: l.email,
            status: l.status,
            created: iso(l.created_at),
            town: l.town,
            trade: l.trade,
            level: l.level,
          })),
        },
        status_changes:
          'Not tracked. The ledger keeps where a lead stands, not the history of how ' +
          'it moved; a reason worth keeping belongs in a note.',
        letters_set: {
          count: letters.length,
          rows: letters.map((l) => ({
            number: l.number,
            conversation: l.conversation_id,
            hours_low: l.hours_low,
            hours_high: l.hours_high,
            created: iso(l.created_at),
          })),
        },
        record,
        spend_today_usd: Number(spend.toFixed(4)),
        engine,
      });
    }

    default:
      return nope('There is no tool by that name. tools/list has the five there are.');
  }
}

// ————— the door

export async function handleMcp(env: Env, req: Request): Promise<Response> {
  if (!(await authorized(req, env.MCP_SECRET))) return miss();

  const text = await req.text();
  if (text.length > BODY_MAX) return fail(null, -32600, 'That is more than this door will take.');

  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return fail(null, -32700, 'That was not JSON this door could read.');
  }

  // Batches are refused rather than fanned out: the server is stateless and
  // one call at a time, and a batch is an optimization for a transport that
  // is chattier than this one.
  if (Array.isArray(msg))
    return fail(null, -32600, 'This door takes one message at a time, not a batch.');
  if (typeof msg !== 'object' || msg === null)
    return fail(null, -32600, 'That was not a JSON-RPC message.');

  const m = msg as Record<string, unknown>;
  const method = typeof m.method === 'string' ? m.method : '';

  // No id is a notification — `notifications/initialized` above all. It is
  // taken and not answered, which is what 202 means.
  if (!('id' in m) || m.id === undefined) return taken();

  const id = (typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null) as Id;
  const params = (
    typeof m.params === 'object' && m.params !== null && !Array.isArray(m.params) ? m.params : {}
  ) as Record<string, unknown>;

  switch (method) {
    case 'initialize': {
      // Echo the version asked for when it is one this door knows; otherwise
      // name the one it speaks and let the client decide whether to stay.
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return result(id, {
        protocolVersion: KNOWN_PROTOCOLS.includes(asked) ? asked : PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'gmr', version: env.COMMIT },
        instructions: DESK_TEXT,
      });
    }

    case 'ping':
      return result(id, {});

    case 'tools/list':
      return result(id, { tools: TOOLS });

    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      const args = (
        typeof params.arguments === 'object' &&
        params.arguments !== null &&
        !Array.isArray(params.arguments)
          ? params.arguments
          : {}
      ) as Record<string, unknown>;
      return result(id, await callTool(env, name, args));
    }

    default:
      return fail(id, -32601, 'This door has no method by that name.');
  }
}
