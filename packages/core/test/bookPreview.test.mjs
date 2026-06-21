import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveBookFixtures,
  resolveBookPropValues,
  collectBookPreviewPropSets,
  validateBookPreviewsForComponent,
  normalizeBookPreviewConfig,
} from "../dist/bookPreview.js";

test("normalizeBookPreviewConfig maps legacy stories to entries", () => {
  const config = normalizeBookPreviewConfig({
    stories: [{ id: "demo", blocks: [] }],
  });
  assert.equal(config.entries?.[0]?.id, "demo");
});

test("resolveBookFixtures merges top-level and nested $fixture references", () => {
  const fixtures = {
    card: { title: "Hello", variant: "default" },
  };
  const resolved = resolveBookFixtures(
    { $fixture: "card", variant: "tall" },
    fixtures,
  );
  assert.deepEqual(resolved, { title: "Hello", variant: "tall" });

  const nested = resolveBookFixtures(
    { data: { $fixture: "card", extra: true } },
    fixtures,
  );
  assert.deepEqual(nested.data, { title: "Hello", variant: "default", extra: true });
});

test("resolveBookPropValues converts $fn and $component DSL", () => {
  const props = resolveBookPropValues(
    {
      onPress: { $fn: "noop" },
      icon: { $component: "SearchIcon", props: { size: 16 } },
      label: "Go",
    },
    {},
  );
  assert.equal(typeof props.onPress, "function");
  assert.equal(props.icon, null);
  assert.equal(props.label, "Go");
});

test("collectBookPreviewPropSets gathers component, variantGrid, and nested props", () => {
  const sets = collectBookPreviewPropSets(
    {
      fixtures: { chip: { label: "News" } },
      entries: [
        {
          id: "TopicChip",
          blocks: [
            {
              type: "component",
              component: "TopicChip",
              props: { $fixture: "chip", variant: "selected" },
            },
            {
              type: "variantGrid",
              component: "TopicChip",
              variants: [
                { id: "default", props: { label: "All" } },
                { id: "selected", props: { label: "Politics", variant: "topicSelectionSelected" } },
              ],
            },
          ],
        },
      ],
    },
    "TopicChip",
  );
  assert.equal(sets.length, 3);
  assert.deepEqual(sets[0].props, { label: "News", variant: "selected" });
  assert.match(sets[2].location, /variant 'selected'/);
});

test("validateBookPreviewsForComponent validates book props against propsSchema", () => {
  const ok = validateBookPreviewsForComponent(
    { label: { type: "string", required: true } },
    {
      entries: [
        {
          id: "TopicChip",
          blocks: [{ type: "component", component: "TopicChip", props: { label: "News" } }],
        },
      ],
    },
    "TopicChip",
  );
  assert.equal(ok.ok, true);

  const bad = validateBookPreviewsForComponent(
    { label: { type: "string", required: true } },
    {
      entries: [
        {
          id: "TopicChip",
          blocks: [{ type: "component", component: "TopicChip", props: { label: 123 } }],
        },
      ],
    },
    "TopicChip",
  );
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /TopicChip/);
});
