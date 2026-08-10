import { load } from "js-yaml";
import creaturesYaml from "../data/creatures.yaml?raw";
import type { WanderingAnimalConfig } from "./WanderingAnimal";
import { creatureSpritePaths, type CreatureSpritePaths } from "./CreatureSprites";

export type CreatureId = string;

export interface CreatureLootEntry {
  itemId: string;
  quantity: number;
}

export interface CreatureDefinition {
  id: CreatureId;
  name: string;
  description: string;
  sprites: CreatureSpritePaths;
  speed: number;
  animFps: number;
  hitRadius: number;
  collisionRadius: number;
  maxHp: number;
  respawnMs: number;
  loot: CreatureLootEntry[];
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
  description?: string;
  sprites: { folder: string; filePrefix: string };
  speed: number;
  animFps: number;
  hitRadius: number;
  collisionRadius: number;
  maxHp: number;
  respawnMs: number;
  loot?: LootYamlEntry[];
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

let catalog: Record<CreatureId, CreatureDefinition> = {};
let playerMaxHp = 100;

function parseLoot(entry: CreatureYamlEntry): CreatureLootEntry[] {
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

/** Load shared creatures.yaml (call once at boot). */
export async function loadCreatureCatalog(): Promise<void> {
  const parsed = load(creaturesYaml) as CreaturesYamlFile;
  if (!parsed?.creatures || typeof parsed.creatures !== "object") {
    throw new Error("Invalid creatures.yaml: missing creatures map");
  }

  const next: Record<CreatureId, CreatureDefinition> = {};
  for (const [id, entry] of Object.entries(parsed.creatures)) {
    next[id] = {
      id,
      name: entry.name,
      description: (entry.description ?? "").trim(),
      sprites: creatureSpritePaths(entry.sprites.folder, entry.sprites.filePrefix),
      speed: entry.speed,
      animFps: entry.animFps,
      hitRadius: entry.hitRadius,
      collisionRadius: entry.collisionRadius,
      maxHp: entry.maxHp,
      respawnMs: entry.respawnMs,
      loot: parseLoot(entry),
      attackDamage: entry.attackDamage ?? 8,
      attackRange: entry.attackRange ?? 44,
      attackCooldownMs: entry.attackCooldownMs ?? 1000,
      aggroRange: entry.aggroRange ?? 160,
    };
  }

  catalog = next;
  playerMaxHp = parsed.combat?.playerMaxHp ?? 100;
}

export function getCreature(id: CreatureId): CreatureDefinition {
  const creature = catalog[id];
  if (!creature) throw new Error(`Unknown creature id: ${id}`);
  return creature;
}

export function hasCreature(id: CreatureId): boolean {
  return id in catalog;
}

export function listCreatures(): CreatureDefinition[] {
  return Object.values(catalog);
}

export function getCreatureName(id: string): string {
  return catalog[id]?.name ?? id;
}

export function getCreatureMaxHp(id: string): number {
  return catalog[id]?.maxHp ?? 1;
}

export function getPlayerMaxHp(): number {
  return playerMaxHp;
}

/** Offline / legacy WanderingAnimal config from catalog. */
export function wanderingConfig(id: CreatureId): WanderingAnimalConfig {
  const c = getCreature(id);
  const first = c.loot[0];
  return {
    speed: c.speed,
    animFps: c.animFps,
    respawnMs: c.respawnMs,
    hitRadius: c.hitRadius,
    dropItem: first?.itemId ?? "meat",
    dropQuantity: first?.quantity ?? 1,
  };
}
