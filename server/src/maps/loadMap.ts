import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collidersFromMap,
  collidersForProp,
  type MapDocument,
} from "@mmo/shared/maps/types";

export type {
  MapCircleCollider,
  MapDocument,
  MapPropType,
} from "@mmo/shared/maps/types";
export { collidersFromMap, collidersForProp };

const DEFAULT_MAP = "hunting_grounds.json";

const MAP_FILES: Record<string, string> = {
  hunting_grounds: "hunting_grounds.json",
  "hunters-tavern": "hunters-tavern.json",
};

/** Load map JSON from repo public/maps (shared with the client). */
export function loadMap(name = DEFAULT_MAP): MapDocument {
  const file = MAP_FILES[name] ?? (name.endsWith(".json") ? name : DEFAULT_MAP);
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../public/maps", file);
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw) as MapDocument;
  if (!data?.id || !data.playable || !data.spawns?.animals) {
    throw new Error(`Invalid map: ${file}`);
  }
  return data;
}

export function loadMapById(mapId: string): MapDocument {
  const file = MAP_FILES[mapId];
  if (!file) throw new Error(`Unknown map id: ${mapId}`);
  return loadMap(file);
}

export function knownMapIds(): string[] {
  return Object.keys(MAP_FILES);
}
