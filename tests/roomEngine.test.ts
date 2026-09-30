import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RoomEngine, type Effect } from "../src/shared/multiplayer/roomEngine.ts";
import {
  defaultSettings,
  randomDuelSettings,
  RECONNECT_GRACE_MS,
  EMPTY_ROOM_TTL_MS,
  MESSAGE_COOLDOWN_MS,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MAX_PER_QUESTION,
} from "../src/shared/multiplayer/constants.ts";
import type { ClientMessage, ServerMessage } from "../src/shared/multiplayer/protocol.ts";
import type { MultiplayerMode, RoomPhase, RoomSettings } from "../src/shared/multiplayer/types.ts";
import type { Question } from "../src/shared/types.ts";

/*
  WHY THE ROOM ENGINE IS TESTED HERE AND NOT IN A BROWSER

  Every multiplayer rule that matters is a question about time and trust:

    * may this player answer right now?
    * has the answer window closed?
    * did the reveal leak the answer before everyone had a go?
    * who is host now that the host's phone went into a tunnel?

  None of that is observable from a screenshot, and all of it is a nightmare to
  drive through real sockets. So the rules live in a plain class with an injected
  clock, and these tests move the clock by hand. A three-player turn-based game
  with a disconnect at exactly the grace boundary is a handful of lines here; it
  would be a flaky ten-minute browser run otherwise.

  The browser tests (scripts/mp-e2e.mjs) then prove the wiring — that real
  sockets, real Durable Objects and real React render what these tests say the
  rules are.
*/

// ------------------------------------------------------------------ fixtures

/** A question whose correct option id is always `id * 10 + 1`. */
function question(id: number, opts: { freeText?: boolean; hints?: string[] } = {}): Question {
  return {
    id,
    publicId: `q-${id}`,
    mode: "CLASSIC",
    category: "PLAYERS",
    difficulty: "NORMAL",
    questionHe: `שאלה ${id}`,
    explanationHe: `הסבר ${id}`,
    options: [
      { id: id * 10 + 1, text: `נכון-${id}`, isCorrect: true },
      { id: id * 10 + 2, text: `שגוי-${id}-א`, isCorrect: false },
      { id: id * 10 + 3, text: `שגוי-${id}-ב`, isCorrect: false },
      { id: id * 10 + 4, text: `שגוי-${id}-ג`, isCorrect: false },
    ],
    clues: [],
    verified: true,
    sourceLabel: null,
    supportsFreeText: opts.freeText === true,
    canonicalAnswer: opts.freeText ? "ליונל מסי" : null,
    aliases: opts.freeText ? ["מסי", "Messi", "Lionel Messi"] : [],
    hints: opts.hints ?? ["רמז ראשון", "רמז שני"],
  };
}

function questions(count: number, opts: { freeText?: boolean } = {}): Question[] {
  return Array.from({ length: count }, (_, i) => question(i + 1, opts));
}

const correctOptionFor = (q: Question) => q.options.find((o) => o.isCorrect)!.id;
const wrongOptionFor = (q: Question) => q.options.find((o) => !o.isCorrect)!.id;

/** Messages of a given type in an effect list, whether broadcast or targeted. */
function messagesOf<T extends ServerMessage["type"]>(
  effects: Effect[],
  type: T
): Extract<ServerMessage, { type: T }>[] {
  const out: Extract<ServerMessage, { type: T }>[] = [];
  for (const effect of effects) {
    if (effect.kind !== "broadcast" && effect.kind !== "send") continue;
    if (effect.message.type === type) out.push(effect.message as Extract<ServerMessage, { type: T }>);
  }
  return out;
}

function errorsFor(effects: Effect[], playerId: string): string[] {
  return effects
    .filter((e) => e.kind === "send" && e.playerId === playerId && e.message.type === "ERROR")
    .map((e) => ((e as { message: ServerMessage }).message as { code: string }).code);
}

interface Harness {
  engine: RoomEngine;
  /** Current virtual time. */
  t: number;
  ids: Record<string, string>;
}

let clock = 1_700_000_000_000;

/** Builds a room with the given named players; the first is host. */
function room(
  mode: MultiplayerMode,
  names: string[],
  settings: Partial<RoomSettings> = {}
): Harness {
  clock += 10_000;
  const t = clock;
  const engine = RoomEngine.create("482731", { ...defaultSettings(mode), ...settings }, t);
  const ids: Record<string, string> = {};
  names.forEach((name, i) => {
    const outcome = engine.join(`token-${name}`, name, t + i);
    assert.equal(outcome.error, null, `join failed for ${name}: ${outcome.error}`);
    ids[name] = outcome.playerId!;
  });
  return { engine, t, ids };
}

function send(h: Harness, name: string, message: ClientMessage): Effect[] {
  return h.engine.handle(h.ids[name], message, h.t);
}

function answer(h: Harness, name: string, optionId: number | null, extra: Partial<ClientMessage & { typed: string | null; reveal: boolean }> = {}) {
  return h.engine.handle(
    h.ids[name],
    {
      type: "SUBMIT_ANSWER",
      questionIndex: h.engine.state.questionIndex,
      optionId,
      typed: (extra as { typed?: string | null }).typed ?? null,
      reveal: (extra as { reveal?: boolean }).reveal === true,
    },
    h.t
  );
}

/** Starts the game with a fixed question set, skipping the countdown. */
function start(h: Harness, qs: Question[]): Effect[] {
  const request = h.engine.requestStart(h.ids[Object.keys(h.ids)[0]], h.t);
  assert.equal(request.error, null, `start refused: ${request.error}`);
  const begun = h.engine.beginGame(qs, h.t);
  // Through the countdown and into question 0.
  h.t = h.engine.state.phaseDeadlineAt! + 1;
  const opened = h.engine.tick(h.t);
  return [...begun, ...opened];
}

/** Ticks once at the current phase deadline. */
function tickDeadline(h: Harness): Effect[] {
  const deadline = h.engine.state.phaseDeadlineAt;
  assert.ok(deadline !== null, `no deadline in phase ${h.engine.state.phase}`);
  h.t = deadline! + 1;
  return h.engine.tick(h.t);
}

/** Walks the reveal → results → hand-off beats until the next question opens (or the game ends). */
function toNextQuestion(h: Harness): Effect[] {
  const all: Effect[] = [];
  const startIndex = h.engine.state.questionIndex;
  for (let i = 0; i < 12; i++) {
    if (h.engine.state.phase === "FINISHED") break;
    if (h.engine.state.phase === "QUESTION" && h.engine.state.questionIndex > startIndex) break;
    all.push(...tickDeadline(h));
  }
  return all;
}

/** Answers every remaining question correctly for the named players and returns at FINISHED. */
function playOut(h: Harness, names: string[]): Effect[] {
  const all: Effect[] = [];
  for (let guard = 0; guard < 200; guard++) {
    if (h.engine.state.phase === "FINISHED") break;
    if (h.engine.state.phase === "QUESTION" || h.engine.state.phase === "WAITING_FOR_ANSWERS") {
      const q = h.engine.state.questions[h.engine.state.questionIndex];
      for (const name of names) {
        if (h.engine.state.settings.mode === "TURN_BASED" && h.engine.state.currentTurnPlayerId !== h.ids[name]) {
          continue;
        }
        all.push(...answer(h, name, correctOptionFor(q)));
      }
    }
    if (h.engine.state.phase === "FINISHED") break;
    all.push(...tickDeadline(h));
  }
  return all;
}

const phase = (h: Harness): RoomPhase => h.engine.state.phase;

// -------------------------------------------------------------- lobby & host

