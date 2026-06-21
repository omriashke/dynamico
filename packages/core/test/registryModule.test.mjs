import test from "node:test";
import assert from "node:assert/strict";
import { createRegistryModuleSubscription } from "../dist/registryModule.js";
import { mockSource } from "./helpers/mockSource.mjs";

test("createRegistryModuleSubscription loads on first listener only", async () => {
  const source = mockSource({
    Colors: {
      name: "Colors",
      version: "1",
      code: "module.exports={Colors:{primary:'#F53071',black:'#000'}}",
    },
  });

  const sub = createRegistryModuleSubscription(
    source,
    () => ({}),
    "Colors",
    { primary: "#000", black: "#fff" },
  );

  assert.equal(source.fetchCalls.length, 0);
  assert.equal(sub.getSnapshot().primary, "#000");

  const off = sub.subscribe(() => {});
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(source.fetchCalls.length, 1);
  assert.equal(sub.getSnapshot().primary, "#F53071");
  assert.equal(sub.proxy.primary, "#F53071");

  off();
  assert.deepEqual(source.watchCalls, ["Colors"]);
});

test("createRegistryModuleSubscription hot-reloads from WS pushes", async () => {
  const source = mockSource({
    Colors: {
      name: "Colors",
      version: "1",
      code: "module.exports={Colors:{primary:'#111111'}}",
    },
  });

  const sub = createRegistryModuleSubscription(
    source,
    () => ({}),
    "Colors",
    { primary: "#000" },
  );
  sub.subscribe(() => {});
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sub.getSnapshot().primary, "#111111");

  source.modules.Colors = {
    name: "Colors",
    version: "2",
    code: "module.exports={Colors:{primary:'#222222'}}",
  };
  source.push({ name: "Colors", version: "2", code: source.modules.Colors.code });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sub.getSnapshot().primary, "#222222");
});
