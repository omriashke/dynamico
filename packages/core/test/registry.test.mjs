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

test("Registry skips re-evaluation when WS pushes same version that is already loaded", async () => {
  const source = mockSource({});
  const registry = new Registry(source, { react: {} });

  // Subscribe so the push is eligible for ingest.
  const notifiedVersions = [];
  registry.subscribe("Button", (entry) => notifiedVersions.push(entry.version));

  // Push v1 — should evaluate and notify.
  source.push({
    name: "Button",
    version: "v1",
    code: "module.exports={default:function Button(){}}",
  });
  await new Promise((r) => setTimeout(r, 0));

  const firstFactory = registry.peek("Button")?.factory;
  assert.ok(firstFactory, "component should be loaded after first push");
  assert.deepEqual(notifiedVersions, ["v1"]);

  // Push the exact same version again (e.g. server replayed on WS reconnect).
  source.push({
    name: "Button",
    version: "v1",
    code: "module.exports={default:function Button(){}}",
  });
  await new Promise((r) => setTimeout(r, 0));

  // Entry must be the SAME object reference — no re-eval means no new identity.
  assert.strictEqual(
    registry.peek("Button"),
    registry.peek("Button"),
    "peek should return the same entry object",
  );
  assert.strictEqual(
    registry.peek("Button")?.factory,
    firstFactory,
    "factory should not be replaced when same version is pushed again",
  );

  // Listener must NOT have been called a second time.
  assert.deepEqual(
    notifiedVersions,
    ["v1"],
    "listener should not fire for a same-version push",
  );
});

test("Registry re-evaluates and notifies when a genuinely new version is pushed", async () => {
  const source = mockSource({});
  const registry = new Registry(source, { react: {} });

  const notifiedVersions = [];
  registry.subscribe("Button", (entry) => notifiedVersions.push(entry.version));

  source.push({
    name: "Button",
    version: "v1",
    code: "module.exports={default:function Button_v1(){}}",
  });
  await new Promise((r) => setTimeout(r, 0));

  const firstFactory = registry.peek("Button")?.factory;

  // Push v2 — a real update from `dynamico push`.
  source.push({
    name: "Button",
    version: "v2",
    code: "module.exports={default:function Button_v2(){}}",
  });
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(notifiedVersions, ["v1", "v2"], "listener should fire for a new version");
  assert.notStrictEqual(
    registry.peek("Button")?.factory,
    firstFactory,
    "factory should be replaced when a new version arrives",
  );
  assert.equal(registry.peek("Button")?.version, "v2");
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
