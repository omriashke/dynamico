import test from "node:test";
import assert from "node:assert/strict";
import { validateProps } from "../dist/propsSchema.js";
import { generateDefaultProps } from "../dist/defaultProps.js";

test("validateProps accepts empty props when schema is undefined", () => {
  const result = validateProps(undefined, { anything: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validateProps reports missing required props", () => {
  const result = validateProps(
    { label: { type: "string", required: true } },
    {},
  );
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /missing required prop 'label'/);
});

test("validateProps checks primitive types", () => {
  const schema = {
    count: { type: "number", required: true },
    active: { type: "boolean", required: true },
    items: { type: "array", required: true },
  };
  const bad = validateProps(schema, { count: "1", active: 1, items: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 3);

  const good = validateProps(schema, { count: 1, active: false, items: [] });
  assert.equal(good.ok, true);
});

test("validateProps treats optional props as skippable", () => {
  const result = validateProps(
    { label: { type: "string", required: false } },
    {},
  );
  assert.equal(result.ok, true);
});

test("generateDefaultProps builds smoke-test bags from schema", () => {
  const props = generateDefaultProps({
    title: { type: "string", required: true },
    count: { type: "number", required: true },
    onPress: { type: "function", required: false },
  });
  assert.equal(typeof props.title, "string");
  assert.equal(typeof props.count, "number");
  assert.equal(typeof props.onPress, "function");
  assert.equal(props.onPress(), undefined);
});
