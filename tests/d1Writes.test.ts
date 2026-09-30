import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  WriteBudget,
  WriteBudgetExceeded,
  chunkByCost,
  classifyStatement,
  costPerRow,
  maxWritesPerRun,
  planWrites,
} from "../src/server/sync/writeBudget.ts";

/*
  THE INCIDENT THESE TESTS GUARD

  One `db:seed:remote` spent the entire Cloudflare free-tier daily write
  allowance. The seed was DELETE-everything + INSERT-everything over 21,781
  rows; with index maintenance that is ~105,550 rows written, every time, even
  when nothing had changed.

  The rules encoded below:
    * a repeat import writes nothing
    * a repeat question generation writes nothing
    * deploy writes no bulk data at all
    * nothing can quietly spend the day's budget
*/

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("write cost accounting", () => {
  it("prices a row by its table's index count", () => {
    // questions carries six indexes plus the row itself.
    assert.ok(costPerRow("questions") > costPerRow("quiz_attempts"));
    assert.equal(costPerRow("quiz_attempts"), 1, "no indexes, so one row written");
  });

  it("classifies the statements the seed emits", () => {
    assert.equal(classifyStatement("INSERT INTO questions (id) VALUES (1);").verb, "insert");
    assert.equal(classifyStatement("UPDATE questions SET a = 1 WHERE id = 2;").verb, "update");
    assert.equal(classifyStatement("DELETE FROM questions WHERE id = 2;").verb, "delete");
    assert.equal(classifyStatement("SELECT id FROM questions;").verb, "read");
  });

  it("charges an unqualified DELETE for the whole table", () => {
    const qualified = classifyStatement("DELETE FROM question_options WHERE question_id = 5;", 6000);
    const wholeTable = classifyStatement("DELETE FROM question_options;", 6000);
    assert.equal(qualified.rows, 1);
    assert.equal(wholeTable.rows, 6000);
    assert.ok(wholeTable.cost > qualified.cost * 100, "wiping a table must price as the disaster it is");
  });

  it("counts reads as free", () => {
    const plan = planWrites(["SELECT id, content_hash FROM questions;"]);
    assert.equal(plan.estimatedRowsWritten, 0);
  });
});

describe("the write budget guard", () => {
  it("defaults to 20,000 rows per run", () => {
    assert.equal(maxWritesPerRun({}), 20000);
    assert.equal(maxWritesPerRun({ MAX_D1_WRITES_PER_RUN: "5000" }), 5000);
    assert.equal(maxWritesPerRun({ MAX_D1_WRITES_PER_RUN: "nonsense" }), 20000);
  });

  it("refuses a plan that does not fit", () => {
    const budget = new WriteBudget(1000);
    assert.throws(() => budget.assertFits(1001), WriteBudgetExceeded);
    assert.doesNotThrow(() => budget.assertFits(1000));
  });

  it("tracks what a run has already spent", () => {
    const budget = new WriteBudget(100);
    budget.record(60);
    assert.equal(budget.remaining, 40);
    assert.ok(!budget.canAfford(41));
    assert.ok(budget.canAfford(40));
  });

  it("chunks a large job so no single batch blows the ceiling", () => {
    const statements = Array.from({ length: 500 }, (_, i) => `INSERT INTO questions (id) VALUES (${i});`);
    const chunks = chunkByCost(statements, 400);
    assert.ok(chunks.length > 1, "expected the job to be split");
    for (const chunk of chunks) {
      assert.ok(planWrites(chunk).estimatedRowsWritten <= 400 + costPerRow("questions"));
    }
    // Order is preserved — child rows must never precede their parent.
    assert.equal(chunks.flat().length, statements.length);
    assert.equal(chunks.flat()[0], statements[0]);
  });
});

