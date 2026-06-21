/** Minimal esbuild CJS bundle shape (getter-based default export). */
var AppShell_exports = {};
var __export = (target, all) => {
  for (var name in all)
    Object.defineProperty(target, name, { get: all[name], enumerable: true });
};
var __toCommonJS = (mod) => {
  var target = { __esModule: true };
  for (var key in mod) {
    Object.defineProperty(target, key, { get: () => mod[key], enumerable: true });
  }
  return target;
};
__export(AppShell_exports, {
  default: () => AppShell,
  propsSchema: () => propsSchema,
});
module.exports = __toCommonJS(AppShell_exports);
var React = require("react");
function AppShell() {
  return React.createElement("View", null);
}
var propsSchema = { type: "object", properties: {} };
