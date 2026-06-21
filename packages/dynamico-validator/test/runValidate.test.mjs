import test from "node:test";
import assert from "node:assert/strict";
import { runValidate } from "../dist/runValidate.js";

const helloCode = `
var React = require("react");
var RN = require("react-native");
function Hello() {
  return React.createElement(RN.Text, null, "hi");
}
module.exports = { default: Hello };
`;

test("runValidate accepts a minimal default-export component", async () => {
  const result = await runValidate({
    name: "Hello",
    componentCode: helloCode,
    allowedScope: ["react", "react-native"],
  });
  assert.equal(result.ok, true);
  assert.ok(result.durationMs >= 0);
});

test("runValidate rejects unknown bare imports (scope gate)", async () => {
  const result = await runValidate({
    name: "BadImport",
    componentCode: `
      var unknown = require("@unknown/pkg");
      module.exports = { default: function BadImport() { return null; } };
    `,
    allowedScope: ["react", "react-native"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.phase, "scope");
});

test("runValidate rejects components without a default export", async () => {
  const result = await runValidate({
    name: "NoDefault",
    componentCode: `module.exports = { Named: function Named() { return null; } };`,
    allowedScope: ["react", "react-native"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.phase, "no-default-export");
});

test("runValidate renders book.config.json previews when provided", async () => {
  const result = await runValidate({
    name: "Chip",
    componentCode: `
      var React = require("react");
      var RN = require("react-native");
      function Chip(props) {
        return React.createElement(RN.Text, null, props.label);
      }
      module.exports = {
        default: Chip,
        propsSchema: { label: { type: "string", required: true } },
      };
    `,
    allowedScope: ["react", "react-native"],
    bookConfig: {
      entries: [
        {
          id: "Chip",
          blocks: [{ type: "component", component: "Chip", props: { label: "News" } }],
        },
      ],
    },
  });
  assert.equal(result.ok, true);
});

test("runValidate fails book preview when render throws", async () => {
  const result = await runValidate({
    name: "Chip",
    componentCode: `
      var React = require("react");
      var RN = require("react-native");
      function Chip(props) {
        if (typeof props.label !== "string") throw new Error("label must be a string");
        return React.createElement(RN.Text, null, props.label);
      }
      module.exports = {
        default: Chip,
        propsSchema: { label: { type: "string", required: true } },
      };
    `,
    allowedScope: ["react", "react-native"],
    bookConfig: {
      entries: [
        {
          id: "Chip",
          blocks: [{ type: "component", component: "Chip", props: { label: 123 } }],
        },
      ],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.phase, "book");
  assert.match(result.error?.message ?? "", /label must be a string/);
});
