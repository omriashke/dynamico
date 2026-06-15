import { transformAsync } from "@babel/core";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import * as esbuild from "esbuild";
import type { CompiledModule, Diagnostic } from "@omriashke/dynamico-core";
import { typecheck } from "./typecheck.js";
import { validateRelativeImports } from "./relativeImports.js";

const requireFromHere = createRequire(import.meta.url);
const presetEnv = requireFromHere.resolve("@babel/preset-env");
const presetReact = requireFromHere.resolve("@babel/preset-react");
const presetTypeScript = requireFromHere.resolve("@babel/preset-typescript");

export interface CompileContext {
  /** Absolute path to the source file on disk — enables esbuild bundling of local helpers. */
  absSourcePath?: string;
  /** Flat registry component names; relative imports to these stay external at runtime. */
  registeredComponents?: ReadonlySet<string>;
  /** Co-located tests import `./Component` — skip RELATIVE_IMPORT gate for them. */
  skipRelativeImportGate?: boolean;
}

/**
 * Compile a single source string (`.tsx`/`.jsx`/`.ts`/`.js`) to a
 * CommonJS-style function body that the client's loader will run via
 * `new Function(module, exports, require, code)`.
 */
export async function compile(
  name: string,
  source: string,
  ext = ".tsx",
  context?: CompileContext,
): Promise<CompiledModule> {
  const tc = typecheck(name, source, ext);
  if (!tc.ok) {
    return errorModule(name, "typecheck failed", undefined, tc.diagnostics, "typecheck");
  }
  const warnings = tc.diagnostics.filter((d) => d.severity === "warning");

  const registered = context?.registeredComponents ?? new Set<string>();

  try {
    let code: string;
    if (context?.absSourcePath) {
      try {
        code = await bundleWithEsbuild(context.absSourcePath, registered, source, ext);
      } catch (bundleErr) {
        code = await babelOnly(name, source, ext);
      }
    } else {
      code = await babelOnly(name, source, ext);
    }

    const relCheck = context?.skipRelativeImportGate
      ? { ok: true as const }
      : validateRelativeImports(code, registered, name);
    if (!relCheck.ok) {
      return errorModule(
        name,
        relCheck.message ?? "invalid relative import",
        undefined,
        relCheck.diagnostics,
        "compile",
      );
    }

    const version = hash(code);
    return { name, version, code, warnings: warnings.length ? warnings : undefined };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const diag = babelErrorToDiagnostic(e, source);
    return errorModule(name, e.message, e.stack, [diag], "compile");
  }
}

async function babelOnly(name: string, source: string, ext: string): Promise<string> {
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
  if (!code) throw new Error("Babel produced no output");
  return code;
}

async function bundleWithEsbuild(
  absSourcePath: string,
  registeredComponents: ReadonlySet<string>,
  source: string,
  ext: string,
): Promise<string> {
  const resolveDir = dirname(absSourcePath);
  const extName = extname(absSourcePath);
  const loader = (extName.slice(1) || ext.slice(1) || "tsx") as esbuild.Loader;
  const externalPlugin: esbuild.Plugin = {
    name: "dynamico-external",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return null;
        if (!args.path.startsWith(".")) {
          return { path: args.path, external: true };
        }
        const resolved = resolve(args.resolveDir, args.path);
        const base = basename(resolved).replace(/\.[tj]sx?$/, "");
        if (registeredComponents.has(base)) {
          return { path: args.path, external: true };
        }
        return null;
      });
    },
  };

  const shared: esbuild.BuildOptions = {
    bundle: true,
    format: "cjs",
    platform: "neutral",
    write: false,
    target: "es2020",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    logLevel: "silent",
    plugins: [externalPlugin],
  };

  const result = existsSync(absSourcePath)
    ? await esbuild.build({ ...shared, entryPoints: [absSourcePath] })
    : await esbuild.build({
        ...shared,
        stdin: {
          contents: source,
          loader,
          resolveDir,
          sourcefile: basename(absSourcePath),
        },
      });
  const file = result.outputFiles?.[0];
  if (!file?.text) throw new Error("esbuild produced no output");
  return flattenEsbuildBundle(file.text);
}

/** Make esbuild CJS bundles compatible with the client loader + test worker (babel-shaped). */
function flattenEsbuildBundle(code: string): string {
  let out = code.replace(
    /var (\w+) = __toESM\(require\(([^)]+)\)\);/g,
    "var $1 = require($2);",
  );
  out = out.replace(/(\w+)\.default\.createElement/g, "$1.createElement");
  return out;
}

function babelErrorToDiagnostic(err: Error, source: string): Diagnostic {
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