describe("lobby and host", () => {
  it("makes the first player through the door host", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    assert.equal(h.engine.state.hostId, h.ids["נאור"]);
    const view = h.engine.view(h.t);
    assert.equal(view.players.find((p) => p.id === h.ids["נאור"])!.isHost, true);
    assert.equal(view.players.find((p) => p.id === h.ids["יובל"])!.isHost, false);
  });

  it("suffixes a duplicate name so the team sheet has no two identical rows", () => {
    const h = room("CLASSIC_BATTLE", ["נאור"]);
    const second = h.engine.join("token-2", "נאור", h.t);
    assert.equal(second.error, null);
    assert.deepEqual(
      h.engine.view(h.t).players.map((p) => p.name),
      ["נאור", "נאור 2"]
    );
  });

  it("refuses a nameless join", () => {
    const h = room("CLASSIC_BATTLE", ["נאור"]);
    assert.equal(h.engine.join("token-x", "   ", h.t).error, "INVALID_NAME");
  });

  it("never exposes a player's reconnect token in the room view", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const serialized = JSON.stringify(h.engine.view(h.t));
    assert.doesNotMatch(serialized, /token-/, "a token leaked into the broadcast state");
  });

  it("lets the host change settings and tells everyone", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const effects = send(h, "נאור", { type: "UPDATE_SETTINGS", settings: { questionCount: 20, difficulty: "HARD" } });
    const states = messagesOf(effects, "ROOM_STATE");
    assert.equal(states.length, 1, "settings changes are broadcast, not sent to the host alone");
    assert.equal(states[0].room.settings.questionCount, 20);
    assert.equal(states[0].room.settings.difficulty, "HARD");
  });

  it("refuses a settings change from a player who is not host", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const effects = send(h, "יובל", { type: "UPDATE_SETTINGS", settings: { questionCount: 30 } });
    assert.deepEqual(errorsFor(effects, h.ids["יובל"]), ["NOT_HOST"]);
    assert.equal(h.engine.state.settings.questionCount, 10);
  });

  it("refuses a settings change once the game has started", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(3));
    const effects = send(h, "נאור", { type: "UPDATE_SETTINGS", settings: { questionCount: 30 } });
    assert.deepEqual(errorsFor(effects, h.ids["נאור"]), ["GAME_ALREADY_STARTED"]);
  });

  it("refuses a start from a player who is not host", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    assert.equal(h.engine.requestStart(h.ids["יובל"], h.t).error, "NOT_HOST");
  });

  it("refuses a start with too few players", () => {
    const h = room("CLASSIC_BATTLE", ["נאור"]);
    assert.equal(h.engine.requestStart(h.ids["נאור"], h.t).error, "NEEDS_MORE_PLAYERS");
  });

  it("lets the host remove a player", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דניאל"]);
    const effects = send(h, "נאור", { type: "KICK_PLAYER", playerId: h.ids["יובל"] });
    assert.ok(effects.some((e) => e.kind === "disconnect" && e.playerId === h.ids["יובל"]));
    assert.deepEqual(h.engine.view(h.t).players.map((p) => p.name), ["נאור", "דניאל"]);
  });

  it("refuses a kick from a player who is not host", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דניאל"]);
    const effects = send(h, "יובל", { type: "KICK_PLAYER", playerId: h.ids["דניאל"] });
    assert.deepEqual(errorsFor(effects, h.ids["יובל"]), ["NOT_HOST"]);
    assert.equal(h.engine.view(h.t).players.length, 3);
  });

  it("closes the room when the host ends it", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const effects = send(h, "נאור", { type: "END_ROOM" });
    assert.equal(messagesOf(effects, "ROOM_CLOSED").length, 1);
    assert.ok(effects.some((e) => e.kind === "destroy"));
    assert.equal(h.engine.state.closed, true);
  });
});

// ------------------------------------------------------------- late join

describe("late join", () => {
  it("turns an unknown player away once the game has started", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(3));
    assert.equal(h.engine.join("token-new", "רועי", h.t).error, "GAME_ALREADY_STARTED");
  });

  it("still lets a player who was already in the room back in", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(3));
    h.engine.detach(h.ids["יובל"], h.t);
    const back = h.engine.join("token-יובל", "יובל", h.t + 500);
    assert.equal(back.error, null);
    assert.equal(back.playerId, h.ids["יובל"]);
  });

  it("refuses a third player in a duel room", () => {
    const h = room("DUEL", ["נאור", "יובל"]);
    assert.equal(h.engine.join("token-3", "דניאל", h.t).error, "ROOM_FULL");
  });
});

// ------------------------------------------------------- classic battle

describe("CLASSIC BATTLE", () => {
  it("sends the same question to everyone, with the answer stripped out", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דניאל"]);
    const effects = start(h, questions(3));
    const started = messagesOf(effects, "QUESTION_STARTED");
    assert.equal(started.length, 1, "one broadcast, so every client gets an identical question");

    const live = started[0].question;
    assert.equal(live.index, 0);
    assert.equal(live.options.length, 4);
    const serialized = JSON.stringify(live);
    assert.doesNotMatch(serialized, /isCorrect/, "correctness reached the client");
    assert.doesNotMatch(serialized, /canonicalAnswer/, "the canonical answer reached the client");
    assert.doesNotMatch(serialized, /רמז/, "hint text reached the client before it was asked for");
  });

  it("never puts a future question on the wire", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const effects = start(h, questions(5));
    const everythingSent = JSON.stringify(
      effects.filter((e) => e.kind === "broadcast" || e.kind === "send").map((e) => (e as { message: unknown }).message)
    );
    for (const id of [2, 3, 4, 5]) {
      assert.doesNotMatch(everythingSent, new RegExp(`שאלה ${id}`), `question ${id} was sent early`);
    }
  });

  it("keeps the correct answer hidden until everyone has answered", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דניאל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];

    const first = answer(h, "נאור", correctOptionFor(q));
    assert.equal(messagesOf(first, "ANSWER_REVEAL").length, 0);
    assert.equal(messagesOf(first, "SCORE_UPDATE").length, 0, "a score update before the reveal leaks correctness");
    assert.equal(phase(h), "WAITING_FOR_ANSWERS");

    const second = answer(h, "יובל", wrongOptionFor(q));
    assert.equal(messagesOf(second, "ANSWER_REVEAL").length, 0);

    const third = answer(h, "דניאל", correctOptionFor(q));
    assert.equal(messagesOf(third, "ANSWER_REVEAL").length, 1, "the reveal comes when the last player answers");
    assert.equal(phase(h), "ANSWER_REVEAL");
  });

  it("reports who has answered without saying whether they were right", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דניאל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];
    const effects = answer(h, "נאור", correctOptionFor(q));

    const received = messagesOf(effects, "ANSWER_RECEIVED");
    assert.equal(received.length, 1);
    assert.deepEqual(Object.keys(received[0]).sort(), ["answeredCount", "expectedCount", "playerId", "type"]);
    assert.equal(received[0].answeredCount, 1);
    assert.equal(received[0].expectedCount, 3);

    // The room view says who answered, and nothing more.
    const view = h.engine.view(h.t);
    assert.deepEqual(view.answered, [h.ids["נאור"]]);
    assert.equal(view.players.every((p) => p.score === 0), true, "scores must not move before the reveal");
  });

  it("reveals when the clock runs out even if nobody answered", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(2));
    const effects = tickDeadline(h);
    const reveal = messagesOf(effects, "ANSWER_REVEAL")[0];
    assert.ok(reveal);
    assert.equal(reveal.reveal.results.every((r) => r.answered === false), true);
    assert.deepEqual(reveal.reveal.roundWinnerIds, [], "nobody takes a round nobody answered");
  });

  it("gives the round to the fastest correct answer and says so in football language", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];

    answer(h, "נאור", correctOptionFor(q));
    h.t += 4000;
    answer(h, "יובל", correctOptionFor(q));

    assert.deepEqual(h.engine.state.roundWinnerIds, [h.ids["נאור"]]);
    const result = messagesOf(tickDeadline(h), "ROUND_RESULT")[0];
    assert.match(result.headlineHe, /נאור/);
    assert.match(result.headlineHe, /לקח את הסיבוב/);
  });

  it("shares a round when two correct answers land on the same score", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];
    answer(h, "נאור", correctOptionFor(q));
    answer(h, "יובל", correctOptionFor(q));
    assert.equal(h.engine.state.roundWinnerIds.length, 2);
    const result = messagesOf(tickDeadline(h), "ROUND_RESULT")[0];
    assert.match(result.headlineHe, /חולקים/);
  });

  it("rewards speed: the same correct answer is worth more, earlier", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];
    answer(h, "נאור", correctOptionFor(q));
    h.t += 10_000;
    answer(h, "יובל", correctOptionFor(q));

    const scores = h.engine.view(h.t).players;
    const fast = scores.find((p) => p.id === h.ids["נאור"])!.score;
    const slow = scores.find((p) => p.id === h.ids["יובל"])!.score;
    assert.ok(fast > slow, `fast ${fast} should beat slow ${slow}`);
  });

  it("banks points at the reveal, not when the answer is tapped", () => {
    // The guarantee behind "correctness stays hidden": the room view carries
    // everyone's score, so a score that moved mid-round would announce the answer.
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דניאל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];

    answer(h, "נאור", correctOptionFor(q));
    answer(h, "יובל", wrongOptionFor(q));
    assert.equal(phase(h), "WAITING_FOR_ANSWERS");
    assert.deepEqual(h.engine.view(h.t).players.map((p) => p.score), [0, 0, 0]);
    assert.deepEqual(h.engine.view(h.t).players.map((p) => p.streak), [0, 0, 0]);

    answer(h, "דניאל", correctOptionFor(q));
    assert.equal(phase(h), "ANSWER_REVEAL");
    assert.ok(h.engine.view(h.t).players.find((p) => p.id === h.ids["נאור"])!.score > 0);
    assert.equal(h.engine.view(h.t).players.find((p) => p.id === h.ids["יובל"])!.score, 0);
  });

  it("breaks the streak of a player who sat a question out", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { questionCount: 3 });
    start(h, questions(3));

    answer(h, "נאור", correctOptionFor(h.engine.state.questions[0]));
    answer(h, "יובל", correctOptionFor(h.engine.state.questions[0]));
    assert.equal(h.engine.state.players.find((p) => p.id === h.ids["נאור"])!.streak, 1);
    toNextQuestion(h);

    // נאור answers, יובל lets the clock run out.
    answer(h, "נאור", correctOptionFor(h.engine.state.questions[1]));
    tickDeadline(h);

    assert.equal(h.engine.state.players.find((p) => p.id === h.ids["נאור"])!.streak, 2);
    assert.equal(h.engine.state.players.find((p) => p.id === h.ids["יובל"])!.streak, 0);
    assert.equal(
      h.engine.state.players.find((p) => p.id === h.ids["יובל"])!.wrongCount,
      0,
      "sitting a question out breaks the streak but is not recorded as a wrong answer"
    );
  });

  it("builds a streak and awards the streak bonus", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { questionCount: 3 });
    start(h, questions(3));

    for (let i = 0; i < 3; i++) {
      const q = h.engine.state.questions[h.engine.state.questionIndex];
      answer(h, "נאור", correctOptionFor(q));
      answer(h, "יובל", wrongOptionFor(q));
      if (i < 2) toNextQuestion(h);
    }

    const naor = h.engine.state.players.find((p) => p.id === h.ids["נאור"])!;
    assert.equal(naor.correctCount, 3);
    assert.equal(naor.bestStreak, 3);
    // 3 correct at full speed = 150 + 150 + (150 + streak) — the third answer
    // carries a streak bonus the first cannot.
    assert.ok(naor.score > 450, `streak bonus missing: ${naor.score}`);
  });
});

