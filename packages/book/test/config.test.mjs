import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBookConfig,
  sidebarSections,
  findEntry,
  bookConfigUrl,
} from "../dist/config.js";

test("normalizeBookConfig maps legacy stories to entries", () => {
  const config = normalizeBookConfig({
    title: "Book",
    stories: [{ id: "demo", label: "Demo" }],
  });
  assert.equal(config.entries?.[0]?.id, "demo");
});

test("sidebarSections falls back to flat catalog when sidebar missing", () => {
  const sections = sidebarSections({
    entries: [
      { id: "A", label: "A" },
      { id: "B", label: "B" },
    ],
  });
  assert.deepEqual(sections, [{ label: "Catalog", entries: ["A", "B"] }]);
});

test("sidebarSections respects explicit sidebar sections", () => {
  const sections = sidebarSections({
    entries: [{ id: "A" }, { id: "B" }],
    sidebar: { sections: [{ label: "UI", entries: ["A"] }] },
  });
  assert.deepEqual(sections, [{ label: "UI", entries: ["A"] }]);
});

test("findEntry returns matching catalog entry", () => {
  const entry = findEntry(
    { entries: [{ id: "TopicChip", label: "TopicChip" }] },
    "TopicChip",
  );
  assert.equal(entry?.label, "TopicChip");
  assert.equal(findEntry({ entries: [] }, "Missing"), undefined);
});

test("bookConfigUrl normalizes trailing slash", () => {
  assert.equal(bookConfigUrl("http://registry/"), "http://registry/book-config");
  assert.equal(bookConfigUrl("http://registry"), "http://registry/book-config");
});
