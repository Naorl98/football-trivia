// Browser storage, treated as hostile.
//
// Every assumption the app used to make about storage is false somewhere:
//
//   it exists            `sessionStorage` is undefined in some embedded
//                        webviews
//   accessing it is safe Safari with "Block all cookies" throws SecurityError
//                        — "The operation is insecure." — on the GETTER, before
//                        any method is called
//   writing it is safe   iOS private browsing throws QuotaExceededError on
//                        setItem with a quota of zero
//   what comes back is   it is whatever was last written, by whatever version of
//   what we wrote        the app was running then, or by anything else with
//                        access to the origin
//
// The first three were reproduced against production and were a release blocker:
// with storage access refused, /play and /results threw inside render, React 19
// unmounted the root, and the page went blank with no message. `privacy.ts`
// already had a careful wrapper for exactly this; `quizSession.ts` did not, and
// used the global objects directly.
//
// The fourth one is the subtler half. `JSON.parse` inside a try/catch only
// defends against text that is not JSON. `[]` parses perfectly and then throws
// one property access later, which is how a corrupted key produced the same
// blank screen — also reproduced, with seven of nine junk payloads taking out
// /play or /results.
//
// So: reads are wrapped AND validated, and a value that does not match the shape
// the caller asked for is treated as absent. "Absent" is always a state the app
// can handle, because it is the state every visitor starts in.

export interface SafeStore {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
  /** False when storage is unavailable, so a caller can skip work rather than guess. */
  readonly available: boolean;
}

/**
 * Wraps one Storage object.
 *
 * `pick` is a function rather than the storage itself because reading
 * `window.sessionStorage` is the operation that throws — passing it as an
 * argument would throw at the call site, before this function could help.
 */
function wrap(pick: () => Storage | undefined): SafeStore {
  let probed = false;
  let usable = false;

  function storage(): Storage | null {
    try {
      const store = pick();
      return store ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Can we actually write?
   *
   * Done once, lazily, and never at module load: the probe costs a write, and
   * doing it while the first render is on the critical path is exactly the kind
   * of startup work that should not be there.
   */
  function check(): boolean {
    if (probed) return usable;
    probed = true;
    const store = storage();
    if (!store) {
      usable = false;
      return false;
    }
    try {
      const probe = "__fiq_probe__";
      store.setItem(probe, "1");
      store.removeItem(probe);
      usable = true;
    } catch {
      // Readable but not writable is the iOS private-mode case. Treated as
      // unavailable, because a preference that cannot be saved is better handled
      // in memory than written to something that throws on every attempt.
      usable = false;
    }
    return usable;
  }

  return {
    get available() {
      return check();
    },
    get(key) {
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        const store = storage();
        if (!store) return false;
        store.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        storage()?.removeItem(key);
      } catch {
        /* nothing stored, nothing to remove */
      }
    },
  };
}

export const safeLocal = wrap(() => (typeof localStorage === "undefined" ? undefined : localStorage));
export const safeSession = wrap(() => (typeof sessionStorage === "undefined" ? undefined : sessionStorage));

/**
 * Reads a key, parses it, and hands it to a validator that has to say yes.
 *
 * The validator is the point. Returning `JSON.parse(raw) as T` is a lie the type
 * checker cannot catch and the browser finds out about later, one property
 * access at a time; a predicate makes the shape an actual runtime condition.
 * Anything that fails — unreadable, unparseable, or parsed but wrong — comes
 * back null, and the stored value is dropped so the next load does not pay for
 * it again.
 */
export function readJson<T>(store: SafeStore, key: string, isValid: (value: unknown) => value is T): T | null {
  const raw = store.get(key);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    store.remove(key);
    return null;
  }

  if (!isValid(parsed)) {
    // Almost always a value written by an older version of the app whose shape
    // has since changed. Clearing it is the migration.
    store.remove(key);
    return null;
  }

  return parsed;
}

/** Writes JSON. Returns false when storage refused it, which is never an error here. */
export function writeJson(store: SafeStore, key: string, value: unknown): boolean {
  try {
    return store.set(key, JSON.stringify(value));
  } catch {
    // JSON.stringify itself can throw — a circular reference, or a BigInt.
    return false;
  }
}