// --------------------------------------------------------- everyone answers

describe("EVERYONE ANSWERS", () => {
  it("scores on correctness and speed, with no streak bonus", () => {
    const classic = room("CLASSIC_BATTLE", ["א", "ב"]);
    const everyone = room("EVERYONE_ANSWERS", ["א", "ב"]);

    for (const h of [classic, everyone]) {
      start(h, questions(3));
      for (let i = 0; i < 3; i++) {
        const q = h.engine.state.questions[h.engine.state.questionIndex];
        answer(h, "א", correctOptionFor(q));
        answer(h, "ב", correctOptionFor(q));
        if (i < 2) toNextQuestion(h);
      }
    }

    const classicScore = classic.engine.state.players.find((p) => p.id === classic.ids["א"])!.score;
    const everyoneScore = everyone.engine.state.players.find((p) => p.id === everyone.ids["א"])!.score;
    assert.ok(
      classicScore > everyoneScore,
      `classic (${classicScore}) should out-score everyone-answers (${everyoneScore}) on identical play`
    );
  });
});

// ------------------------------------------------------------- turn based

describe("TURN BASED", () => {
  it("walks the players round-robin in join order", () => {
    const h = room("TURN_BASED", ["נאור", "יובל", "דניאל"], { questionCount: 4 });
    start(h, questions(4));

    const turns: string[] = [];
    for (let i = 0; i < 4; i++) {
      turns.push(h.engine.state.currentTurnPlayerId!);
      const q = h.engine.state.questions[h.engine.state.questionIndex];
      const current = Object.keys(h.ids).find((n) => h.ids[n] === h.engine.state.currentTurnPlayerId)!;
      answer(h, current, correctOptionFor(q));
      if (i < 3) toNextQuestion(h);
    }

    assert.deepEqual(turns, [h.ids["נאור"], h.ids["יובל"], h.ids["דניאל"], h.ids["נאור"]]);
  });

  it("announces whose turn it is", () => {
    const h = room("TURN_BASED", ["נאור", "יובל"]);
    const effects = start(h, questions(2));
    const turn = messagesOf(effects, "TURN_STARTED")[0];
    assert.ok(turn);
    assert.equal(turn.playerId, h.ids["נאור"]);
    assert.equal(turn.name, "נאור");
  });

  it("rejects a submission from a player whose turn it is not", () => {
    const h = room("TURN_BASED", ["נאור", "יובל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];

    const effects = answer(h, "יובל", correctOptionFor(q));
    assert.deepEqual(errorsFor(effects, h.ids["יובל"]), ["NOT_YOUR_TURN"]);
    assert.equal(h.engine.state.roundAnswers.length, 0, "the out-of-turn answer was not recorded");
    assert.equal(h.engine.state.players.find((p) => p.id === h.ids["יובל"])!.score, 0);
  });

  it("refuses a hint to a player whose turn it is not", () => {
    const h = room("TURN_BASED", ["נאור", "יובל"]);
    start(h, questions(2));
    const effects = send(h, "יובל", { type: "REQUEST_HINT", questionIndex: 0 });
    assert.deepEqual(errorsFor(effects, h.ids["יובל"]), ["NOT_YOUR_TURN"]);
    assert.equal(messagesOf(effects, "HINT").length, 0);
  });

  it("closes the round as soon as the one player whose turn it is has answered", () => {
    const h = room("TURN_BASED", ["נאור", "יובל", "דניאל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];
    const effects = answer(h, "נאור", correctOptionFor(q));
    assert.equal(messagesOf(effects, "ANSWER_REVEAL").length, 1);
    assert.equal(phase(h), "ANSWER_REVEAL");
  });

  it("scores zero and moves on when a turn runs out of time", () => {
    const h = room("TURN_BASED", ["נאור", "יובל"], { questionCount: 2 });
    start(h, questions(2));
    tickDeadline(h);
    assert.equal(phase(h), "ANSWER_REVEAL");
    assert.equal(h.engine.state.players.find((p) => p.id === h.ids["נאור"])!.score, 0);
    assert.equal(h.engine.state.players.find((p) => p.id === h.ids["נאור"])!.wrongCount, 0, "a no-show is not a wrong answer");
  });

  it("skips a disconnected player's turn instead of freezing the room", () => {
    const h = room("TURN_BASED", ["נאור", "יובל", "דניאל"], { questionCount: 3 });
    start(h, questions(3));

    // Question 1 belongs to נאור. Answer it, then drop יובל before question 2.
    answer(h, "נאור", correctOptionFor(h.engine.state.questions[0]));
    h.engine.detach(h.ids["יובל"], h.t);
    toNextQuestion(h);

    assert.equal(
      h.engine.state.currentTurnPlayerId,
      h.ids["דניאל"],
      "the turn should pass over the disconnected player, not stall on them"
    );
    assert.notEqual(phase(h), "LOBBY");
  });

  it("puts a reconnected player back into the rotation", () => {
    const h = room("TURN_BASED", ["נאור", "יובל", "דניאל"], { questionCount: 4 });
    start(h, questions(4));

    answer(h, "נאור", correctOptionFor(h.engine.state.questions[0]));
    h.engine.detach(h.ids["יובל"], h.t);
    toNextQuestion(h);
    assert.equal(h.engine.state.currentTurnPlayerId, h.ids["דניאל"]);

    // Back inside the grace window, so their score and seat are intact.
    h.t += 2000;
    h.engine.join("token-יובל", "יובל", h.t);
    answer(h, "דניאל", correctOptionFor(h.engine.state.questions[1]));
    toNextQuestion(h);

    assert.ok(
      [h.ids["נאור"], h.ids["יובל"]].includes(h.engine.state.currentTurnPlayerId!),
      "a reconnected player must be eligible for turns again"
    );
  });

  it("ends the round when the only eligible player leaves mid-turn", () => {
    const h = room("TURN_BASED", ["נאור", "יובל"], { questionCount: 3 });
    start(h, questions(3));
    assert.equal(h.engine.state.currentTurnPlayerId, h.ids["נאור"]);

    const effects = h.engine.detach(h.ids["נאור"], h.t);
    assert.equal(messagesOf(effects, "ANSWER_REVEAL").length, 1, "the round closed rather than waiting on a ghost");
  });

  it("keeps everyone's scoreboard in step after each round", () => {
    const h = room("TURN_BASED", ["נאור", "יובל"], { questionCount: 2 });
    start(h, questions(2));
    const effects = answer(h, "נאור", correctOptionFor(h.engine.state.questions[0]));

    const update = messagesOf(effects, "SCORE_UPDATE")[0];
    assert.ok(update, "the reveal carries a score update");
    // Broadcast, so every client receives the same numbers — there is no
    // per-client score path that could drift.
    assert.equal(
      effects.filter((e) => e.kind === "broadcast" && e.message.type === "SCORE_UPDATE").length,
      1
    );
    assert.equal(update.scores.length, 2);
    assert.ok(update.scores.find((s) => s.playerId === h.ids["נאור"])!.score > 0);
    assert.equal(update.scores.find((s) => s.playerId === h.ids["יובל"])!.score, 0);
  });
});

// ------------------------------------------------------------------- duel

describe("DUEL", () => {
  it("requires exactly two players", () => {
    const two = room("DUEL", ["נאור", "יובל"]);
    assert.equal(two.engine.requestStart(two.ids["נאור"], two.t).error, null);

    const one = room("DUEL", ["נאור"]);
    assert.equal(one.engine.requestStart(one.ids["נאור"], one.t).error, "NEEDS_MORE_PLAYERS");
  });

  it("gives both players the same questions in the same order with the same options", () => {
    const h = room("DUEL", ["נאור", "יובל"], { questionCount: 3 });
    const effects = start(h, questions(3));

    // One broadcast per question is the guarantee: there is no per-player
    // rendering path that could differ.
    assert.equal(messagesOf(effects, "QUESTION_STARTED").length, 1);
    const first = messagesOf(effects, "QUESTION_STARTED")[0].question;
    assert.deepEqual(first.options.map((o) => o.id), [11, 12, 13, 14]);

    const second = messagesOf(toNextQuestion(h), "QUESTION_STARTED")[0].question;
    assert.equal(second.index, 1);
    assert.deepEqual(second.options.map((o) => o.id), [21, 22, 23, 24]);
  });

  it("gives the intro extra room before the first question", () => {
    const duel = room("DUEL", ["נאור", "יובל"]);
    duel.engine.requestStart(duel.ids["נאור"], duel.t);
    duel.engine.beginGame(questions(3), duel.t);
    const duelIntro = duel.engine.state.phaseDeadlineAt! - duel.t;

    const classic = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    classic.engine.requestStart(classic.ids["נאור"], classic.t);
    classic.engine.beginGame(questions(3), classic.t);
    const classicIntro = classic.engine.state.phaseDeadlineAt! - classic.t;

    assert.ok(duelIntro > classicIntro, "the VS intro needs its own time");
    assert.ok(duelIntro <= 6000, `the intro must stay short, got ${duelIntro}ms`);
  });

  it("names the round winner each question and the match winner at the end", () => {
    const h = room("DUEL", ["נאור", "יובל"], { questionCount: 3 });
    start(h, questions(3));

    // נאור takes two rounds, יובל one.
    for (let i = 0; i < 3; i++) {
      const q = h.engine.state.questions[h.engine.state.questionIndex];
      if (i < 2) {
        answer(h, "נאור", correctOptionFor(q));
        answer(h, "יובל", wrongOptionFor(q));
      } else {
        answer(h, "נאור", wrongOptionFor(q));
        answer(h, "יובל", correctOptionFor(q));
      }
      assert.equal(h.engine.state.roundWinnerIds.length, 1);
      if (i < 2) toNextQuestion(h);
    }

    const finished = messagesOf(toNextQuestion(h), "GAME_FINISHED")[0];
    assert.ok(finished, "the duel ended");
    assert.deepEqual(finished.result.winnerIds, [h.ids["נאור"]]);
    assert.equal(finished.result.standings[0].playerId, h.ids["נאור"]);
    assert.equal(finished.result.standings.length, 2, "a duel result has two rows, not a podium");
    assert.equal(finished.result.teamResult, null);
  });

  it("asks both players before restarting a rematch", () => {
    const h = room("DUEL", ["נאור", "יובל"], { questionCount: 2 });
    start(h, questions(2));
    playOut(h, ["נאור", "יובל"]);
    assert.equal(phase(h), "FINISHED");

    const first = send(h, "נאור", { type: "REQUEST_REMATCH" });
    assert.equal(phase(h), "REMATCH_WAITING");
    const status = messagesOf(first, "REMATCH_STATUS")[0];
    assert.deepEqual(status.requested, [h.ids["נאור"]]);
    assert.equal(status.needed, 2);

    send(h, "יובל", { type: "REQUEST_REMATCH" });
    assert.equal(phase(h), "LOBBY", "both said yes, so the room is ready to go again");
    assert.equal(h.engine.rematchAgreed(), true, "the caller is told to fetch a fresh question set");
    assert.equal(h.engine.state.players.every((p) => p.score === 0), true, "scores reset for the rematch");
  });

  it("hands the win to the player who stayed when their opponent never comes back", () => {
    const h = room("DUEL", ["נאור", "יובל"], { questionCount: 5 });
    start(h, questions(5));
    answer(h, "נאור", wrongOptionFor(h.engine.state.questions[0]));
    answer(h, "יובל", correctOptionFor(h.engine.state.questions[0]));
    toNextQuestion(h);

    // יובל is ahead, and leaves. Past the grace window it is a forfeit.
    h.engine.detach(h.ids["יובל"], h.t);
    h.t += RECONNECT_GRACE_MS + 1000;
    const effects = h.engine.tick(h.t);

    const finished = messagesOf(effects, "GAME_FINISHED")[0];
    assert.ok(finished, "the duel ended rather than hanging");
    assert.equal(finished.result.forfeitedBy, h.ids["יובל"]);
    assert.deepEqual(finished.result.winnerIds, [h.ids["נאור"]], "the player who stayed wins, whatever the scoreline said");
  });

  it("does not forfeit a player who returns inside the grace window", () => {
    const h = room("DUEL", ["נאור", "יובל"], { questionCount: 5 });
    start(h, questions(5));

    h.engine.detach(h.ids["יובל"], h.t);
    h.t += RECONNECT_GRACE_MS - 5000;
    h.engine.join("token-יובל", "יובל", h.t);
    h.t += 10_000;
    const effects = h.engine.tick(h.t);

    assert.equal(messagesOf(effects, "GAME_FINISHED").length, 0, "they came back in time");
    assert.notEqual(phase(h), "FINISHED");
  });
});

describe("RANDOM DUEL", () => {
  it("uses the fixed queue settings, so both players get identical rules", () => {
    const settings = randomDuelSettings();
    assert.equal(settings.questionCount, 10);
    assert.equal(settings.answerMode, "MULTIPLE_CHOICE");
    assert.equal(settings.secondsPerQuestion, 15);
    assert.equal(settings.hintsAllowed, false, "a hint penalty nobody opted into would not be fair");
  });

  it("refuses to let a player reconfigure a matchmade room", () => {
    const h = room("RANDOM_DUEL", ["נאור", "יובל"], randomDuelSettings());
    const effects = send(h, "נאור", { type: "UPDATE_SETTINGS", settings: { questionCount: 30 } });
    assert.equal(errorsFor(effects, h.ids["נאור"]).length, 1);
    assert.equal(h.engine.state.settings.questionCount, 10);
  });
});

// ------------------------------------------------------------ team battle

describe("TEAM BATTLE", () => {
  it("auto-balances unassigned players at kick-off", () => {
    const h = room("TEAM_BATTLE", ["נאור", "יובל", "דניאל", "רועי"], { questionCount: 2 });
    start(h, questions(2));

    const teams = h.engine.view(h.t).players.map((p) => p.team);
    assert.equal(teams.filter((t) => t === "GREEN").length, 2);
    assert.equal(teams.filter((t) => t === "GOLD").length, 2);
  });

  it("lets the host assign a player by hand", () => {
    const h = room("TEAM_BATTLE", ["נאור", "יובל", "דניאל", "רועי"]);
    send(h, "נאור", { type: "SET_TEAM", playerId: h.ids["רועי"], team: "GOLD" });
    assert.equal(h.engine.view(h.t).players.find((p) => p.id === h.ids["רועי"])!.team, "GOLD");
  });

  it("sums individual scores into the team total and names the winning team and MVP", () => {
    const h = room("TEAM_BATTLE", ["נאור", "יובל", "דניאל", "רועי"], { questionCount: 2 });
    start(h, questions(2));

    // Green = נאור + דניאל, Gold = יובל + רועי (alternating join order).
    const green = h.engine.state.players.filter((p) => p.team === "GREEN").map((p) => p.id);
    const gold = h.engine.state.players.filter((p) => p.team === "GOLD").map((p) => p.id);
    const nameOf = (id: string) => Object.keys(h.ids).find((n) => h.ids[n] === id)!;

    for (let i = 0; i < 2; i++) {
      const q = h.engine.state.questions[h.engine.state.questionIndex];
      // Both greens correct, both golds wrong.
      for (const id of green) answer(h, nameOf(id), correctOptionFor(q));
      for (const id of gold) answer(h, nameOf(id), wrongOptionFor(q));
      if (i < 1) toNextQuestion(h);
    }

    const finished = messagesOf(toNextQuestion(h), "GAME_FINISHED")[0];
    assert.ok(finished);
    const team = finished.result.teamResult!;
    assert.equal(team.winner, "GREEN");

    const expectedGreen = h.engine.state.players
      .filter((p) => p.team === "GREEN")
      .reduce((sum, p) => sum + p.score, 0);
    assert.equal(team.scores.GREEN, expectedGreen, "the team total is exactly the sum of its members");
    assert.equal(team.scores.GOLD, 0);
    assert.ok(green.includes(team.mvpPlayerId!), "the MVP here is the best individual, who is on green");
    assert.deepEqual(team.names, { GREEN: "הירוקים", GOLD: "הזהובים" });
  });

  it("carries team totals in the live view during the game", () => {
    const h = room("TEAM_BATTLE", ["נאור", "יובל"], { questionCount: 2 });
    start(h, questions(2));
    assert.notEqual(h.engine.view(h.t).teamScores, null);
    const classic = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    assert.equal(classic.engine.view(classic.t).teamScores, null);
  });

  it("clears team badges when the host switches away from team mode", () => {
    const h = room("TEAM_BATTLE", ["נאור", "יובל"]);
    send(h, "נאור", { type: "AUTO_BALANCE" });
    assert.ok(h.engine.state.players.every((p) => p.team !== null));
    send(h, "נאור", { type: "UPDATE_SETTINGS", settings: { mode: "CLASSIC_BATTLE" } });
    assert.ok(h.engine.state.players.every((p) => p.team === null));
  });
});

// -------------------------------------------------------------- anti-cheat

describe("anti-cheat", () => {
  it("refuses a second answer to the same question", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];

    answer(h, "נאור", wrongOptionFor(q));
    const second = answer(h, "נאור", correctOptionFor(q));

    assert.deepEqual(errorsFor(second, h.ids["נאור"]), ["ALREADY_ANSWERED"]);
    assert.equal(h.engine.state.roundAnswers.length, 1, "the second attempt was not recorded");
    assert.equal(h.engine.state.roundAnswers[0].correct, false, "and it did not overwrite the first");

    // Close the round and confirm nothing was banked for it.
    answer(h, "יובל", wrongOptionFor(q));
    assert.equal(h.engine.state.players.find((p) => p.id === h.ids["נאור"])!.score, 0);
  });

  it("refuses an answer after the deadline", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];
    h.t = h.engine.state.phaseDeadlineAt! + 1;
    const effects = answer(h, "נאור", correctOptionFor(q));
    assert.deepEqual(errorsFor(effects, h.ids["נאור"]), ["TOO_LATE"]);
    assert.equal(h.engine.state.roundAnswers.length, 0);
  });

  it("refuses an answer for a question that is not the one in play", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(5));
    // Answering question 4 while question 0 is open would be reading ahead.
    const ahead = h.engine.handle(
      h.ids["נאור"],
      { type: "SUBMIT_ANSWER", questionIndex: 4, optionId: 51, typed: null, reveal: false },
      h.t
    );
    assert.deepEqual(errorsFor(ahead, h.ids["נאור"]), ["TOO_LATE"]);
    assert.equal(h.engine.state.roundAnswers.length, 0);
  });

  it("refuses an option id that belongs to a different question", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(3));
    // 31 is question 3's correct option; question 1 is in play.
    const effects = answer(h, "נאור", 31);
    assert.deepEqual(errorsFor(effects, h.ids["נאור"]), ["INVALID_MESSAGE"]);
    assert.equal(h.engine.state.players.find((p) => p.id === h.ids["נאור"])!.score, 0);
  });

  it("refuses an answer during the reveal", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];
    answer(h, "נאור", correctOptionFor(q));
    answer(h, "יובל", correctOptionFor(q));
    assert.equal(phase(h), "ANSWER_REVEAL");

    const late = h.engine.handle(
      h.ids["יובל"],
      { type: "SUBMIT_ANSWER", questionIndex: 0, optionId: correctOptionFor(q), typed: null, reveal: false },
      h.t
    );
    assert.deepEqual(errorsFor(late, h.ids["יובל"]), ["TOO_LATE"]);
  });

  it("counts hints on the server, so a hint cannot be hidden to dodge the penalty", () => {
    const withHint = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(withHint, questions(2));
    const hintEffects = send(withHint, "נאור", { type: "REQUEST_HINT", questionIndex: 0 });
    const hint = messagesOf(hintEffects, "HINT")[0];
    assert.equal(hint.text, "רמז ראשון");
    assert.equal(hint.hintIndex, 0);

    // The client never says it used a hint — and it does not have to.
    answer(withHint, "נאור", correctOptionFor(withHint.engine.state.questions[0]));
    answer(withHint, "יובל", correctOptionFor(withHint.engine.state.questions[0]));

    const clean = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(clean, questions(2));
    answer(clean, "נאור", correctOptionFor(clean.engine.state.questions[0]));
    answer(clean, "יובל", correctOptionFor(clean.engine.state.questions[0]));

    const penalised = withHint.engine.state.players.find((p) => p.id === withHint.ids["נאור"])!.score;
    const full = clean.engine.state.players.find((p) => p.id === clean.ids["נאור"])!.score;
    assert.ok(penalised < full, `hint penalty not applied: ${penalised} vs ${full}`);
    assert.equal(withHint.engine.state.roundAnswers[0].hintsUsed, 1);
  });

  it("hands out hints one at a time and stops when they run out", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(2));
    assert.equal(messagesOf(send(h, "נאור", { type: "REQUEST_HINT", questionIndex: 0 }), "HINT")[0].text, "רמז ראשון");
    assert.equal(messagesOf(send(h, "נאור", { type: "REQUEST_HINT", questionIndex: 0 }), "HINT")[0].text, "רמז שני");
    assert.equal(messagesOf(send(h, "נאור", { type: "REQUEST_HINT", questionIndex: 0 }), "HINT").length, 0);
  });

  it("gives no hints at all when the host turned them off", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { hintsAllowed: false });
    start(h, questions(2));
    assert.equal(messagesOf(send(h, "נאור", { type: "REQUEST_HINT", questionIndex: 0 }), "HINT").length, 0);
    const live = h.engine.liveQuestion(0)!;
    assert.equal(live.hintCount, 0, "the client is not even shown a hint button");
  });

  it("rate-limits reactions", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    assert.equal(messagesOf(send(h, "נאור", { type: "SEND_REACTION", emoji: "🔥" }), "REACTION").length, 1);
    const second = send(h, "נאור", { type: "SEND_REACTION", emoji: "🔥" });
    assert.deepEqual(errorsFor(second, h.ids["נאור"]), ["RATE_LIMITED"]);

    h.t += 4000;
    assert.equal(messagesOf(send(h, "נאור", { type: "SEND_REACTION", emoji: "👏" }), "REACTION").length, 1);
  });

  it("ignores a message from a player who is not in the room", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const effects = h.engine.handle("not-a-player", { type: "START_GAME" }, h.t);
    assert.deepEqual(errorsFor(effects, "not-a-player"), ["NOT_JOINED"]);
  });
});

