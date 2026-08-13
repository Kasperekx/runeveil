import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface MapPlayableBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface MapPropType {
  texture: string;
  /** Client-only visual used while a gather node is depleted. */
  depletedTexture?: string;
  anchorX: number;
  anchorY: number;
  scale?: number;
  filter?: "nearest" | "linear";
  shadow?: {
    radiusX: number;
    radiusY: number;
    alpha?: number;
  };
  collisionRadius: number;
  /** Extra solid circles relative to the prop foot (wide wagons, etc.). */
  colliders?: Array<{ x?: number; y?: number; radius: number }>;
  interaction?:
    | {
        kind: "cooking";
        radius: number;
        stationId?: string;
        offsetX?: number;
        offsetY?: number;
      }
    | {
        kind: "enter";
        radius: number;
        offsetX?: number;
        offsetY?: number;
        activationRadius?: number;
        label?: string;
        targetMapId?: string;
        targetEntryId?: string;
      }
    | {
        kind: "mining";
        radius: number;
        offsetX?: number;
        offsetY?: number;
        activationRadius?: number;
        nodeId: string;
      };
  ambientEffect?: {
    kind: "campfire";
  };
  light?: {
    color: number;
    radius: number;
    intensity: number;
    flicker?: boolean;
    offsetX?: number;
    offsetY?: number;
  };
}

export interface MapPropInstance {
  type: string;
  x: number;
  y: number;
}

export interface MapAnimalSpawn {
  id: string;
  kind: string;
  x: number;
  y: number;
}

export interface MapNpcPlacement {
  id: string;
  npcId: string;
  x: number;
  y: number;
}

/** A world location at which trade-profession recipes may be crafted. */
export interface MapCookingStation {
  id: string;
  name: string;
  x: number;
  y: number;
  radius?: number;
  /** cooking = campfire/hearth; forge = anvil/smelter. Default cooking. */
  kind?: "cooking" | "forge";
}

/** Safe settlement used for player resurrection. */
export interface MapHome {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface MapEntryPoint {
  id: string;
  x: number;
  y: number;
}

export interface MapDocument {
  id: string;
  /** Client-side Tiled source; the server consumes the compiled fields below. */
  tiledMap?: string;
  width: number;
  height: number;
  tileSize: number;
  playable: MapPlayableBounds;
  lighting?: {
    mode: "world" | "interior";
    ambientColor?: number;
    ambientAlpha?: number;
    localLightVisibility?: number;
  };
  ground: { texture: string; tileScale?: number };
  propTypes: Record<string, MapPropType>;
  props: MapPropInstance[];
  spawns: {
    player: { x: number; y: number };
    animals: MapAnimalSpawn[];
  };
  /** Optional static NPC placements (vendors, etc.). */
  npcs?: MapNpcPlacement[];
  cookingStations?: MapCookingStation[];
  /** Resurrection points. The closest one to the death location is used. */
  homes?: MapHome[];
  /** Named, server-selected arrival points for doors and portals. */
  entryPoints?: MapEntryPoint[];
}

export interface MapCircleCollider {
  x: number;
  y: number;
  radius: number;
}

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

/** Default body radius for static map NPCs. */
const NPC_COLLISION_RADIUS = 20;

/** Solid circles for one prop instance (primary radius + optional extras). */
export function collidersForProp(
  def: Pick<MapPropType, "collisionRadius" | "colliders">,
  x: number,
  y: number,
): MapCircleCollider[] {
  const out: MapCircleCollider[] = [];
  if (def.collisionRadius > 0) {
    out.push({ x, y, radius: def.collisionRadius });
  }
  for (const extra of def.colliders ?? []) {
    if (extra.radius <= 0) continue;
    out.push({
      x: x + (extra.x ?? 0),
      y: y + (extra.y ?? 0),
      radius: extra.radius,
    });
  }
  return out;
}

export function collidersFromMap(map: MapDocument): MapCircleCollider[] {
  const out: MapCircleCollider[] = [];
  for (const prop of map.props) {
    const def = map.propTypes[prop.type];
    if (!def) continue;
    out.push(...collidersForProp(def, prop.x, prop.y));
  }
  for (const npc of map.npcs ?? []) {
    out.push({ x: npc.x, y: npc.y, radius: NPC_COLLISION_RADIUS });
  }
  return out;
}
