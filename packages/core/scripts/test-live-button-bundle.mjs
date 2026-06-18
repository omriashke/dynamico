/**
 * Verify real dev registry bundles resolve Colors through relative imports.
 * Uses a probe module that mirrors Button's module-level Colors read.
 */
import * as React from "react";
import { Registry } from "../dist/registry.js";

const registryUrl = process.env.DYNAMICO_REGISTRY_URL ?? "https://dev.newscast.info/api/dynamico";

async function fetchComponent(name) {
  const res = await fetch(`${registryUrl.replace(/\/$/, "")}/component/${name}`);
  if (!res.ok) throw new Error(`GET /component/${name} → ${res.status}`);
  const body = await res.json();
  if (!body.code) throw new Error(`${name} has no compiled code`);
  return { name, version: body.version ?? "live", code: body.code };
}

const PROBE_CODE = `
var import_Colors = require("../Colors");
module.exports = {
  default: function Probe() { return null; },
  primary: import_Colors.Colors.primary,
  black: import_Colors.Colors.black,
};
`;

const StyleSheet = { create: (s) => s, flatten: (s) => s ?? {} };
const scope = {
  react: React,
  "react-native": { View: "View", Text: "Text", Pressable: "Pressable", StyleSheet },
  "react-native-svg": { Svg: "Svg", Path: "Path", G: "G" },
};

const cache = new Map([["ColorsProbe", { name: "ColorsProbe", version: "probe", code: PROBE_CODE }]]);

const source = {
  async fetch(name) {
    if (cache.has(name)) return cache.get(name);
    const mod = await fetchComponent(name);
    cache.set(name, mod);
    return mod;
  },
  subscribe() {
    return () => undefined;
  },
};

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

console.log("Probing Colors via relative import (bundles from", registryUrl, ")…");
const registry = new Registry(source, scope);
const entry = await registry.ensure("ColorsProbe");

assert(!entry.error, `Probe load error: ${entry.error?.message}`);
assert(entry.factory?.primary === "#F53071", `primary expected #F53071, got ${entry.factory?.primary}`);
assert(entry.factory?.black === "#000000", `black expected #000000, got ${entry.factory?.black}`);

// Also ensure real Button loads without error (StyleSheet.create runs at eval time).
const buttonEntry = await registry.ensure("Button");
assert(!buttonEntry.error, `Button load error: ${buttonEntry.error?.message}`);

console.log("PASS: Colors.primary =", entry.factory.primary, "· Button loads cleanly");
