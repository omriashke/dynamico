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
