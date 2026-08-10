/** Shared map document shape (client + server). */

export interface MapPlayableBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface MapPropType {
  texture: string;
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
  interaction?: {
    kind: "cooking";
    /** World-space pointer hit radius around the prop anchor. */
    radius: number;
    /** Links this visual prop to a server-authoritative cooking station. */
    stationId?: string;
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
}

export interface MapHome {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface MapDocument {
  id: string;
  width: number;
  height: number;
  tileSize: number;
  playable: MapPlayableBounds;
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

export interface MapWorldInteraction {
  kind: "cooking";
  x: number;
  y: number;
  /** Maximum player distance required to activate the prop. */
  activationRadius: number;
  radius: number;
  stationId?: string;
}

/** Default body radius for static map NPCs (merchant, blacksmith, …). */
export const NPC_COLLISION_RADIUS = 20;

/** Build solid circles from props (+ optional offset colliders) and NPCs. */
export function collidersFromMap(map: MapDocument): MapCircleCollider[] {
  const out: MapCircleCollider[] = [];
  for (const prop of map.props) {
    const def = map.propTypes[prop.type];
    if (!def) continue;
    if (def.collisionRadius > 0) {
      out.push({ x: prop.x, y: prop.y, radius: def.collisionRadius });
    }
    for (const extra of def.colliders ?? []) {
      if (extra.radius <= 0) continue;
      out.push({
        x: prop.x + (extra.x ?? 0),
        y: prop.y + (extra.y ?? 0),
        radius: extra.radius,
      });
    }
  }
  for (const npc of map.npcs ?? []) {
    out.push({ x: npc.x, y: npc.y, radius: NPC_COLLISION_RADIUS });
  }
  return out;
}
