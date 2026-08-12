import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

export interface PlayerAttributes {
  strength: number;
  agility: number;
  stamina: number;
  intellect: number;
  spirit: number;
}

export interface ClassDerivedConfig {
  baseHp: number;
  hpPerStamina: number;
  baseDamage: number;
  damagePerStrength: number;
  /** Movement speed at level 1 (px/s). */
  baseMoveSpeed: number;
  /** Extra px/s gained each level after 1. */
  moveSpeedPerLevel: number;
}

export interface ClassDefinition {
  id: string;
  name: string;
  description: string;
  portrait: string;
  /** Combat resource for this class (`none` until mana/energy arrive). */
  resource: "none" | "rage" | "mana" | "energy";
  base: PlayerAttributes;
  derived: ClassDerivedConfig;
}

interface ClassYamlEntry {
  name: string;
  description?: string;
  portrait: string;
  resource?: string;
  base: PlayerAttributes;
  derived: ClassDerivedConfig;
}

interface ClassesYamlFile {
  defaultClass: string;
  equipmentSlots?: string[];
  classes: Record<string, ClassYamlEntry>;
}

function loadYaml(): ClassesYamlFile {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../src/data/classes.yaml");
  const parsed = load(readFileSync(path, "utf8")) as ClassesYamlFile;
  if (!parsed?.classes || !parsed.defaultClass) {
    throw new Error(`Invalid classes.yaml at ${path}`);
  }
  return parsed;
}

const yaml = loadYaml();

export const DEFAULT_CLASS_ID = yaml.defaultClass;

export const EQUIPMENT_SLOT_IDS: string[] = yaml.equipmentSlots ?? [
  "head",
  "neck",
  "shoulders",
  "back",
  "chest",
  "wrists",
  "hands",
  "waist",
  "legs",
  "feet",
  "finger1",
  "finger2",
  "trinket1",
  "trinket2",
  "mainHand",
  "offHand",
];

export const CLASSES: Record<string, ClassDefinition> = Object.fromEntries(
  Object.entries(yaml.classes).map(([id, entry]) => [
    id,
    {
      id,
      name: entry.name,
      description: (entry.description ?? "").trim(),
      portrait: entry.portrait,
      resource: parseClassResource(entry.resource),
      base: { ...entry.base },
      derived: { ...entry.derived },
    },
  ]),
);

function parseClassResource(
  raw: string | undefined,
): ClassDefinition["resource"] {
  if (raw === "rage" || raw === "mana" || raw === "energy") return raw;
  return "none";
}

export function getClass(id: string): ClassDefinition {
  const def = CLASSES[id] ?? CLASSES[DEFAULT_CLASS_ID];
  if (!def) throw new Error(`No class definition for ${id}`);
  return def;
}

export function computeMaxHp(
  attrs: PlayerAttributes,
  derived: ClassDerivedConfig = getClass(DEFAULT_CLASS_ID).derived,
): number {
  return Math.max(
    1,
    Math.floor(derived.baseHp + attrs.stamina * derived.hpPerStamina),
  );
}

export function computeAttackPower(
  attrs: PlayerAttributes,
  derived: ClassDerivedConfig = getClass(DEFAULT_CLASS_ID).derived,
): number {
  return Math.max(
    1,
    Math.floor(derived.baseDamage + attrs.strength * derived.damagePerStrength),
  );
}

/** Tibia-lite walk speed: base + gradual per-level gain (no agility yet). */
export function computeMoveSpeed(
  level: number,
  derived: ClassDerivedConfig = getClass(DEFAULT_CLASS_ID).derived,
): number {
  const lvl = Math.max(1, Math.floor(level));
  return Math.max(
    1,
    Math.floor(derived.baseMoveSpeed + (lvl - 1) * derived.moveSpeedPerLevel),
  );
}

export function emptyEquipment(): Record<
  string,
  {
    itemId: string;
    quantity: number;
    instanceId: string;
    rarity: string;
    affixesJson: string;
    durability: number;
    maxDurability: number;
  }
> {
  return Object.fromEntries(
    EQUIPMENT_SLOT_IDS.map((slot) => [
      slot,
      {
        itemId: "",
        quantity: 0,
        instanceId: "",
        rarity: "common",
        affixesJson: "[]",
        durability: 0,
        maxDurability: 0,
      },
    ]),
  );
}
