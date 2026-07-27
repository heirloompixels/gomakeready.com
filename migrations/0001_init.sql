-- gmr · 0001 · the archive is the schema default
--
-- Every conversation is a numbered work. The number is the row id — not a
-- column beside it, not a slug, not a hash — because the Nº the letter is
-- printed with and the address the desk calls it by must be the same fact.
-- AUTOINCREMENT so a number is spent once and never handed out twice, even
-- after a rolled-back write: a catalogue with a reused number is not a
-- catalogue.
--
-- Nothing here is ever deleted and nothing in the transcript is ever
-- updated. A visitor who withdraws is marked `withdrawn`, not erased —
-- visibility governs what the record may aggregate, and aggregation is the
-- only thing the record ever does. The raw transcript stays private
-- whatever the flag says.
--
-- All timestamps are unix *seconds* (`unixepoch()`), which is the coarsest
-- clock the piece needs — a conversation is measured in minutes and a
-- letter in days. (the200 keeps milliseconds; it is timing a mirror.)
-- Defaults are declared here rather than passed in, so a row inserted by a
-- hand at the D1 console is stamped the same way as one written by the
-- Worker.

-- The work. One row per conversation, opened the moment the visitor
-- finishes the sentence on-ramp — the investment gate — and never before.
-- town and timezone are what the edge knew (request.cf); they are the only
-- thing kept about where a person was, and neither is fine enough to point
-- at anyone. level/trade/frictions stay NULL until calibration happens;
-- a conversation that ends early is a real work with unset facts, not a
-- broken row.
CREATE TABLE conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,  -- this IS the Nº
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  town        TEXT,                               -- request.cf.city, as the edge said it
  timezone    TEXT,                               -- IANA zone; the hour is told in theirs
  visibility  TEXT NOT NULL DEFAULT 'held',       -- 'held' | 'public' | 'withdrawn'
  level       TEXT,                               -- 'daily' | 'burned' | 'nodded' | 'new'
  trade       TEXT,                               -- what they keep: a gallery, an outfitter…
  frictions   TEXT                                -- JSON array of text, as chosen on the on-ramp
);
CREATE INDEX conversations_visibility ON conversations (visibility, created_at);

-- The transcript. Append-only: a line said is a dated fact, and facts are
-- not edited after the day. `seq` is the conversation's own count, 0-based
-- and dense, so the arc can be replayed exactly as it was heard; the unique
-- index is the arbiter that makes two simultaneous writes impossible to
-- confuse rather than merely unlikely.
CREATE TABLE events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER NOT NULL REFERENCES conversations (id),
  seq              INTEGER NOT NULL,     -- 0-based, per conversation, no gaps
  at               INTEGER NOT NULL DEFAULT (unixepoch()),
  role             TEXT NOT NULL,        -- 'site' | 'visitor' | 'system'
  stage            TEXT,                 -- the six-stage arc: onramp, calibrate, teach, ideas, climax, letter
  body             TEXT NOT NULL
);
CREATE UNIQUE INDEX events_seq ON events (conversation_id, seq);
CREATE INDEX events_conversation ON events (conversation_id, id);

-- The lead. An email left at the ask band, with the conversation it came out
-- of when there was one — the band also takes an address from someone who
-- read to the bottom and never spoke. No unique index on email: the same
-- person may ask twice, months apart, and refusing the second one would be
-- the database deciding something the desk is better at. Duplicates are a
-- fact about the person, not a defect in the table.
CREATE TABLE leads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER REFERENCES conversations (id),  -- NULL: came off the band alone
  email            TEXT NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  status           TEXT NOT NULL DEFAULT 'new'  -- 'new' | 'contacted' | 'booked' | 'client' | 'closed'
);
CREATE INDEX leads_status ON leads (status, created_at);
CREATE INDEX leads_created ON leads (created_at);
CREATE INDEX leads_email ON leads (email);  -- for finding the repeats, not for forbidding them

-- The desk's own hand in the margin. Append-only for the same reason the
-- transcript is: a note is what was true when it was written, and the
-- correction is the next note.
CREATE TABLE notes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id  INTEGER NOT NULL REFERENCES leads (id),
  at       INTEGER NOT NULL DEFAULT (unixepoch()),
  body     TEXT NOT NULL
);
CREATE INDEX notes_lead ON notes (lead_id, at);

-- The letter. Its own numbering, deliberately not the conversation's: a
-- letter is set only for a conversation that reached the end, so letter Nº 6
-- may belong to conversation Nº 19, and both numbers are printed truthfully.
-- Letters start at 1 (there is no Nº 0 on a printed page).
--
-- key_hash is sha-256 hex of the magic-link key. The key itself is never
-- stored, here or anywhere: it exists in the mail we sent and in the URL the
-- reader keeps. A database in the wrong hands opens no one's letter.
CREATE TABLE letters (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER NOT NULL REFERENCES conversations (id),
  number           INTEGER NOT NULL,     -- letter Nº — its own sequence, 1-based
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  html             TEXT NOT NULL,        -- the letter as set; print renders from this
  key_hash         TEXT                  -- sha-256 hex of the magic-link key; never the key
);
CREATE UNIQUE INDEX letters_number ON letters (number);
CREATE INDEX letters_conversation ON letters (conversation_id, number);
CREATE INDEX letters_key ON letters (key_hash);  -- the magic link's only lookup
