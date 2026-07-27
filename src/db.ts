// gmr — the data layer. Hand-written SQL, no ORM and no query builder
// (CLAUDE.md § Architecture): the schema is small enough to hold in the head,
// and every statement here should be readable as the sentence it is.
//
// Two rules the rest of the app inherits by using this file:
//
//   Nothing deletes. There is no `delete` verb below and there will not be
//   one. `setVisibility` is how a conversation leaves the public record, and
//   the row stays exactly where it was.
//
//   Numbers are dealt by the database, never by the caller. The conversation
//   Nº is the row id, the event seq and the letter Nº are computed inside the
//   INSERT. A caller that could pass a number could pass a wrong one.

// D1Database and D1PreparedStatement are global here — @cloudflare/workers-types
// is in tsconfig `types`, the same as the200.

// ————— the vocabulary
//
// These are the enumerations the migration writes down in comments. SQLite
// will not enforce them; TypeScript will, at the only place they are written.

export type Visibility = 'held' | 'public' | 'withdrawn';
export type Level = 'daily' | 'burned' | 'nodded' | 'new';
export type Role = 'site' | 'visitor' | 'system';
export type LeadStatus = 'new' | 'contacted' | 'booked' | 'client' | 'closed';

export const LEVELS: readonly Level[] = ['daily', 'burned', 'nodded', 'new'];
export const LEAD_STATUSES: readonly LeadStatus[] = [
  'new',
  'contacted',
  'booked',
  'client',
  'closed',
];

export const isLevel = (v: string): v is Level => (LEVELS as readonly string[]).includes(v);
export const isLeadStatus = (v: string): v is LeadStatus =>
  (LEAD_STATUSES as readonly string[]).includes(v);

// ————— the rows, exactly as the tables hold them

export interface ConversationRow {
  id: number; // the Nº
  created_at: number; // unix seconds
  town: string | null;
  timezone: string | null;
  visibility: Visibility;
  level: Level | null;
  trade: string | null;
  frictions: string | null; // JSON array as text; use `frictionsOf`
}

export interface EventRow {
  id: number;
  conversation_id: number;
  seq: number; // 0-based, per conversation
  at: number;
  role: Role;
  stage: string | null;
  body: string;
}

export interface LeadRow {
  id: number;
  conversation_id: number | null;
  email: string;
  created_at: number;
  status: LeadStatus;
}

export interface NoteRow {
  id: number;
  lead_id: number;
  at: number;
  body: string;
}

export interface LetterRow {
  id: number;
  conversation_id: number;
  number: number; // letter Nº, 1-based
  created_at: number;
  html: string;
  key_hash: string | null;
}

