-- Lets the seed be applied incrementally instead of by wiping the bank.
--
-- Every question carries a hash of everything that lands in D1 for it — the
-- question row plus its options, clues, scopes, aliases and hints. The apply
-- script compares hashes and touches only what actually changed, so a re-run
-- with no content change writes zero rows.
--
-- Before this, seeding meant DELETE-everything + INSERT-everything: 21,781
-- rows each way, ~105,550 rows written once index maintenance is counted,
-- which is the entire free-tier daily allowance in one command.

ALTER TABLE questions ADD COLUMN content_hash TEXT;

-- Makes the "what is already loaded?" query an index-only scan.
CREATE INDEX IF NOT EXISTS idx_questions_content_hash ON questions(content_hash);
