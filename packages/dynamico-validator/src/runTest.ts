import * as React from "react";
import { loadModule, type Scope } from "@omriashke/dynamico-core";
import * as RNMock from "./mocks/react-native.js";
import * as SafeAreaMock from "./mocks/safe-area-context.js";

export interface RunTestInput {
  /** Component name (e.g. "HomeScreen"). Only used in error messages. */
  name: string;
  /** Compiled CommonJS code for the component itself. */
  componentCode: string;
  /** Compiled CommonJS code for the .test.tsx file. */
  testCode: string;
  /**
   * Optional explicit scope provided by the registry. The runner merges this
   * over its built-in defaults (react, react-native, safe-area-context).
   * Pass anything the registry knows the host will provide; everything else
   * is auto-stubbed with an empty object.
   */
  hostScope?: Scope;
  /**
   * Optional whitelist of bare specifiers the production host will provide
   * via DynamicoProvider scope. When set, any component import that resolves
   * to a specifier OUTSIDE this list causes the test to fail with phase
   * "scope" — mirroring the runtime error the user would see on device.
   * Relative imports (./, ../) are not checked.
   *
   * Pass the keys of the host's scope object. If undefined, the test runner
   * auto-stubs unknown modules (permissive — useful for v1 onboarding).
   */
  allowedScope?: readonly string[];
  /**
   * Maximum wall-clock time the test may take, in ms. Default 5000. The
   * registry's worker enforces this by terminating the worker on timeout;
   * this field exists so authors can opt INTO faster timeouts, not slower.
   */
  timeoutMs?: number;
}

export interface RunTestResult {
  ok: boolean;
  durationMs: number;
  /** When ok=false, the message thrown by the test (or load failure). */
  error?: {
    message: string;
    stack?: string;
    /** Which phase failed: 'load' (require), 'test' (test threw), or 'no-default-export'. */
    phase: "load" | "scope" | "test" | "no-default-export" | "no-test-export";
  };
}

const BUILT_IN_SCOPE: Scope = {
  react: React,
  "react-native": RNMock,
  "react-native-safe-area-context": SafeAreaMock,
};

/**
 * Test-time scope override. Tests can call setHostScope({...}) at the top of
 * their default async function to provide real return shapes for hooks that
 * the auto-stub can't fake convincingly.
 *
 * Resets between tests because each test runs in a fresh worker thread.
 */
let mutableHostScope: Scope = {};
export function setHostScope(scope: Scope): void {
  mutableHostScope = { ...mutableHostScope, ...scope };
}
export function getHostScope(): Scope {
  return mutableHostScope;
}

/**
 * Auto-stub policy: if a component require()s a key that isn't in BUILT_IN_SCOPE
 * and isn't in the registry-supplied hostScope, return an empty object. This
 * keeps tests authoring lightweight: a component that imports
 * `@newscast/app-hooks` and only ever calls `useFeed()` from it will get
 * `useFeed === undefined`, which the test author surfaces explicitly when they
 * pass a real stub via hostScope.
 *
 * The empty-object stub is wrapped in a Proxy so that `pkg.someThing` returns
 * an empty function (not undefined), preventing "X is not a function" errors
 * for callable shapes the test doesn't care about. This is the right default
 * for a smoke test: "the component renders and doesn't throw, given that
 * nothing in the host scope returns anything interesting".
 */
/**
 * Build a scope where each module is a Proxy that resolves *every* property
 * access lazily. Resolution order at access time:
 *   1. mutableHostScope[moduleName][key]   (test-time override via setHostScope)
 *   2. registry-supplied hostScope[moduleName][key]
 *   3. BUILT_IN_SCOPE[moduleName][key]     (react, react-native, ...)
 *   4. deep no-op stub
 *
 * This means setHostScope() works even AFTER the component has been loaded,
 * because the destructured `useFeed` (or whatever) is itself a Proxy-callable
 * that re-resolves on every invocation.
 */
