import assert from "node:assert/strict";
import test from "node:test";
import {
  deathDurabilityLoss,
  isBroken,
  repairCost,
} from "./durabilityConfig.js";

test("death durability loss is meaningful but never destructive", () => {
  assert.equal(deathDurabilityLoss(100), 10);
  assert.equal(deathDurabilityLoss(1), 1);
  assert.equal(deathDurabilityLoss(0), 0);
});

test("broken means zero durability only for repairable items", () => {
  assert.equal(isBroken(0, 75), true);
  assert.equal(isBroken(1, 75), false);
  assert.equal(isBroken(0, 0), false);
});

test("repair price scales with missing durability and rounds safely", () => {
  const item = { buyPrice: 75 };
  assert.equal(repairCost(item, 100, 100), 0);
  assert.equal(repairCost(item, 50, 100), 12);
  assert.equal(repairCost(item, 0, 100), 23);
});
