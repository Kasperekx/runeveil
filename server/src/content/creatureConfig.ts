import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { SHARED_DATA_DIR } from "@mmo/shared/data/dir";
import { getItemConfig } from "./itemConfig.js";
import { validateLootTable, type LootTableEntry } from "./lootTable.js";

export type CreatureKind = string;

export type LootEntry = LootTableEntry;

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
  minQuantity?: number;
  maxQuantity?: number;
  chance?: number;
  group?: string;
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

function parseLoot(creatureId: string, entry: CreatureYamlEntry): LootEntry[] {
  if (Array.isArray(entry.loot) && entry.loot.length > 0) {
    const loot = entry.loot
      .filter((row) => typeof row?.item === "string" && row.item.length > 0)
      .map((row) => {
        const legacyQuantity = Math.max(1, Math.floor(row.quantity ?? 1));
        return {
          itemId: row.item,
          chance: row.chance ?? 100,
          minQuantity: Math.max(
            1,
            Math.floor(row.minQuantity ?? legacyQuantity),
          ),
          maxQuantity: Math.max(
            1,
            Math.floor(row.maxQuantity ?? row.minQuantity ?? legacyQuantity),
          ),
          group: row.group?.trim() || null,
        };
      });
    for (const row of loot) {
      if (!getItemConfig(row.itemId)) {
        throw new Error(
          `Invalid loot table for ${creatureId}: unknown item "${row.itemId}"`,
        );
      }
    }
    validateLootTable(creatureId, loot);
    return loot;
  }
  if (entry.dropItem) {
    return [
      {
        itemId: entry.dropItem,
        chance: 100,
        minQuantity: Math.max(1, Math.floor(entry.dropQuantity ?? 1)),
        maxQuantity: Math.max(1, Math.floor(entry.dropQuantity ?? 1)),
        group: null,
      },
    ];
  }
  return [];
}

/** Shared with client: shared/data/creatures.yaml */
function loadYaml(): CreaturesYamlFile {
  const path = join(SHARED_DATA_DIR, "creatures.yaml");
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
        loot: parseLoot(id, entry),
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
