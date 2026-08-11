import assert from "node:assert/strict";
import test from "node:test";
import { createItemData, normalizeDurability } from "./itemization.js";

test("every newly created wearable starts at full durability", () => {
  const item = createItemData("iron_shortsword", 1);
  assert.equal(item.durability, 100);
  assert.equal(item.maxDurability, 100);
});

test("legacy 0/0 wearable save is restored from the item catalog", () => {
  assert.deepEqual(normalizeDurability("leather_chest", 0, 0), {
    durability: 90,
    maxDurability: 90,
  });
});

test("zero durability remains zero for a real durability-enabled instance", () => {
  assert.deepEqual(normalizeDurability("leather_chest", 0, 90), {
    durability: 0,
    maxDurability: 90,
  });
});

test("consumables remain outside the durability system", () => {
  assert.deepEqual(normalizeDurability("meat", 0, 0), {
    durability: 0,
    maxDurability: 0,
  });
});
