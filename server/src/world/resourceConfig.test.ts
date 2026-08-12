import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampResource,
  maxResourceFor,
  parseResourceKind,
  RESOURCE_MAX,
} from "./resourceConfig.js";

describe("resourceConfig", () => {
  it("parses known kinds and defaults to none", () => {
    assert.equal(parseResourceKind("rage"), "rage");
    assert.equal(parseResourceKind("mana"), "mana");
    assert.equal(parseResourceKind("energy"), "energy");
    assert.equal(parseResourceKind("wat"), "none");
    assert.equal(parseResourceKind(undefined), "none");
  });

  it("caps rage at 100", () => {
    assert.equal(maxResourceFor("rage"), 100);
    assert.equal(RESOURCE_MAX.rage, 100);
    assert.equal(clampResource(150, 100), 100);
    assert.equal(clampResource(-3, 100), 0);
    assert.equal(clampResource(12.9, 100), 12);
  });
});
