import { transformAsync } from "@babel/core";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import type { CompiledModule, Diagnostic } from "@omriashke/dynamico-core";
import { typecheck } from "./typecheck.js";

const requireFromHere = createRequire(import.meta.url);
const presetEnv = requireFromHere.resolve("@babel/preset-env");
const presetReact = requireFromHere.resolve("@babel/preset-react");
const presetTypeScript = requireFromHere.resolve("@babel/preset-typescript");

/**
 * Compile a single source string (`.tsx`/`.jsx`/`.ts`/`.js`) to a
 * CommonJS-style function body that the client's loader will run via
 * `new Function(module, exports, require, code)`.
 *
 * We run validation in two phases:
 *   1) typecheck() — TypeScript syntax/sanity check, produces structured
 *      diagnostics with file/line/column. This is what the agent really wants.
 *   2) Babel transform — strips types and downlevels JSX. Babel errors are
 *      converted into a single diagnostic whose location we parse from the
 *      message when possible.
 *
 * Presets:
 *   - preset-typescript: strip types
 *   - preset-react classic runtime: emits React.createElement (single host binding,
 *     portable across Hermes/web)
 *   - preset-env: conservative target, modules: commonjs so the client loader
 *     can intercept require() calls.
 *
 * `ext` is the source file's extension (e.g. `".tsx"`) and is used only to
 * give Babel an accurate filename for error messages — the TS preset runs
 * with `allExtensions: true` and `isTSX: true`, so JSX is understood
 * regardless of extension.
 */
export async function compile(name: string, source: string, ext = ".tsx"): Promise<CompiledModule> {
  const tc = typecheck(name, source, ext);
  if (!tc.ok) {
    return errorModule(name, "typecheck failed", undefined, tc.diagnostics, "typecheck");
  }
  const warnings = tc.diagnostics.filter((d) => d.severity === "warning");

  try {
    const result = await transformAsync(source, {
      filename: `${name}${ext}`,
      babelrc: false,
      configFile: false,
      sourceType: "module",
      presets: [
        [presetEnv, { targets: { esmodules: false }, modules: "commonjs" }],
        [presetReact, { runtime: "classic" }],
        [presetTypeScript, { isTSX: true, allExtensions: true }],
      ],
    });
    const code = result?.code;
    if (!code) {
      return errorModule(name, "Babel produced no output");
    }
    const version = hash(code);
    return { name, version, code, warnings: warnings.length ? warnings : undefined };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const diag = babelErrorToDiagnostic(e, source);
    return errorModule(name, e.message, e.stack, [diag], "compile");
  }
}

function babelErrorToDiagnostic(err: Error, source: string): Diagnostic {
  // Babel errors look like: "/path/Foo.tsx: Unexpected token (3:7)\n..."
  const m = /\((\d+):(\d+)\)/.exec(err.message);
  let line: number | undefined;
  let column: number | undefined;
  let snippet: string | undefined;
  if (m) {
    line = Number(m[1]);
    column = Number(m[2]) + 1;
    snippet = source.split("\n")[line - 1];
  }
  return {
    severity: "error",
    message: err.message.split("\n")[0],
    line,
    column,
    code: "BABEL",
    snippet,
  };
}

function errorModule(
  name: string,
  message: string,
  stack?: string,
  diagnostics?: Diagnostic[],
  kind: "compile" | "typecheck" = "compile",
): CompiledModule {
  return {
    name,
    version: hash(message + (stack ?? "")),
    error: { kind, message, stack, diagnostics },
  };
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
