import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../dist/store.js";

test("Store set/get round-trips CompiledModule", () => {
  const store = new Store();
  const mod = { name: "Button", version: "1", code: "module.exports={}" };
  store.set(mod);
  assert.deepEqual(store.get("Button"), mod);
});

test("Store set deduplicates identical version broadcasts", () => {
  const store = new Store();
  const mod = { name: "Button", version: "1", code: "a" };
  store.set(mod);
  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });
  store.set({ ...mod });
  assert.equal(calls, 0);
});

test("Store subscribe receives updates and remove broadcasts removal", () => {
  const store = new Store();
  const seen = [];
  const off = store.subscribe((m) => seen.push(m.name + ":" + m.version));

  store.set({ name: "A", version: "1", code: "" });
  store.set({ name: "B", version: "1", code: "" });
  store.remove("A");

  assert.equal(seen.length, 3);
  assert.match(seen[2], /^A:/);
  off();
});

test("Store list returns all modules", () => {
  const store = new Store();
  store.set({ name: "A", version: "1", code: "" });
  store.set({ name: "B", version: "2", code: "" });
  assert.deepEqual(store.list().map((m) => m.name).sort(), ["A", "B"]);
});

test("Store remove is no-op when module missing", () => {
  const store = new Store();
  assert.equal(store.remove("Missing"), undefined);
});
