import type { Diagnostic } from "./types.js";

/** Map a relative require specifier to the flat registry component name (basename). */
export function resolveRelativeComponentName(specifier: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../") && !specifier.startsWith("/")) {
    return null;
  }
  const base = specifier
    .replace(/^\.+\//, "")
    .replace(/\.[tj]sx?$/, "")
    .split("/")
    .pop();
  return base || null;
}

/** Collect relative require() specifiers from compiled CommonJS output. */
export function extractRelativeRequires(code: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /require\(\s*["'](\.[^"']+)["']\s*\)/g,
    /require\(\s*["'](\.\.[^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const match of code.matchAll(re)) {
      const spec = match[1];
      if (spec) found.add(spec);
    }
  }
  return [...found];
}

/** Registry component names referenced by relative imports in compiled code. */
export function collectRelativeComponentDeps(code: string, componentName?: string): string[] {
  const deps = new Set<string>();
  for (const specifier of extractRelativeRequires(code)) {
    const base = resolveRelativeComponentName(specifier);
    if (!base || base === componentName) continue;
    deps.add(base);
  }
  return [...deps];
}

export interface RelativeImportValidation {
  ok: boolean;
  message?: string;
  diagnostics?: Diagnostic[];
}

/**
 * Reject relative imports that resolve to registry names not in the manifest.
 * Local utility files should be bundled at compile time; any remaining relative
 * require() must target another registered component.
 */
export function validateRelativeImports(
  code: string,
  registered: ReadonlySet<string>,
  componentName?: string,
): RelativeImportValidation {
  const unresolved: string[] = [];
  for (const specifier of extractRelativeRequires(code)) {
    const base = resolveRelativeComponentName(specifier);
    if (!base) continue;
    if (base === componentName) continue;
    if (!registered.has(base)) unresolved.push(specifier);
  }
  if (unresolved.length === 0) return { ok: true };

  const lines = unresolved.map(
    (spec) =>
      `  ${spec} → registry component '${resolveRelativeComponentName(spec)}' is not registered`,
  );
  const message =
    `relative import(s) must target a registered component or a local file bundled into this module:\n` +
    `${lines.join("\n")}\n` +
    `Push the dependency as its own component, move helpers into this file, ` +
    `import from host scope (e.g. @newscast/utils-app-ui), or colocate as ./sibling.ts (auto-bundled).`;

  return {
    ok: false,
    message,
    diagnostics: unresolved.map((spec) => ({
      severity: "error" as const,
      message: `unregistered relative import '${spec}'`,
      code: "RELATIVE_IMPORT",
    })),
  };
}
