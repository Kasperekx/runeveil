import { load } from "js-yaml";
import attributesYaml from "@mmo/shared/data/attributes.yaml?raw";
import classesYaml from "@mmo/shared/data/classes.yaml?raw";

export interface PlayerAttributes {
  strength: number;
  agility: number;
  stamina: number;
  intellect: number;
  spirit: number;
}

export type AttrId = keyof PlayerAttributes;

export interface ClassDefinition {
  id: string;
  name: string;
  description: string;
  portrait: string;
  resource: "none" | "rage" | "mana" | "energy";
  base: PlayerAttributes;
  derived: {
    baseHp: number;
    hpPerStamina: number;
    baseDamage: number;
    damagePerStrength: number;
    baseMoveSpeed: number;
    moveSpeedPerLevel: number;
  };
  selection: {
    epithet: string;
    role: string;
    difficulty: number;
    armor: string;
    playstyle: string;
    rune: string;
    accent: string;
    preview: string;
    strengths: string[];
  };
}

export interface AttributeDefinition {
  id: AttrId;
  label: string;
  flavor: string;
  /** May include `{derivedKey}` placeholders from the class formula block. */
  effect: string;
}

interface ClassesYamlFile {
  defaultClass: string;
  equipmentSlots?: string[];
  classes: Record<
    string,
    {
      name: string;
      description?: string;
      portrait: string;
      resource?: string;
      base: PlayerAttributes;
      derived: ClassDefinition["derived"];
      selection?: Partial<ClassDefinition["selection"]>;
    }
  >;
}

interface AttributesYamlFile {
  attributes: Record<
    string,
    {
      label: string;
      flavor?: string;
      effect?: string;
    }
  >;
}

const ATTR_IDS: AttrId[] = [
  "strength",
  "agility",
  "stamina",
  "intellect",
  "spirit",
];

let defaultClassId = "warrior";
let equipmentSlots: string[] = [];
let catalog: Record<string, ClassDefinition> = {};
const attrCatalog: Record<AttrId, AttributeDefinition> = {
  strength: { id: "strength", label: "Siła", flavor: "", effect: "" },
  agility: { id: "agility", label: "Zręczność", flavor: "", effect: "" },
  stamina: { id: "stamina", label: "Wytrzymałość", flavor: "", effect: "" },
  intellect: { id: "intellect", label: "Inteligencja", flavor: "", effect: "" },
  spirit: { id: "spirit", label: "Duch", flavor: "", effect: "" },
};

/** Polish labels — filled from attributes.yaml on load. */
export const ATTR_LABELS: Record<AttrId, string> = {
  strength: "Siła",
  agility: "Zręczność",
  stamina: "Wytrzymałość",
  intellect: "Inteligencja",
  spirit: "Duch",
};

export async function loadClassCatalog(): Promise<void> {
  const parsed = load(classesYaml) as ClassesYamlFile;
  if (!parsed?.classes || !parsed.defaultClass) {
    throw new Error("Invalid classes.yaml");
  }

  defaultClassId = parsed.defaultClass;
  equipmentSlots = parsed.equipmentSlots ?? [];
  const next: Record<string, ClassDefinition> = {};
  for (const [id, entry] of Object.entries(parsed.classes)) {
    next[id] = {
      id,
      name: entry.name,
      description: (entry.description ?? "").trim(),
      portrait: entry.portrait,
      resource:
        entry.resource === "rage" ||
        entry.resource === "mana" ||
        entry.resource === "energy"
          ? entry.resource
          : "none",
      base: { ...entry.base },
      derived: { ...entry.derived },
      selection: {
        epithet: entry.selection?.epithet ?? "Wędrowiec",
        role: entry.selection?.role ?? "Przygoda",
        difficulty: Math.max(
          1,
          Math.min(3, Math.floor(entry.selection?.difficulty ?? 1)),
        ),
        armor: entry.selection?.armor ?? "Pancerz mieszany",
        playstyle: entry.selection?.playstyle ?? "Wszechstronny",
        rune: entry.selection?.rune ?? "ᚱ",
        accent: entry.selection?.accent ?? "copper",
        preview: entry.selection?.preview ?? entry.portrait,
        strengths: [...(entry.selection?.strengths ?? [])],
      },
    };
  }
  catalog = next;
  loadAttributeCatalog();
}

function loadAttributeCatalog(): void {
  const parsed = load(attributesYaml) as AttributesYamlFile;
  if (!parsed?.attributes) {
    throw new Error("Invalid attributes.yaml");
  }

  for (const id of ATTR_IDS) {
    const entry = parsed.attributes[id];
    if (!entry?.label) {
      throw new Error(`attributes.yaml missing "${id}.label"`);
    }
    attrCatalog[id] = {
      id,
      label: entry.label.trim(),
      flavor: (entry.flavor ?? "").trim(),
      effect: (entry.effect ?? "").trim(),
    };
    ATTR_LABELS[id] = attrCatalog[id].label;
  }
}

export function getDefaultClassId(): string {
  return defaultClassId;
}

export function getClass(id: string): ClassDefinition {
  const def = catalog[id] ?? catalog[defaultClassId];
  if (!def) throw new Error(`Unknown class: ${id}`);
  return def;
}

export function getClassName(id: string): string {
  return catalog[id]?.name ?? id;
}

export function listClasses(): ClassDefinition[] {
  return Object.values(catalog);
}

/** Walk speed in px/s: base + (level - 1) * perLevel (Tibia-lite). */
export function computeMoveSpeed(
  level: number,
  derived: ClassDefinition["derived"] = getClass(getDefaultClassId()).derived,
): number {
  const lvl = Math.max(1, Math.floor(level));
  return Math.max(
    1,
    Math.floor(derived.baseMoveSpeed + (lvl - 1) * derived.moveSpeedPerLevel),
  );
}

export function listEquipmentSlots(): string[] {
  return equipmentSlots;
}

/**
 * Hover copy for the character panel. Substitutes `{derived.*}` tokens from
 * the active class formula block into the YAML effect string.
 */
export function describeAttribute(
  attr: AttrId,
  derived: ClassDefinition["derived"],
): { title: string; effect: string; flavor: string } {
  const def = attrCatalog[attr];
  return {
    title: def.label,
    flavor: def.flavor,
    effect: applyDerivedTokens(def.effect, derived),
  };
}

function applyDerivedTokens(
  template: string,
  derived: ClassDefinition["derived"],
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = (derived as Record<string, number>)[key];
    if (typeof value !== "number") return `{${key}}`;
    return Number.isInteger(value) ? String(value) : String(value);
  });
}

export const EQUIPMENT_SLOT_LABELS: Record<string, string> = {
  head: "Głowa",
  neck: "Szyja",
  shoulders: "Ramiona",
  back: "Plecy",
  chest: "Tors",
  wrists: "Nadgarstki",
  hands: "Dłonie",
  waist: "Pas",
  legs: "Nogi",
  feet: "Stopy",
  finger1: "Pierścień 1",
  finger2: "Pierścień 2",
  trinket1: "Trinket 1",
  trinket2: "Trinket 2",
  mainHand: "Broń główna",
  offHand: "Lewa ręka",
};
