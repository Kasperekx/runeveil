import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { SHARED_DATA_DIR } from "@mmo/shared/data/dir";

export interface PlaceableCampfireConfig {
  id: string;
  collisionRadius: number;
  placeRange: number;
  cookingActivationRadius: number;
}

interface PlaceableCampfireYaml {
  id: string;
  anchorX: number;
  anchorY: number;
  collisionRadius: number;
  placeRange: number;
  cookingActivationRadius: number;
}

function loadConfig(): PlaceableCampfireConfig {
  const path = join(SHARED_DATA_DIR, "placeableCampfire.yaml");
  const raw = load(readFileSync(path, "utf8")) as PlaceableCampfireYaml;
  if (
    !raw?.id ||
    typeof raw.collisionRadius !== "number" ||
    typeof raw.placeRange !== "number" ||
    typeof raw.cookingActivationRadius !== "number"
  ) {
    throw new Error(`Invalid placeableCampfire.yaml at ${path}`);
  }
  if (raw.anchorX !== 0.5 || raw.anchorY !== 0.5) {
    throw new Error("placeableCampfire anchors must be 0.5 / 0.5");
  }
  return {
    id: raw.id,
    collisionRadius: raw.collisionRadius,
    placeRange: raw.placeRange,
    cookingActivationRadius: raw.cookingActivationRadius,
  };
}

/** Shared with client: shared/data/placeableCampfire.yaml */
export const PLACEABLE_CAMPFIRE = loadConfig();