// The stored JSON, read back as what it is. A malformed column answers with
// an empty list rather than throwing: the record is worth more than the
// friction list of one conversation.
export function frictionsOf(row: ConversationRow): string[] {
  if (row.frictions === null) return [];
  try {
    const v: unknown = JSON.parse(row.frictions);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ————— conversations

export interface NewConversation {
  town?: string | null;
  timezone?: string | null;
}

// The work is opened and given its number in the same breath. RETURNING so
// the Nº comes back from the write itself — a second SELECT would be a
// second chance to read someone else's row.
export async function createConversation(
  db: D1Database,
  what: NewConversation = {},
): Promise<ConversationRow> {
  const row = await db
    .prepare('INSERT INTO conversations (town, timezone) VALUES (?, ?) RETURNING *')
    .bind(what.town ?? null, what.timezone ?? null)
    .first<ConversationRow>();
  if (!row) throw new Error('the conversation would not open');
  return row;
}

export async function getConversation(db: D1Database, id: number): Promise<ConversationRow | null> {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first<ConversationRow>();
}

// Newest first — the desk reads the catalogue backwards.
export async function latestConversations(db: D1Database, n: number): Promise<ConversationRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM conversations ORDER BY id DESC LIMIT ?')
    .bind(n)
    .all<ConversationRow>();
  return results;
}

export interface Facts {
  level?: Level;
  trade?: string;
  frictions?: string[];
}

// What calibration learned. Written once in the ordinary case, but an UPDATE
// rather than an INSERT because these are properties of the work, not lines
// in the transcript — the transcript keeps the saying of them. Only the
// fields offered are touched; an empty call is not a write.
export async function setConversationFacts(
  db: D1Database,
  id: number,
  facts: Facts,
): Promise<ConversationRow | null> {
  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  const put = (col: string, v: string | null): void => {
    sets.push(col + ' = ?');
    binds.push(v);
  };
  if (facts.level !== undefined) put('level', facts.level);
  if (facts.trade !== undefined) put('trade', facts.trade);
  if (facts.frictions !== undefined) put('frictions', JSON.stringify(facts.frictions));
  if (sets.length === 0) return getConversation(db, id);

  return db
    .prepare('UPDATE conversations SET ' + sets.join(', ') + ' WHERE id = ? RETURNING *')
    .bind(...binds, id)
    .first<ConversationRow>();
}

// The archive's only form of removal, which removes nothing. 'withdrawn'
// takes a conversation out of the aggregates; the row, the transcript and
// the letter all stay where they were.
export async function setVisibility(
  db: D1Database,
  id: number,
  visibility: Visibility,
): Promise<ConversationRow | null> {
  return db
    .prepare('UPDATE conversations SET visibility = ? WHERE id = ? RETURNING *')
    .bind(visibility, id)
    .first<ConversationRow>();
}

// ————— events (append-only)

export interface NewEvent {
  conversationId: number;
  role: Role;
  body: string;
  stage?: string | null;
}

// The next seq is computed inside the INSERT, not read and then written.
// One statement is one SQLite transaction, and SQLite has one writer, so
// MAX(seq)+1 cannot be stale by the time the row lands — the read and the
// write are the same act. The UNIQUE index behind it is the arbiter of
// last resort: if a seq is ever taken, the write fails loudly instead of
// quietly producing two line sevens.
const APPEND_EVENT =
  'INSERT INTO events (conversation_id, seq, role, stage, body)' +
  ' SELECT ?, COALESCE(MAX(seq) + 1, 0), ?, ?, ? FROM events WHERE conversation_id = ?' +
  ' RETURNING *';

export function appendEventStmt(db: D1Database, e: NewEvent): D1PreparedStatement {
  return db
    .prepare(APPEND_EVENT)
    .bind(e.conversationId, e.role, e.stage ?? null, e.body, e.conversationId);
}

export async function appendEvent(db: D1Database, e: NewEvent): Promise<EventRow> {
  // Three attempts, for the case the arbiter refuses: a losing writer takes
  // the next number rather than the caller taking an error.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const row = await appendEventStmt(db, e).first<EventRow>();
      if (row) return row;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (!m.includes('UNIQUE') || attempt === 2) throw err;
    }
  }
  throw new Error('the transcript would not take the line');
}

// The transcript in the order it was heard.
export async function listEvents(db: D1Database, conversationId: number): Promise<EventRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM events WHERE conversation_id = ? ORDER BY seq')
    .bind(conversationId)
    .all<EventRow>();
  return results;
}

// The last N lines, handed back in the order they were said — what the model
// is given as context, and what the desk reads over a shoulder.
export async function latestEvents(
  db: D1Database,
  conversationId: number,
  n: number,
): Promise<EventRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM events WHERE conversation_id = ? ORDER BY seq DESC LIMIT ?')
    .bind(conversationId, n)
    .all<EventRow>();
  return results.reverse();
}

export async function countEvents(db: D1Database, conversationId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM events WHERE conversation_id = ?')
    .bind(conversationId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ————— leads

export interface NewLead {
  email: string;
  conversationId?: number | null;
}

export async function createLead(db: D1Database, lead: NewLead): Promise<LeadRow> {
  const row = await db
    .prepare('INSERT INTO leads (conversation_id, email) VALUES (?, ?) RETURNING *')
    .bind(lead.conversationId ?? null, lead.email)
    .first<LeadRow>();
  if (!row) throw new Error('the lead would not take');
  return row;
}

export async function getLead(db: D1Database, id: number): Promise<LeadRow | null> {
  return db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<LeadRow>();
}

export interface LeadQuery {
  status?: LeadStatus;
  limit?: number;
}

// Newest first, optionally one status at a time. The desk's whole index.
export async function listLeads(db: D1Database, q: LeadQuery = {}): Promise<LeadRow[]> {
  const where = q.status === undefined ? '' : ' WHERE status = ?';
  const binds: (string | number)[] = q.status === undefined ? [] : [q.status];
  let sql = 'SELECT * FROM leads' + where + ' ORDER BY created_at DESC, id DESC';
  if (q.limit !== undefined) {
    sql += ' LIMIT ?';
    binds.push(q.limit);
  }
  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<LeadRow>();
  return results;
}

// The same email, every time it has been left. Duplicates are the point.
export async function leadsByEmail(db: D1Database, email: string): Promise<LeadRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM leads WHERE email = ? ORDER BY created_at DESC, id DESC')
    .bind(email)
    .all<LeadRow>();
  return results;
}

export async function setLeadStatus(
  db: D1Database,
  id: number,
  status: LeadStatus,
): Promise<LeadRow | null> {
  return db
    .prepare('UPDATE leads SET status = ? WHERE id = ? RETURNING *')
    .bind(status, id)
    .first<LeadRow>();
}

// ————— notes (append-only)

export async function addNote(db: D1Database, leadId: number, body: string): Promise<NoteRow> {
  const row = await db
    .prepare('INSERT INTO notes (lead_id, body) VALUES (?, ?) RETURNING *')
    .bind(leadId, body)
    .first<NoteRow>();
  if (!row) throw new Error('the note would not take');
  return row;
}

export async function listNotes(db: D1Database, leadId: number): Promise<NoteRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM notes WHERE lead_id = ? ORDER BY at, id')
    .bind(leadId)
    .all<NoteRow>();
  return results;
}

