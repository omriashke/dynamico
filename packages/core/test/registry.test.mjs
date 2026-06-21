import test from "node:test";
import assert from "node:assert/strict";
import { Registry } from "../dist/registry.js";
import { mockSource } from "./helpers/mockSource.mjs";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  assert.equal(source.watchRefCount("Button"), 0);
});

test("Registry ingests WS push when component has active subscriber", async () => {
  const source = mockSource({});
  const registry = new Registry(source, { react: {} });
  const versions = [];

  registry.subscribe("Button", (entry) => versions.push(entry.version));

  source.push({
    name: "Button",
    version: "1",
    code: "module.exports={default:function Button(){}}",
  });
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(versions, ["1"]);
  assert.equal(typeof registry.peek("Button")?.factory?.default, "function");
});

test("Registry ensure() fetches over HTTP when module is not cached", async () => {
  const source = mockSource({
    WelcomeScreen: {
      name: "WelcomeScreen",
      version: "1",
      code: "module.exports={default:function WelcomeScreen(){}}",
    },
  });
  const registry = new Registry(source, { react: {} });

  await registry.ensure("WelcomeScreen");
  assert.deepEqual(source.fetchCalls, ["WelcomeScreen"]);
});

test("Registry keeps two subscribers on one watch until both unsubscribe", () => {
  const source = mockSource({});
  const registry = new Registry(source, { react: {} });

  const offA = registry.subscribe("Button", () => {});
  const offB = registry.subscribe("Button", () => {});
  assert.deepEqual(source.watchCalls, ["Button"]);

  offA();
  assert.equal(source.watchRefCount("Button"), 1);

  offB();
  assert.equal(source.watchRefCount("Button"), 0);
});

test("Registry notifies dependency subscribers when a relative import updates", async () => {
  const source = mockSource({
    Colors: {
      name: "Colors",
      version: "1",
      code: "module.exports={Colors:{primary:'#111'}}",
    },
    Button: {
      name: "Button",
      version: "1",
      code: `
        var Colors = require("../Colors").Colors;
        module.exports = { default: function Button(){ return Colors.primary; } };
      `,
    },
  });
  const registry = new Registry(source, { react: {} });

  await registry.ensure("Button");
  const parentVersions = [];
  registry.subscribe("Button", (entry) => parentVersions.push(entry.version));

  source.push({
    name: "Colors",
    version: "2",
    code: "module.exports={Colors:{primary:'#222'}}",
  });
  await registry.ensure("Colors");
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(parentVersions.length >= 1);
});

test("Registry records removal events from the source", async () => {
  const source = mockSource({
    Button: { name: "Button", version: "1", code: "module.exports={default:function Button(){}}" },
  });
  const registry = new Registry(source, { react: {} });
  let removalEntry;
  registry.subscribe("Button", (entry) => {
    if (entry.error) removalEntry = entry;
  });
  await registry.ensure("Button");

  source.push({ name: "Button", version: "dead", removed: true });
  for (let i = 0; i < 20; i++) {
    await sleep(5);
    if (removalEntry?.error) break;
  }

  assert.match(removalEntry?.error?.message ?? "", /removed/i);
  assert.equal(registry.peek("Button"), undefined);
});
