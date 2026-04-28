import { transformAsync } from "@babel/core";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import type { CompiledModule } from "@dynamico/core";

// Resolve presets relative to *this* package, regardless of where the registry
// is invoked from (avoids issues with strict pnpm hoisting).
const requireFromHere = createRequire(import.meta.url);
const presetEnv = requireFromHere.resolve("@babel/preset-env");
const presetReact = requireFromHere.resolve("@babel/preset-react");
const presetTypeScript = requireFromHere.resolve("@babel/preset-typescript");

/**
 * Compile a single .tsx/.jsx source string to a CommonJS-style function body
 * that the client's loader will run via `new Function(module, exports, require, code)`.
 *
 * We intentionally use:
 *   - preset-typescript: strip types
 *   - preset-react with the *classic* runtime so the compiled output uses
 *     React.createElement (a single host binding) rather than imports from
 *     react/jsx-runtime. This is the most portable choice for Hermes/Expo
 *     and keeps the client-side host scope minimal.
 *   - preset-env target: a conservative spec that Hermes supports
 *   - modules: "commonjs" so imports become require() calls our loader handles
 */
export async function compile(name: string, source: string): Promise<CompiledModule> {
  try {
    const result = await transformAsync(source, {
      filename: `${name}.tsx`,
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
    return { name, version, code };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    return errorModule(name, e.message, e.stack);
  }
}

function errorModule(name: string, message: string, stack?: string): CompiledModule {
  return {
    name,
    version: hash(message + (stack ?? "")),
    error: { kind: "compile", message, stack },
  };
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