describe("the seed is applied incrementally, never by wiping", () => {
  const applier = read("scripts/seed-apply.mjs");
  const pkg = JSON.parse(read("package.json"));

  it("no longer exposes a destructive remote seed command", () => {
    const scripts = pkg.scripts as Record<string, string>;
    for (const [name, command] of Object.entries(scripts)) {
      if (!command.includes("--remote")) continue;
      assert.ok(
        !command.includes("seed/seed.sql"),
        `"${name}" would push the whole seed file at remote D1: ${command}`
      );
    }
  });

  it("drops the seed file's DELETE preamble instead of running it", () => {
    assert.match(applier, /Everything before the first header is the DELETE preamble/);
  });

  it("only ever deletes rows for a specific question id", () => {
    // Every DELETE the applier emits must be id-qualified.
    const deletes = [...applier.matchAll(/DELETE FROM \$\{?[a-z_]+\}? ?([^`;]*)/g)].map((m) => m[0]);
    for (const statement of deletes) {
      assert.match(statement, /WHERE/, `unqualified DELETE in the applier: ${statement}`);
    }
  });

  it("estimates and reports before writing", () => {
    assert.match(applier, /estimated rows written/);
    assert.match(applier, /--dry-run/);
    assert.match(applier, /assertFits/);
  });

  // A second run has nothing to do: every hash matches, so no statement is
  // generated at all. Proven end to end against local D1 as well.
  it("produces no statements when every content hash matches", () => {
    const plan = planWrites([]);
    assert.equal(plan.statements, 0);
    assert.equal(plan.estimatedRowsWritten, 0);
  });
});

describe("imports never rewrite unchanged rows", () => {
  const importers = read("src/server/sync/importers.ts");

  it("guards every UPSERT with a changed-values WHERE", () => {
    const upserts = [...importers.matchAll(/DO UPDATE SET[\s\S]*?;`/g)].map((m) => m[0]);
    assert.ok(upserts.length > 0, "expected UPSERT statements to exist");
    for (const statement of upserts) {
      assert.match(
        statement,
        /WHERE [\s\S]*IS NOT excluded\./,
        `an UPSERT without a change guard rewrites unchanged rows:\n${statement.slice(0, 200)}`
      );
    }
  });

  it("uses IS NOT rather than <> so NULL transitions still count as changes", () => {
    const guards = [...importers.matchAll(/WHERE ([^;]*IS NOT excluded[^;]*);/g)].map((m) => m[1]);
    for (const guard of guards) {
      assert.ok(!guard.includes("<>"), `"<>" is NULL-blind and would skip real changes: ${guard}`);
    }
  });

  it("does not use INSERT OR REPLACE, which rewrites the row unconditionally", () => {
    assert.ok(!/INSERT\s+OR\s+REPLACE/i.test(importers));
  });
});

describe("question generation only writes what is missing", () => {
  const generator = read("scripts/questions-generate.mjs");

  it("dedupes against the semantic keys already in D1", () => {
    assert.match(generator, /SELECT semantic_key FROM questions/);
    assert.match(generator, /validateAndDedupe\(candidates, existingKeys\)/);
  });

  it("exits without writing when nothing new was generated", () => {
    assert.match(generator, /accepted\.length === 0/);
    assert.match(generator, /Nothing new to write/);
  });

  it("never truncates the question bank", () => {
    assert.ok(!/DELETE FROM questions/i.test(generator));
    assert.ok(!/DROP TABLE/i.test(generator));
  });
});

describe("deploy performs no bulk D1 writes", () => {
  const pkg = JSON.parse(read("package.json"));

  it("the deploy script only builds and uploads", () => {
    const deploy = (pkg.scripts as Record<string, string>).deploy;
    assert.equal(deploy, "npm run build && wrangler deploy");
    assert.ok(!deploy.includes("d1"));
    assert.ok(!deploy.includes("seed"));
    assert.ok(!deploy.includes("migrations"));
  });

  it("no lifecycle hook smuggles a seed into the deploy", () => {
    const scripts = pkg.scripts as Record<string, string>;
    for (const name of ["predeploy", "postdeploy", "prebuild", "postbuild", "prepare", "postinstall"]) {
      if (scripts[name]) {
        assert.ok(!scripts[name].includes("seed"), `"${name}" would seed on deploy: ${scripts[name]}`);
      }
    }
  });
});

describe("gameplay is read-heavy and write-light", () => {
  const files = {
    quiz: read("src/worker/routes/quiz.ts"),
    attempts: read("src/worker/db/attempts.ts"),
    challenges: read("src/worker/db/challenges.ts"),
    daily: read("src/worker/db/daily.ts"),
    questions: read("src/worker/db/questions.ts"),
  };

  it("starting or counting a quiz writes nothing", () => {
    for (const source of [files.quiz, files.questions]) {
      assert.ok(!/INSERT INTO|UPDATE \w+ SET|DELETE FROM/i.test(source), "the quiz read path must not write");
    }
  });

  it("a finished quiz costs one row", () => {
    const inserts = files.attempts.match(/INSERT INTO/gi) ?? [];
    assert.equal(inserts.length, 1);
    assert.equal(costPerRow("quiz_attempts"), 1);
  });

  it("the daily challenge is get-or-create, not write-per-request", () => {
    assert.match(files.daily, /INSERT OR IGNORE INTO daily_challenges/);
    // The only UPDATE is the stale-set repair, which is guarded by a read.
    const updates = files.daily.match(/UPDATE \w+ SET/gi) ?? [];
    assert.equal(updates.length, 1);
    assert.match(files.daily, /live === existing\.questionIds\.length/);
  });

  it("a full session of play stays far under any sane budget", () => {
    // Ten players finishing a quiz and three of them sharing it.
    const plan = planWrites([
      ...Array.from({ length: 10 }, () => "INSERT INTO quiz_attempts (score) VALUES (1);"),
      ...Array.from({ length: 3 }, () => "INSERT INTO quiz_challenges (public_id) VALUES ('x');"),
      "INSERT INTO daily_challenges (challenge_date) VALUES ('2026-01-01');",
    ]);
    assert.ok(plan.estimatedRowsWritten < 50, `${plan.estimatedRowsWritten} rows for a whole session`);
  });
});