// --------------------------------------------------------------- free text

describe("free-text answers in multiplayer", () => {
  const freeText: Partial<RoomSettings> = { answerMode: "FREE_TEXT" };

  it("reuses the shared matcher: aliases, transliteration and small typos all pass", () => {
    for (const typed of ["ליונל מסי", "מסי", "Messi", "messi", "Lionel Messi", "Vinicius"]) {
      const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], freeText);
      start(h, questions(2, { freeText: true }));
      answer(h, "נאור", null, { typed });
      const expected = typed !== "Vinicius";
      assert.equal(
        h.engine.state.roundAnswers[0].correct,
        expected,
        `"${typed}" should be ${expected ? "accepted" : "rejected"}`
      );
    }
  });

  it("accepts a typo and marks it as a tolerance match so the client can run the VAR beat", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], freeText);
    start(h, questions(2, { freeText: true }));
    answer(h, "נאור", null, { typed: "Lionel Mesi" });
    const recorded = h.engine.state.roundAnswers[0];
    assert.equal(recorded.correct, true);
    assert.equal(recorded.matchKind, "fuzzy");
  });

  it("sends no options and reveals the canonical answer only at the reveal", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], freeText);
    const effects = start(h, questions(2, { freeText: true }));
    const live = messagesOf(effects, "QUESTION_STARTED")[0].question;
    assert.equal(live.answerMode, "FREE_TEXT");
    assert.deepEqual(live.options, []);
    assert.doesNotMatch(JSON.stringify(live), /מסי/);

    answer(h, "נאור", null, { typed: "מסי" });
    const closing = answer(h, "יובל", null, { typed: "רונאלדו" });

    const reveal = messagesOf(closing, "ANSWER_REVEAL")[0];
    assert.ok(reveal, "the round closed once both players had typed something");
    assert.equal(reveal.reveal.correctAnswer, "ליונל מסי", "the canonical answer arrives with the reveal, not before");
    assert.equal(reveal.reveal.results.find((r) => r.playerId === h.ids["נאור"])!.correct, true);
    assert.equal(reveal.reveal.results.find((r) => r.playerId === h.ids["יובל"])!.correct, false);
    assert.equal(reveal.reveal.results.find((r) => r.playerId === h.ids["יובל"])!.typedAnswer, "רונאלדו");
  });

  it("records a reveal as not correct rather than as a wrong answer", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], freeText);
    start(h, questions(2, { freeText: true }));
    answer(h, "נאור", null, { reveal: true });
    const recorded = h.engine.state.roundAnswers[0];
    assert.equal(recorded.correct, false);
    assert.equal(recorded.revealed, true);
    assert.equal(recorded.points, 0);
  });

  it("rejects an empty typed answer", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], freeText);
    start(h, questions(2, { freeText: true }));
    const effects = answer(h, "נאור", null, { typed: "   " });
    assert.deepEqual(errorsFor(effects, h.ids["נאור"]), ["INVALID_MESSAGE"]);
  });
});

