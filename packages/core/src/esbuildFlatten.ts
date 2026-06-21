/** Marker appended once so loadModule does not double-flatten esbuild bundles. */
export const ESBUILD_FLATTEN_MARKER = ";// dynamico-flat-exports";

export interface EsbuildExportEntry {
  exportKey: string;
  varName: string;
}

/** Parse esbuild `__export(mod, { name: () => var, ... })` named export entries. */
export function parseEsbuildNamedExports(code: string): EsbuildExportEntry[] {
  const exportBlockMatch = code.match(/__export\(\w+,\s*\{([\s\S]*?)\}\s*\)/);
  if (!exportBlockMatch) return [];
  const entries: EsbuildExportEntry[] = [];
  for (const m of exportBlockMatch[1].matchAll(/(\w+):\s*\(\)\s*=>\s*(\w+)/g)) {
    entries.push({ exportKey: m[1], varName: m[2] });
  }
  return entries;
}

/**
 * Append a plain `module.exports = { ... }` assignment so Hermes and relative
 * imports (e.g. `require("../Colors").Colors`) see named exports, not only
 * getter-based defaults.
 */
export function appendPlainEsbuildExports(code: string): string {
  if (code.includes(ESBUILD_FLATTEN_MARKER)) return code;

  const entries = parseEsbuildNamedExports(code);
  if (entries.length === 0) {
    const defaultMatch = code.match(/default:\s*\(\)\s*=>\s*(\w+)/);
    if (!defaultMatch) return code;
    const fn = defaultMatch[1];
    const propsMatch = code.match(/propsSchema:\s*\(\)\s*=>\s*(\w+)/);
    const propsPart = propsMatch ? `,propsSchema:${propsMatch[1]}` : "";
    return `${code}${ESBUILD_FLATTEN_MARKER}\n;(function(){try{if(typeof ${fn}==='function'){module.exports={__esModule:true,default:${fn}${propsPart}};}}catch(e){}})();\n`;
  }

  const parts = entries.map(({ exportKey, varName }) =>
    exportKey === "default" ? `default:${varName}` : `${exportKey}:${varName}`,
  );
  const defaultEntry = entries.find((e) => e.exportKey === "default");
  const guard = defaultEntry
    ? `(typeof ${defaultEntry.varName}!=='undefined')`
    : "true";

  return `${code}${ESBUILD_FLATTEN_MARKER}\n;(function(){try{if(${guard}){module.exports={__esModule:true,${parts.join(",")}};}}catch(e){}})();\n`;
}
