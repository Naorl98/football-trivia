import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { matchAnswer, normalizeAnswer } from "../src/shared/answerMatching.ts";
import { PLAYERS } from "../seed/data/players.ts";
import { CLUBS } from "../seed/data/clubs.ts";

/*
  Free-text answer matching, checked against the REAL dataset rather than
  hand-written fixtures — so a change to a player's aliases shows up here.

  The contract has two halves, and both matter:
    * every spelling a Hebrew-speaking fan would reasonably type is accepted
    * a different player or club is never accepted
  The second half is what keeps the first honest. Loosening the typo budget
  until everything passes would make the matcher useless.
*/

function playerSpec(id: string) {
  const player = PLAYERS.find((p) => p.id === id);
  if (!player) throw new Error(`player "${id}" is missing from the dataset`);
  return { canonical: player.he, aliases: [player.en, ...player.aliases] };
}

function clubSpec(id: string) {
  const club = CLUBS.find((c) => c.id === id);
  if (!club) throw new Error(`club "${id}" is missing from the dataset`);
  return { canonical: club.he, aliases: [club.en, ...club.aliases] };
}

function accepts(spec: { canonical: string; aliases: string[] }, input: string): boolean {
  return matchAnswer(input, spec).correct;
}

describe("Varane — the aleph problem", () => {
  const spec = playerSpec("varane");

  // All three spellings are in real use; the dataset's canonical is only one
  // of them, so the other two have to be reachable.
  for (const spelling of ["רפאל ורן", "רפאל וראן", "רפאל ואראן"]) {
    it(`accepts "${spelling}"`, () => {
      assert.ok(accepts(spec, spelling), `${spelling} should be accepted`);
    });
  }

  it("accepts the surname alone, in both scripts", () => {
    assert.ok(accepts(spec, "ורן"));
    assert.ok(accepts(spec, "וראן"));
    assert.ok(accepts(spec, "Varane"));
  });

  // The word that identifies the player is the short one, so the budget must
  // not let two edits land entirely on it while the long first name matches.
  it("rejects a same-first-name answer whose surname differs", () => {
    assert.ok(!accepts(spec, "רפאל לאאן"));
    assert.ok(!accepts(spec, "רפאל גררו"));
  });

  it("rejects every other player in the dataset", () => {
    const wrong = PLAYERS.filter((p) => p.id !== "varane" && accepts(spec, p.he)).map((p) => p.he);
    assert.deepEqual(wrong, []);
  });
});

describe("Vinícius — accents and nicknames", () => {
  const spec = playerSpec("vinicius");

  for (const spelling of ["Vinícius", "Vinicius", "ויניסיוס", "Vini Jr", "vinicius junior"]) {
    it(`accepts "${spelling}"`, () => {
      assert.ok(accepts(spec, spelling));
    });
  }

  it("normalizes Latin accents away", () => {
    assert.equal(normalizeAnswer("Vinícius Júnior"), "vinicius junior");
  });

  it("rejects a different Brazilian forward", () => {
    assert.ok(!accepts(spec, "Rodrygo"));
    assert.ok(!accepts(spec, "ריצ'רליסון"));
  });
});

describe("Paris Saint-Germain — abbreviations across scripts", () => {
  const spec = clubSpec("psg");

  for (const spelling of ["PSG", "psg", "Paris Saint-Germain", "paris saint germain", "פריז סן ז'רמן", "פריז סן זרמן"]) {
    it(`accepts "${spelling}"`, () => {
      assert.ok(accepts(spec, spelling));
    });
  }

  it("rejects another French club", () => {
    assert.ok(!accepts(spec, "Marseille"));
    assert.ok(!accepts(spec, "מונאקו"));
  });
});

describe("Manchester United — short forms", () => {
  const spec = clubSpec("man_utd");

  for (const spelling of ["Manchester United", "Man Utd", "Man United", "מנצ'סטר יונייטד", "מנצסטר יונייטד", "יונייטד"]) {
    it(`accepts "${spelling}"`, () => {
      assert.ok(accepts(spec, spelling));
    });
  }

  // The neighbours are the real test: these two differ by one word.
  it("rejects Manchester City", () => {
    assert.ok(!accepts(spec, "Manchester City"));
    assert.ok(!accepts(spec, "מנצ'סטר סיטי"));
  });
});

describe("typo tolerance stays bounded", () => {
  it("accepts realistic keyboard slips on long names", () => {
    const spec = clubSpec("liverpool");
    assert.ok(accepts(spec, "Livrpool"));
    assert.ok(accepts(spec, "Liverpoool"));
  });

  it("does not accept a short name that is one edit from another", () => {
    // Four characters: a single edit already reaches a different word, so the
    // budget at this length is deliberately zero.
    const spec = { canonical: "Kane", aliases: [] };
    assert.ok(accepts(spec, "Kane"));
    assert.ok(!accepts(spec, "Kang"));
    assert.ok(!accepts(spec, "Lane"));
  });

  it("never matches on a substring alone", () => {
    const spec = playerSpec("ronaldo_cr");
    // "Ronaldo" is accepted only because it is a declared alias...
    assert.ok(accepts(spec, "Ronaldo"));
    // ...while an unrelated longer string containing it is not.
    assert.ok(!accepts(spec, "Ronaldo Nazario de Lima"));
  });

  it("rejects empty and whitespace-only answers", () => {
    const spec = clubSpec("psg");
    assert.ok(!accepts(spec, ""));
    assert.ok(!accepts(spec, "   "));
  });

  it("false-positive sweep: no club answers for a different club", () => {
    // Every club, checked against every other club's canonical Hebrew name.
    const specs = CLUBS.map((c) => ({ id: c.id, spec: clubSpec(c.id) }));
    const collisions: string[] = [];
    for (const { id, spec } of specs) {
      for (const other of CLUBS) {
        if (other.id === id) continue;
        if (accepts(spec, other.he)) collisions.push(`${other.he} matched ${spec.canonical}`);
      }
    }
    assert.deepEqual(collisions, [], `fuzzy matching collided:\n${collisions.join("\n")}`);
  });

  it("false-positive sweep: no player answers for a different player", () => {
    const specs = PLAYERS.map((p) => ({ id: p.id, spec: playerSpec(p.id) }));
    const collisions: string[] = [];
    for (const { id, spec } of specs) {
      for (const other of PLAYERS) {
        if (other.id === id) continue;
        if (accepts(spec, other.he)) collisions.push(`${other.he} matched ${spec.canonical}`);
      }
    }
    assert.deepEqual(collisions, [], `fuzzy matching collided:\n${collisions.join("\n")}`);
  });
});
