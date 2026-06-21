import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createServer } from "../dist/server.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTempSourceDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "dynamico-ws-test-"));
  writeFileSync(
    join(dir, "dynamico.config.json"),
    JSON.stringify({
      version: 1,
      components: {
        Foo: { path: "Foo.tsx", description: "test" },
        Bar: { path: "Bar.tsx", description: "test" },
      },
    }),
  );
  writeFileSync(join(dir, "Foo.tsx"), "export default function Foo(){ return null; }");
  writeFileSync(join(dir, "Bar.tsx"), "export default function Bar(){ return null; }");
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("WS /subscribe filters pushes by client watch list", async () => {
  await withTempSourceDir(async (sourceDir) => {
    const { app, store } = await createServer({ sourceDir, logger: false });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = app.server.address().port;

    try {
      const received = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/subscribe`);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });

      ws.onmessage = (ev) => received.push(JSON.parse(String(ev.data)));

      ws.send(JSON.stringify({ op: "watch", names: ["Foo"] }));
      await sleep(20);
      received.length = 0;

      store.set({ name: "Foo", version: "v-test-1", code: "module.exports={default:function Foo(){}}" });
      store.set({ name: "Bar", version: "v-test-1", code: "module.exports={default:function Bar(){}}" });
      await sleep(20);

      assert.equal(received.length, 1);
      assert.equal(received[0].name, "Foo");

      ws.send(JSON.stringify({ op: "watch", names: ["Foo", "Bar"] }));
      await sleep(20);
      store.set({ name: "Bar", version: "v-test-2", code: "module.exports={default:function Bar(){}}" });
      await sleep(20);

      assert.equal(received.at(-1).name, "Bar");
      ws.close();
    } finally {
      await app.close();
    }
  });
});

test("WS watch replays snapshots for watched names", async () => {
  await withTempSourceDir(async (sourceDir) => {
    const { app, store } = await createServer({ sourceDir, logger: false });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = app.server.address().port;

    try {
      store.set({
        name: "Foo",
        version: "snapshot-1",
        code: "module.exports={default:function Foo(){}}",
      });

      const received = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/subscribe`);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
      ws.onmessage = (ev) => received.push(JSON.parse(String(ev.data)));

      ws.send(JSON.stringify({ op: "watch", names: ["Foo"] }));
      await sleep(20);

      assert.equal(received.length, 1);
      assert.equal(received[0].version, "snapshot-1");
      ws.close();
    } finally {
      await app.close();
    }
  });
});

test("WS ignores malformed client frames without crashing", async () => {
  await withTempSourceDir(async (sourceDir) => {
    const { app } = await createServer({ sourceDir, logger: false });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = app.server.address().port;

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/subscribe`);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
      ws.send("not-json");
      ws.send(JSON.stringify({ op: "nope" }));
      ws.close();
      assert.ok(true);
    } finally {
      await app.close();
    }
  });
});
