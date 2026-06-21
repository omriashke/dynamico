/** esbuild bundle with named data export + default component (Colors shape). */
var index_exports = {};
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
__export(index_exports, {
  DEFAULT_COLORS: () => DEFAULT_COLORS,
  Colors: () => Colors,
  default: () => ColorsPreview,
  propsSchema: () => propsSchema,
});
module.exports = __toCommonJS(index_exports);
var DEFAULT_COLORS = { black: "#000000", primary: "#F53071" };
var Colors = { ...DEFAULT_COLORS };
function ColorsPreview() {
  return null;
}
var propsSchema = {};
