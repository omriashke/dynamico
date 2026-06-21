import test from "node:test";
import assert from "node:assert/strict";
import {
  readEntryFromUrl,
  writeEntryToUrl,
} from "../dist/entryUrl.js";

function installWindow(initial = {}) {
  const state = {
    hash: initial.hash ?? "",
    pathname: initial.pathname ?? "/",
    search: initial.search ?? "",
  };
  const listeners = new Map();

  globalThis.window = {
    location: state,
    history: {
      state: null,
      replaceState(_state, _title, url) {
        const parsed = new URL(url, "http://local.test");
        state.pathname = parsed.pathname;
        state.search = parsed.search;
        state.hash = parsed.hash;
      },
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    __emit(type) {
      listeners.get(type)?.();
    },
  };
  globalThis.history = globalThis.window.history;

  return state;
}

test.afterEach(() => {
  delete globalThis.window;
  delete globalThis.history;
});

test("readEntryFromUrl hash mode reads #entry id", () => {
  installWindow({ hash: "#TopicChip" });
  assert.equal(readEntryFromUrl({ mode: "hash" }), "TopicChip");
  assert.equal(readEntryFromUrl({ mode: "hash" }, ["Other"]), null);
});

test("writeEntryToUrl hash mode updates location hash", () => {
  const state = installWindow({ pathname: "/book/", search: "?x=1" });
  writeEntryToUrl("TopicChip", { mode: "hash" });
  assert.equal(state.hash, "#TopicChip");
});

test("readEntryFromUrl path mode resolves entry under basePath", () => {
  installWindow({ pathname: "/book/TopicChip" });
  assert.equal(
    readEntryFromUrl({ mode: "path", basePath: "/book/" }, ["TopicChip"]),
    "TopicChip",
  );
});

test("writeEntryToUrl path mode replaces pathname with base + entry", () => {
  const state = installWindow({ pathname: "/" });
  writeEntryToUrl("TopicChip", { mode: "path", basePath: "/book/" });
  assert.equal(state.pathname, "/book/TopicChip");
});

test("readEntryFromUrl path mode finds valid id in deep pathname when base mismatches", () => {
  installWindow({ pathname: "/legacy/prefix/TopicChip/extra" });
  assert.equal(
    readEntryFromUrl({ mode: "path", basePath: "/" }, ["TopicChip", "Other"]),
    "TopicChip",
  );
});
