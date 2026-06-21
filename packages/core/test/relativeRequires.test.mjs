import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveRelativeComponentName,
  extractRelativeRequires,
  collectRelativeComponentDeps,
} from "../dist/relativeRequires.js";

test("resolveRelativeComponentName maps relative paths to flat basename", () => {
  assert.equal(resolveRelativeComponentName("./Button"), "Button");
  assert.equal(resolveRelativeComponentName("../ui/Colors.tsx"), "Colors");
  assert.equal(resolveRelativeComponentName("../hooks/useFeed.ts"), "useFeed");
  assert.equal(resolveRelativeComponentName("react"), null);
});

test("extractRelativeRequires finds ./ and ../ requires in compiled CJS", () => {
  const code = `
    var c = require("../Colors");
    var b = require("./Button.tsx");
    var r = require("react");
  `;
  assert.deepEqual(extractRelativeRequires(code).sort(), ["../Colors", "./Button.tsx"]);
});

test("collectRelativeComponentDeps excludes self and deduplicates", () => {
  const code = `
    require("../Colors");
    require("./WelcomeScreen");
    require("./WelcomeScreen");
  `;
  assert.deepEqual(collectRelativeComponentDeps(code, "AppShell").sort(), [
    "Colors",
    "WelcomeScreen",
  ]);
});

test("collectRelativeComponentDeps returns empty when no relative imports", () => {
  assert.deepEqual(collectRelativeComponentDeps('require("react")', "Demo"), []);
});
