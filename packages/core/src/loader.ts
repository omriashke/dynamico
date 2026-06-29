import type { Scope } from "./types.js";
import { appendPlainEsbuildExports } from "./esbuildFlatten.js";

/** Copy exports to a plain object (no getters) so Hermes can read `.default` reliably. */
function toPlainExports(exports: Record<string, unknown>): Record<string, unknown> {
  const plain: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(exports)) {
    const desc = Object.getOwnPropertyDescriptor(exports, key);
    if (desc?.get && !desc.set) {
      try {
        const value = desc.get.call(exports);
        if (value !== undefined) plain[key] = value;
      } catch {
        /* skip broken getter */
      }
    } else if (desc && "value" in desc) {
      plain[key] = desc.value;
    } else {
      plain[key] = exports[key];
    }
  }
  if (!("__esModule" in plain)) plain.__esModule = true;
  return plain;
}

/** Replace getter-only exports with plain values (Hermes-safe). */
function materializeGetterExports(exports: Record<string, unknown>): void {
  for (const key of Object.getOwnPropertyNames(exports)) {
    const desc = Object.getOwnPropertyDescriptor(exports, key);
    if (!desc?.get || desc.set) continue;
    try {
      const value = desc.get.call(exports);
      if (value !== undefined) {
        try {
          Object.defineProperty(exports, key, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        } catch {
          (exports as Record<string, unknown>)[key] = value;
        }
      }
    } catch {
      /* leave getter */
    }
  }
}

/** Resolve the default export from a loaded CJS module object (Hermes-safe). */
export function resolveModuleDefault(exp: unknown): unknown {
  if (typeof exp === "function") return exp;
  if (!exp || typeof exp !== "object") return undefined;
  const exports = exp as Record<string, unknown>;
  const desc = Object.getOwnPropertyDescriptor(exports, "default");
  if (desc?.get && !desc.set) {
    try {
      const fromGetter = desc.get.call(exports);
      if (typeof fromGetter === "function") return fromGetter;
    } catch {
      /* fall through */
    }
  }
  const d = exports.default;
  if (typeof d === "function") return d;
  return undefined;
}

/**
 * Cache of interop wrappers keyed by the original scope value, so repeated
 * `require()` calls return a stable module identity (important for React and
 * other libraries that are sensitive to multiple module instances).
 */
const interopCache = new WeakMap<object, Record<string, unknown>>();

/**
 * Normalize a host scope value into an ESM/CJS-interop-safe module object.
 *
 * Components are compiled to CJS (by esbuild/Babel), so the same package may be
 * consumed in three different ways depending on how the author wrote the import:
 *
 *   import Svg from 'react-native-svg'        // wants `.default`
 *   import { Path } from 'react-native-svg'   // wants named `.Path`
 *   import * as RNSVG from 'react-native-svg' // wants the namespace
 *
 * The host typically registers `* as Pkg` namespace objects in scope. Those
 * carry named exports but their interop `default` is unreliable across bundlers
 * — so a default import silently resolves to `undefined` and the component
 * renders nothing (no error). This wrapper makes all three styles work:
 *
 *   - `__esModule` always reports `true` so esbuild's `__toESM` / Babel's
 *     `_interopRequireDefault` read `.default` instead of re-wrapping.
 *   - `.default` falls back to the namespace itself when the package has no
 *     explicit default export (standard CJS interop).
 *   - every other property passes straight through to the original value.
 *
 * Functions and primitives (a package exported as a single callable) are
 * returned unchanged.
 */
export function interopScopeModule(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const mod = value as Record<string, unknown>;

  // Already a proper ES module namespace with a usable default — trust it as-is
  // to preserve identity for packages like React.
  if (mod.__esModule === true && "default" in mod) return mod;

  const cached = interopCache.get(mod);
  if (cached) return cached;

  const wrapper = new Proxy(mod, {
    get(target, prop, receiver) {
      if (prop === "__esModule") return true;
      if (prop === "default") {
        const own = Reflect.get(target, "default", receiver);
        return own !== undefined ? own : target;
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (prop === "__esModule" || prop === "default") return true;
      return Reflect.has(target, prop);
    },
  });

  interopCache.set(mod, wrapper);
  return wrapper;
}

/**
 * Execute a CommonJS-style code string in a controlled scope.
 *
 * The compiler (server-side Babel) emits code that uses `require(name)`,
 * `module.exports`, and `exports`. We give it a `require` that:
 *   - returns the host-registered binding for any bare specifier in `scope`
 *     (normalized for ESM/CJS interop so default imports resolve)
 *   - delegates relative paths ("./Other", "../foo") to `requireRelative`,
 *     which the registry implements by looking up other dynamic components
 *   - throws otherwise (no arbitrary npm imports at runtime)
 *
 * This is the only place we call `new Function`. It runs in the same realm
 * as the host app — v1 trusts the registry; sandboxing is a v2 concern.
 */
export function loadModule(
  code: string,
  scope: Scope,
  requireRelative: (specifier: string) => unknown,
): unknown {
  const moduleObj = { exports: {} as Record<string, unknown> };
  const requireFn = (name: string): unknown => {
    if (name.startsWith("./") || name.startsWith("../") || name.startsWith("/")) {
      return requireRelative(name);
    }
    if (name in scope) {
      return interopScopeModule(scope[name]);
    }
    throw new Error(
      `dynamico: '${name}' is not in host scope. Add it via <DynamicoProvider scope={{...}}>.`,
    );
  };

  // eslint-disable-next-line no-new-func
  const fn = new Function("module", "exports", "require", appendPlainEsbuildExports(code));
  fn(moduleObj, moduleObj.exports, requireFn);
  materializeGetterExports(moduleObj.exports);
  return toPlainExports(moduleObj.exports);
}
