import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CONSENT_STORAGE_KEY,
  ConsentStore,
  DEFAULT_CONSENT,
  KEYS_BY_CATEGORY,
  grantedCategories,
  keysToPurge,
  parseConsent,
  type StorageLike,
} from "../src/client/lib/privacy.ts";

/** An in-memory Storage, so the store is testable without a browser. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: StorageLike & { snapshot(): Record<string, string> } = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    snapshot: () => Object.fromEntries(map),
  };
  return storage;
}

describe("parseConsent", () => {
  it("treats a missing record as nothing granted and nothing decided", () => {
    assert.deepEqual(parseConsent(null), DEFAULT_CONSENT);
  });

  it("falls back safely on junk rather than guessing", () => {
    for (const junk of ["", "not json", "[]", "null", '"yes"', "42"]) {
      assert.deepEqual(parseConsent(junk), DEFAULT_CONSENT, `input: ${junk}`);
    }
  });

  it("only accepts a literal true — never a truthy value", () => {
    const state = parseConsent(JSON.stringify({ decided: 1, preferences: "yes", history: true }));
    assert.equal(state.decided, false);
    assert.equal(state.preferences, false);
    assert.equal(state.history, true);
  });

  it("ignores unknown fields from a future version", () => {
    const state = parseConsent(JSON.stringify({ decided: true, history: true, marketing: true }));
    assert.deepEqual(state, { decided: true, preferences: false, history: true });
  });
});

describe("grantedCategories", () => {
  it("always includes essential", () => {
    assert.deepEqual(grantedCategories(DEFAULT_CONSENT), ["essential"]);
  });

  it("lists exactly what was granted", () => {
    assert.deepEqual(grantedCategories({ decided: true, preferences: true, history: false }), [
      "essential",
      "preferences",
    ]);
    assert.deepEqual(grantedCategories({ decided: true, preferences: true, history: true }), [
      "essential",
      "preferences",
      "history",
    ]);
  });
});

describe("keysToPurge", () => {
  it("purges nothing when consent only widens", () => {
    const purge = keysToPurge(
      { decided: true, preferences: false, history: false },
      { decided: true, preferences: true, history: true }
    );
    assert.deepEqual(purge, { local: [], session: [] });
  });

  it("purges a category's keys when it is withdrawn", () => {
    const purge = keysToPurge(
      { decided: true, preferences: true, history: true },
      { decided: true, preferences: true, history: false }
    );
    assert.deepEqual(purge.local, KEYS_BY_CATEGORY.history.local);
  });

  it("never purges essential keys", () => {
    const purge = keysToPurge(
      { decided: true, preferences: true, history: true },
      { decided: true, preferences: false, history: false }
    );
    for (const key of KEYS_BY_CATEGORY.essential.session) {
      assert.ok(!purge.session.includes(key), `${key} must survive — it is the running game`);
    }
  });
});

describe("ConsentStore", () => {
  it("grants essential without being asked, and nothing else", () => {
    const store = new ConsentStore(fakeStorage(), fakeStorage());
    assert.equal(store.allows("essential"), true);
    assert.equal(store.allows("preferences"), false);
    assert.equal(store.allows("history"), false);
  });

  it("restores a previous decision from storage", () => {
    const local = fakeStorage({
      [CONSENT_STORAGE_KEY]: JSON.stringify({ decided: true, preferences: true, history: false }),
    });
    const store = new ConsentStore(local, fakeStorage());
    assert.equal(store.get().decided, true);
    assert.equal(store.allows("preferences"), true);
    assert.equal(store.allows("history"), false);
  });

  it("marks the visitor as decided once they answer, even rejecting everything", () => {
    const store = new ConsentStore(fakeStorage(), fakeStorage());
    store.rejectOptional();
    assert.equal(store.get().decided, true, "a rejection is still an answer — do not re-ask");
    assert.equal(store.allows("history"), false);
  });

  // This is the part a banner usually fakes: withdrawing consent has to delete
  // what was already stored, not merely stop future writes.
  it("deletes a category's data the moment consent is withdrawn", () => {
    const local = fakeStorage({
      [CONSENT_STORAGE_KEY]: JSON.stringify({ decided: true, preferences: true, history: true }),
      fiq_sound_enabled: "false",
      fiq_recent_questions: "[1,2,3]",
    });
    const store = new ConsentStore(local, fakeStorage());

    store.set({ preferences: true, history: false });

    assert.equal(local.getItem("fiq_recent_questions"), null, "history data should be gone");
    assert.equal(local.getItem("fiq_sound_enabled"), "false", "preferences data should remain");
  });

  it("leaves the running game alone when optional consent is withdrawn", () => {
    const session = fakeStorage({ fiq_active_quiz: '{"startedAt":1}' });
    const local = fakeStorage({
      [CONSENT_STORAGE_KEY]: JSON.stringify({ decided: true, preferences: true, history: true }),
    });
    const store = new ConsentStore(local, session);

    store.rejectOptional();

    assert.equal(session.getItem("fiq_active_quiz"), '{"startedAt":1}');
  });

  it("clearAllData removes every key it owns, including the consent record", () => {
    const local = fakeStorage({
      [CONSENT_STORAGE_KEY]: JSON.stringify({ decided: true, preferences: true, history: true }),
      fiq_sound_enabled: "true",
      fiq_recent_questions: "[9]",
      unrelated_key: "keep me",
    });
    const session = fakeStorage({ fiq_active_quiz: "{}", fiq_last_result: "{}", fiq_intro_seen: "true" });
    const store = new ConsentStore(local, session);

    store.clearAllData();

    assert.deepEqual(local.snapshot(), { unrelated_key: "keep me" }, "must not touch keys it does not own");
    assert.deepEqual(session.snapshot(), {});
    assert.equal(store.get().decided, false, "the visitor should be asked again");
  });

  it("notifies subscribers on every change and stops after unsubscribe", () => {
    const store = new ConsentStore(fakeStorage(), fakeStorage());
    const seen: boolean[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.history));

    store.acceptAll();
    store.rejectOptional();
    unsubscribe();
    store.acceptAll();

    assert.deepEqual(seen, [true, false]);
  });

  it("survives storage that throws on write", () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    const store = new ConsentStore(hostile, fakeStorage());
    assert.doesNotThrow(() => store.acceptAll());
    // The choice still applies for this session.
    assert.equal(store.allows("history"), true);
  });
});
