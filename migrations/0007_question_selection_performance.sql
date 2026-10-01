-- Question selection performance.
--
-- MEASURED, against production before this migration (15,186 questions,
-- 27,710 scope rows, 24MB):
--
--   random pick, CLASSIC, no scope filter
--     SEARCH q USING INDEX idx_questions_active (active=?)
--     USE TEMP B-TREE FOR ORDER BY
--     rows_read 25,197  to return 10
--
--   random pick, CLASSIC + 3 categories + a competition scope
--     rows_read 15,187  to return 20
--
--   availability count, CLASSIC
--     rows_read 15,186  to return one integer
--
-- Two separate problems, and they need separate fixes.
--
-- PROBLEM 1: THE FILTER SCANS. Every index on `questions` was single-column, so
-- SQLite could satisfy exactly one predicate from an index and had to test the
-- rest row by row. It picked `active`, which every row matches, so in practice
-- every query read the whole table.
--
-- PROBLEM 2: ORDER BY RANDOM() SORTS EVERYTHING. Even with a perfect index on
-- the WHERE clause, `ORDER BY RANDOM() LIMIT 10` has to assign a random key to
-- every matching row and sort all of them to find ten. That is the temp B-tree,
-- and no index can remove it.
--
-- So: composite indexes for the filter, and a persisted random key for the
-- ordering, so selection becomes a bounded range scan over an index instead of a
-- full sort.
--
-- WHY A PERSISTED KEY RATHER THAN A SMARTER RANDOM(). The alternatives were
-- worse. `WHERE id > <random>` skews towards rows that follow large gaps.
-- `LIMIT 1 OFFSET <random>` still walks the offset. Counting first and then
-- picking ids costs an extra round trip and the count is the expensive query.
-- A random column with an index is the one option where the database reads
-- only the rows it returns.

-- ---------------------------------------------------------------- shuffle key

-- A fixed random position per question. Ordering by it is ordering by nothing in
-- particular, which is what "random" has to mean if an index is going to help.
ALTER TABLE questions ADD COLUMN shuffle_key INTEGER;

-- Seeded from SQLite's own RNG, once, for the rows that already exist.
UPDATE questions SET shuffle_key = ABS(RANDOM() % 1000000000) WHERE shuffle_key IS NULL;

-- And filled by the database for every row inserted from here on.
--
-- A trigger rather than a column added to each INSERT, deliberately. Questions
-- arrive by two paths — the generated seed.sql and scripts/questions-generate.mjs
-- — and seed.sql is append-only, 15,000 statements long, and must not be
-- rewritten. More to the point: a row with a NULL key is invisible to the
-- selection query below, so "whoever adds the next insert path remembers to set
-- it" is not a property worth relying on. The database guarantees it instead.
CREATE TRIGGER questions_shuffle_key_on_insert
AFTER INSERT ON questions
WHEN NEW.shuffle_key IS NULL
BEGIN
  UPDATE questions SET shuffle_key = ABS(RANDOM() % 1000000000) WHERE id = NEW.id;
END;

-- ------------------------------------------------------------------- indexes

-- THE SELECTION INDEX. The column order is the whole trick, and the obvious
-- order is wrong, so this is worth reading before changing.
--
-- `shuffle_key` sits THIRD, immediately after the two predicates that are always
-- present and always equalities. That is what lets SQLite satisfy the ORDER BY
-- from the index: it can only walk an index in order of column N if every column
-- before N is pinned to a single value. `active` and `mode` always are;
-- `difficulty`, `supports_free_text` and `category` are each present only
-- sometimes.
--
-- The first attempt put the filter columns before the ordering column —
-- (active, mode, difficulty, supports_free_text, shuffle_key) — which reads
-- naturally and does not work. Verified against the real planner:
--
--   (active, mode, difficulty, supports_free_text, shuffle_key)
--     SEARCH q USING COVERING INDEX idx_questions_pick (active=? AND mode=?)
--     USE TEMP B-TREE FOR ORDER BY          <-- still sorting everything
--
--   (active, mode, shuffle_key, difficulty, supports_free_text, category)
--     SEARCH q USING COVERING INDEX ... (active=? AND mode=? AND shuffle_key>?)
--                                           <-- no sort, in any combination
--
-- With difficulty skipped, the first index is ordered by
-- (difficulty, supports_free_text, shuffle_key) inside each (active, mode)
-- group, which is not shuffle_key order, so the sort came back and the whole
-- exercise bought nothing.
--
-- The filter columns are still in the index, just AFTER the ordering column.
-- They cannot narrow the range scan from there, but they are tested against the
-- index entry rather than the table row, which keeps the index covering — so a
-- filtered selection walks index entries in random order and stops at LIMIT
-- without reading a single table row.
CREATE INDEX idx_questions_pick
  ON questions (active, mode, shuffle_key, difficulty, supports_free_text, category);

-- Availability counts read no column but the ones they filter on, so this index
-- covers them outright — the count never touches the table. Ordering is
-- irrelevant to a COUNT, so here the filter columns do lead, most commonly
-- constrained first.
CREATE INDEX idx_questions_count
  ON questions (active, mode, difficulty, category, supports_free_text);

-- The scope EXISTS subquery already had (scope_type, scope_value) to find
-- candidate questions. This is the other direction: given a question we are
-- already walking, does it carry one of the requested tags. Covering, so the
-- subquery stops hitting the scope table itself.
CREATE INDEX idx_question_scopes_reverse
  ON question_scopes (question_id, scope_type, scope_value);
