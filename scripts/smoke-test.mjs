// End-to-end API smoke test.
// Usage: node scripts/smoke-test.mjs [baseUrl]   (default http://localhost:5173)
const BASE = process.argv[2] ?? "http://localhost:5173";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
}

const baseConfig = {
  region: "WORLD",
  countries: [],
  competitions: ["ALL"],
  categories: [],
  difficulty: "MIXED",
  questionCount: 10,
  gameMode: "CLASSIC",
};

console.log(`\nFootball IQ API smoke test → ${BASE}\n`);

// --- health
{
  const { status, body } = await get("/api/health");
  check("health endpoint responds ok", status === 200 && body.ok === true);
}

// --- classic quiz
{
  const { body } = await post("/api/quiz", baseConfig);
  check("classic quiz returns 10 questions", body.questions?.length === 10, `got ${body.questions?.length}`);
  check("every question has exactly 4 options", body.questions?.every((q) => q.options.length === 4));
  check(
    "every question has exactly 1 correct option",
    body.questions?.every((q) => q.options.filter((o) => o.isCorrect).length === 1)
  );
  const ids = body.questions.map((q) => q.id);
  check("no duplicate questions in a quiz", new Set(ids).size === ids.length);
  check("only CLASSIC mode questions returned", body.questions.every((q) => q.mode === "CLASSIC"));
  const correctPositions = body.questions.map((q) => q.options.findIndex((o) => o.isCorrect));
  check(
    "correct answers are shuffled (not always first)",
    new Set(correctPositions).size > 1,
    `positions: ${correctPositions.join(",")}`
  );
}

// --- difficulty filter
{
  const { body } = await post("/api/quiz", { ...baseConfig, difficulty: "EASY", questionCount: 5 });
  check("difficulty filter is respected", body.questions.every((q) => q.difficulty === "EASY"));
}

// --- category + competition scope filter
{
  const { body } = await post("/api/quiz", {
    ...baseConfig,
    competitions: ["UCL"],
    categories: ["CHAMPIONS_LEAGUE"],
    questionCount: 5,
  });
  check("champions league scope returns questions", body.questions.length > 0);
  check("category filter is respected", body.questions.every((q) => q.category === "CHAMPIONS_LEAGUE"));
}

// --- clue-based modes
for (const mode of ["WHO_AM_I", "CAREER_PATH"]) {
  const { body } = await post("/api/quiz", { ...baseConfig, gameMode: mode, questionCount: 5 });
  check(`${mode} returns questions`, body.questions.length > 0);
  check(`${mode} questions carry ordered clues`, body.questions.every((q) => q.clues.length >= 2));
  check(
    `${mode} clue order is sequential`,
    body.questions.every((q) => q.clues.every((c, i) => c.order === i))
  );
}

// --- insufficient pool handling (no duplication)
{
  const { body } = await post("/api/quiz", { ...baseConfig, gameMode: "WHO_AM_I", questionCount: 50 });
  const ids = body.questions.map((q) => q.id);
  check("oversized request does not duplicate questions", new Set(ids).size === ids.length);

  // This assertion used to be `availableCount < requestedCount`, which asserted
  // a fact about the DATA rather than about the code: when it was written the
  // WHO_AM_I pool held fewer than fifty questions, so asking for fifty was
  // necessarily an over-request. The pool is now 706, so the premise expired and
  // the test started failing on a system that was behaving correctly.
  //
  // The rule worth protecting does not depend on the pool size: a quiz is as
  // long as was asked for, or as long as the pool allows, whichever is smaller.
  check(
    "a quiz is min(requested, available) long",
    body.questions.length === Math.min(body.requestedCount, body.availableCount),
    `available=${body.availableCount} requested=${body.requestedCount} returned=${body.questions.length}`
  );
}

// --- validation
{
  const { status } = await post("/api/quiz", { ...baseConfig, questionCount: 7 });
  check("invalid questionCount is rejected", status === 400);
  const bad = await post("/api/quiz", { ...baseConfig, difficulty: "SUPER_HARD" });
  check("invalid difficulty is rejected", bad.status === 400);
}

// --- daily challenge determinism
{
  const first = await get("/api/daily");
  const second = await get("/api/daily");
  check("daily challenge returns 10 questions", first.body.quiz.questions.length === 10);
  const idsA = first.body.quiz.questions.map((q) => q.id).join(",");
  const idsB = second.body.quiz.questions.map((q) => q.id).join(",");
  check("daily challenge is identical across requests", idsA === idsB);
  check("daily challenge reports an Israel-local date", /^\d{4}-\d{2}-\d{2}$/.test(first.body.date));
}

// --- challenge replay fidelity
{
  const created = await post("/api/challenges", { ...baseConfig, questionCount: 5 });
  const publicId = created.body.challenge.publicId;
  check("challenge is created with a public id", typeof publicId === "string" && publicId.length >= 6);
  check("challenge stores its question ids", created.body.challenge.questionIds.length === 5);

  const fetched = await get(`/api/challenges/${publicId}`);
  const originalIds = created.body.quiz.questions.map((q) => q.id).join(",");
  const replayedIds = fetched.body.quiz.questions.map((q) => q.id).join(",");
  check("challenge replays the exact same questions in the same order", originalIds === replayedIds);

  const missing = await get("/api/challenges/doesnotexist");
  check("unknown challenge returns 404", missing.status === 404);
}

// --- attempt logging + central scoring
{
  const { body: quiz } = await post("/api/quiz", { ...baseConfig, questionCount: 5 });
  const answers = quiz.questions.map((q, i) => ({
    questionId: q.id,
    selectedOptionId: q.options[0].id,
    correct: i < 3, // 3 correct out of 5
    timeMs: 1200,
  }));
  const { status, body } = await post("/api/attempts", { answers, durationSeconds: 61 });
  check("attempt is recorded", status === 200 && typeof body.attemptId === "number");
  check("server-side score matches shared scoring rules", body.score.correct === 3 && body.score.points === 3);
  check("accuracy is computed correctly", body.score.accuracy === 60, `got ${body.score.accuracy}`);
  check("rank label is derived deterministically", body.score.rank === "פרשן", `got ${body.score.rank}`);

  const empty = await post("/api/attempts", { answers: [], durationSeconds: 10 });
  check("empty attempt is rejected", empty.status === 400);
}

// --- SPA routes served
{
  const res = await fetch(`${BASE}/challenge/abc123`);
  const html = await res.text();
  check("SPA fallback serves the app shell for client routes", res.status === 200 && html.includes('id="root"'));
  check("HTML declares Hebrew RTL", html.includes('lang="he"') && html.includes('dir="rtl"'));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
