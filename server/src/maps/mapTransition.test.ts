import assert from "node:assert/strict";
import test from "node:test";
import { loadMapById } from "./loadMap.js";
import { findMapTransition, resolveMapArrival } from "./mapTransition.js";

test("tavern door resolves the configured indoor arrival", () => {
  const outdoors = loadMapById("hunting_grounds");
  const tavern = loadMapById("hunters-tavern");
  const door = outdoors.props.find((prop) => {
    const candidate = outdoors.propTypes[prop.type]?.interaction;
    return candidate?.kind === "enter" && candidate.targetMapId === tavern.id;
  });
  assert.ok(door);
  const interaction = outdoors.propTypes[door.type]!.interaction!;
  assert.equal(interaction.kind, "enter");

  const match = findMapTransition(
    outdoors,
    door.x + (interaction.offsetX ?? 0),
    door.y + (interaction.offsetY ?? 0),
    tavern.id,
  );
  assert.ok(match);
  assert.deepEqual(resolveMapArrival(tavern, match.targetEntryId), {
    x: 384,
    y: 370,
  });
});

test("door transition is rejected outside activation range", () => {
  const outdoors = loadMapById("hunting_grounds");
  assert.equal(
    findMapTransition(outdoors, 40, 40, "hunters-tavern"),
    null,
  );
});

test("interior has no animal spawns", () => {
  assert.deepEqual(loadMapById("hunters-tavern").spawns.animals, []);
});
