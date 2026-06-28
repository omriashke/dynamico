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
