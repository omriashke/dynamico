import test from "node:test";
import assert from "node:assert/strict";
import { Registry } from "../dist/registry.js";

function mockSource(modules) {
  const listeners = new Set();
  const watchRefCounts = new Map();
  return {
    modules,
    fetchCalls: [],
    watchCalls: [],
    async fetch(name) {
      this.fetchCalls.push(name);
      return (
        this.modules[name] ?? {
          name,
          version: "0",
          error: { kind: "compile", message: "missing" },
        }
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    watch(name) {
      this.watchCalls.push(name);
      const next = (watchRefCounts.get(name) ?? 0) + 1;
      watchRefCounts.set(name, next);
      return () => {
        const count = (watchRefCounts.get(name) ?? 1) - 1;
        if (count <= 0) watchRefCounts.delete(name);
        else watchRefCounts.set(name, count);
      };
    },
    push(module) {
      for (const l of listeners) l({ module });
    },
  };
}

test("Registry caches WS pushes and does not fetch until ensure()", async () => {
  const source = mockSource({
    Button: { name: "Button", version: "1", code: "module.exports={default:function Button(){}}" },
    Colors: { name: "Colors", version: "1", code: "module.exports={Colors:{black:'#000'}}" },
  });
  const registry = new Registry(source, { react: {} });

  source.push({
    name: "Button",
    version: "1",
    code: "module.exports={default:function Button(){}}",
  });
  source.push({
    name: "Colors",
    version: "1",
    code: "module.exports={Colors:{black:'#000'}}",
  });

  assert.deepEqual(source.fetchCalls, []);
  assert.equal(registry.peek("Button"), undefined);

  await registry.ensure("Button");
  assert.equal(source.fetchCalls.length, 0);
  assert.equal(typeof registry.peek("Button")?.factory?.default, "function");
});

test("Registry watch starts on subscribe and stops when last listener leaves", () => {
  const source = mockSource({});
  const registry = new Registry(source, { react: {} });

  assert.deepEqual(source.watchCalls, []);

  const off = registry.subscribe("Button", () => {});
  assert.deepEqual(source.watchCalls, ["Button"]);

  off();
  assert.deepEqual(source.watchCalls, ["Button"]);
});
