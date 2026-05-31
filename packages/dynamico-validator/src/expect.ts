/**
 * Tiny expectation helper. We avoid pulling in Jest/Vitest because tests run
 * inside the registry's worker thread — the smaller the dependency surface,
 * the lower the cold-start cost.
 *
 * Failed expectations throw — the runner catches the throw and reports it as
 * the rejection reason for the push.
 */
export interface Expectation<T> {
  toBe(expected: T): void;
  toEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toMatch(pattern: string | RegExp): void;
  toThrow(): void;
}

export function expect<T>(actual: T): Expectation<T> {
  return {
    toBe(expected) {
      if (!Object.is(actual, expected)) {
        throw new Error(`expected ${stringify(actual)} to be ${stringify(expected)}`);
      }
    },
    toEqual(expected) {
      if (!deepEqual(actual, expected)) {
        throw new Error(`expected ${stringify(actual)} to equal ${stringify(expected)}`);
      }
    },
    toBeTruthy() {
      if (!actual) throw new Error(`expected ${stringify(actual)} to be truthy`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`expected ${stringify(actual)} to be falsy`);
    },
    toMatch(pattern) {
      if (typeof actual !== "string") {
        throw new Error(`expected ${stringify(actual)} to be a string`);
      }
      const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
      if (!re.test(actual)) {
        throw new Error(`expected ${stringify(actual)} to match ${pattern}`);
      }
    },
    toThrow() {
      if (typeof actual !== "function") {
        throw new Error(`toThrow() requires a function`);
      }
      let threw = false;
      try { (actual as () => unknown)(); } catch { threw = true; }
      if (!threw) throw new Error(`expected function to throw`);
    },
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

function stringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}
