-- gmr · 0002 · the hours a letter found
--
-- Additive only. Nothing above is altered and nothing is dropped: 0001 is
-- the shape the first letters were written into, and a migration that edits
-- it would be editing the past.
--
-- The letter's html already holds the hours as they are printed ("3–4 hrs /
-- week"). These two columns hold the same fact as arithmetic, because the
-- record has to add them up and no aggregate should be reading prose to do
-- it. NULL is honest for a letter set before this migration, and for one
-- whose findings carried no hours at all.
--
-- Whole hours, per week, as the letter prints them. low <= high is enforced
-- by the hand that writes the row (src/letter.ts), not by SQLite: a CHECK
-- added here would be a constraint on rows that already exist.

ALTER TABLE letters ADD COLUMN hours_low  INTEGER;
ALTER TABLE letters ADD COLUMN hours_high INTEGER;
