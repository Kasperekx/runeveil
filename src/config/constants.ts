/**
 * Sprite / scale standards
 * - Creature & item art: 64×64 canvas, nearest-neighbor
 * - Item icon content: max 32×32 px inside the canvas
 * - Item world pickup: ~24px on screen (ITEM_WORLD_SCALE × 32)
 * - Creatures: drawn at scale 1 (full canvas footprint)
 */
export const SPRITE_CANVAS_SIZE = 64;
export const ITEM_ICON_CONTENT_MAX = 32;
export const ITEM_WORLD_DISPLAY_MAX = 24;
export const ITEM_WORLD_SCALE = ITEM_WORLD_DISPLAY_MAX / ITEM_ICON_CONTENT_MAX;

/** Fallback walk speed (px/s) before sheet sync; live value is level-scaled. */
export const PLAYER_SPEED = 110;
export const PLAYER_ANIM_FPS = 8;
/** Slow breathe while standing; frames ping-pong for a smooth loop. */
export const PLAYER_IDLE_FPS = 2.5;
/** Three-frame strike: slower swing for weightier melee. */
export const PLAYER_ATTACK_FPS = 5;
/** Attack animation frame index (0-based) that deals damage. */
export const PLAYER_ATTACK_HIT_FRAME = 1;

/** @deprecated Use ATTACK_* from config/combat.ts */
export {
  ATTACK_RANGE as PLAYER_ATTACK_RANGE,
  ATTACK_COOLDOWN_MS as PLAYER_ATTACK_COOLDOWN_MS,
  ATTACK_CLICK_RADIUS as PLAYER_ATTACK_CLICK_RADIUS,
} from "./combat";
/** Player body radius for blocking against animals. */
export const PLAYER_COLLISION_RADIUS = 16;
export const MAX_DELTA_MS = 50;

/** Click must land within this of an NPC's anchor point to select/talk. */
export const NPC_CLICK_RADIUS = 44;
/** Player must stand within this of an NPC to open dialogue — 2 tiles (64px each). */
export const NPC_TALK_RANGE = 128;

/** How close the camera sits on the player (>1 = zoomed in). */
export const CAMERA_ZOOM = 2.65;

export const INVENTORY_COLUMNS = 6;
/** Default/offline grid size — matches starter backpack `capacity: 8`. */
export const INVENTORY_SLOT_COUNT = 8;
export const INVENTORY_CLOSE_MS = 200;
/** Bag sockets under the grid; must match BAG_SLOT_COUNT in server bagConfig. */
export const BAG_SLOT_COUNT = 4;
/** First bag socket — permanent main backpack (cannot unequip / replace). */
export const MAIN_BAG_INDEX = 0;
/** Default loadout: main backpack + three empty sockets. */
export const STARTER_BAGS = ["backpack", "", "", ""] as const;

/** Fade-out duration for the character panel; matches its CSS transition. */
export const CHARACTER_PANEL_CLOSE_MS = 180;

export const PICKUP_RADIUS = 48;
export const DROP_PICKUP_DELAY_MS = 700;

export const APP_BACKGROUND = "#1a2a22";
export const DRAG_SLOT_MIME = "application/x-mmo-slot";
/** Drag payload for an equipped bag socket → inventory. */
export const DRAG_BAG_MIME = "application/x-mmo-bag";
/** Drag payload for a worn equipment slot → inventory. Value is the slotId. */
export const DRAG_EQUIP_MIME = "application/x-mmo-equip";
/** Drag payload for a skill from the skills panel → action bar. Value is skillId. */
export const DRAG_SKILL_MIME = "application/x-mmo-skill";
/** Drag payload for moving a binding between action-bar slots. Value is slot index. */
export const DRAG_ACTION_MIME = "application/x-mmo-action";