function makeAutoStubScope(
  _componentExports: unknown,
  hostScope: Scope,
  allowedScope?: readonly string[],
): Scope {
  const builtIn = BUILT_IN_SCOPE;
  const supplied = hostScope;
  // When allowedScope is provided, the runner mirrors the production loader's
  // strictness: any specifier not in the union of {allowedScope, BUILT_IN_SCOPE,
  // hostScope, '__component__'} causes the loader's `name in scope` check to
  // return false and throw "is not in host scope" — exactly what the device
  // would see at runtime.
  const allowedSet = allowedScope
    ? new Set<string>([
        ...allowedScope,
        ...Object.keys(builtIn),
        ...Object.keys(supplied),
      ])
    : undefined;

  const lookupModule = (moduleName: string): unknown =>
    mutableHostScope[moduleName] ?? supplied[moduleName] ?? builtIn[moduleName];

  // For modules that have a real value (e.g. 'react' = React), we want to
  // read straight through. We only Proxy the *unknown* modules — modules that
  // either don't have a hostScope entry or are user packages where hooks may
  // be overridden via setHostScope at test time.
  //
  // Strategy: ALWAYS go through a Proxy. If the underlying module exists, the
  // Proxy reads from it; if not, fall back to deep stubs. This lets a test
  // override individual exports of even the built-in 'react-native' if it
  // really wants to, while keeping the common case (no override) trivially
  // pass-through.
  const moduleProxyCache = new Map<string, unknown>();
  const moduleProxyFor = (moduleName: string): unknown => {
    const cached = moduleProxyCache.get(moduleName);
    if (cached) return cached;

    // Use a callable target so the Proxy is also callable (some modules are
    // CommonJS exports that are themselves functions, e.g. some libraries).
    const target = function moduleStub() { /* see apply trap */ };

    const prop = (key: PropertyKey): unknown => {
      // Symbol props (Symbol.iterator etc.) — only meaningful when the
      // underlying real module has them; otherwise undefined.
      if (typeof key === "symbol") {
        const real = lookupModule(moduleName) as Record<PropertyKey, unknown> | undefined;
        return real ? real[key] : undefined;
      }

      // Test-time override (setHostScope) wins over everything.
      const override = (mutableHostScope[moduleName] as Record<string, unknown> | undefined);
      if (override && Object.prototype.hasOwnProperty.call(override, key)) {
        return override[key as string];
      }

      // Registry-supplied scope.
      const fromSupplied = (supplied[moduleName] as Record<string, unknown> | undefined);
      if (fromSupplied && Object.prototype.hasOwnProperty.call(fromSupplied, key)) {
        return fromSupplied[key as string];
      }

      // Built-in scope (real react, react-native mock, etc.).
      const fromBuiltIn = (builtIn[moduleName] as Record<string, unknown> | undefined);
      if (fromBuiltIn && Object.prototype.hasOwnProperty.call(fromBuiltIn, key)) {
        return fromBuiltIn[key as string];
      }

      // Special CommonJS interop properties.
      if (key === "__esModule") return true;
      if (key === "default") return moduleProxyFor(moduleName);

      // Final fallback: a deep no-op stub. Crucially this is wrapped so it
      // checks mutableHostScope on EACH call (so the test can override the
      // *callable's* return value via setHostScope at any point).
      return makeLiveStub(moduleName, String(key));
    };

    const proxy = new Proxy(target, {
      get(_t, key: PropertyKey): unknown {
        return prop(key);
      },
      has() { return true; },
    });
    moduleProxyCache.set(moduleName, proxy);
    return proxy;
  };

  return new Proxy(
    {} as Record<string, unknown>,
    {
      get(_t, key: string): unknown {
        return moduleProxyFor(key);
      },
      has(_t, key: PropertyKey): boolean {
        if (allowedSet && typeof key === "string") {
          return allowedSet.has(key);
        }
        return true;
      },
    },
  ) as Scope;
}

/**
 * A stub function that, on each call, re-checks mutableHostScope so that
 * `useFeed` (destructured at module-load time) still respects late
 * setHostScope() overrides set inside the test body.
 */
function makeLiveStub(moduleName: string, propName: string): unknown {
  const fn = function liveStub(...args: unknown[]) {
    const override = mutableHostScope[moduleName] as Record<string, unknown> | undefined;
    if (override && Object.prototype.hasOwnProperty.call(override, propName)) {
      const real = override[propName];
      if (typeof real === "function") {
        return (real as (...a: unknown[]) => unknown)(...args);
      }
      return real;
    }
    return makeStubModule(`${moduleName}.${propName}()`);
  };
  return new Proxy(fn, {
    get(_t, key: PropertyKey) {
      if (key === Symbol.toPrimitive) return (_hint: string) => "";
      if (typeof key === "symbol") return undefined;
      if (key === "__esModule") return true;
      if (key === "default") return fn;
      return makeStubModule(`${moduleName}.${propName}.${String(key)}`);
    },
    has() { return true; },
  });
}

const stubCache = new Map<string, unknown>();

/**
 * Make a Proxy that's plausibly anything: callable, indexable, iterable as an
 * empty array, destructurable into more stubs.
 *
 * Why so flexible? Tests for screens never want to fully simulate the host's
 * data layer — they want to know the screen MOUNTS without throwing given
 * "boring" data. So `useFeed()` returns this stub; destructuring
 * `{ articles }` gives back another stub; `articles.map(x => ...)` returns
 * `[]`; `.length === 0`. Real return shapes can be supplied explicitly via
 * setHostScope() when the test cares.
 */
