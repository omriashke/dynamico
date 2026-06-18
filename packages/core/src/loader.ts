import type { Scope } from "./types.js";

/** esbuild CJS bundles assign exports before the component function; materialize at end. */
function patchEsbuildDefaultExport(code: string): string {
  const m = code.match(/default:\s*\(\)\s*=>\s*(\w+)/);
  if (!m) return code;
  const fn = m[1];
  return `${code}\n;try{if(typeof ${fn}==='function'){module.exports.default=${fn};}}catch(e){}\n`;
}

/** Replace getter-only exports with plain values (Hermes-safe). */
function materializeGetterExports(exports: Record<string, unknown>): void {
  for (const key of Object.getOwnPropertyNames(exports)) {
    const desc = Object.getOwnPropertyDescriptor(exports, key);
    if (!desc?.get || desc.set) continue;
    try {
      const value = desc.get.call(exports);
      if (value !== undefined) {
        Object.defineProperty(exports, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    } catch {
      /* leave getter */
    }
  }
}

/**
 * Execute a CommonJS-style code string in a controlled scope.
 *
 * The compiler (server-side Babel) emits code that uses `require(name)`,
 * `module.exports`, and `exports`. We give it a `require` that:
 *   - returns the host-registered binding for any bare specifier in `scope`
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
    // Use `in` (triggers Proxy `has` traps) so that hosts can supply scope
    // via a Proxy and resolve module bindings lazily. Falls back to
    // `hasOwnProperty` semantics for plain object scopes.
    if (name in scope) {
      return scope[name];
    }
    throw new Error(
      `dynamico: '${name}' is not in host scope. Add it via <DynamicoProvider scope={{...}}>.`,
    );
  };

  // The compiled body is just the function body; arguments are well-known.
  // eslint-disable-next-line no-new-func
  const fn = new Function("module", "exports", "require", patchEsbuildDefaultExport(code));
  fn(moduleObj, moduleObj.exports, requireFn);
  materializeGetterExports(moduleObj.exports);

  return moduleObj.exports;
}
