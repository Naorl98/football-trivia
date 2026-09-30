-- Free-text answer mode, progressive hints, and generated-question metadata.
-- Additive only: every existing row keeps working as a multiple-choice question
-- (supports_free_text defaults to 0).

ALTER TABLE questions ADD COLUMN canonical_answer TEXT;
ALTER TABLE questions ADD COLUMN supports_free_text INTEGER NOT NULL DEFAULT 0;
ALTER TABLE questions ADD COLUMN semantic_key TEXT;
ALTER TABLE questions ADD COLUMN generated INTEGER NOT NULL DEFAULT 0;

-- Accepted alternative spellings for a free-text answer: short names,
-- transliterations, Hebrew and English forms. `normalized` stores the
-- matcher's canonical form so lookups never re-normalize on read.
CREATE TABLE answer_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized TEXT NOT NULL,
  lang TEXT
);

-- Ordered hints revealed one at a time by the "רמז" button.
CREATE TABLE question_hints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_answer_aliases_question_id ON answer_aliases(question_id);
CREATE INDEX idx_answer_aliases_normalized ON answer_aliases(normalized);
CREATE INDEX idx_question_hints_question_id ON question_hints(question_id);
CREATE INDEX idx_questions_free_text ON questions(supports_free_text);
CREATE UNIQUE INDEX idx_questions_semantic_key ON questions(semantic_key) WHERE semantic_key IS NOT NULL;
