import assert from "node:assert/strict";
import test from "node:test";
import { deathExperienceLoss } from "./deathConfig.js";

test("death costs five percent of the current level requirement", () => {
  assert.equal(deathExperienceLoss(80, 100), 5);
  assert.equal(deathExperienceLoss(300, 550), 28);
});

test("death cannot remove a completed level", () => {
  assert.equal(deathExperienceLoss(3, 100), 3);
  assert.equal(deathExperienceLoss(0, 100), 0);
});

test("max-level characters do not lose stale experience", () => {
  assert.equal(deathExperienceLoss(50, 0), 0);
});