// ----------------------------------------------------- reconnect & hosting

describe("reconnect", () => {
  it("restores a player's score and seat on the same token", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { questionCount: 3 });
    start(h, questions(3));
    answer(h, "נאור", correctOptionFor(h.engine.state.questions[0]));
    answer(h, "יובל", wrongOptionFor(h.engine.state.questions[0]));
    const scoreBefore = h.engine.state.players.find((p) => p.id === h.ids["נאור"])!.score;
    assert.ok(scoreBefore > 0);

    h.engine.detach(h.ids["נאור"], h.t);
    h.t += 3000;
    const back = h.engine.join("token-נאור", "נאור", h.t);

    assert.equal(back.playerId, h.ids["נאור"], "the same player, not a duplicate");
    assert.equal(h.engine.view(h.t).players.length, 2);
    assert.equal(h.engine.state.players.find((p) => p.id === h.ids["נאור"])!.score, scoreBefore);
  });

  it("shows a dropped player as reconnecting during the grace window", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    h.engine.detach(h.ids["יובל"], h.t);

    const during = h.engine.view(h.t + 1000).players.find((p) => p.id === h.ids["יובל"])!;
    assert.equal(during.connected, false);
    assert.equal(during.reconnecting, true);

    const after = h.engine.view(h.t + RECONNECT_GRACE_MS + 1).players.find((p) => p.id === h.ids["יובל"])!;
    assert.equal(after.reconnecting, false);
  });

  it("does not wait on a disconnected player to finish the round", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דניאל"]);
    start(h, questions(2));
    const q = h.engine.state.questions[0];
    answer(h, "נאור", correctOptionFor(q));
    answer(h, "יובל", correctOptionFor(q));
    assert.equal(phase(h), "WAITING_FOR_ANSWERS");

    const effects = h.engine.detach(h.ids["דניאל"], h.t);
    assert.equal(messagesOf(effects, "ANSWER_REVEAL").length, 1, "the round closed once the last live player had answered");
  });

  it("gives up a seat in the lobby once the grace window closes", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דניאל"]);
    h.engine.detach(h.ids["דניאל"], h.t);
    h.t += RECONNECT_GRACE_MS + 1;
    const effects = h.engine.tick(h.t);

    assert.equal(messagesOf(effects, "PLAYER_LEFT").length, 1);
    assert.deepEqual(h.engine.view(h.t).players.map((p) => p.name), ["נאור", "יובל"]);
  });

  it("keeps a mid-game player in the standings after they time out — they played those questions", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { questionCount: 3 });
    start(h, questions(3));
    answer(h, "נאור", correctOptionFor(h.engine.state.questions[0]));
    answer(h, "יובל", correctOptionFor(h.engine.state.questions[0]));
    toNextQuestion(h);

    h.engine.detach(h.ids["יובל"], h.t);
    h.t += RECONNECT_GRACE_MS + 1;
    h.engine.tick(h.t);

    assert.equal(h.engine.view(h.t).players.length, 2, "they keep their row");
    assert.ok(h.engine.state.players.find((p) => p.id === h.ids["יובל"])!.score > 0);
  });

  it("transfers host to the oldest connected player and says who it is", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דניאל"]);
    h.engine.detach(h.ids["נאור"], h.t);
    h.t += RECONNECT_GRACE_MS + 1;
    const effects = h.engine.tick(h.t);

    const changed = messagesOf(effects, "HOST_CHANGED")[0];
    assert.ok(changed, "the room was told about the handover");
    assert.equal(changed.hostId, h.ids["יובל"]);
    assert.equal(changed.hostName, "יובל");
    assert.equal(h.engine.state.hostId, h.ids["יובל"]);
  });

  it("gives the host their role back if they return inside the grace window", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דניאל"]);
    h.engine.detach(h.ids["נאור"], h.t);
    h.t += 5000;
    h.engine.join("token-נאור", "נאור", h.t);
    h.t += RECONNECT_GRACE_MS + 1;
    h.engine.tick(h.t);

    assert.equal(h.engine.state.hostId, h.ids["נאור"], "the host came back before anyone took over");
  });

  it("schedules a wake-up for the grace deadline", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    h.engine.detach(h.ids["יובל"], h.t);
    const wake = h.engine.nextWakeAt()!;
    assert.ok(wake <= h.t + RECONNECT_GRACE_MS, `expected a wake at the grace deadline, got +${wake - h.t}ms`);
  });
});

