#!/usr/bin/env node
import { compile } from "../packages/registry-server/dist/compile.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NEWSCAST = process.env.NEWSCAST_ROOT ?? join(import.meta.dirname, "../../newscast");
const config = JSON.parse(
  readFileSync(join(NEWSCAST, "dynamico/expo/dynamico.config.json"), "utf8"),
);
const registered = new Set(Object.keys(config.components));

const badSource = `
import * as React from 'react';
import { pickThemeColors } from '../themePalette';
export default function BadRelative() {
  const colors = pickThemeColors({}, { primary: '#F53071' });
  return React.createElement('div', null, colors.primary);
}
`;

const abs = join(NEWSCAST, "dynamico/expo/ui/IconButton/BadRelative.tsx");
const compiled = await compile("BadRelative", badSource, ".tsx", {
  absSourcePath: abs,
  registeredComponents: registered,
});

if (!compiled.error?.message?.includes("themePalette")) {
  console.error("FAIL: expected unregistered ../themePalette to be rejected");
  console.error(compiled.error?.message ?? "no error");
  process.exit(1);
}
console.log("PASS: unregistered relative import rejected");

const goodAbs = join(NEWSCAST, "dynamico/expo/ui/IconButton/IconButton.tsx");
const goodSrc = readFileSync(goodAbs, "utf8");
const good = await compile("IconButton", goodSrc, ".tsx", {
  absSourcePath: goodAbs,
  registeredComponents: registered,
});
if (good.error) {
  console.error("FAIL: IconButton should compile:", good.error.message);
  process.exit(1);
}
console.log("PASS: IconButton bundles without relative requires");
