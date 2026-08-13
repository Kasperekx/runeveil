/** Shared map document shape (client + server). */

export interface MapPlayableBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface MapPropType {
  texture: string;
  /** Optional texture shown while a gatherable prop is depleted. */
  depletedTexture?: string;
  /** Optional looped sprite animation for an otherwise static map prop. */
  idleAnimation?: {
    frames: string[];
    fps: number;
  };
  anchorX: number;
  anchorY: number;
  /** Draw scale relative to texture size. */
  scale?: number;
  /** nearest keeps pixel edges; linear softens upscaled props. */
  filter?: "nearest" | "linear";
  /** Draw a ground shadow ellipse under the prop foot. */
  shadow?: {
    radiusX: number;
    radiusY: number;
    alpha?: number;
  };
  /** 0 = decorative only (world units at the prop foot). */
  collisionRadius: number;
  /** Extra solid circles relative to the prop foot (wide wagons, etc.). */
  colliders?: Array<{ x?: number; y?: number; radius: number }>;
  /**
   * `ground` — always under entities (short clutter like grass).
   * `world` (default) — Y-sorted with player/creatures (trees).
   */
  layer?: "ground" | "world";
  /** Optional click target exposed by a placed prop (e.g. a cooking fire). */
  interaction?:
    | {
        kind: "cooking";
        /** World-space pointer hit radius around the interaction point. */
        radius: number;
        /** Links this visual prop to a server-authoritative cooking station. */
        stationId?: string;
        /** Hit point relative to the prop foot (door, hearth, …). */
        offsetX?: number;
        offsetY?: number;
      }
    | {
        kind: "enter";
        /** World-space pointer hit radius around the door hotspot. */
        radius: number;
        offsetX?: number;
        offsetY?: number;
        /** How close the player must stand to enter. */
        activationRadius?: number;
        /** Prompt copy, e.g. "Karczma". */
        label?: string;
        /** Destination map id once interiors exist. */
        targetMapId?: string;
        /** Named safe arrival point on the destination map. */
        targetEntryId?: string;
      }
    | {
        kind: "mining";
        /** World-space pointer hit radius around the ore node. */
        radius: number;
        offsetX?: number;
        offsetY?: number;
        /** How close the player must stand to start mining. */
        activationRadius?: number;
        /** Key into professions.yaml mining.nodes. */
        nodeId: string;
      };
  /** Lightweight procedural visual layered above a static world prop. */
  ambientEffect?: {
    kind: "campfire";
  };
  /** Static light emitted by every placed instance of this prop. */
  light?: {
    /** RGB number, e.g. 0xffa34d for a warm fire. */
    color: number;
    /** Radius in world units. */
    radius: number;
    /** Strength of the soft light, usually 0.1–0.6. */
    intensity: number;
    /** Adds a subtle, irregular pulse (fire, lanterns). */
    flicker?: boolean;
    /** Fine-tunes the visual light centre relative to the prop anchor. */
    offsetX?: number;
    offsetY?: number;
  };
}

export interface MapGround {
  texture: string;
  /** Repeats the ground texture larger when > 1. */
  tileScale?: number;
}

/** Optional stone/dirt patches drawn above the base ground tile. */
export interface MapGroundPatch {
  texture: string;
  tileScale?: number;
  x: number;
  y: number;
  width: number;
  height: number;
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

/** A placed, interactable NPC (dialogue only — not combat, not networked). */
export interface MapNpcInstance {
  id: string;
  /** Key into src/data/npcs.yaml. */
  npcId: string;
  x: number;
  y: number;
}

export interface MapCookingStation {
  id: string;
  name: string;
  x: number;
  y: number;
  radius?: number;
  /** cooking = campfire/hearth; forge = anvil/smelter. Default cooking. */
  kind?: "cooking" | "forge";
}

export interface MapHome {
  id: string;
  name: string;
  x: number;
  y: number;
}

/** Named arrival point used by server-authoritative map transitions. */
export interface MapEntryPoint {
  id: string;
  x: number;
  y: number;
}

export interface MapLighting {
  /** Interiors keep a fixed ambience; world maps use the day/night cycle. */
  mode: "world" | "interior";
  ambientColor?: number;
  ambientAlpha?: number;
  localLightVisibility?: number;
}

export interface MapDocument {
  id: string;
  /** Optional Tiled source used to render authored terrain layers. */
  tiledMap?: string;
  width: number;
  height: number;
  tileSize: number;
  playable: MapPlayableBounds;
  lighting?: MapLighting;
  ground: MapGround;
  /** Optional overlays (e.g. stone plaza) above the base ground. */
  groundPatches?: MapGroundPatch[];
  propTypes: Record<string, MapPropType>;
  props: MapPropInstance[];
  /** Optional — maps authored before the NPC system omit this. */
  npcs?: MapNpcInstance[];
  /** Optional world cooking nodes. Crafting remains validated by the server. */
  cookingStations?: MapCookingStation[];
  /** Safe settlements used for resurrection. */
  homes?: MapHome[];
  entryPoints?: MapEntryPoint[];
  spawns: {
    player: { x: number; y: number };
    animals: MapAnimalSpawn[];
  };
}

export interface MapCircleCollider {
  x: number;
  y: number;
  radius: number;
}

export type MapWorldInteraction =
  | {
      kind: "cooking";
      x: number;
      y: number;
      /** Maximum player distance required to activate the prop. */
      activationRadius: number;
      radius: number;
      stationId?: string;
      /** Which craft recipes this station unlocks. Default cooking. */
      stationKind?: "cooking" | "forge";
    }
  | {
      kind: "enter";
      x: number;
      y: number;
      activationRadius: number;
      radius: number;
      label: string;
      targetMapId?: string;
      targetEntryId?: string;
    }
  | {
      kind: "mining";
      x: number;
      y: number;
      activationRadius: number;
      radius: number;
      nodeId: string;
      /** Stable id for deplete/respawn sync: mapId:type:x:y */
      nodeKey: string;
    };

/** Default body radius for static map NPCs (merchant, blacksmith, …). */
export const NPC_COLLISION_RADIUS = 20;

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

/** Build solid circles from props (+ optional offset colliders) and NPCs. */
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