// ------------------------------------------------------ results & lifecycle

describe("results", () => {
  it("produces full standings with every column the results screen shows", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דניאל"], { questionCount: 3 });
    start(h, questions(3));

    for (let i = 0; i < 3; i++) {
      const q = h.engine.state.questions[h.engine.state.questionIndex];
      answer(h, "נאור", correctOptionFor(q));
      answer(h, "יובל", i === 0 ? correctOptionFor(q) : wrongOptionFor(q));
      answer(h, "דניאל", wrongOptionFor(q));
      if (i < 2) toNextQuestion(h);
    }

    const finished = messagesOf(toNextQuestion(h), "GAME_FINISHED")[0];
    assert.ok(finished);
    const top = finished.result.standings[0];
    assert.equal(top.playerId, h.ids["נאור"]);
    assert.equal(top.position, 1);
    assert.equal(top.correctCount, 3);
    assert.equal(top.wrongCount, 0);
    assert.equal(top.accuracy, 100);
    assert.equal(top.bestStreak, 3);
    assert.ok(typeof top.averageResponseMs === "number");
    assert.deepEqual(finished.result.standings.map((s) => s.position), [1, 2, 3]);
    assert.equal(finished.result.forfeitedBy, null);
  });

  it("shows the standings once before the podium", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { questionCount: 1 });
    start(h, questions(1));
    answer(h, "נאור", correctOptionFor(h.engine.state.questions[0]));
    answer(h, "יובל", wrongOptionFor(h.engine.state.questions[0]));

    tickDeadline(h); // reveal -> round results
    const leaderboard = messagesOf(tickDeadline(h), "LEADERBOARD_UPDATE")[0];
    assert.ok(leaderboard, "a standings beat between the last round and the podium");
    assert.equal(phase(h), "LEADERBOARD");
    assert.equal(messagesOf(tickDeadline(h), "GAME_FINISHED").length, 1);
  });

  it("asks the caller to write exactly one history record", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { questionCount: 1 });
    start(h, questions(1));
    const effects = playOut(h, ["נאור", "יובל"]);
    assert.equal(effects.filter((e) => e.kind === "persist").length, 1);
  });

  it("returns a private room to the lobby when the host asks for another game", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { questionCount: 1 });
    start(h, questions(1));
    playOut(h, ["נאור", "יובל"]);
    assert.equal(phase(h), "FINISHED");

    send(h, "נאור", { type: "REQUEST_REMATCH" });
    assert.equal(phase(h), "LOBBY");
    assert.equal(h.engine.view(h.t).players.length, 2, "players stay in the room");
    assert.equal(h.engine.state.players.every((p) => p.score === 0), true);
    assert.equal(h.engine.state.played, true, "the room remembers it has been played");
  });

  it("refuses a non-host rematch in a private room", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { questionCount: 1 });
    start(h, questions(1));
    playOut(h, ["נאור", "יובל"]);
    const effects = send(h, "יובל", { type: "REQUEST_REMATCH" });
    assert.deepEqual(errorsFor(effects, h.ids["יובל"]), ["NOT_HOST"]);
  });
});

