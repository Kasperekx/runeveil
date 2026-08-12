import { load } from "js-yaml";
import skillsYaml from "../data/skills.yaml?raw";

export type SkillId = string;

export interface SkillConfig {
  id: SkillId;
  name: string;
  description: string;
  icon: string;
  /** Empty = all classes. */
  classes: string[];
  rank: number;
  school: string;
  schoolLabel: string;
  /** Sticky combat target required to cast. */
  requiresTarget: boolean;
  cooldownMs: number;
  range: number;
  coneDegrees: number;
  /** Per point of Strength. */
  strengthScale: number;
  /** Per point of equipped weapon damage. */
  weaponScale: number;
  /** Combat resource spent on cast (0 = free). */
  resourceCost: number;
  vfx: string;
}

interface SkillYamlEntry {
  name: string;
  description: string;
  icon: string;
  classes?: string[];
  rank?: number;
  school?: string;
  schoolLabel?: string;
  requiresTarget?: boolean;
  cooldownMs: number;
  range: number;
  coneDegrees: number;
  strengthScale: number;
  weaponScale: number;
  resourceCost?: number;
  vfx: string;
}

interface SkillsYamlFile {
  skills: Record<string, SkillYamlEntry>;
}

let catalog: Record<SkillId, SkillConfig> = {};

export async function loadSkillCatalog(): Promise<void> {
  const parsed = load(skillsYaml) as SkillsYamlFile;

  if (!parsed?.skills || typeof parsed.skills !== "object") {
    throw new Error("Invalid skills.yaml: missing skills map");
  }

  const next: Record<SkillId, SkillConfig> = {};

  for (const [id, entry] of Object.entries(parsed.skills)) {
    next[id] = normalizeSkill(id, entry);
  }

  catalog = next;
}

function normalizeSkill(id: string, entry: SkillYamlEntry): SkillConfig {
  const classes = (entry.classes ?? [])
    .map((c) => String(c).trim())
    .filter(Boolean);
  return {
    id,
    name: entry.name,
    description: entry.description.trim(),
    icon: entry.icon,
    classes,
    rank: Math.max(1, Math.floor(entry.rank ?? 1)),
    school: entry.school ?? "physical",
    schoolLabel: entry.schoolLabel ?? "Fizyczna",
    requiresTarget: Boolean(entry.requiresTarget),
    cooldownMs: Math.max(0, Math.floor(entry.cooldownMs)),
    range: Math.max(0, entry.range),
    coneDegrees: Math.max(0, Math.min(360, entry.coneDegrees)),
    strengthScale: Math.max(0, entry.strengthScale),
    weaponScale: Math.max(0, entry.weaponScale),
    resourceCost: Math.max(0, Math.floor(entry.resourceCost ?? 0)),
    vfx: entry.vfx,
  };
}

export function getSkill(id: SkillId): SkillConfig {
  const skill = catalog[id];
  if (!skill) {
    throw new Error(`Unknown skill id: ${id}`);
  }
  return skill;
}

export function hasSkill(id: SkillId): boolean {
  return id in catalog;
}

export function listSkills(): SkillConfig[] {
  return Object.values(catalog);
}

export function listSkillsForClass(classId: string): SkillConfig[] {
  return listSkills().filter((skill) => skillUsableByClass(skill, classId));
}

export function skillUsableByClass(
  skill: SkillConfig,
  classId: string,
): boolean {
  if (skill.classes.length === 0) return true;
  return skill.classes.includes(classId);
}

/** Skill damage range from strength + weapon min/max scales. */
export function skillDamageRange(
  skill: SkillConfig,
  strength: number,
  weaponMin: number,
  weaponMax: number,
): { min: number; max: number } {
  const min = Math.max(
    1,
    Math.round(strength * skill.strengthScale + weaponMin * skill.weaponScale),
  );
  const max = Math.max(
    min,
    Math.round(strength * skill.strengthScale + weaponMax * skill.weaponScale),
  );
  return { min, max };
}

/** Average skill damage (for compact displays). */
export function skillPower(
  skill: SkillConfig,
  strength: number,
  weaponDamage: number,
): number {
  return Math.max(
    1,
    strength * skill.strengthScale + weaponDamage * skill.weaponScale,
  );
}