export async function latestNotes(db: D1Database, leadId: number, n: number): Promise<NoteRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM notes WHERE lead_id = ? ORDER BY at DESC, id DESC LIMIT ?')
    .bind(leadId, n)
    .all<NoteRow>();
  return results.reverse();
}

// ————— letters

// sha-256 hex. The magic-link key is hashed on the way in and compared as a
// hash on the way back; the key itself never reaches the database.
const enc = new TextEncoder();

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface NewLetter {
  conversationId: number;
  html: string;
  keyHash?: string | null;
}

// Letter Nº is dealt the same way event seq is, and for the same reason —
// one statement, one writer, no chance to read a number someone else is
// already printing. Letters begin at 1.
export async function createLetter(db: D1Database, letter: NewLetter): Promise<LetterRow> {
  const row = await db
    .prepare(
      'INSERT INTO letters (conversation_id, number, html, key_hash)' +
        ' SELECT ?, COALESCE(MAX(number) + 1, 1), ?, ? FROM letters' +
        ' RETURNING *',
    )
    .bind(letter.conversationId, letter.html, letter.keyHash ?? null)
    .first<LetterRow>();
  if (!row) throw new Error('the letter would not set');
  return row;
}

export async function letterByKeyHash(db: D1Database, keyHash: string): Promise<LetterRow | null> {
  return db.prepare('SELECT * FROM letters WHERE key_hash = ?').bind(keyHash).first<LetterRow>();
}

export async function lettersFor(db: D1Database, conversationId: number): Promise<LetterRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM letters WHERE conversation_id = ? ORDER BY number')
    .bind(conversationId)
    .all<LetterRow>();
  return results;
}

// ————— the record
//
// "Nothing said here is kept whole. It is melted down, like old type, and
// recast without a name." This function is that sentence in SQL. It counts;
// it never selects a body, a town, an email or an id. Only visibility
// 'public' is counted — 'held' has not been offered and 'withdrawn' has been
// taken back — with one exception, `total`, which is every conversation
// there has ever been. That number is the piece's own scale and belongs to
// no one, so it is safe to print beside the rest.

export interface Aggregates {
  conversations: number; // public only — what the record may speak for
  total: number; // every conversation, whatever its visibility
  byLevel: Record<string, number>; // public only
  byTrade: Record<string, number>; // public only
  hoursFound: number | null; // null until letters carry hours (step 5b)
}

export async function recordAggregates(db: D1Database): Promise<Aggregates> {
  const [totals, levels, trades] = await db.batch<Record<string, unknown>>([
    db.prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN visibility = 'public' THEN 1 ELSE 0 END) AS public" +
        ' FROM conversations',
    ),
    db.prepare(
      "SELECT level AS k, COUNT(*) AS n FROM conversations WHERE visibility = 'public'" +
        ' AND level IS NOT NULL GROUP BY level ORDER BY n DESC, k',
    ),
    db.prepare(
      "SELECT trade AS k, COUNT(*) AS n FROM conversations WHERE visibility = 'public'" +
        ' AND trade IS NOT NULL GROUP BY trade ORDER BY n DESC, k',
    ),
  ]);

  const head = totals.results[0] as { total?: number; public?: number | null } | undefined;
  const tally = (rows: Record<string, unknown>[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of rows) {
      const k = r.k;
      const n = r.n;
      if (typeof k === 'string' && typeof n === 'number') out[k] = n;
    }
    return out;
  };

  return {
    conversations: head?.public ?? 0,
    total: head?.total ?? 0,
    byLevel: tally(levels.results),
    byTrade: tally(trades.results),
    // The letter attaches hours to findings; until it does, the record says
    // it does not know rather than saying zero.
    hoursFound: null,
  };
}
