import assert from "node:assert/strict";
import test from "node:test";
import {
  rollLootTable,
  validateLootTable,
  type LootTableEntry,
} from "./lootTable.js";

function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

test("independent drops can leave a corpse empty", () => {
  const table: LootTableEntry[] = [
    { itemId: "meat", chance: 60, minQuantity: 1, maxQuantity: 1, group: null },
  ];
  assert.deepEqual(rollLootTable(table, sequence([0.8])), []);
});

test("accepted drop rolls an inclusive quantity range", () => {
  const table: LootTableEntry[] = [
    { itemId: "meat", chance: 60, minQuantity: 1, maxQuantity: 3, group: null },
  ];
  assert.deepEqual(rollLootTable(table, sequence([0.2, 0.99])), [
    { itemId: "meat", quantity: 3 },
  ]);
});

test("a loot group yields at most one item", () => {
  const table: LootTableEntry[] = [
    {
      itemId: "helm",
      chance: 20,
      minQuantity: 1,
      maxQuantity: 1,
      group: "gear",
    },
    {
      itemId: "chest",
      chance: 30,
      minQuantity: 1,
      maxQuantity: 1,
      group: "gear",
    },
  ];
  assert.deepEqual(rollLootTable(table, sequence([0.35])), [
    { itemId: "chest", quantity: 1 },
  ]);
  assert.deepEqual(rollLootTable(table, sequence([0.8])), []);
});

test("group probabilities above one hundred percent are rejected", () => {
  assert.throws(() =>
    validateLootTable("boar", [
      {
        itemId: "a",
        chance: 60,
        minQuantity: 1,
        maxQuantity: 1,
        group: "gear",
      },
      {
        itemId: "b",
        chance: 50,
        minQuantity: 1,
        maxQuantity: 1,
        group: "gear",
      },
    ]),
  );
});