describe("room lifecycle", () => {
  it("closes a room nobody is connected to", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    h.engine.detach(h.ids["נאור"], h.t);
    h.engine.detach(h.ids["יובל"], h.t);

    h.t += EMPTY_ROOM_TTL_MS + 1000;
    const effects = h.engine.tick(h.t);
    assert.equal(messagesOf(effects, "ROOM_CLOSED").length, 1);
    assert.ok(effects.some((e) => e.kind === "destroy"));
  });

  it("stops asking to be woken once it is closed", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    send(h, "נאור", { type: "END_ROOM" });
    assert.equal(h.engine.nextWakeAt(), null);
  });

  it("refuses a join to a closed room", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    send(h, "נאור", { type: "END_ROOM" });
    assert.equal(h.engine.join("token-new", "רועי", h.t).error, "ROOM_EXPIRED");
  });

  it("reports no questions rather than starting an empty game", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const effects = h.engine.beginGame([], h.t);
    assert.equal(messagesOf(effects, "ERROR")[0].code, "NO_QUESTIONS");
    assert.equal(phase(h), "LOBBY");
  });

  it("hands a reconnecting player the moment they walked into", () => {
    // ROOM_STATE alone says "we are in question 2's reveal" but carries no
    // question and no reveal, so without this a refresh mid-round shows a
    // scoreboard and an empty board. That is the likeliest moment for a refresh
    // to happen, so it has to work.
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { questionCount: 3 });
    start(h, questions(3));

    const open = h.engine.resumeMessages(h.ids["נאור"], h.t);
    assert.equal(open.filter((m) => m.type === "QUESTION_STARTED").length, 1, "the question on screen");
    assert.equal(open.filter((m) => m.type === "ANSWER_REVEAL").length, 0, "and no reveal while the round is open");

    answer(h, "נאור", correctOptionFor(h.engine.state.questions[0]));
    answer(h, "יובל", wrongOptionFor(h.engine.state.questions[0]));
    assert.equal(phase(h), "ANSWER_REVEAL");

    const during = h.engine.resumeMessages(h.ids["יובל"], h.t);
    assert.equal(during.filter((m) => m.type === "QUESTION_STARTED").length, 1);
    assert.equal(during.filter((m) => m.type === "ANSWER_REVEAL").length, 1, "the reveal everybody else is looking at");
    assert.equal(during.filter((m) => m.type === "SCORE_UPDATE").length, 1, "and the current scores");
  });

  it("replays hints a reconnecting player already paid for", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(2));
    send(h, "נאור", { type: "REQUEST_HINT", questionIndex: 0 });
    send(h, "נאור", { type: "REQUEST_HINT", questionIndex: 0 });

    const mine = h.engine.resumeMessages(h.ids["נאור"], h.t).filter((m) => m.type === "HINT");
    assert.deepEqual(mine.map((m) => (m as { text: string }).text), ["רמז ראשון", "רמז שני"]);

    const theirs = h.engine.resumeMessages(h.ids["יובל"], h.t).filter((m) => m.type === "HINT");
    assert.equal(theirs.length, 0, "and gives nobody else a hint they did not buy");
  });

  it("hands a reconnecting player the final result once the game is over", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { questionCount: 1 });
    start(h, questions(1));
    playOut(h, ["נאור", "יובל"]);

    const messages = h.engine.resumeMessages(h.ids["נאור"], h.t);
    assert.equal(messages.filter((m) => m.type === "GAME_FINISHED").length, 1);
  });

  it("gives a display screen the same picture, without a player id", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    start(h, questions(3));
    const messages = h.engine.resumeMessages(null, h.t);
    assert.equal(messages.filter((m) => m.type === "QUESTION_STARTED").length, 1, "a TV joining mid-game sees the question");
    assert.equal(messages.filter((m) => m.type === "HINT").length, 0, "and never anybody's hints");
  });

  it("survives a serialize/restore round trip mid-game", () => {
    // This is what hibernation does to a room: the object is evicted and rebuilt
    // from storage between two messages.
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"], { questionCount: 3 });
    start(h, questions(3));
    answer(h, "נאור", correctOptionFor(h.engine.state.questions[0]));

    const restored = new RoomEngine(JSON.parse(JSON.stringify(h.engine.state)));
    assert.equal(restored.state.phase, "WAITING_FOR_ANSWERS");
    assert.equal(restored.state.questionIndex, 0);
    assert.equal(restored.state.roundAnswers.length, 1);

    const effects = restored.handle(
      h.ids["יובל"],
      { type: "SUBMIT_ANSWER", questionIndex: 0, optionId: correctOptionFor(restored.state.questions[0]), typed: null, reveal: false },
      h.t
    );
    assert.equal(messagesOf(effects, "ANSWER_REVEAL").length, 1, "the restored room closed the round correctly");
  });
});

// ------------------------------------------------------------- larger rooms

