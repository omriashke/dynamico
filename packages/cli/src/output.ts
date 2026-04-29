import type { Diagnostic } from "@omriashke/dynamico-core";

/**
 * Human-readable rendering for diagnostics. Mimics the classic compiler
 * format so an agent reading our stderr (or stdout) gets a strong signal:
 *
 *   path/to/Foo.tsx:12:7 - error TS2304: Cannot find name 'Reactt'.
 *     12 |   return <Reactt.Fragment />;
 *        |          ^^^^^^
 */
export function formatDiagnostic(name: string, d: Diagnostic): string {
  const where = d.line ? `${name}.tsx:${d.line}:${d.column ?? 1} - ` : "";
  const code = d.code ? ` ${d.code}:` : ":";
  const head = `${where}${d.severity}${code} ${d.message}`;
  if (!d.snippet || d.line === undefined) return head;
  const gutter = `${d.line}`.padStart(4, " ");
  const caret = " ".repeat(gutter.length) + " | " + " ".repeat((d.column ?? 1) - 1) + "^";
  return `${head}\n${gutter} | ${d.snippet}\n${caret}`;
}

export function emit(json: boolean, payload: unknown, humanLines: string[]): void {
  if (json) {
    process.stdout.write(JSON.stringify(payload) + "\n");
  } else {
    for (const l of humanLines) process.stdout.write(l + "\n");
  }
}

export function fail(json: boolean, payload: unknown, humanLines: string[], code = 1): never {
  if (json) {
    process.stderr.write(JSON.stringify(payload) + "\n");
  } else {
    for (const l of humanLines) process.stderr.write(l + "\n");
  }
  process.exit(code);
}
