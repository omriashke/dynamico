import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, resolveModuleDefault } from "../dist/loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, "fixtures/esbuild-getter-bundle.js"), "utf8");

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