function makeStubModule(name: string): unknown {
  if (stubCache.has(name)) return stubCache.get(name);
  const noop = () => makeStubModule(`${name}()`);
  const stub: unknown = new Proxy(noop as unknown as object, {
    get(_t, key) {
      if (key === "__esModule") return true;
      if (key === "default") return stub;
      // Iterable protocol: pretend to be an empty array so `.map(...)`,
      // `for (const x of ...)`, and spread `[...]` all work.
      if (key === Symbol.iterator) return function* () { /* empty */ };
      if (key === Symbol.asyncIterator) return async function* () { /* empty */ };
      if (key === "length") return 0;
      if (key === "map" || key === "filter" || key === "forEach" || key === "reduce" || key === "flatMap") {
        return () => [];
      }
      if (key === "find" || key === "findIndex" || key === "indexOf" || key === "lastIndexOf") {
        return () => -1;
      }
      if (key === "some" || key === "every" || key === "includes") {
        return () => false;
      }
      if (key === "join" || key === "toString" || key === "toJSON") {
        return () => "";
      }
      if (key === "valueOf") {
        return () => 0;
      }
      if (key === "then" || key === "catch" || key === "finally") {
        // not a thenable — these are sometimes accessed by frameworks
        return undefined;
      }
      // Allow string/number/default coercion (e.g. `${stub}`, +stub) so stubs
      // can flow through StyleSheet.create and other code paths that touch
      // primitives. Returning undefined would also work for hint==="number"
      // but we prefer a stable empty string representation.
      if (key === Symbol.toPrimitive) return (_hint: string) => "";
      if (typeof key === "symbol") return undefined;
      return makeStubModule(`${name}.${String(key)}`);
    },
    apply() {
      return makeStubModule(`${name}()`);
    },
    construct() {
      return makeStubModule(`new ${name}()`) as object;
    },
    has() {
      return true;
    },
  });
  stubCache.set(name, stub);
  return stub;
}

export async function runTest(input: RunTestInput): Promise<RunTestResult> {
  const start = performance.now();

  // Phase 1: load the component module
  let componentExports: unknown;
  try {
    componentExports = loadModule(
      input.componentCode,
      makeAutoStubScope(undefined, input.hostScope ?? {}, input.allowedScope),
      (specifier) => {
        // Components may relative-import sibling components (`./Foo`) or
        // static assets (`../assets/loginImage.png`). The registry resolves
        // sibling components against its store, but in tests we don't have
        // the rest of the registry available, so we hand back a deep stub
        // for both. The component's behavior with a missing sibling is then
        // exactly the same as if the sibling rendered no UI.
        return makeStubModule(`relative:${specifier}`);
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Surface scope-misses with a clearer phase so the registry log/CLI
    // output makes it obvious the component needs a host scope addition.
    const phase = /is not in host scope/.test(msg) ? "scope" : "load";
    return {
      ok: false,
      durationMs: performance.now() - start,
      error: {
        phase,
        message: msg,
        stack: err instanceof Error ? err.stack : undefined,
      },
    };
  }

  const defaultExport = (componentExports as Record<string, unknown>)?.default ?? componentExports;
  if (typeof defaultExport !== "function") {
    return {
      ok: false,
      durationMs: performance.now() - start,
      error: {
        phase: "no-default-export",
        message: `component '${input.name}' has no default export of a function/class`,
      },
    };
  }

  // Phase 2: load the test module. The test imports the component via the
  // synthetic specifier '__component__' which we inject into scope.
  const testScope = makeAutoStubScope(componentExports, {
    ...(input.hostScope ?? {}),
    __component__: componentExports,
    "@omriashke/dynamico-validator": await import("./index.js"),
  });

  let testExports: unknown;
  try {
    testExports = loadModule(input.testCode, testScope, (specifier) => {
      // Resolve relative imports to the component (the typical pattern is
      // `import Foo from './Foo'` inside Foo.test.tsx).
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        return componentExports;
      }
      throw new Error(`unsupported relative import '${specifier}' in test`);
    });
  } catch (err) {
    return {
      ok: false,
      durationMs: performance.now() - start,
      error: {
        phase: "load",
        message: `test file failed to load: ${err instanceof Error ? err.message : String(err)}`,
        stack: err instanceof Error ? err.stack : undefined,
      },
    };
  }

  const testFn = (testExports as Record<string, unknown>)?.default;
  if (typeof testFn !== "function") {
    return {
      ok: false,
      durationMs: performance.now() - start,
      error: {
        phase: "no-test-export",
        message: `${input.name}.test.tsx must export default an async function (got ${typeof testFn})`,
      },
    };
  }

  // Phase 3: execute the test
  try {
    await (testFn as () => unknown | Promise<unknown>)();
  } catch (err) {
    return {
      ok: false,
      durationMs: performance.now() - start,
      error: {
        phase: "test",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    };
  }

  return { ok: true, durationMs: performance.now() - start };
}
