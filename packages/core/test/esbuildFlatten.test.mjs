import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEsbuildNamedExports,
  appendPlainEsbuildExports,
  ESBUILD_FLATTEN_MARKER,
} from "../dist/esbuildFlatten.js";

const namedBlock = `
__export(index_exports, {
  DEFAULT_COLORS: () => DEFAULT_COLORS,
  Colors: () => Colors,
  default: () => ColorsPreview,
  propsSchema: () => propsSchema,
});
`;

const defaultOnlyBlock = `
__export(single_exports, {
  default: () => Button,
  propsSchema: () => propsSchema,
});
`;

test("parseEsbuildNamedExports reads export key → var mappings", () => {
  const entries = parseEsbuildNamedExports(namedBlock);
  assert.deepEqual(
    entries.map((e) => e.exportKey),
    ["DEFAULT_COLORS", "Colors", "default", "propsSchema"],
  );
  assert.equal(entries.find((e) => e.exportKey === "Colors")?.varName, "Colors");
});

test("parseEsbuildNamedExports returns empty for bundles without __export", () => {
  assert.deepEqual(parseEsbuildNamedExports("module.exports = {}"), []);
});

test("appendPlainEsbuildExports is idempotent when marker already present", () => {
  const once = appendPlainEsbuildExports(defaultOnlyBlock);
  assert.ok(once.includes(ESBUILD_FLATTEN_MARKER));
  assert.equal(appendPlainEsbuildExports(once), once);
});

test("appendPlainEsbuildExports preserves all named exports in plain assignment", () => {
  const flat = appendPlainEsbuildExports(namedBlock);
  assert.match(flat, /module\.exports=\{__esModule:true,/);
  assert.match(flat, /Colors:Colors/);
  assert.match(flat, /DEFAULT_COLORS:DEFAULT_COLORS/);
  assert.match(flat, /default:ColorsPreview/);
  assert.match(flat, /propsSchema:propsSchema/);
});

test("appendPlainEsbuildExports handles default-only bundles", () => {
  const flat = appendPlainEsbuildExports(defaultOnlyBlock);
  assert.match(flat, /default:Button/);
  assert.match(flat, /propsSchema:propsSchema/);
});

test("appendPlainEsbuildExports leaves unrelated code unchanged when no exports found", () => {
  const code = "module.exports = { foo: 1 };";
  assert.equal(appendPlainEsbuildExports(code), code);
});
