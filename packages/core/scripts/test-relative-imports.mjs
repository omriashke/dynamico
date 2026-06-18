/**
 * Smoke test: relative registry imports must expose data exports (Colors) at
 * module-eval time, not lazy React wrappers.
 *
 * Run after `pnpm build`: node scripts/test-relative-imports.mjs
 */
import * as React from "react";
import { Registry } from "../dist/registry.js";

const COLORS_CODE = `
var exports = {};
exports.Colors = {
  white: "#FFFFFF",
  black: "#000000",
  primary: "#F53071",
  secondary: "#FFF5F5",
  grey: "rgba(0,0,0,0.25)",
};
exports.default = function ColorsPreview() { return null; };
module.exports = exports;
`;

const BUTTON_CODE = `
var import_react = require("react");
var import_react_native = require("react-native");
var import_Colors = require("../Colors");
var styles = import_react_native.StyleSheet.create({
  primary: { backgroundColor: import_Colors.Colors.primary },
  text: { color: import_Colors.Colors.white },
});
function Button(props) {
  return import_react.createElement(
    import_react_native.Pressable,
    { style: styles.primary },
    import_react.createElement(import_react_native.Text, { style: styles.text }, props.title),
  );
}
module.exports = { default: Button, styles: styles };
`;

const ARROW_CODE = `
var import_react = require("react");
var RNSVG = require("react-native-svg");
var import_Colors = require("../Colors");
function ArrowIcon(props) {
  var color = props.color !== undefined ? props.color : import_Colors.Colors.black;
  return import_react.createElement(
    RNSVG.Svg,
    { width: 16, height: 16 },
    import_react.createElement(RNSVG.Path, { fill: color, d: "M0 0" }),
  );
}
module.exports = { default: ArrowIcon, defaultColor: import_Colors.Colors.black };
`;

const modules = {
  Colors: { name: "Colors", version: "v1", code: COLORS_CODE },
  Button: { name: "Button", version: "v1", code: BUTTON_CODE },
  ArrowIcon: { name: "ArrowIcon", version: "v1", code: ARROW_CODE },
};

const source = {
  fetch(name) {
    const mod = modules[name];
    if (!mod) return Promise.reject(new Error(`unknown component: ${name}`));
    return Promise.resolve(mod);
  },
  subscribe() {
    return () => undefined;
  },
};

const StyleSheet = {
  create(styles) {
    return styles;
  },
};

const scope = {
  react: React,
  "react-native": {
    View: "View",
    Text: "Text",
    Pressable: "Pressable",
    StyleSheet,
  },
  "react-native-svg": {
    Svg: "Svg",
    Path: "Path",
    G: "G",
  },
};

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

const registry = new Registry(source, scope);

const buttonEntry = await registry.ensure("Button");
assert(!buttonEntry.error, `Button load error: ${buttonEntry.error?.message}`);
assert(
  buttonEntry.factory?.styles?.primary?.backgroundColor === "#F53071",
  `Button primary bg expected #F53071, got ${buttonEntry.factory?.styles?.primary?.backgroundColor}`,
);

const arrowEntry = await registry.ensure("ArrowIcon");
assert(!arrowEntry.error, `ArrowIcon load error: ${arrowEntry.error?.message}`);
assert(
  arrowEntry.factory?.defaultColor === "#000000",
  `ArrowIcon default color expected #000000, got ${arrowEntry.factory?.defaultColor}`,
);

console.log("PASS: relative import data exports resolve correctly at module-eval time");
