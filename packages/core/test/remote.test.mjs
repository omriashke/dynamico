import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteSource } from "../dist/sources/remote.js";

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState === MockWebSocket.CLOSED) return;
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateMessage(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function latestWs() {
  return MockWebSocket.instances.at(-1);
}

function remoteOptions(overrides = {}) {
  return {
    url: "http://127.0.0.1:4000",
    WebSocket: MockWebSocket,
    reconnectMs: 60_000,
    fetch: async () => ({ ok: true, json: async () => ({ name: "X", version: "1", code: "" }) }),
    ...overrides,
  };
}

test("createRemoteSource does not open WebSocket until first watch()", async () => {
  MockWebSocket.instances = [];
  const source = createRemoteSource(remoteOptions());

  assert.equal(MockWebSocket.instances.length, 0);
  const release = source.watch("Button");
  await sleep(20);
  assert.equal(MockWebSocket.instances.length, 1);
  assert.match(MockWebSocket.instances[0].url, /ws:\/\/127\.0\.0\.1:4000\/subscribe/);

  release();
  source.dispose();
  await sleep(20);
});

test("createRemoteSource sends watch set on connect and when watch list changes", async () => {
  MockWebSocket.instances = [];
  const source = createRemoteSource(remoteOptions());

  const releaseA = source.watch("Button");
  await sleep(30);
  const ws = latestWs();
  assert.ok(ws?.sent.some((m) => m.op === "watch" && m.names.includes("Button")));

  const releaseB = source.watch("Colors");
  await sleep(20);
  assert.ok(ws.sent.some((m) => m.op === "watch" && m.names.includes("Colors")));

  releaseA();
  await sleep(20);
  assert.ok(ws.sent.some((m) => m.op === "watch" && m.names.length === 1 && m.names[0] === "Colors"));

  releaseB();
  source.dispose();
  await sleep(20);
});

test("createRemoteSource ref-counts watch per component name", async () => {
  MockWebSocket.instances = [];
  const source = createRemoteSource(remoteOptions());

  const a = source.watch("Button");
  const b = source.watch("Button");
  await sleep(30);
  const ws = latestWs();
  assert.ok(ws?.sent.some((m) => m.op === "watch" && m.names.includes("Button")));

  a();
  await sleep(20);
  assert.ok(ws.sent.some((m) => m.op === "watch" && m.names.includes("Button")));

  b();
  source.dispose();
  await sleep(20);
  assert.equal(ws.readyState, MockWebSocket.CLOSED);
});

test("createRemoteSource delivers WS frames to subscribe listeners", async () => {
  MockWebSocket.instances = [];
  const source = createRemoteSource(remoteOptions());

  const seen = [];
  source.subscribe((update) => seen.push(update.module.name));

  source.watch("Button");
  await sleep(30);
  latestWs()?.simulateMessage({
    name: "Button",
    version: "2",
    code: "module.exports={default:function Button(){}}",
  });

  assert.deepEqual(seen, ["Button"]);
  source.dispose();
  await sleep(20);
});

test("createRemoteSource fetch returns compile error on HTTP failure", async () => {
  const source = createRemoteSource(
    remoteOptions({
      webSocket: false,
      fetch: async () => ({ ok: false, status: 404 }),
    }),
  );
  const mod = await source.fetch("Missing");
  assert.equal(mod.error?.kind, "compile");
  assert.match(mod.error?.message, /404/);
});

test("createRemoteSource webSocket:false skips watch side effects", async () => {
  MockWebSocket.instances = [];
  const source = createRemoteSource(remoteOptions({ webSocket: false }));
  const release = source.watch("Button");
  await sleep(0);
  assert.equal(MockWebSocket.instances.length, 0);
  release();
});
