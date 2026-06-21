import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { compile, flattenEsbuildBundle } from "../dist/compile.js";
import {
  loadModule,
  resolveModuleDefault,
  appendPlainEsbuildExports,
} from "@omriashke/dynamico-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const getterBundle = readFileSync(
  join(__dirname, "../../core/test/fixtures/esbuild-getter-bundle.js"),
  "utf8",
);
const namedExportsBundle = readFileSync(
  join(__dirname, "../../core/test/fixtures/esbuild-named-exports-bundle.js"),
  "utf8",
);

test("flattenEsbuildBundle emits plain module.exports object", () => {
  const flat = flattenEsbuildBundle(getterBundle);
  assert.match(flat, /module\.exports=\{__esModule:true,default:AppShell/);
  const scope = { react: { createElement: () => null }, "react-native": { View: "View" } };
  const factory = loadModule(flat, scope, () => ({}));
  assert.equal(typeof resolveModuleDefault(factory), "function");
});

test("flattenEsbuildBundle preserves named exports like Colors", () => {
  const flat = appendPlainEsbuildExports(namedExportsBundle);
  assert.match(flat, /Colors:Colors/);
  assert.match(flat, /DEFAULT_COLORS:DEFAULT_COLORS/);
  const factory = loadModule(flat, {}, () => ({}));
  assert.equal(factory.Colors?.black, "#000000");
  assert.equal(typeof resolveModuleDefault(factory), "function");
});

test("compile downlevels async/await for Hermes new Function()", async () => {
  const source = `
import * as React from 'react';
export default function Demo() {
  const onPress = async () => { await Promise.resolve(1); };
  return null;
}`;
  const result = await compile("AsyncDemo", source, ".tsx");
  assert.ifError(result.error);
  assert.doesNotMatch(result.code, /\basync\b/);
  const scope = { react: ReactStub() };
  assert.doesNotThrow(() => loadModule(result.code, scope, () => ({})));
});

function ReactStub() {
  return { createElement: () => null, useState: () => [0, () => {}], useEffect: () => {} };
}
