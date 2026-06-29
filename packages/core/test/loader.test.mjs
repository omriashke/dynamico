import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadModule,
  resolveModuleDefault,
  interopScopeModule,
} from "../dist/loader.js";
import { appendPlainEsbuildExports } from "../dist/esbuildFlatten.js";

/** esbuild's runtime interop helper for `require()` of a CJS module. */
function esbuildToESM(mod) {
  if (mod && mod.__esModule) return mod;
  const target = {};
  Object.defineProperty(target, "default", { value: mod, enumerable: true });
  if (mod) for (const k of Object.keys(mod)) target[k] = mod[k];
  return target;
}

/** Babel's runtime interop helper for a default import. */
function babelInteropDefault(mod) {
  return mod && mod.__esModule ? mod : { default: mod };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, "fixtures/esbuild-getter-bundle.js"), "utf8");
const namedFixture = readFileSync(
  join(__dirname, "fixtures/esbuild-named-exports-bundle.js"),
  "utf8",
);

/** Legacy registry bundles end with a failed plain assignment (getter-only default). */
const legacyRegistryTail =
  ";try{if(typeof AppShell==='function'){module.exports.default=AppShell;}}catch(e){}";

function pickDefault(factory) {
  const d = resolveModuleDefault(factory);
  return typeof d === "function" ? d : undefined;
}

test("loadModule returns plain default export from esbuild getter bundle", () => {
  const scope = { react: { createElement: () => null }, "react-native": { View: "View" } };
  const factory = loadModule(fixture, scope, () => ({}));
  assert.equal(typeof factory.default, "function");
  assert.equal(factory.default.name, "AppShell");
  assert.equal(Object.getOwnPropertyDescriptor(factory, "default")?.get, undefined);
  assert.equal(typeof pickDefault(factory), "function");
});

test("loadModule resolves legacy registry bundle with failed default assignment", () => {
  const scope = { react: { createElement: () => null }, "react-native": { View: "View" } };
  const factory = loadModule(fixture + legacyRegistryTail, scope, () => ({}));
  assert.equal(typeof pickDefault(factory), "function");
  assert.equal(pickDefault(factory).name, "AppShell");
});

test("resolveModuleDefault reads function export directly", () => {
  function Demo() {}
  assert.equal(resolveModuleDefault(Demo), Demo);
  assert.equal(resolveModuleDefault({ default: Demo }), Demo);
});

test("interopScopeModule: default import resolves the package default export", () => {
  // A `* as` namespace whose default export is the primary component, but with
  // no __esModule marker — the exact shape that silently broke SVG imports.
  function Svg() {}
  function Path() {}
  const namespace = { Svg, Path, default: Svg };

  const mod = interopScopeModule(namespace);

  // esbuild path: import Svg from 'react-native-svg'
  assert.equal(esbuildToESM(mod).default, Svg);
  // babel path: import Svg from 'react-native-svg'
  assert.equal(babelInteropDefault(mod).default, Svg);
  // plain require('react-native-svg').default
  assert.equal(mod.default, Svg);
  // named imports still work
  assert.equal(mod.Path, Path);
});

test("interopScopeModule: default falls back to namespace when no default export", () => {
  // react-native style: no default export, only named members.
  const View = "View";
  const Text = "Text";
  const namespace = { View, Text };

  const mod = interopScopeModule(namespace);

  // import RN from 'react-native' → whole module (standard CJS interop)
  assert.equal(esbuildToESM(mod).default.View, View);
  assert.equal(babelInteropDefault(mod).default.View, View);
  // named access unchanged
  assert.equal(mod.View, View);
  assert.equal(mod.Text, Text);
});

test("interopScopeModule: leaves proper ES modules and primitives untouched", () => {
  const proper = { __esModule: true, default: () => {}, named: 1 };
  assert.equal(interopScopeModule(proper), proper);

  const fn = () => {};
  assert.equal(interopScopeModule(fn), fn);
  assert.equal(interopScopeModule("x"), "x");
  assert.equal(interopScopeModule(null), null);
});

test("interopScopeModule: returns a stable wrapper for the same value", () => {
  const namespace = { Svg: () => {} };
  assert.equal(interopScopeModule(namespace), interopScopeModule(namespace));
});

test("loadModule: default import of a namespace scope package resolves (svg case)", () => {
  function Svg() {}
  function Path() {}
  const scope = {
    react: { createElement: (...a) => a },
    "react-native-svg": { Svg, Path, default: Svg },
  };

  // Simulates esbuild-compiled output of:
  //   import Svg, { Path } from 'react-native-svg';
  //   export default function Icon(){ return Svg; }   (returns refs for assert)
  const code = `
    var __toESM = ${esbuildToESM.toString()};
    var svg = __toESM(require("react-native-svg"));
    function Icon(){ return { svg: svg.default, path: svg.Path }; }
    module.exports = { __esModule: true, default: Icon };
  `;

  const factory = loadModule(code, scope, () => ({}));
  const out = factory.default();
  assert.equal(out.svg, Svg);
  assert.equal(out.path, Path);
});

test("loadModule exposes named exports after flatten (Colors.primary at init)", () => {
  const flat = appendPlainEsbuildExports(namedFixture);
  const factory = loadModule(flat, {}, () => ({}));
  assert.equal(factory.Colors?.black, "#000000");
  assert.equal(factory.DEFAULT_COLORS?.primary, "#F53071");
  assert.equal(typeof resolveModuleDefault(factory), "function");
});
