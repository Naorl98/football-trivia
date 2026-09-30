import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  damerauLevenshtein,
  isAnswerCorrect,
  matchAnswer,
  normalizeAnswer,
  typoBudget,
} from "../src/shared/answerMatching.ts";

const vinicius = {
  canonical: "Vinícius Júnior",
  aliases: ["Vinicius", "Vinícius", "Vini Jr", "Vini", "Vinicius Jr", "ויניסיוס", "ויני"],
};

const messi = { canonical: "Lionel Messi", aliases: ["Messi", "ליאו מסי", "מסי", "Leo Messi"] };

const psg = {
  canonical: "Paris Saint-Germain",
  aliases: ["PSG", "Paris SG", "פריז סן ז'רמן", "פ.ס.ז'"],
};

const kane = { canonical: "Kane", aliases: ["Harry Kane", "קיין"] };

describe("normalizeAnswer", () => {
  test("lowercases", () => {
    assert.equal(normalizeAnswer("VINICIUS"), "vinicius");
  });

  test("strips Latin diacritics", () => {
    assert.equal(normalizeAnswer("Vinícius Júnior"), "vinicius junior");
    assert.equal(normalizeAnswer("Mbappé"), "mbappe");
    assert.equal(normalizeAnswer("Håland"), "haland");
  });

  test("strips Hebrew niqqud", () => {
    assert.equal(normalizeAnswer("מֶסִי"), "מסי");
  });

  test("normalizes punctuation to spaces", () => {
    assert.equal(normalizeAnswer("Paris Saint-Germain"), "paris saint germain");
    assert.equal(normalizeAnswer("Paris Saint Germain"), "paris saint germain");
    assert.equal(normalizeAnswer("N'Golo Kanté"), "n golo kante");
  });

  test("normalizes Hebrew geresh variants identically", () => {
    assert.equal(normalizeAnswer("פריז סן ז'רמן"), normalizeAnswer("פריז סן ז׳רמן"));
  });

  test("collapses whitespace", () => {
    assert.equal(normalizeAnswer("  Vini   Jr  "), "vini jr");
  });

  test("handles empty input", () => {
    assert.equal(normalizeAnswer(""), "");
    assert.equal(normalizeAnswer("   "), "");
  });
});

describe("damerauLevenshtein", () => {
  test("identical strings are distance 0", () => {
    assert.equal(damerauLevenshtein("vinicius", "vinicius"), 0);
  });

  test("counts a substitution as 1", () => {
    assert.equal(damerauLevenshtein("vinicius", "vinicious"), 1);
  });

  test("counts an adjacent transposition as 1, not 2", () => {
    assert.equal(damerauLevenshtein("vinicuis", "vinicius"), 1);
  });

  test("counts an insertion as 1", () => {
    assert.equal(damerauLevenshtein("viniciuss", "vinicius"), 1);
  });

  test("respects the early-exit ceiling", () => {
    assert.ok(damerauLevenshtein("messi", "ronaldo", 1) > 1);
  });
});

describe("typoBudget scales with length", () => {
  test("very short answers are strict", () => {
    assert.equal(typoBudget("kane"), 0);
    assert.equal(typoBudget("psg"), 0);
  });

  test("medium answers allow one edit", () => {
    assert.equal(typoBudget("messi"), 1);
  });

  test("longer answers allow more", () => {
    assert.equal(typoBudget("vinicius"), 2);
    assert.equal(typoBudget("vinicius junior"), 3);
  });
});

describe("exact and alias matching", () => {
  test("accepts the canonical answer", () => {
    const result = matchAnswer("Vinícius Júnior", vinicius);
    assert.equal(result.correct, true);
    assert.equal(result.kind, "exact");
  });

  test("accepts an accented alias", () => {
    assert.equal(isAnswerCorrect("Vinícius", vinicius), true);
  });

  test("accepts the unaccented spelling", () => {
    assert.equal(isAnswerCorrect("Vinicius", vinicius), true);
  });

  test("is case-insensitive in both directions", () => {
    assert.equal(isAnswerCorrect("vinicius", vinicius), true);
    assert.equal(isAnswerCorrect("VINICIUS", vinicius), true);
    assert.equal(isAnswerCorrect("ViNiCiUs", vinicius), true);
  });

  test("accepts short-form aliases", () => {
    assert.equal(isAnswerCorrect("Vini", vinicius), true);
    assert.equal(isAnswerCorrect("Vini Jr", vinicius), true);
    assert.equal(isAnswerCorrect("Vinicius Jr", vinicius), true);
  });

  test("accepts Hebrew aliases", () => {
    assert.equal(isAnswerCorrect("ויניסיוס", vinicius), true);
    assert.equal(isAnswerCorrect("ויני", vinicius), true);
  });

  test("accepts surnames that are declared aliases", () => {
    assert.equal(isAnswerCorrect("Messi", messi), true);
    assert.equal(isAnswerCorrect("מסי", messi), true);
  });

  test("ignores surrounding whitespace", () => {
    assert.equal(isAnswerCorrect("   Messi   ", messi), true);
  });

  test("reports which form was matched", () => {
    assert.equal(matchAnswer("Vini Jr", vinicius).matchedAgainst, "Vini Jr");
  });
});

