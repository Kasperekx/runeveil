import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

export type CreatureKind = string;

export interface LootEntry {
  itemId: string;
  quantity: number;
}

export interface CreatureKindConfig {
  name: string;
  speed: number;
  hitRadius: number;
  collisionRadius: number;
  maxHp: number;
  respawnMs: number;
  /** XP granted to the killer. */
  xp: number;
  loot: LootEntry[];
  attackDamage: number;
  attackRange: number;
  attackCooldownMs: number;
  aggroRange: number;
}

interface LootYamlEntry {
  item: string;
  quantity?: number;
}

interface CreatureYamlEntry {
  name: string;
  speed: number;
  hitRadius: number;
  collisionRadius: number;
  maxHp: number;
  respawnMs: number;
  xp?: number;
  loot?: LootYamlEntry[];
  /** @deprecated prefer loot[] */
  dropItem?: string;
  dropQuantity?: number;
  attackDamage?: number;
  attackRange?: number;
  attackCooldownMs?: number;
  aggroRange?: number;
}

interface CreaturesYamlFile {
  combat?: {
    playerAttackDamage?: number;
    playerMaxHp?: number;
  };
  creatures: Record<string, CreatureYamlEntry>;
}

function parseLoot(entry: CreatureYamlEntry): LootEntry[] {
  if (Array.isArray(entry.loot) && entry.loot.length > 0) {
    return entry.loot
      .filter((row) => typeof row?.item === "string" && row.item.length > 0)
      .map((row) => ({
        itemId: row.item,
        quantity: Math.max(1, Math.floor(row.quantity ?? 1)),
      }));
  }
  if (entry.dropItem) {
    return [
      {
        itemId: entry.dropItem,
        quantity: Math.max(1, Math.floor(entry.dropQuantity ?? 1)),
      },
    ];
  }
  return [];
}

/** Shared with client: src/data/creatures.yaml */
function loadYaml(): CreaturesYamlFile {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../src/data/creatures.yaml");
  const raw = readFileSync(path, "utf8");
  const parsed = load(raw) as CreaturesYamlFile;
  if (!parsed?.creatures) {
    throw new Error(`Invalid creatures.yaml at ${path}`);
  }
  return parsed;
}

const yaml = loadYaml();

export const CREATURE_KINDS: Record<string, CreatureKindConfig> =
  Object.fromEntries(
    Object.entries(yaml.creatures).map(([id, entry]) => [
      id,
      {
        name: entry.name,
        speed: entry.speed,
        hitRadius: entry.hitRadius,
        collisionRadius: entry.collisionRadius,
        maxHp: entry.maxHp,
        respawnMs: entry.respawnMs,
        xp: Math.max(0, Math.floor(entry.xp ?? 0)),
        loot: parseLoot(entry),
        attackDamage: entry.attackDamage ?? 8,
        attackRange: entry.attackRange ?? 44,
        attackCooldownMs: entry.attackCooldownMs ?? 1000,
        aggroRange: entry.aggroRange ?? 160,
      },
    ]),
  );

export const CREATURE_COLLISION: Record<string, number> = Object.fromEntries(
  Object.entries(CREATURE_KINDS).map(([id, c]) => [id, c.collisionRadius]),
);

export const PLAYER_COLLISION_RADIUS = 16;
export const PICKUP_RADIUS = 48;
export const DROP_PICKUP_DELAY_MS = 700;
export const SIM_INTERVAL_MS = 50;
/** Matches meat maxStack in items.yaml for now. */
export const MAX_STACK = 20;
