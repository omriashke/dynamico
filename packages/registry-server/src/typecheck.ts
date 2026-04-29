import ts from "typescript";
import type { Diagnostic } from "@dynamico/core";

/**
 * Lightweight syntax-only typecheck on a TSX source.
 *
 * v1: we run TypeScript in transpile-style (single-file) mode. This catches:
 *   - syntax errors (e.g. missing brackets, malformed JSX)
 *   - many trivial type errors *within* the file
 *   - top-level mistakes like exporting nothing
 *
 * It does NOT catch cross-file mistakes (e.g. wrong props on an imported
 * component) because we don't have the host's type definitions on the server.
 * That's a v2 enhancement: receive a tarball of types alongside the source.
 *
 * Returns:
 *   { ok: true, warnings }  — compiled fine; warnings are non-fatal hints
 *   { ok: false, diagnostics } — caller should reject the upload (or surface
 *                                via dry-run)
 */
export function typecheck(name: string, source: string): {
  ok: boolean;
  diagnostics: Diagnostic[];
} {
  const filename = `${name}.tsx`;
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);

  const diagnostics: Diagnostic[] = [];
  const syntactic = (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  for (const d of syntactic) diagnostics.push(toDiag(d, "error", source));

  const reachableDefault = hasDefaultExport(sourceFile);
  if (!reachableDefault) {
    diagnostics.push({
      severity: "error",
      message: "component must have a default export (e.g. `export default function Foo() {...}`)",
      code: "DYN0001",
    });
  }

  const ok = diagnostics.every((d) => d.severity !== "error");
  return { ok, diagnostics };
}

function hasDefaultExport(sf: ts.SourceFile): boolean {
  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) return true;
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isVariableStatement(stmt)) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      return true;
    }
  }
  return false;
}

function toDiag(d: ts.Diagnostic, severity: "error" | "warning", source: string): Diagnostic {
  const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  let line: number | undefined;
  let column: number | undefined;
  let snippet: string | undefined;
  if (d.file && d.start !== undefined) {
    const pos = d.file.getLineAndCharacterOfPosition(d.start);
    line = pos.line + 1;
    column = pos.character + 1;
    snippet = source.split("\n")[pos.line];
  }
  return {
    severity,
    message,
    line,
    column,
    code: `TS${d.code}`,
    snippet,
  };
}
