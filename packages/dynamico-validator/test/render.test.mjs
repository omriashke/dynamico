import test from "node:test";
import assert from "node:assert/strict";
import { formatConsoleArg } from "../dist/render.js";
import { runValidate } from "../dist/runValidate.js";

test("formatConsoleArg JSON-stringifies plain objects without throwing", () => {
  assert.equal(
    formatConsoleArg({ componentStack: " at WelcomeScreen" }),
    '{"componentStack":" at WelcomeScreen"}',
  );
});

test("formatConsoleArg handles values that break String() coercion", () => {
  const evil = {
    [Symbol.toPrimitive]() {
      throw new TypeError("Cannot convert object to primitive value");
    },
  };
  let formatted;
  assert.doesNotThrow(() => {
    formatted = formatConsoleArg(evil);
  });
  assert.equal(typeof formatted, "string");
  assert.notEqual(formatted, "");
});

test("formatConsoleArg handles Symbol values", () => {
  assert.doesNotThrow(() => formatConsoleArg(Symbol("react")));
});

test("runValidate survives console.error object args during render (React 19)", async () => {
  const result = await runValidate({
    name: "ObjLog",
    componentCode: `
      var React = require("react");
      var RN = require("react-native");
      function ObjLog() {
        console.error("dev noise", { componentStack: " at ObjLog" });
        return React.createElement(RN.Text, null, "ok");
      }
      module.exports = { default: ObjLog };
    `,
    allowedScope: ["react", "react-native"],
  });
  assert.equal(result.ok, true);
});

test("runValidate survives when native console.error throws on object args", async () => {
  const orig = console.error;
  console.error = (...args) => {
    for (const a of args) {
      if (a != null && typeof a === "object") {
        throw new TypeError("Cannot convert object to primitive value");
      }
    }
    orig.apply(console, args);
  };
  try {
    const result = await runValidate({
      name: "ObjLogNative",
      componentCode: `
        var React = require("react");
        var RN = require("react-native");
        function ObjLogNative() {
          console.error("dev noise", { componentStack: " at ObjLogNative" });
          return React.createElement(RN.Text, null, "ok");
        }
        module.exports = { default: ObjLogNative };
      `,
      allowedScope: ["react", "react-native"],
    });
    assert.equal(result.ok, true);
  } finally {
    console.error = orig;
  }
});

test("runValidate fails a push that renders an undefined element type", async () => {
  // Simulates a broken import resolving to undefined and being used as JSX —
  // React only warns ("Element type is invalid"), so without the guard this
  // would ship a blank component.
  const result = await runValidate({
    name: "BadImport",
    componentCode: `
      var React = require("react");
      var Missing = undefined;
      function BadImport() {
        return React.createElement(Missing, null);
      }
      module.exports = { default: BadImport };
    `,
    allowedScope: ["react"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.phase, "render");
  assert.match(result.error?.message ?? "", /type is invalid/i);
});

test("runValidate passes a default import of react-native-svg (interop)", async () => {
  // Faithful to runtime: `import Svg from 'react-native-svg'` must resolve to
  // the Svg component via interop, not undefined.
  const result = await runValidate({
    name: "SvgIcon",
    componentCode: `
      var React = require("react");
      var __svg = require("react-native-svg");
      var Svg = (__svg && __svg.__esModule ? __svg : { default: __svg }).default;
      var Path = __svg.Path;
      function SvgIcon() {
        return React.createElement(Svg, null, React.createElement(Path, { d: "M0 0" }));
      }
      module.exports = { default: SvgIcon };
    `,
    allowedScope: ["react"],
  });
  assert.equal(result.ok, true);
});

test("runValidate still captures real render errors logged by React 19", async () => {
  const result = await runValidate({
    name: "Broken",
    componentCode: `
      var React = require("react");
      var RN = require("react-native");
      function Broken() {
        console.error("An error occurred in the Broken component", {
          componentStack: "ReferenceError: missingVar is not defined",
        });
        return React.createElement(RN.Text, null, "ok");
      }
      module.exports = { default: Broken };
    `,
    allowedScope: ["react", "react-native"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.phase, "render");
  assert.match(result.error?.message ?? "", /ReferenceError|not defined|error occurred/i);
});