describe("punctuation differences", () => {
  test("hyphen vs space", () => {
    assert.equal(isAnswerCorrect("Paris Saint Germain", psg), true);
    assert.equal(isAnswerCorrect("Paris Saint-Germain", psg), true);
  });

  test("abbreviation alias", () => {
    assert.equal(isAnswerCorrect("PSG", psg), true);
    assert.equal(isAnswerCorrect("psg", psg), true);
  });

  test("Hebrew alias with punctuation", () => {
    assert.equal(isAnswerCorrect("פריז סן ז'רמן", psg), true);
    assert.equal(isAnswerCorrect("פריז סן ז׳רמן", psg), true);
  });
});

describe("token reordering", () => {
  test("accepts reordered name parts", () => {
    assert.equal(isAnswerCorrect("Junior Vinicius", vinicius), true);
    assert.equal(matchAnswer("Junior Vinicius", vinicius).kind, "token");
  });
});

describe("tolerated typos", () => {
  for (const typo of ["Viniciuos", "Vinicious", "Vinicuis", "Vinisius", "vinicus"]) {
    test(`accepts "${typo}"`, () => {
      const result = matchAnswer(typo, vinicius);
      assert.equal(result.correct, true, `expected "${typo}" to match`);
      assert.equal(result.kind, "fuzzy");
    });
  }

  test("accepts a single slip in a medium-length name", () => {
    assert.equal(isAnswerCorrect("Mesi", messi), true);
  });

  test("accepts a slip in an accented name", () => {
    assert.equal(isAnswerCorrect("Mbape", { canonical: "Mbappé", aliases: ["Kylian Mbappé"] }), true);
  });
});

describe("rejections — the matcher must not be a pushover", () => {
  test("rejects a different famous player", () => {
    assert.equal(isAnswerCorrect("Ronaldo", vinicius), false);
    assert.equal(isAnswerCorrect("Rodrygo", vinicius), false);
    assert.equal(isAnswerCorrect("Neymar", messi), false);
  });

  test("rejects a different club", () => {
    assert.equal(isAnswerCorrect("Real Madrid", psg), false);
    assert.equal(isAnswerCorrect("Paris FC", psg), false);
  });

  test("rejects empty and whitespace input", () => {
    assert.equal(isAnswerCorrect("", vinicius), false);
    assert.equal(isAnswerCorrect("     ", vinicius), false);
    assert.equal(isAnswerCorrect("\t\n", vinicius), false);
  });

  test("rejects arbitrary substrings of the canonical answer", () => {
    // "Junior" is part of "Vinícius Júnior" but is not a declared alias and
    // identifies nobody on its own.
    assert.equal(isAnswerCorrect("Junior", vinicius), false);
    assert.equal(isAnswerCorrect("Vin", vinicius), false);
    assert.equal(isAnswerCorrect("us", vinicius), false);
  });

  test("rejects a one-letter change on a very short answer", () => {
    // Budget is 0 at this length, so near-misses stay wrong.
    assert.equal(isAnswerCorrect("Kang", kane), false);
    assert.equal(isAnswerCorrect("Lane", kane), false);
  });

  test("rejects near-miss club abbreviations", () => {
    assert.equal(isAnswerCorrect("PSV", psg), false);
  });

  test("rejects two different players whose names are close", () => {
    const zidane = { canonical: "Zidane", aliases: ["Zinedine Zidane", "זידאן"] };
    assert.equal(isAnswerCorrect("Zidane", zidane), true);
    assert.equal(isAnswerCorrect("Zidan", zidane), true); // one slip, 6 chars -> allowed
    assert.equal(isAnswerCorrect("Kroos", zidane), false);
  });

  test("rejects an unrelated Hebrew name", () => {
    assert.equal(isAnswerCorrect("רונאלדו", messi), false);
  });

  test("handles a spec with no usable answers", () => {
    assert.equal(isAnswerCorrect("anything", { canonical: "", aliases: [] }), false);
  });
});

describe("real-world football cases", () => {
  const cases: { spec: { canonical: string; aliases: string[] }; accept: string[]; reject: string[] }[] = [
    {
      spec: { canonical: "Cristiano Ronaldo", aliases: ["Ronaldo", "CR7", "כריסטיאנו רונאלדו", "רונאלדו"] },
      accept: ["Cristiano Ronaldo", "ronaldo", "CR7", "רונאלדו", "Cristiano Ronald"],
      reject: ["Ronaldinho", "Ronaldo Nazario", "Messi"],
    },
    {
      spec: { canonical: "Manchester United", aliases: ["Man United", "Man Utd", "מנצ'סטר יונייטד", "יונייטד"] },
      accept: ["Manchester United", "man utd", "מנצ'סטר יונייטד", "Manchster United"],
      reject: ["Manchester City", "מנצ'סטר סיטי"],
    },
    {
      spec: { canonical: "Erling Haaland", aliases: ["Haaland", "Holland", "הולנד", "ארלינג הולנד"] },
      accept: ["Haaland", "haaland", "Halland", "הולנד"],
      reject: ["Kane", "Mbappe"],
    },
  ];

  for (const { spec, accept, reject } of cases) {
    for (const value of accept) {
      test(`${spec.canonical} accepts "${value}"`, () => {
        assert.equal(isAnswerCorrect(value, spec), true, `expected "${value}" to be accepted`);
      });
    }
    for (const value of reject) {
      test(`${spec.canonical} rejects "${value}"`, () => {
        assert.equal(isAnswerCorrect(value, spec), false, `expected "${value}" to be rejected`);
      });
    }
  }
});