describe("a full room", () => {
  it("runs a twenty-player classic battle to a complete leaderboard", () => {
    const names = Array.from({ length: 20 }, (_, i) => `שחקן${i + 1}`);
    const h = room("CLASSIC_BATTLE", names, { questionCount: 5 });
    assert.equal(h.engine.view(h.t).players.length, 20);

    start(h, questions(5));
    for (let round = 0; round < 5; round++) {
      const q = h.engine.state.questions[h.engine.state.questionIndex];
      names.forEach((name, i) => {
        // Every third player gets it right, so the standings have real spread.
        answer(h, name, i % 3 === 0 ? correctOptionFor(q) : wrongOptionFor(q));
      });
      if (round < 4) toNextQuestion(h);
    }

    const finished = messagesOf(toNextQuestion(h), "GAME_FINISHED")[0];
    assert.ok(finished, "the game finished");
    assert.equal(finished.result.standings.length, 20);
    assert.deepEqual(
      finished.result.standings.map((s) => s.score),
      [...finished.result.standings.map((s) => s.score)].sort((a, b) => b - a),
      "standings are ordered by score"
    );
    assert.ok(finished.result.winnerIds.length >= 1);
  });

  it("turns a twenty-first player away", () => {
    const names = Array.from({ length: 20 }, (_, i) => `שחקן${i + 1}`);
    const h = room("CLASSIC_BATTLE", names);
    assert.equal(h.engine.join("token-21", "אחד יותר", h.t).error, "ROOM_FULL");
  });
});

describe("trash talk", () => {
  /** Sends at an explicit time, so the cooldown can be stepped over precisely. */
  function talk(
    h: Harness,
    name: string,
    payload: { presetId?: string | null; text?: string | null },
    at = h.t
  ): Effect[] {
    return h.engine.handle(
      h.ids[name],
      {
        type: "SEND_MESSAGE",
        presetId: (payload.presetId ?? null) as never,
        text: payload.text ?? null,
      },
      at
    );
  }

  it("sends a preset to the other players but not back to the sender", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל", "דנה"]);
    const effects = talk(h, "נאור", { presetId: "easy" });
    const sent = messagesOf(effects, "PLAYER_MESSAGE");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, "זה היה קל");
    assert.equal(sent[0].name, "נאור");
    const broadcast = effects.find((e) => e.kind === "broadcast")!;
    assert.equal(
      (broadcast as { exceptPlayerId?: string }).exceptPlayerId,
      h.ids["נאור"],
      "your own jibe popping up over your own scoreboard reads as a bug"
    );
  });

  it("resolves the preset server-side, ignoring any text sent with it", () => {
    // The wire carries an id, never the sentence, so a preset cannot become a
    // channel for something else.
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const sent = messagesOf(
      talk(h, "נאור", { presetId: "var", text: "<script>alert(1)</script>" }),
      "PLAYER_MESSAGE"
    );
    assert.equal(sent[0].text, "VAR בבקשה");
  });

  it("sends a custom message", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const sent = messagesOf(talk(h, "נאור", { text: "נראה אותך בשאלה הבאה" }), "PLAYER_MESSAGE");
    assert.equal(sent[0].text, "נראה אותך בשאלה הבאה");
  });

  it("attributes the message to the socket that sent it, not to the payload", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const spoofed = h.engine.handle(
      h.ids["נאור"],
      {
        type: "SEND_MESSAGE",
        presetId: "easy" as never,
        text: null,
        // Extra fields a hostile client might add to claim another identity.
        ...({ playerId: h.ids["יובל"], name: "יובל" } as object),
      } as ClientMessage,
      h.t
    );
    const sent = messagesOf(spoofed, "PLAYER_MESSAGE");
    assert.equal(sent[0].playerId, h.ids["נאור"]);
    assert.equal(sent[0].name, "נאור");
  });

  it("strips markup and control characters rather than trusting the renderer", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const sent = messagesOf(talk(h, "נאור", { text: "hi <b>there</b> bye" }), "PLAYER_MESSAGE");
    assert.equal(sent.length, 1, "the message should still be delivered");
    for (const character of ["<", ">"]) {
      assert.ok(!sent[0].text.includes(character), `${character} survived sanitising: ${sent[0].text}`);
    }
  });

  it("strips a bidi override, which in an RTL product can reorder the line", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const sent = messagesOf(talk(h, "נאור", { text: "abc‮def" }), "PLAYER_MESSAGE");
    assert.ok(!sent[0].text.includes("‮"));
  });

  it("refuses a message over the length limit instead of truncating it", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const effects = talk(h, "נאור", { text: "א".repeat(MESSAGE_MAX_LENGTH + 1) });
    assert.deepEqual(messagesOf(effects, "PLAYER_MESSAGE"), []);
    assert.deepEqual(errorsFor(effects, h.ids["נאור"]), ["INVALID_MESSAGE"]);
  });

  it("accepts a message exactly at the limit", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const sent = messagesOf(talk(h, "נאור", { text: "א".repeat(MESSAGE_MAX_LENGTH) }), "PLAYER_MESSAGE");
    assert.equal(sent.length, 1);
  });

  it("blocks obvious abuse", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const effects = talk(h, "נאור", { text: "you fuck" });
    assert.deepEqual(messagesOf(effects, "PLAYER_MESSAGE"), []);
    assert.deepEqual(errorsFor(effects, h.ids["נאור"]), ["INVALID_MESSAGE"]);
  });

  it("blocks abuse spelled with padding", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    assert.deepEqual(messagesOf(talk(h, "נאור", { text: "f u c k you" }), "PLAYER_MESSAGE"), []);
  });

  it("rate limits within the cooldown", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    assert.equal(messagesOf(talk(h, "נאור", { presetId: "easy" }), "PLAYER_MESSAGE").length, 1);
    const second = talk(h, "נאור", { presetId: "lucky" }, h.t + MESSAGE_COOLDOWN_MS - 1);
    assert.deepEqual(messagesOf(second, "PLAYER_MESSAGE"), []);
    assert.deepEqual(errorsFor(second, h.ids["נאור"]), ["RATE_LIMITED"]);
  });

  it("allows another message once the cooldown has passed", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    talk(h, "נאור", { presetId: "easy" });
    const later = talk(h, "נאור", { presetId: "lucky" }, h.t + MESSAGE_COOLDOWN_MS);
    assert.equal(messagesOf(later, "PLAYER_MESSAGE").length, 1);
  });

  it("caps messages per question even when the cooldown is respected", () => {
    // The cooldown alone still allows a steady drip for a whole 30-second question.
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    let at = h.t;
    let delivered = 0;
    for (let i = 0; i < MESSAGE_MAX_PER_QUESTION + 2; i++) {
      delivered += messagesOf(talk(h, "נאור", { presetId: "easy" }, at), "PLAYER_MESSAGE").length;
      at += MESSAGE_COOLDOWN_MS;
    }
    assert.equal(delivered, MESSAGE_MAX_PER_QUESTION);
  });

  it("in a duel the message reaches only the opponent", () => {
    const h = room("DUEL", ["נאור", "יובל"]);
    const effects = talk(h, "נאור", { presetId: "didnt_see" });
    assert.deepEqual(
      effects.filter((e) => e.kind === "broadcast"),
      [],
      "a duel jibe is between the two of them, not announced to the room"
    );
    const targeted = effects.filter((e) => e.kind === "send" && e.message.type === "PLAYER_MESSAGE");
    assert.equal(targeted.length, 1);
    assert.equal((targeted[0] as { playerId: string }).playerId, h.ids["יובל"]);
  });

  it("a player who has not joined cannot send anything", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const effects = h.engine.handle(
      "not-a-player",
      { type: "SEND_MESSAGE", presetId: "easy" as never, text: null },
      h.t
    );
    assert.deepEqual(messagesOf(effects, "PLAYER_MESSAGE"), []);
  });

  it("does not touch scores or the game phase", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const phaseBefore = h.engine.state.phase;
    const scoresBefore = h.engine.state.players.map((p) => p.score);
    talk(h, "נאור", { presetId: "warming_up" });
    assert.equal(h.engine.state.phase, phaseBefore);
    assert.deepEqual(
      h.engine.state.players.map((p) => p.score),
      scoresBefore
    );
  });

  it("is never persisted, so a reconnect cannot replay it", () => {
    const h = room("CLASSIC_BATTLE", ["נאור", "יובל"]);
    const effects = talk(h, "נאור", { presetId: "easy" });
    assert.deepEqual(
      effects.filter((e) => e.kind === "persist"),
      []
    );

    // Rejoining replays the room state, and that state carries no message history.
    const rejoin = h.engine.join("token-יובל", "יובל", h.t + 1);
    const state = messagesOf(rejoin.effects, "ROOM_STATE");
    assert.ok(state.length > 0, "expected the room state to be sent on rejoin");
    assert.ok(
      !JSON.stringify(state).includes("זה היה קל"),
      "an ephemeral jibe must not come back with the room state"
    );
  });
});
